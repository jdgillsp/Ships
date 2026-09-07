// Keep the working reference focused on the current station; the complete
// shortcut list and camera preferences remain in Settings.
export function stationGuide(mode, touch = false) {
  const title = { deck: 'Moving around the deck', helm: 'Steering Kestrel', diver: 'Swimming & looking around', winch: 'Working the winch' }[mode] || 'Moving around the deck';
  const movement = touch ? {
    deck: [['Left thumbstick', 'Walk around the deck.']],
    helm: [['Left thumbstick', 'Push up or down for ahead or astern; left or right turns the ship. Release to coast.']],
    diver: [['Left thumbstick', 'Swim forward, back or sideways.'], ['Up / Down', 'Hold a depth button to rise or descend.']],
    winch: [['Lift', 'The winch runs while you are at the controls, anchored within cable range.']]
  } : {
    deck: [['WASD / arrows', 'Walk around the deck.']],
    helm: [['W / S', 'Hold for ahead or astern. Release to coast.'], ['A / D', 'Turn left or right; looking around does not steer.'], ['B', 'Raise or deploy the anchor.']],
    diver: [['WASD', 'Swim forward, back or sideways.'], ['Space / Ctrl', 'Rise or descend.']],
    winch: [['Lift', 'The winch runs while you are at the controls, anchored within cable range.'], ['R', 'Leave the winch controls.']]
  };
  const look = mode === 'helm' ? 'Look around without steering the ship.' : mode === 'diver' ? 'Aim your view and forward swimming direction.' : mode === 'winch' ? 'Look around the recovery machinery.' : 'Look around. Walking follows your viewing direction.';
  const rows = [...(movement[mode] || movement.deck), [touch ? 'Drag the scene' : 'Drag', look]];
  if (!touch) {
    rows.push(['Q / E', mode === 'diver' ? 'Turn your view left / right.' : 'In first person, turn your view left / right.']);
    if (mode !== 'diver') rows.push(['C / Home', 'Change view / recenter your current view.']);
    if (mode !== 'winch') rows.push(['F', 'Use the highlighted action.']);
    if (mode === 'deck') rows.push(['L', 'Raise or lower binoculars.']);
  } else {
    if (mode !== 'winch') rows.push(['Action button', 'Use nearby equipment or interact with the dive objective.']);
    rows.push(['Activities / Tools', mode === 'winch' ? 'Leave the winch through Activities; change your view in Tools.' : 'Change duties in Activities; camera and anchor controls are in Tools.']);
  }
  if (mode === 'deck') rows.push(['Binocular − / +', touch ? 'Adjust magnification from 2× to 6×. The left thumbstick still walks while scouting.' : 'Adjust magnification from 2× to 6× while scouting.']);
  return { title, rows };
}
