import { dialogFocus } from './DialogFocus.js';

export class DeliveryLog {
  constructor(game) {
    this.game = game; this.dialog = game.$('mission-complete');
    this.button = document.createElement('button'); this.button.id = 'view-delivery'; this.button.textContent = 'Delivery log'; this.button.hidden = true;
    this.button.setAttribute('aria-haspopup', 'dialog');
    game.activities.dialog.querySelector('.activities-footer').append(this.button);
    this.button.onclick = () => { game.activities.dialog.close(); this.show(); };
    game.$('continue-sailing').onclick = () => this.close();
    const restoreFocus = dialogFocus(game, this.dialog);
    this.dialog.addEventListener('close', () => {
      if (this.dialog.open) return;
      this.dialog.hidden = true; restoreFocus(this.button, game.hud.button);
    });
  }
  update(world) {
    this.button.hidden = world.mission !== 'complete';
    if (world.research) { this.game.completed = true; return; }
    if (world.mission === 'complete' && !this.game.completed && !this.game.dialogOpen()) {
      this.game.completed = true; this.show();
    }
  }
  show() {
    const g = this.game, record = g.state?.delivery;
    if (!g.started || g.state?.mission !== 'complete' || g.dialogOpen()) return;
    g.setLookout(false); g.naturalist.toggle(false); g.keys.clear(); g.net.input({});
    const duration = record?.duration ?? record?.time;
    g.$('mission-time').textContent = record ? `${Math.floor(duration / 60)} min ${Math.floor(duration % 60)} sec to delivery` : 'Archive received at Pelican Station';
    g.$('delivery-crew').hidden = !record;
    g.$('delivery-crew').textContent = record ? `Crew at delivery: ${record.crew.join(', ')}` : '';
    g.$('delivery-sender').hidden = !record;
    g.$('delivery-sender').textContent = record ? `Brought ashore by ${record.receivedFrom}` : '';
    this.dialog.hidden = false; this.dialog.showModal();
  }
  close() { this.dialog.close(); this.dialog.hidden = true; }
}
