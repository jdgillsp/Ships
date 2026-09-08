import { SALVAGE_SITES, activeSalvage, nextSalvageReason } from './SalvageVoyages.js';

export class SalvageJobs {
  constructor(game, activities) {
    this.game = game; this.activities = activities;
    this.root = document.createElement('section'); this.root.id = 'salvage-jobs'; this.root.hidden = true;
    this.root.innerHTML = '<h3>Another salvage expedition</h3><p>Pelican Station has more survey archives to recover. Your crew, charts and field notes stay with Kestrel.</p><label for="next-salvage-site">Next wreck</label><select id="next-salvage-site"></select><p id="next-salvage-depth"></p><button id="accept-salvage">Accept salvage job</button><p id="next-salvage-status" role="status"></p>';
    activities.$('activities-crew').before(this.root); this.$ = id => this.root.querySelector(`#${id}`);
    this.$('next-salvage-site').onchange = () => this.update(game.state);
    this.$('accept-salvage').onclick = async () => {
      if (this.pending) return; this.pending = true; this.error = ''; this.update(game.state);
      try { await game.net.action('nextSalvage', { destination: this.$('next-salvage-site').value }); activities.dialog.close(); }
      catch (e) { this.error = e.message; }
      finally { this.pending = false; this.update(game.state); }
    };
  }
  update(world) {
    this.root.hidden = world.mission !== 'complete'; if (this.root.hidden) return;
    const current = activeSalvage(world).id, select = this.$('next-salvage-site');
    if (current !== this.current) {
      this.current = current; this.error = '';
      select.replaceChildren(...SALVAGE_SITES.filter(s => s.id !== current).map(s => new Option(s.name, s.id)));
    }
    const site = SALVAGE_SITES.find(s => s.id === select.value);
    this.$('next-salvage-depth').textContent = `${Math.round(-site.cargo.y)} m recovery · ${Math.round(Math.hypot(site.wreck.x - world.ship.x, site.wreck.z - world.ship.z))} m to sail`;
    const reason = nextSalvageReason(world, this.game.net.id);
    this.$('accept-salvage').disabled = this.pending || !this.game.net.ready || !!reason;
    select.disabled = this.pending;
    this.$('next-salvage-status').textContent = this.error || reason || 'Ready to depart from Pelican Station. Accepting starts a fresh archive recovery for the whole crew.';
  }
}
