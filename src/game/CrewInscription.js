export const DEFAULT_INSCRIPTION = 'Bring everyone home';
export const INSCRIPTION_LIMIT = 48;
const validText = text => typeof text === 'string' && text.length > 0 && text.length <= INSCRIPTION_LIMIT && /^[\x20-\x7e]+$/.test(text) && text.trim() === text;

export function inscriptionReason(w, id) {
  const p = w.players[id], base = w.locations.base;
  if (!p?.connected || p.mode === 'diver') return 'Come aboard to change the crew inscription.';
  if (Math.hypot(w.ship.x - base.x, w.ship.z - base.z) >= 24 || Math.abs(w.ship.speed) >= 1.5 || !w.ship.anchor) return 'Anchor beside Pelican Station to change the inscription.';
  return '';
}
export function inscribeShip(w, id, text, expectedRevision) {
  const reason = inscriptionReason(w, id);
  if (reason) return { ok: false, message: reason };
  if (!validText(text)) return { ok: false, message: 'Use 1–48 characters: English letters, numbers, spaces and basic punctuation.' };
  if (expectedRevision !== (w.ship.inscription?.revision || 0)) return { ok: false, message: 'A crewmate changed the inscription. Read their version before saving.' };
  if (text === (w.ship.inscription?.text || DEFAULT_INSCRIPTION)) return { ok: true };
  w.ship.inscription = { text, revision: expectedRevision + 1, author: w.players[id].name, time: w.time };
  w.log = `${w.players[id].name} set Kestrel’s crew inscription: ${text}`; w.revision++;
  return { ok: true };
}
export function validInscription(w) {
  const r = w.ship?.inscription;
  return r === undefined || !!r && validText(r.text) && Number.isSafeInteger(r.revision) && r.revision > 0 &&
    typeof r.author === 'string' && r.author.length <= 20 && Number.isFinite(r.time) && r.time >= 0 && r.time <= w.time;
}

export class CrewInscriptionControls {
  constructor(game, activities) {
    this.game = game; this.root = document.createElement('section'); this.root.id = 'crew-inscription';
    this.root.innerHTML = '<h3>Kestrel’s crew inscription</h3><p>A shared nameplate above the aft cabin windows, kept with your ship.</p><p id="inscription-current"></p><label for="inscription-text">Crew inscription · up to 48 characters</label><input id="inscription-text" maxlength="48" autocomplete="off"><button id="save-inscription">Set crew inscription</button><button id="reload-inscription">Load crew’s version</button><p id="inscription-status" role="status"></p>';
    activities.$('activities-crew').before(this.root); this.$ = id => this.root.querySelector(`#${id}`);
    this.$('inscription-text').oninput = () => { this.dirty = true; this.error = ''; this.update(game.state); };
    this.$('reload-inscription').onclick = () => { this.dirty = false; this.revision = undefined; this.error = ''; this.update(game.state); };
    this.$('save-inscription').onclick = async () => {
      if (this.pending || !game.net.ready) return;
      const text = this.$('inscription-text').value.trim(); this.pending = true; this.error = ''; this.update(game.state);
      try { await game.net.action('inscribeShip', { text, expectedRevision: this.revision }); this.dirty = false; this.revision = undefined; }
      catch (e) { this.error = e.message; }
      finally { this.pending = false; this.update(game.state); }
    };
  }
  update(w) {
    const r = w.ship.inscription, revision = r?.revision || 0, current = r?.text || DEFAULT_INSCRIPTION;
    if (!this.dirty && this.revision !== revision) { this.revision = revision; this.$('inscription-text').value = current; }
    const conflict = this.revision !== revision, reason = inscriptionReason(w, this.game.net.id);
    this.$('inscription-current').textContent = `Aboard: “${current}”${r ? ` · set by ${r.author}` : ''}`;
    this.$('inscription-text').disabled = !!this.pending;
    this.$('reload-inscription').hidden = !conflict; this.$('reload-inscription').disabled = !!this.pending;
    this.$('save-inscription').disabled = !!this.pending || !this.game.net.ready || !!reason || conflict || !validText(this.$('inscription-text').value.trim());
    this.$('inscription-status').textContent = this.error || (!this.game.net.ready ? 'Waiting for the connection.' : conflict ? 'A crewmate changed the inscription. Your draft is kept; load their version to start again.' : reason || 'English letters, numbers and basic punctuation. Visible to the whole crew.');
  }
}
