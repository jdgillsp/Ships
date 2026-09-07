import http from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { inviteAddresses, isLoopback } from './InviteAddresses.mjs';
import * as defaultSimulation from '../src/game/Simulation.js';
import { RoomStore, RETENTION_MS } from './RoomStore.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const body = async req => {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 4096) throw new Error('Request too large.'); }
  return JSON.parse(raw || '{}');
};

export function createGameServer(simulation = defaultSimulation, options = {}) {
  const { createWorld, addPlayer, disconnectPlayer, setInput, act, tick, snapshot, STEP } = simulation;
  const rooms = new Map();
  const store = options.dataDir ? new RoomStore(options.dataDir) : null;
  const digest = token => typeof token === 'string' ? createHash('sha256').update(token).digest('hex') : '';
  let loaded = !store, stopping = false;
  const ready = store ? store.load().then(saved => {
    for (const r of saved) {
      const room = { world: r.world, touched: r.touched, tokens: new Map(r.tokens), streams: new Map(), departed: new Map(r.departed || []) };
      room.world.surveys ??= {}; room.world.course ??= null; room.world.signals = {};
      room.world.calls = {};
      for (const survey of Object.values(room.world.surveys)) survey.active = 0;
      for (const p of Object.values(room.world.players)) { disconnectPlayer(room.world, p.id); p.lastInput = room.world.time; if (!room.departed.has(p.id)) room.departed.set(p.id, Date.now()); }
      Object.assign(room.world.ship, { anchor: true, speed: 0, yawRate: 0, pilot: null }); room.world.winch = null;
      rooms.set(r.code, room);
    }
    loaded = true;
  }) : Promise.resolve();
  const persist = () => store ? store.save(rooms) : Promise.resolve();
  const autosave = () => { persist().catch(() => {}); };
  const stateFor = room => ({ ...snapshot(room.world), persistence: { enabled: !!store, savedAt: store?.savedAt ?? null, error: !!store?.error, retentionDays: store ? 30 : null } });
  const disconnect = (room, id) => {
    disconnectPlayer(room.world, id); if (!room.departed.has(id)) room.departed.set(id, Date.now());
    if (!Object.values(room.world.players).some(p => p.connected)) Object.assign(room.world.ship, { speed: 0, yawRate: 0, anchor: true });
  };
  const server = http.createServer(async (req, res) => {
    try {
      await ready;
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/health') return json(res, 200, { ok: true, rooms: rooms.size, persistence: { enabled: !!store, savedAt: store?.savedAt ?? null, error: !!store?.error } });
      if (url.pathname === '/api/invite-addresses' && req.method === 'GET') {
        const hostname = new URL(`http://${req.headers.host || 'unknown'}`).hostname;
        const localHost = isLoopback(hostname) || hostname === 'localhost' || hostname.endsWith('.localhost');
        const addresses = localHost && isLoopback(req.socket.remoteAddress) ? inviteAddresses(server.address(), (options.networkInterfaces || networkInterfaces)()) : [];
        return json(res, 200, { addresses });
      }
      if (url.pathname === '/api/rooms' && req.method === 'POST') {
        if (rooms.size >= 100) return json(res, 503, { error: 'The server is full. Try again later.' });
        const code = randomBytes(9).toString('base64url');
        rooms.set(code, { world: createWorld(), tokens: new Map(), streams: new Map(), departed: new Map(), touched: Date.now() });
        return json(res, 201, { room: code });
      }
      const match = url.pathname.match(/^\/api\/rooms\/([\w-]{12})\/(join|events|input|action|leave)$/);
      if (match) {
        const [, code, operation] = match, room = rooms.get(code);
        if (!room) return json(res, 404, { error: 'This expedition has expired. Start a new expedition.' });
        if (operation === 'join' && req.method === 'POST') {
          const data = await body(req); let id = room.tokens.get(digest(data.token)), token = data.token;
          if (data.resume && !id) return json(res, 409, { error: 'This crew identity is no longer available. Join using the invite to return as a new crewmate.' });
          if (!id) {
            // Retain returning identities while room is available. Reclaim an
            // offline slot only when a new crewmate actually needs the space.
            for (const p of Object.values(room.world.players)) if (Object.keys(room.world.players).length >= 4 && !p.connected && Date.now() - (room.departed.get(p.id) ?? Date.now()) > 120_000) {
              delete room.world.players[p.id]; for (const [t, pid] of room.tokens) if (pid === p.id) room.tokens.delete(t);
              room.departed.delete(p.id);
            }
            id = randomUUID(); token = randomBytes(24).toString('base64url');
            addPlayer(room.world, id, data.name || `Crew ${Object.keys(room.world.players).length + 1}`);
            room.tokens.set(digest(token), id);
          } else addPlayer(room.world, id);
          room.touched = Date.now(); room.departed.delete(id); await persist().catch(() => {});
          return json(res, 200, { id, token, room: code, state: stateFor(room) });
        }
        const token = req.headers.authorization?.replace(/^Bearer /, '') || url.searchParams.get('token');
        const id = room.tokens.get(digest(token));
        if (!id || !room.world.players[id]) return json(res, 401, { error: 'Join the expedition again.' });
        room.touched = Date.now();
        if (operation === 'events' && req.method === 'GET') {
          room.streams.get(id)?.end();
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          room.streams.set(id, res); room.departed.delete(id); room.world.players[id].connected = true; room.world.players[id].lastInput = room.world.time;
          res.write(`data: ${JSON.stringify(stateFor(room))}\n\n`);
          req.on('close', () => { if (room.streams.get(id) === res) { room.streams.delete(id); disconnect(room, id); if (!stopping) autosave(); } });
          return;
        }
        if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
        const data = await body(req);
        if (operation === 'input') { setInput(room.world, id, data); return json(res, 200, { ok: true }); }
        if (operation === 'action') { const result = act(room.world, id, data.action, data); if (result.ok) await persist().catch(() => {}); return json(res, result.ok ? 200 : 409, result); }
        if (operation === 'leave') {
          // A failed checkpoint leaves the player connected so they can retry.
          try { await persist(); } catch { return json(res, 503, { error: 'The expedition could not be saved. You are still aboard; please retry in a moment.' }); }
          const stream = room.streams.get(id); room.streams.delete(id); disconnect(room, id); stream?.end(); autosave();
          return json(res, 200, { ok: true, saved: !!store, savedAt: store?.savedAt ?? null });
        }
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Unknown endpoint.' });
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Use GET.' });
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(root + path.sep)) return json(res, 403, { error: 'Forbidden.' });
      if (!(await stat(file).catch(() => null))?.isFile()) return json(res, 404, { error: 'File not found. Run npm run build first, or use the Vite development URL.' });
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch (error) { if (!res.headersSent) json(res, 400, { error: error.message }); else res.end(); }
  });
  let count = 0;
  const interval = setInterval(() => {
    if (!loaded || stopping) return;
    count++;
    for (const [code, room] of rooms) {
      const expiry = store && Object.keys(room.world.players).length ? RETENTION_MS : 30 * 60_000;
      if (!room.streams.size && Date.now() - room.touched > expiry) { rooms.delete(code); continue; }
      if (Object.values(room.world.players).some(p => p.connected)) tick(room.world, STEP);
      // A half-open TCP/SSE connection is not proof that a captain can still
      // control the ship. Expire stations if client heartbeats stop arriving.
      for (const [id, player] of Object.entries(room.world.players)) if (player.connected && room.world.time - player.lastInput > 4) {
        const stream = room.streams.get(id);
        // This is an intentional reconnect, so finish the HTTP response. An
        // abrupt socket destroy reports corrupt chunking during a slow load.
        room.streams.delete(id); disconnect(room, id); stream?.end();
      }
      if (count % 2 === 0) {
        const event = `data: ${JSON.stringify(stateFor(room))}\n\n`;
        for (const stream of room.streams.values()) { if (stream.writableLength < 256_000) stream.write(event); else stream.destroy(); }
      }
    }
    if (count % 100 === 0 && store) autosave();
  }, STEP * 1000);
  server.on('close', () => clearInterval(interval));
  let stopPromise;
  const stop = () => stopPromise ??= (async () => {
    stopping = true; clearInterval(interval); await ready;
    for (const room of rooms.values()) for (const id of Object.keys(room.world.players)) { room.streams.get(id)?.end(); disconnect(room, id); }
    server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve));
    await persist();
  })();
  return { server, rooms, ready, stop, flush: persist, store };
}

if (!new URL(import.meta.url).search && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, ready, stop } = createGameServer(defaultSimulation, { dataDir: process.env.EXPEDITION_DATA_DIR || path.resolve(root, '../.expeditions') });
  await ready;
  server.listen(Number(process.env.PORT || 8787), process.env.HOST || '0.0.0.0', () => console.log(`Expedition server listening on http://localhost:${server.address().port}`));
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (closing) return; closing = true; stop().catch(error => { console.error('Unable to finish saving expeditions:', error.message); process.exitCode = 1; }); });
}
