const key = 'abyssal:saved-expeditions';
const lifetime = 30 * 24 * 60 * 60_000;
const stages = { outbound: 'Sailing out', dive: 'At the wreck', recovery: 'Recovering the archive', return: 'Homeward bound', complete: 'Archive delivered' };

export function recentExpeditions(storage) {
  try {
    if (storage === undefined) storage = localStorage;
    const entries = JSON.parse(storage.getItem(key) || '[]');
    return Array.isArray(entries) ? entries.filter(e => e && /^[\w-]{12}$/.test(e.room) && /^[\w-]{32}$/.test(e.token) &&
      typeof e.name === 'string' && e.name.length <= 20 && Number.isFinite(e.visitedAt) && Date.now() - e.visitedAt < lifetime &&
      Object.hasOwn(stages, e.mission) && Number.isInteger(e.surveys) && e.surveys >= 0 && e.surveys <= 15).slice(0, 6) : [];
  } catch { return []; }
}

export function rememberExpedition(net, storage) {
  const w = net.state, p = w?.players?.[net.id];
  if (!w?.persistence?.enabled || !p) return false;
  const entry = { room: net.room, token: net.token, name: p.name, mission: w.mission,
    surveys: Object.values(w.surveys || {}).filter(s => s.completedAt != null).length, visitedAt: Date.now() };
  try { if (storage === undefined) storage = localStorage; storage.setItem(key, JSON.stringify([entry, ...recentExpeditions(storage).filter(e => e.room !== entry.room || e.token !== entry.token)].slice(0, 6))); return true; }
  catch { return false; }
}

export class SavedExpeditions {
  constructor(game) {
    this.game = game; this.lastRemember = 0;
    this.panel = document.createElement('aside'); this.panel.className = 'recent-expeditions';
    game.root.querySelector('.launch-screen').append(this.panel); this.render();
    this.exit = document.createElement('button'); this.exit.id = 'save-expedition'; this.exit.textContent = 'Return to menu';
    this.status = document.createElement('p'); this.status.id = 'expedition-save-status'; this.status.setAttribute('role', 'status');
    game.settings.dialog.append(this.status, this.exit);
    this.exit.onclick = () => this.leave();
  }
  render() {
    this.panel.replaceChildren(); const entries = recentExpeditions(); this.panel.hidden = !entries.length;
    if (!entries.length) return;
    const heading = document.createElement('h2'); heading.textContent = 'Your voyages';
    const note = document.createElement('p'); note.textContent = 'Return as your saved crewmate. Expeditions stay available for 30 days after the crew’s last visit.';
    this.panel.append(heading, note);
    for (const entry of entries) {
      const card = document.createElement('article'), title = document.createElement('h3'), detail = document.createElement('p');
      title.textContent = `${entry.name} aboard Kestrel`;
      detail.textContent = `${stages[entry.mission]} · ${entry.surveys}/15 sites surveyed · ${new Date(entry.visitedAt).toLocaleDateString()}`;
      const resume = document.createElement('button'); resume.className = 'resume-expedition'; resume.textContent = 'Resume voyage →';
      resume.onclick = async () => {
        if (this.game.$('start-expedition').disabled) return;
        resume.disabled = true;
        await this.game.start(entry); resume.disabled = false;
      };
      const remove = document.createElement('button'); remove.className = 'forget-expedition'; remove.textContent = 'Forget'; remove.title = 'Remove this saved identity from this browser';
      remove.onclick = () => { try { localStorage.setItem(key, JSON.stringify(recentExpeditions().filter(e => e.room !== entry.room || e.token !== entry.token))); this.render(); } catch {} };
      card.append(title, detail, resume, remove); this.panel.append(card);
    }
  }
  update(w) {
    if (this.leaving) return;
    const p = w.persistence;
    this.exit.textContent = p?.enabled ? 'Save & return to menu' : 'Return to menu';
    if (performance.now() - this.lastRemember > 2000) { this.lastRemember = performance.now(); this.canRemember = rememberExpedition(this.game.net); }
    this.status.textContent = this.failure || (p?.enabled ? (p.error ? 'Autosave needs attention. Keep this tab open and try Save again.' : this.canRemember === false ? 'Progress is saved on the server, but this browser cannot remember a voyage shortcut.' : 'Autosaved on this server. Your ship and survey log will be here when you return.') : 'This server keeps voyages only while it is running.');
  }
  async leave() {
    const g = this.game; if (this.leaving) return;
    if (g.state.persistence?.enabled && !rememberExpedition(g.net)) { this.failure = this.status.textContent = 'This browser could not store your resume entry. Allow site storage and try again.'; return; }
    this.failure = null;
    this.leaving = true; this.exit.disabled = true; g.keys.clear(); await g.net.input({});
    this.status.textContent = 'Saving your voyage…';
    try {
      await g.net.request(`/api/rooms/${g.net.room}/leave`, {});
      rememberExpedition(g.net); g.net.close();
      const url = new URL(location.href); url.searchParams.delete('room'); url.searchParams.set('mode', 'expedition'); location.assign(url.href);
    } catch (error) { this.failure = this.status.textContent = error.message; this.leaving = false; this.exit.disabled = false; this.lastRemember = performance.now(); }
  }
}
