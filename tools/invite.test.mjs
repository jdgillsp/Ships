import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoopback, inviteAddresses } from '../server/InviteAddresses.mjs';
import { createGameServer } from '../server/index.mjs';
import { get } from 'node:http';

const interfaces = {
  'vEthernet (WSL)': [{ address: '172.24.0.1', internal: false }],
  Ethernet: [{ address: '10.0.0.8', internal: false }, { address: '2001:db8::2', internal: false }],
  'Wi-Fi': [{ address: '192.168.1.8', internal: false }],
  Other: [{ address: '192.168.1.8', internal: false }, { address: '169.254.1.3', internal: false }, { address: '203.0.113.1', internal: false }, { address: '127.0.0.1', internal: true }],
};
test('invite loopback detection covers IPv4, IPv6 and mapped sockets', () => {
  for (const address of ['127.0.0.1', '127.10.0.2', '::1', '[::1]', '::ffff:127.0.0.1']) assert.ok(isLoopback(address));
  for (const address of ['127.evil.test', '192.168.1.2', '::ffff:192.168.1.2', '::', '0.0.0.0', undefined]) assert.equal(isLoopback(address), false);
});
test('network invites prefer physical interfaces and omit duplicate or unusable addresses', () => {
  const choices = inviteAddresses({ address: '0.0.0.0', port: 8790 }, interfaces);
  assert.deepEqual(choices.map(item => item.origin), ['http://192.168.1.8:8790', 'http://10.0.0.8:8790']);
  assert.ok(choices[0].label.startsWith('Wi-Fi'));
});
test('network invites respect the actual listening interface', () => {
  assert.deepEqual(inviteAddresses({ address: '127.0.0.1', port: 1234 }, interfaces), []);
  assert.deepEqual(inviteAddresses({ address: '::1', port: 1234 }, interfaces), []);
  assert.deepEqual(inviteAddresses({ address: '10.0.0.8', port: 1234 }, interfaces).map(item => item.origin), ['http://10.0.0.8:1234']);
  assert.deepEqual(inviteAddresses({ address: '172.24.0.1', port: 1234 }, interfaces).map(item => item.origin), ['http://172.24.0.1:1234']);
  assert.deepEqual(inviteAddresses('socket-path', interfaces), []);
});
test('address lookup exposes network choices only through a local host request', async () => {
  const app = createGameServer(undefined, { networkInterfaces: () => interfaces });
  app.server.listen(0, '0.0.0.0'); await new Promise(r => app.server.once('listening', r));
  try {
    const url = `http://127.0.0.1:${app.server.address().port}/api/invite-addresses`;
    const local = await fetch(url); assert.equal(local.status, 200);
    assert.equal((await local.json()).addresses.length, 2);
    const proxied = await new Promise((resolve, reject) => get(url, { headers: { Host: 'voyage.example' } }, response => { let body = ''; response.on('data', part => { body += part; }); response.on('end', () => resolve(JSON.parse(body))); }).on('error', reject));
    assert.deepEqual(proxied, { addresses: [] });
  } finally { await app.stop(); }
});
