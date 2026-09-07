// Run the complete production voyage against an isolated server, leaving any
// current player's room and its saved voyages untouched.
import { createGameServer } from '../server/index.mjs';

const app = createGameServer();
app.server.listen(0, '127.0.0.1');
await new Promise(resolve => app.server.once('listening', resolve));
const previousURL = process.env.GAME_URL;
process.env.GAME_URL = `http://127.0.0.1:${app.server.address().port}/`;
try { await import('./game-browser.mjs'); }
finally {
  if (previousURL === undefined) delete process.env.GAME_URL; else process.env.GAME_URL = previousURL;
  await app.stop();
}
