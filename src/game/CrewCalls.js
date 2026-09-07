import { dialogFocus } from './DialogFocus.js';

export const CALL_LIFETIME = 25;
export const CALL_COOLDOWN = 3;
export const CALLS = Object.freeze({ slow: 'Slow down, please', anchor: 'Hold position, please', ready: 'Ready to dive', pickup: 'Need pickup', winch: 'Need a winch operator', thanks: 'Thanks, crew' });

export function canCall(w, id, kind) {
  const p = w.players[id];
  return !!p?.connected && Object.hasOwn(CALLS, kind) && (kind !== 'pickup' || p.mode === 'diver') &&
    (kind !== 'ready' || p.mode !== 'diver') && (kind !== 'winch' || (w.cargo.attached && !w.cargo.recovered));
}
export function sendCrewCall(w, id, kind) {
  if (!canCall(w, id, kind)) return { ok: false, message: 'Choose a call that fits your current activity.' };
  const p = w.players[id];
  if (w.time - (p.lastCall ?? -Infinity) < CALL_COOLDOWN) return { ok: false, message: 'Wait a moment before calling again.' };
  p.lastCall = w.time; w.calls ??= {}; w.callSequence = (w.callSequence || 0) + 1;
  w.calls[id] = { id: w.callSequence, owner: id, kind, time: w.time, expires: w.time + CALL_LIFETIME, acknowledgedBy: null };
  w.revision++; return { ok: true };
}
export function acknowledgeCrewCall(w, id, owner, callId) {
  const call = w.calls?.[owner];
  if (!w.players[id]?.connected || !w.players[owner]?.connected || !call || call.id !== callId || call.expires <= w.time || owner === id || call.kind === 'thanks') return { ok: false, message: 'That crew call is no longer available.' };
  if (call.acknowledgedBy) return call.acknowledgedBy === id ? { ok: true } : { ok: false, message: 'A crewmate has already acknowledged this call.' };
  call.acknowledgedBy = id; w.ackSequence = (w.ackSequence || 0) + 1; w.revision++; return { ok: true };
}
export function activeCrewCalls(w) {
  return Object.values(w.calls || {}).filter(c => c.expires > w.time && w.players[c.owner]?.connected && Object.hasOwn(CALLS, c.kind)).sort((a, b) => b.id - a.id);
}

export class CrewRadio {
  constructor(game) {
    this.game = game; this.rows = new Map();
    this.button = document.createElement('button'); this.button.id = 'crew-radio'; this.button.textContent = 'Call crew [Z]'; this.button.setAttribute('aria-haspopup', 'dialog');
    game.root.querySelector('.view-controls').append(this.button); this.button.onclick = () => this.show();
    this.stationButton = document.createElement('button'); this.stationButton.id = 'deck-radio'; this.stationButton.dataset.action = 'radio';
    this.stationButton.textContent = '[F] Use radio'; this.stationButton.hidden = true; this.stationButton.className = 'suggested';
    this.stationButton.setAttribute('aria-haspopup', 'dialog'); game.$('game-actions').append(this.stationButton);
    this.banner = document.createElement('div'); this.banner.id = 'crew-call-banner'; this.banner.hidden = true;
    this.notice = document.createElement('p'); this.notice.setAttribute('role', 'status'); this.notice.setAttribute('aria-live', 'polite');
    this.ack = document.createElement('button'); this.ack.id = 'ack-crew-call'; this.ack.textContent = 'On it';
    this.banner.append(this.notice, this.ack); game.root.querySelector('.ship-console').prepend(this.banner);
    this.dialog = document.createElement('dialog'); this.dialog.id = 'crew-radio-dialog'; this.dialog.setAttribute('aria-labelledby', 'crew-radio-title');
    this.dialog.innerHTML = '<div class="radio-heading"><div><p class="radio-plate">KESTREL / SHIP RADIO</p><h2 id="crew-radio-title">Crew radio</h2></div><button id="close-radio">Close</button></div><div class="radio-channel"><span>CREW CHANNEL</span><strong>01</strong></div><p>Choose a call. Your crew can reply “On it” to confirm.</p><div class="radio-choices"></div><div id="radio-inbox"></div><p id="radio-status" role="status"></p>';
    game.root.append(this.dialog); this.$ = id => this.dialog.querySelector(`#${id}`); this.choices = new Map();
    for (const [kind, text] of Object.entries(CALLS)) { const b = document.createElement('button'); b.id = `call-${kind}`; b.textContent = text; b.onclick = () => this.send(kind); this.choices.set(kind, b); this.dialog.querySelector('.radio-choices').append(b); }
    const restoreFocus = dialogFocus(game, this.dialog);
    this.$('close-radio').onclick = () => this.dialog.close(); this.dialog.addEventListener('close', () => {
      // show() already stopped movement. This queued event can arrive after a
      // new walking key following Escape, which must remain held.
      restoreFocus(this.returnFocus, this.button, game.hud.button);
    });
  }
  show({ station = false } = {}) {
    const g = this.game; if (!g.started || g.dialogOpen() || (!station && this.button.hidden)) return;
    this.returnFocus = station ? this.stationButton : this.button;
    g.setLookout(false); g.naturalist.toggle(false); g.keys.clear(); g.net.input({}); this.error = '';
    this.dialog.showModal(); this.updateUI(g.state);
  }
  async send(kind) {
    const g = this.game; if (this.pending) return; this.error = ''; this.pending = true; this.updateUI(g.state);
    try { await g.net.action('crewCall', { kind }); this.dialog.close(); }
    catch (e) { this.error = e.message; }
    finally { this.pending = false; this.updateUI(g.state); }
  }
  async acknowledge(call) {
    const g = this.game; if (this.acking) return; this.acking = true; this.updateUI(g.state);
    try {
      await g.net.action('acknowledgeCall', { owner: call.owner, callId: call.id });
      if (call.kind === 'pickup') { g.crewTracking.id = call.owner; g.crewTracking.updateUI(g.state); }
    } catch (e) { g.message = e.message; g.messageUntil = performance.now() + 4000; }
    finally { this.acking = false; this.updateUI(g.state); }
  }
  description(w, call) {
    const sender = call.owner === this.game.net.id ? 'You' : w.players[call.owner]?.name || 'Crew';
    const reply = call.acknowledgedBy ? `${w.players[call.acknowledgedBy]?.name || 'A crewmate'}: On it` : call.owner === this.game.net.id ? 'Sent to your crew' : call.kind === 'pickup' ? 'On it also shows their live position' : '';
    return `${sender}: ${CALLS[call.kind]}${reply ? ` · ${reply}` : ''}`;
  }
  updateUI(w) {
    const g = this.game, active = activeCrewCalls(w), peers = Object.values(w.players).filter(p => p.connected && p.id !== g.net.id);
    this.stationButton.hidden = g.contextAction() !== 'radio'; this.stationButton.disabled = !g.net.ready;
    this.button.hidden = !w.calls || peers.length === 0; this.button.disabled = !g.net.ready;
    const newest = active.find(c => c.owner !== g.net.id && !c.acknowledgedBy) || active[0];
    // Retain a request while the player reaches for its acknowledgement.
    let shown = active.find(c => c.id === this.shownId && !c.acknowledgedBy && c.owner !== g.net.id) || newest;
    this.shownId = shown?.id; this.banner.hidden = !shown;
    if (shown) {
      const text = this.description(w, shown); if (this.notice.textContent !== text) this.notice.textContent = text;
      this.ack.hidden = shown.owner === g.net.id || !!shown.acknowledgedBy || shown.kind === 'thanks';
      this.ack.disabled = !g.net.ready || this.acking; this.ack.onclick = () => this.acknowledge(shown);
    }
    if (!this.dialog.open) return;
    const wait = w.time - (w.players[g.net.id]?.lastCall ?? -Infinity) < CALL_COOLDOWN;
    this.$('radio-status').textContent = this.error || (!g.net.ready ? 'Waiting for the connection…' : !peers.length ? 'You’re sailing solo. Calls become available when a crewmate joins.' : this.pending ? 'Calling your crew…' : wait ? 'Call sent. Wait a moment before calling again.' : '');
    for (const [kind, b] of this.choices) { b.hidden = !canCall(w, g.net.id, kind); b.disabled = this.pending || !g.net.ready || wait || !peers.length; }
    for (const [id, row] of this.rows) if (!active.some(c => c.id === id)) { row.root.remove(); this.rows.delete(id); }
    for (const call of active) {
      let row = this.rows.get(call.id);
      if (!row) {
        const root = document.createElement('div'), text = document.createElement('p'), button = document.createElement('button'); root.className = 'radio-message'; button.textContent = 'On it'; button.onclick = () => this.acknowledge(call); root.append(text, button); this.$('radio-inbox').prepend(root);
        row = { root, text, button }; this.rows.set(call.id, row);
      }
      row.text.textContent = this.description(w, call); row.button.hidden = call.owner === g.net.id || !!call.acknowledgedBy || call.kind === 'thanks'; row.button.disabled = !g.net.ready || this.acking;
    }
  }
}
