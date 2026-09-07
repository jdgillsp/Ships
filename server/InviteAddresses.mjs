import { isIP } from 'node:net';

export function isLoopback(address) {
  const value = String(address || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  return value === '::1' || (isIP(value) === 4 && value.startsWith('127.'));
}

export function inviteAddresses(listener, interfaces) {
  if (!listener || typeof listener === 'string' || isLoopback(listener.address)) return [];
  const any = ['0.0.0.0', '::'].includes(listener.address), choices = [];
  for (const [name, addresses] of Object.entries(interfaces)) for (const item of addresses || []) {
    if (item.internal || isIP(item.address) !== 4 || (!any && item.address !== listener.address)) continue;
    const [a, b] = item.address.split('.').map(Number);
    if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) continue;
    const rank = /virtual|vethernet|vmware|docker|wsl|vpn|tun|tap/i.test(name) ? 3 : /wi-?fi|wlan/i.test(name) ? 0 : /ethernet|^eth|^en\d/i.test(name) ? 1 : 2;
    choices.push({ label: `${name} · ${item.address}`, origin: `http://${item.address}:${listener.port}`, rank });
  }
  choices.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  const physical = choices.filter(item => item.rank < 3);
  const seen = new Set();
  return (physical.length ? physical : choices).filter(item => { if (seen.has(item.origin)) return false; seen.add(item.origin); return true; }).slice(0, 8).map(({ label, origin }) => ({ label, origin }));
}
