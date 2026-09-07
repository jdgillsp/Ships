export class Connection {
  constructor(onState, onStatus) { this.onState = onState; this.onStatus = onStatus; this.ready = false; this.pending = false; this.samples = []; }
  async request(path, data, authenticated = true) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated && this.token ? { Authorization: `Bearer ${this.token}` } : {}) }, body: JSON.stringify(data), signal: AbortSignal.timeout(6000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || result.message || 'Unable to reach the expedition server.');
    return result;
  }
  async join(room, name, resumeToken) {
    clearInterval(this.heartbeat); this.events?.close(); this.ready = false; this.samples = [];
    this.onStatus('Connecting to the expedition…');
    if (!room) room = (await this.request('/api/rooms', {}, false)).room;
    // Retrying this live room must work even when browser storage is denied.
    // Credentials from another room must never become its resume identity.
    let saved = resumeToken || (this.room === room ? this.token : undefined);
    if (!saved) try { saved = sessionStorage.getItem(`kestrel:${room}`); } catch {}
    if (this.room !== room) { this.id = undefined; this.token = undefined; }
    this.room = room;
    const result = await this.request(`/api/rooms/${room}/join`, { name, token: saved, resume: !!resumeToken }, false);
    this.id = result.id; this.token = result.token;
    try { sessionStorage.setItem(`kestrel:${room}`, this.token); } catch {}
    this.receive(result.state);
    this.events?.close();
    this.events = new EventSource(`/api/rooms/${room}/events?token=${encodeURIComponent(this.token)}`);
    this.events.onmessage = event => { this.ready = true; this.onStatus('Connected'); this.receive(JSON.parse(event.data)); };
    this.events.onerror = () => { this.ready = false; this.onStatus(this.events.readyState === EventSource.CLOSED ? 'The expedition is unavailable. Retry or start a new expedition.' : 'Connection interrupted. Reconnecting…'); };
    this.heartbeat = setInterval(() => {
      if (performance.now() - this.receivedAt > 3000) { this.ready = false; this.onStatus('Waiting for the server. Controls are paused…'); }
      // Background tabs may suspend rendering. A neutral heartbeat keeps the
      // crew present without preserving an unattended throttle input.
      if (performance.now() - (this.sentAt || 0) > 500) this.input({});
    }, 1000);
    return room;
  }
  receive(state) {
    this.state = state; this.receivedAt = performance.now();
    this.samples.push({ state, at: this.receivedAt }); if (this.samples.length > 8) this.samples.shift();
    this.onState(state);
  }
  interpolated() {
    if (!this.state) return null;
    // Keep the last world visible while a rejoin waits for its first snapshot.
    if (!this.samples.length) return this.state;
    const at = performance.now() - 120;
    let a = this.samples[0], b = a;
    for (const sample of this.samples) { if (sample.at <= at) a = sample; if (sample.at >= at) { b = sample; break; } b = sample; }
    const t = a === b ? 1 : Math.max(0, Math.min(1, (at - a.at) / (b.at - a.at)));
    const lerp = (x, y) => x + (y - x) * t;
    const entity = (x, y, fields) => { const out = { ...y }; for (const key of fields) if (Number.isFinite(x[key]) && Number.isFinite(y[key])) out[key] = lerp(x[key], y[key]); return out; };
    return { ...this.state, time: lerp(a.state.time, b.state.time),
      ship: entity(a.state.ship, b.state.ship, ['x', 'y', 'z', 'heading', 'speed', 'yawRate', 'propellerAngle', 'anchorDrop', 'pitch', 'roll']),
      cargo: entity(a.state.cargo, b.state.cargo, ['x', 'y', 'z']),
      players: Object.fromEntries(Object.entries(b.state.players).map(([id, p]) => [id, a.state.players[id]?.mode === p.mode ? entity(a.state.players[id], p, ['x', 'y', 'z', 'yaw', 'pitch', 'deckX', 'deckZ', 'deckYaw']) : p])) };
  }
  async input(input) {
    if (!this.ready || this.pending) return;
    this.sentAt = performance.now();
    this.pending = true;
    try { await this.request(`/api/rooms/${this.room}/input`, input); }
    catch { this.ready = false; this.onStatus('Connection interrupted. Reconnecting…'); }
    finally { this.pending = false; }
  }
  async action(action, details = {}) {
    const blocked = this.actionGuard?.(action); if (blocked) throw new Error(blocked);
    if (!this.ready) throw new Error('Wait for the connection to recover.');
    return this.request(`/api/rooms/${this.room}/action`, { ...details, action });
  }
  close() { clearInterval(this.heartbeat); this.events?.close(); this.ready = false; }
}
