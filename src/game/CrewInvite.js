import { dialogFocus } from './DialogFocus.js';

const localPage = host => host === 'localhost' || host.endsWith('.localhost') || ['[::1]', '[::]', '0.0.0.0'].includes(host) || /^127(?:\.\d{1,3}){3}$/.test(host);
const networkPage = host => /^(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host);
const networkNote = 'For crewmates on the same Wi-Fi or local network. Keep this game running while they join.';

export class CrewInvite {
  constructor(game) {
    this.game = game; this.dialog = game.$('invite-dialog'); this.sequence = 0;
    this.dialog.setAttribute('aria-labelledby', 'invite-title');
    this.dialog.innerHTML = '<header class="invite-heading"><div><p class="eyebrow">KESTREL / CREW INVITATION</p><h2 id="invite-title">Invite crew</h2></div><button id="close-invite">Close</button></header><p>Share this voyage with up to three crewmates. They’ll join your ship and its current expedition.</p><label id="invite-address-label" for="invite-address" hidden>Connection<select id="invite-address"></select></label><label for="invite-link">Voyage link</label><input id="invite-link" readonly aria-label="Expedition invite link"><p id="invite-network-note"></p><button id="copy-invite">Copy link</button><p id="copy-status" role="status"></p>';
    this.link = game.$('invite-link'); this.select = game.$('invite-address'); this.copy = game.$('copy-invite'); this.note = game.$('invite-network-note');
    game.$('invite').onclick = () => this.show(); game.$('close-invite').onclick = () => this.dialog.close();
    this.select.onchange = () => { this.link.value = game.inviteURL(this.select.value); game.$('copy-status').textContent = ''; };
    this.copy.onclick = async () => {
      const value = this.link.value;
      try { await navigator.clipboard.writeText(value); if (this.dialog.open && this.link.value === value) game.$('copy-status').textContent = 'Link copied.'; }
      catch { if (this.dialog.open) { this.link.focus(); this.link.select(); game.$('copy-status').textContent = 'Select and copy this link.'; } }
    };
    const restore = dialogFocus(game, this.dialog);
    this.dialog.addEventListener('close', () => { if (this.dialog.open) return; this.sequence++; this.request?.abort(); restore(game.$('invite'), game.hud.button); });
  }
  async show() {
    const g = this.game; if (!g.started || g.dialogOpen()) return;
    g.setLookout(false); g.keys.clear(); g.net.input({});
    const sequence = ++this.sequence; this.request?.abort();
    this.link.value = g.inviteURL(); this.select.replaceChildren(); g.$('invite-address-label').hidden = true; g.$('copy-status').textContent = '';
    const local = localPage(location.hostname);
    this.note.textContent = local ? 'Finding an address for your crew…' : networkPage(location.hostname) ? networkNote : 'Anyone with this link can join while a crew place is available.';
    this.copy.disabled = local; this.dialog.showModal();
    if (!local) return;
    const request = this.request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 4000);
    try {
      const response = await fetch('/api/invite-addresses', { signal: request.signal });
      if (!response.ok) throw new Error('Address lookup unavailable');
      const data = await response.json();
      if (sequence !== this.sequence || !this.dialog.open) return;
      const addresses = (Array.isArray(data.addresses) ? data.addresses : []).filter(item => {
        try { const url = new URL(item.origin); return typeof item.label === 'string' && url.protocol === 'http:' && !url.username && !url.password; } catch { return false; }
      });
      if (!addresses.length) throw new Error('No shared address');
      this.select.replaceChildren(...addresses.map(item => new Option(item.label, item.origin)));
      g.$('invite-address-label').hidden = addresses.length < 2;
      this.link.value = g.inviteURL(addresses[0].origin);
      this.note.textContent = networkNote;
    } catch {
      if (sequence === this.sequence && this.dialog.open) this.note.textContent = 'This link only opens on this computer. Open the game through a shared address to invite another device.';
    } finally {
      clearTimeout(timeout);
      if (sequence === this.sequence && this.dialog.open) this.copy.disabled = false;
    }
  }
}
