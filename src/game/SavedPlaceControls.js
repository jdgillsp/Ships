import { PLACE_LIMIT } from './SavedPlaces.js';

export class SavedPlaceControls {
  constructor(chart) {
    this.chart = chart;
    this.root = document.createElement('section'); this.root.id = 'saved-place-controls';
    this.root.innerHTML = '<h3>Keep a crew mark</h3><p>Mark a place with G, then save it here before the mark fades.</p><label for="place-signal">Active crew mark</label><select id="place-signal"></select><label for="place-name">Place name</label><input id="place-name" maxlength="40" autocomplete="off"><button id="save-place">Save place to chart</button><p id="place-status" role="status"></p>';
    chart.dialog.querySelector('.voyage-details').append(this.root);
    this.$ = id => this.root.querySelector(`#${id}`);
    this.$('place-signal').onchange = () => { this.$('place-name').value = this.signals.find(s => String(s.id) === this.$('place-signal').value)?.label || ''; };
    this.$('save-place').onclick = () => this.save();
    this.remove = document.createElement('button'); this.remove.id = 'remove-place'; this.remove.textContent = 'Remove saved place'; this.remove.hidden = true;
    chart.$('clear-course').after(this.remove);
    this.remove.onclick = async () => {
      if (this.pending) return;
      this.pending = true; this.error = ''; this.update(chart.game.state);
      try { await chart.game.net.action('removePlace', { destination: chart.select.value }); }
      catch (e) { this.error = e.message; }
      finally { this.pending = false; chart.updateUI(chart.game.state); }
    };
  }
  async save() {
    const c = this.chart, signal = this.signals.find(s => String(s.id) === this.$('place-signal').value);
    if (!signal || this.pending) return;
    this.pending = true; this.error = ''; this.update(c.game.state);
    try {
      await c.game.net.action('savePlace', { owner: signal.owner, signalId: signal.id, name: this.$('place-name').value });
      this.selectWhenReady = `place-${signal.id}`;
      this.error = 'Place saved for the whole crew. Plot a course to return.';
    } catch (e) { this.error = e.message; }
    finally { this.pending = false; c.updateUI(c.game.state); }
  }
  update(w) {
    if (this.selectWhenReady && w.places?.[this.selectWhenReady]) {
      this.chart.select.value = this.selectWhenReady; this.selectWhenReady = null;
    }
    this.signals = Object.values(w.signals || {}).filter(s => s.expires > w.time && !w.places?.[`place-${s.id}`]).sort((a, b) => b.id - a.id);
    const signature = JSON.stringify(this.signals.map(s => s.id)), select = this.$('place-signal');
    if (signature !== this.signature) {
      const previous = select.value; this.signature = signature;
      select.replaceChildren(...this.signals.map(s => new Option(`${w.players[s.owner]?.name || 'Crew'} · ${s.label}`, String(s.id))));
      if (this.signals.some(s => String(s.id) === previous)) select.value = previous;
      else this.$('place-name').value = this.signals[0]?.label || '';
    }
    const unsupported = !Object.hasOwn(w, 'places'), blocked = this.pending || !this.chart.game.net.ready || unsupported;
    const count = Object.keys(w.places || {}).length;
    this.$('save-place').disabled = blocked || !this.signals.length || count >= PLACE_LIMIT;
    select.disabled = blocked || !this.signals.length;
    this.$('place-name').disabled = blocked || !this.signals.length;
    this.remove.hidden = !w.places?.[this.chart.select.value]; this.remove.disabled = blocked;
    this.$('place-status').textContent = this.error || (unsupported ? 'Saved places are unavailable on this server.' : `${count}/${PLACE_LIMIT} places saved${!this.signals.length ? ' · No unsaved active marks. Close the chart and use G to mark a place.' : ''}`);
  }
}
