const key = 'abyssal:crew-name';
const callsigns = ['Tern', 'Petrel', 'Gannet', 'Heron', 'Puffin', 'Fulmar', 'Osprey', 'Gull'];

export function suggestedCrewName() {
  try {
    const saved = localStorage.getItem(key);
    if (saved?.trim() && saved.length <= 20 && !/[<>\x00-\x1f]/.test(saved)) return saved;
  } catch { /* A name preference must not prevent joining. */ }
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${callsigns[random[0] % callsigns.length]} ${1000 + random[1] % 9000}`;
}

export function rememberCrewName(name) {
  if (typeof name !== 'string' || !name.trim()) return;
  try { localStorage.setItem(key, name); } catch { /* Joining still works without preferences. */ }
}
