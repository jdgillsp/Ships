import { pickupDiver } from './PickupCourse.js';
import { BASE, WRECK, CRATE, distance, availableActions } from './Simulation.js';
import { activeSalvage } from './SalvageVoyages.js';
import { researchSite, researchReady, researchTarget, researchHarborReason } from './ResearchVoyages.js';

export function missionGuidance(w, id) {
  const p = w.players[id]; if (!p) return null;
  const has = action => availableActions(w, id).includes(action);
  const step = (title, text, action = 'glance', button = 'Show direction') => ({ title, text, action, button });
  const aboard = p.mode !== 'diver', captain = w.players[w.ship.pilot];
  const pickup = pickupDiver(w);
  if (pickup) {
    if (!aboard) return pickup.id === id ? step('Return to your pickup', 'The crew is following your position. Ascend and return alongside Kestrel.', has('board') ? 'board' : 'glance', has('board') ? 'Climb aboard' : 'Find Kestrel') : step(`Support ${pickup.name}’s return`, 'The ship is arranging a pickup. Keep track of your crewmate and return together.', 'glance', 'Show pickup direction');
    if (distance(w.ship, pickup) >= 20) {
      if (w.ship.anchor) return step(`Get underway for ${pickup.name}`, 'Raise anchor and follow the live pickup course. The expedition route is kept.', 'anchor', 'Raise anchor');
      return step(`Reach ${pickup.name}`, 'Follow the green compass pointer toward the diver, then slow and hold for boarding.', has('helm') ? 'helm' : 'glance', has('helm') ? 'Take the helm' : 'Show pickup direction');
    }
    if (!w.ship.anchor) return step('Hold for the pickup', `Deploy the anchor and let Kestrel slow while ${pickup.name} returns.`, 'anchor', 'Deploy anchor');
    return step(`Wait for ${pickup.name} aboard`, `${pickup.name} is ${Math.round(Math.max(0, -pickup.y))} m deep. Hold position for the ascent and boarding; the expedition course resumes afterward.`, 'glance', 'Check the dive team');
  }
  if (w.research) {
    const site = researchSite(w);
    if (researchReady(w)) {
      if (!aboard) return step('Return with the research team', 'Survey complete. Ascend and return alongside Kestrel.', has('board') ? 'board' : 'glance', has('board') ? 'Climb aboard' : 'Find Kestrel');
      const divers = Object.values(w.players).filter(other => other.connected && other.mode === 'diver').length;
      if (divers) return step('Recover the research team', `${divers} diver${divers === 1 ? '' : 's'} still in the water. Hold position and bring everyone aboard before sailing home.`, 'radio', 'Call the dive team');
      const homeDistance = distance(w.ship, w.locations.base);
      if (homeDistance >= 24) {
        if (w.ship.anchor) return step('Get underway for Pelican Station', 'The research team is aboard. Raise anchor for the homeward sail.', 'anchor', 'Raise anchor');
        return step('Bring the research report home', `${site.name} surveyed. Sail to Pelican Station, ${Math.round(homeDistance)} m away.`, has('helm') ? 'helm' : 'glance', has('helm') ? 'Take the helm' : 'Show homeward direction');
      }
      if (!w.ship.anchor) return step('Anchor at Pelican Station', 'Deploy the anchor beside the station before bringing the findings ashore.', 'anchor', 'Deploy anchor');
      const reason = researchHarborReason(w, id);
      return reason ? step('Settle alongside Pelican Station', 'Let Kestrel slow at anchor before filing the report.', 'glance', 'Check the station') : step('File the research report', `The crew surveyed ${site.name}. Bring the findings ashore.`, 'fileResearch', 'File research report');
    }
    if (!aboard) return step(`Survey ${site.name}`, 'Reach the habitat signal and hold X to survey. Nearby crewmates can help.', 'survey', 'Show survey controls');
    if (distance(w.ship, site) >= 32) {
      if (w.ship.anchor) return step(`Set sail for ${site.name}`, 'Raise the anchor, then sail to the research habitat.', 'anchor', 'Raise anchor');
      return step(`Sail to ${site.name}`, 'Bring Kestrel close to the habitat signal before anchoring for the survey.', has('helm') ? 'helm' : 'glance', has('helm') ? 'Take the helm' : 'Show research direction');
    }
    if (!w.ship.anchor) return step('Hold position for the survey', 'Deploy the anchor so the dive team has a steady place to return.', 'anchor', 'Deploy anchor');
    return step(`Dive to ${site.name}`, 'Follow the habitat signal and survey together. Return to Pelican Station with the findings.', has('dive') ? 'dive' : 'glance', has('dive') ? 'Enter the water' : 'Show research direction');
  }
  if (w.mission === 'complete') return step('Choose your next expedition', 'Archive delivered. Explore a habitat together.', 'chart', 'Choose a dive site');
  if (w.cargo.recovered) {
    if (!aboard) return step('Return to Kestrel', 'The archive is secured. Ascend and swim alongside the ladder to climb aboard.', has('board') ? 'board' : 'glance', has('board') ? 'Climb aboard' : 'Find Kestrel');
    const divers = Object.values(w.players).filter(other => other.connected && other.mode === 'diver').length;
    if (divers) return step('Recover the dive team', `${divers} diver${divers === 1 ? '' : 's'} still in the water. Hold position while they return.`, 'radio', 'Call the crew');
    if (has('deliver')) return step('Deliver the archive', 'Pelican Station is in range. Hand over the recovered archive.', 'deliver', 'Deliver archive');
    return step('Bring the archive home', `Sail to Pelican Station, then slow alongside to deliver. ${Math.round(distance(w.ship, BASE))} m to go.`, has('helm') ? 'helm' : 'glance', has('helm') ? 'Take the helm' : 'Show homeward course');
  }
  const inRange = distance(w.ship, w.cargo) < (w.cargo.attached ? 34 : 32);
  if (!inRange) {
    if (!aboard) return step('Bring Kestrel to the wreck first', 'The lifting cable cannot reach from here. Return aboard or ask your captain to bring Kestrel over the archive.', has('board') ? 'board' : 'glance', has('board') ? 'Climb aboard' : 'Find Kestrel');
    if (w.ship.anchor) return step('Get underway for the wreck', 'Raise the anchor, then sail Kestrel over the archive before diving.', 'anchor', 'Raise anchor');
    if (p.mode === 'deck' && captain && captain.id !== id) return step('Scout the wreck for your captain', `${captain.name} is steering. Use binoculars to find the survey buoy and G to mark it for the crew.`, 'lookout', 'Scout the buoy');
    return step('Sail Kestrel to the wreck', 'Bring the ship within cable range of the archive, then anchor before the dive.', has('helm') ? 'helm' : 'glance', has('helm') ? 'Take the helm' : 'Show wreck direction');
  }
  if (!w.ship.anchor) {
    const crewAboard = Object.values(w.players).some(other => other.connected && other.id !== id && other.mode !== 'diver');
    return step('Anchor over the archive', aboard ? 'Deploy the anchor to hold the ship over the lifting cable.' : crewAboard ? 'The ship is in range. Ask the crew to deploy the anchor before attaching the cable.' : 'Return aboard and deploy the anchor before attaching the lifting cable.', aboard ? 'anchor' : crewAboard ? 'radio' : has('board') ? 'board' : 'glance', aboard ? 'Deploy anchor' : crewAboard ? 'Request an anchor' : has('board') ? 'Climb aboard' : 'Find Kestrel');
  }
  if (w.cargo.attached) {
    if (!aboard) return step('Return aboard for the lift', 'Cable secured. Ascend to Kestrel; a crewmate can operate the winch while you return.', has('board') ? 'board' : 'glance', has('board') ? 'Climb aboard' : 'Find Kestrel');
    if (p.mode === 'winch') return step('Lift the archive', recoveryStatus(w).text, 'glance', 'Check lift progress');
    return step('Operate the recovery winch', recoveryStatus(w).text, has('winch') ? 'winch' : 'glance', has('winch') ? 'Operate winch' : 'Check recovery');
  }
  if (!aboard) return step('Attach the lifting cable', `Kestrel is anchored within range. Follow the archive signal to ${Math.round(-w.cargo.y)} m depth; attach within 5 m.`, has('attach') ? 'attach' : 'glance', has('attach') ? 'Attach lifting cable' : 'Find the archive');
  return step('Dive to the archive', 'Kestrel is anchored over the wreck. Dive, follow the archive signal, and attach the cable within 5 m.', has('dive') ? 'dive' : 'glance', has('dive') ? 'Enter the water' : 'Check the dive');
}

export function objectiveDistance(w, id, target) {
  const p = w.players[id];
  return p?.mode === 'diver' ? Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z) : distance(w.ship, target);
}

export function recoveryStatus(w) {
  const start = w.cargo.initialY ?? CRATE.y;
  const progress = w.cargo.recovered ? 1 : Math.max(0, Math.min(1, (w.cargo.y - start) / (2 - start)));
  const remaining = Math.max(0, 2 - w.cargo.y);
  if (w.cargo.recovered) {
    const divers = Object.values(w.players).filter(p => p.connected && p.mode === 'diver').length;
    return { progress, text: divers ? `Archive secured · ${divers} diver${divers === 1 ? '' : 's'} still in the water` : 'Archive secured · crew aboard' };
  }
  const text = !w.ship.anchor ? 'Lift paused · deploy the anchor' : distance(w.ship, w.cargo) >= 34 ? 'Lift paused · move closer to the cable' : !w.winch ? 'Cable attached · someone must operate the winch' : `Lifting archive · ${remaining.toFixed(1)} m to deck`;
  return { progress, text };
}

export function objectiveFor(w, id, { quiet = false } = {}) {
  const p = w.players[id];
  if (!p) return null;
  if (w.research) return researchTarget(w, id);
  if (p.mode === 'diver') {
    if (!w.cargo.attached && (distance(w.ship, w.cargo) >= 32 || !w.ship.anchor)) return { key: 'ship', label: 'KESTREL / BOARDING', x: w.ship.x, y: 0, z: w.ship.z, hint: missionGuidance(w, id).text };
    if (w.cargo.attached) return { key: 'ship', label: 'KESTREL / BOARDING', x: w.ship.x, y: 0, z: w.ship.z, hint: p.y < -3 ? 'Ascend to the surface' : Math.abs(w.ship.speed) >= 2 ? 'Wait for the cutter to slow' : 'Swim alongside · F to board' };
    const near = Math.hypot(p.x - w.cargo.x, p.y - w.cargo.y, p.z - w.cargo.z) < 5;
    return { key: 'archive', label: 'ARCHIVE SIGNAL', ...w.cargo, hint: near ? (!w.ship.anchor ? 'Crew must deploy the anchor' : distance(w.ship, w.cargo) >= 32 ? 'Bring Kestrel within cable range' : 'F to attach lifting cable') : `${Math.round(Math.max(0, -w.cargo.y))} m deep · follow the signal` };
  }
  if (w.cargo.attached && !w.cargo.recovered) {
    // Once positioned for lifting, the readout carries recovery progress. A
    // horizontal bearing to the cable adds no useful guidance from the deck.
    if (quiet && w.ship.anchor && distance(w.ship, w.cargo) < 34) return null;
    return { key: 'lift', label: 'ARCHIVE RECOVERY', ...w.cargo, hint: recoveryStatus(w).text };
  }
  if (w.mission === 'complete') return null;
  if (w.mission === 'return') return { key: 'base', label: 'PELICAN STATION', ...BASE, y: 3, hint: distance(w.ship, BASE) < 24 ? (Math.abs(w.ship.speed) < 1.5 ? 'F to deliver the archive' : 'Slow to deliver the archive') : 'Bring the archive home' };
  const wreck = activeSalvage(w).wreck;
  return { key: 'buoy', label: 'SURVEY BUOY', x: wreck.x + 17, y: 4, z: wreck.z,
    hint: missionGuidance(w, id).text };
}
