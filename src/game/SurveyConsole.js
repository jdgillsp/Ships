import { surveyStatus, SURVEY_RADIUS, SURVEY_SECONDS } from './Survey.js';
import { voyageSites } from './VoyageSites.js';

export class SurveyConsole {
  constructor(game) {
    this.game = game;
    this.panel = document.createElement('div'); this.panel.id = 'habitat-survey'; this.panel.hidden = true;
    this.panel.innerHTML = '<div class="survey-heading"><span id="survey-title">HABITAT SURVEY</span><span id="survey-percent"></span></div><progress id="survey-progress" max="1" value="0" aria-label="Shared habitat survey progress"></progress><p id="survey-detail"></p>';
    game.root.querySelector('.mission-panel').append(this.panel);
    this.button = document.createElement('button'); this.button.id = 'survey-site'; this.button.hidden = true;
    this.button.textContent = 'Hold to survey [X]'; this.button.setAttribute('aria-describedby', 'survey-detail');
    game.$('game-actions').prepend(this.button);
    const release = () => game.keys.delete('KeyX');
    this.button.onpointerdown = e => { if (e.button !== 0 || this.button.disabled) return; e.preventDefault(); this.button.setPointerCapture(e.pointerId); game.keys.add('KeyX'); };
    this.button.onpointerup = this.button.onpointercancel = this.button.onlostpointercapture = release;
    this.button.onkeydown = e => { if (['Space', 'Enter'].includes(e.code)) { e.preventDefault(); e.stopPropagation(); game.keys.add('KeyX'); } };
    this.button.onkeyup = e => { if (['Space', 'Enter'].includes(e.code)) { e.preventDefault(); e.stopPropagation(); release(); } };
    this.button.onblur = release;
  }
  updateUI(world) {
    const g = this.game, status = surveyStatus(world, g.net.id), p = world.players[g.net.id];
    this.panel.hidden = !status; this.button.hidden = !status || p.mode !== 'diver';
    if (!status) { g.keys.delete('KeyX'); return; }
    const { complete, progress, record, eligible, distance } = status;
    const count = Object.values(world.surveys).filter(s => s.completedAt != null).length;
    const blocked = !g.net.ready || g.dialogOpen() || g.naturalist.open;
    this.button.disabled = complete || !eligible || blocked;
    this.button.textContent = complete ? 'Survey logged ✓' : eligible ? 'Hold to survey [X]' : 'Survey · approach signal [X]';
    this.button.title = `Hold X or this button within ${SURVEY_RADIUS} m of the dive signal. Each nearby scanning diver helps.`;
    this.button.classList.toggle('scanning', eligible && !blocked && !complete && g.keys.has('KeyX'));
    if (complete || p.mode !== 'diver' || blocked) g.keys.delete('KeyX');
    g.$('survey-title').textContent = `HABITAT SURVEY · ${count}/${voyageSites().length}`;
    g.$('survey-percent').textContent = complete ? 'LOGGED ✓' : `${Math.floor(progress * 100)}%`;
    g.$('survey-progress').value = progress;
    g.$('survey-detail').textContent = complete ? `Surveyed by ${record.contributors.map(c => c.name).join(' & ')}. N opens your crew chart.` :
      !g.net.ready ? 'Connection paused. Your survey progress is kept.' : record?.active ? `${record.active} ${record.active === 1 ? 'diver scanning' : 'divers scanning'} · keep within the habitat signal.` :
      p.mode !== 'diver' ? 'Dive to the habitat signal to survey it. Teammates can scan together.' :
      eligible ? `Hold X for ${SURVEY_SECONDS} seconds to log this habitat. Another diver can help.` : `Swim within ${SURVEY_RADIUS} m of the signal at its dive depth · ${Math.ceil(distance)} m away.`;
  }
}
