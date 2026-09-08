import { availableActions, distance } from './Simulation.js';
import { HELM_STATION_Z } from './HelmRig.js';
import { WINCH_CONTROL } from './RecoveryRig.js';
import { BOARDING_LADDER } from './Boarding.js';
import { RADIO_STATION } from './RadioStation.js';
import { LOGBOOK_STATION } from './LogbookStation.js';

// Station ranges are ship-local, so walking prompts stay stable as Kestrel
// turns and heaves. A blocked nearby station must not suggest a distant one.
export function nearbyDeckStation(world, id) {
  const p = world?.players[id];
  if (!p?.connected || p.mode !== 'deck' || !Number.isFinite(p.deckX) || !Number.isFinite(p.deckZ)) return null;
  const has = action => availableActions(world, id).includes(action);
  if (p.deckX > BOARDING_LADDER.deckX - .3 && Math.abs(p.deckZ - BOARDING_LADDER.z) < .8) {
    return { station: 'ladder', action: has('dive') ? 'dive' : null,
      text: has('dive') ? 'Boarding ladder · ready to dive' : 'Boarding ladder · wait for Kestrel to slow below 4 knots' };
  }
  if (Math.hypot(p.deckX, p.deckZ - HELM_STATION_Z) < 1.7) {
    const pilot = world.players[world.ship.pilot];
    return { station: 'helm', action: has('helm') ? 'helm' : null,
      text: pilot ? `Helm · ${pilot.name} is steering` : 'Helm · ready to steer' };
  }
  if (Math.hypot(p.deckX - WINCH_CONTROL.x, p.deckZ - WINCH_CONTROL.z) < 1.45) {
    const operator = world.players[world.winch];
    return { station: 'winch', action: has('winch') ? 'winch' : null,
      text: world.cargo.recovered ? 'Winch · archive secured' : !world.cargo.attached ? 'Winch · a diver must attach the lifting cable' :
        operator ? `Winch · ${operator.name} is operating` : !world.ship.anchor ? 'Winch · anchor Kestrel before lifting' : distance(world.ship, world.cargo) >= 34 ? 'Winch · move Kestrel closer to the cable' : 'Winch · cable attached, ready to lift' };
  }
  if (Math.hypot(p.deckX - RADIO_STATION.x, p.deckZ - RADIO_STATION.z) < RADIO_STATION.reach) {
    const peers = Object.values(world.players).filter(other => other.connected && other.id !== id).length;
    return { station: 'radio', action: 'radio', text: peers ? `Deck radio · ${peers} crewmate${peers === 1 ? '' : 's'} on channel` : 'Deck radio · sailing solo' };
  }
  if (Math.hypot(p.deckX - LOGBOOK_STATION.x, p.deckZ - LOGBOOK_STATION.z) < LOGBOOK_STATION.reach) {
    return { station: 'logbook', action: 'logbook', text: 'Ship’s logbook · read the crew’s voyage history' };
  }
  return null;
}
