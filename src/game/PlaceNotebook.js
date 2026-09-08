import { PLACE_NOTE_LIMIT } from './SavedPlaces.js';

export class PlaceNotebook {
  constructor(chart) {
    this.chart = chart; this.drafts = new Map(); this.confirmed = new Map();
    this.root = document.createElement('details'); this.root.id = 'place-notebook'; this.root.hidden = true;
    this.root.innerHTML = `<summary>Edit crew notes</summary><label for="edit-place-name">Place name</label><input id="edit-place-name" maxlength="40" autocomplete="off"><label for="edit-place-note">What should the crew remember?</label><textarea id="edit-place-note" rows="4" maxlength="${PLACE_NOTE_LIMIT}" placeholder="What you found, a useful approach, or a reason to return…"></textarea><p id="place-note-author"></p><button id="update-place">Save crew notes</button><button id="reload-place-note" hidden>Reload crew notes</button><p id="place-note-status" role="status"></p>`;
    chart.$('voyage-record').after(this.root); this.$ = id => this.root.querySelector(`#${id}`);
    const changed = () => {
      this.drafts.set(this.selected, { name: this.$('edit-place-name').value, note: this.$('edit-place-note').value, revision: this.baseRevision });
      this.message = ''; this.update(chart.game.state);
    };
    this.$('edit-place-name').oninput = changed; this.$('edit-place-note').oninput = changed;
    this.$('reload-place-note').onclick = () => { this.drafts.delete(this.selected); this.message = ''; this.signature = null; this.update(chart.game.state); };
    this.$('update-place').onclick = () => this.save();
  }
  async save() {
    const id = this.selected, draft = this.drafts.get(id);
    if (!draft || this.pending) return;
    this.pending = true; this.message = ''; this.update(this.chart.game.state);
    try {
      const response = await this.chart.game.net.action('updatePlace', { destination: id, expectedRevision: draft.revision, name: draft.name, note: draft.note });
      this.confirmed.set(id, response.place); this.drafts.delete(id); this.signature = null;
      this.message = 'Crew notes saved.';
    } catch (e) { this.message = e.message; }
    finally { this.pending = false; this.chart.updateUI(this.chart.game.state); }
  }
  update(world) {
    const id = this.chart.select.value;
    let place = world.places?.[id]; this.root.hidden = !place;
    // A response may arrive before its streamed snapshot. Keep acknowledged
    // content until that stream catches up instead of flashing the old notes.
    const confirmed = this.confirmed.get(id);
    if (!place) { this.confirmed.delete(id); this.drafts.delete(id); return; }
    if (confirmed && (confirmed.revision || 0) > (place.revision || 0)) place = confirmed;
    else this.confirmed.delete(id);
    const draft = this.drafts.get(id), revision = place.revision || 0;
    const signature = JSON.stringify([id, revision, place.name, place.note]);
    if (this.selected !== id || !draft && this.signature !== signature) {
      this.$('edit-place-name').value = draft?.name ?? place.name;
      this.$('edit-place-note').value = draft?.note ?? place.note ?? '';
      this.baseRevision = draft?.revision ?? revision;
      if (this.selected !== id) this.message = '';
      this.selected = id; this.signature = signature;
    }
    const conflict = draft && revision > draft.revision;
    this.$('place-note-author').textContent = place.updatedBy ? `Last updated by ${place.updatedBy}` : `Place saved by ${place.savedBy}`;
    this.$('reload-place-note').hidden = !conflict;
    const blocked = this.pending || !this.chart.game.net.ready;
    this.$('edit-place-name').disabled = blocked; this.$('edit-place-note').disabled = blocked;
    this.$('reload-place-note').disabled = blocked;
    this.$('update-place').disabled = blocked || !draft || !!conflict;
    this.$('place-note-status').textContent = this.message || (conflict ? 'A crewmate changed these notes. Your draft is kept. Reload the crew notes to continue.' : draft ? 'Unsaved draft · kept while you browse this chart' : 'Notes are shared with the whole crew.');
  }
}
