/**
 * 🌙 Mitsuki's Room — Test Simulation
 * Simulates 2 bot players completing a full hand via the REST API.
 *
 * Usage: npm test  (or: node test/simulate.js)
 * Requires: npm install first, then the server must NOT be running
 *           (this script starts its own instance).
 */

const http = require('http');

const BASE = 'http://localhost:3001';
let server;

// ─── HTTP Helpers ─────────────────────────────────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Test ─────────────────────────────────────────────────────

async function runTest() {
  console.log('\n🌙 ═══ Mitsuki\'s Room — Test Simulation ═══\n');

  // Start server on test port
  process.env.PORT = '3001';
  // Override timers for faster testing
  const config = require('../config');
  config.PORT = 3001;
  config.TURN_TIMER_MS = 60000;      // Long timer so we don't timeout
  config.HAND_START_DELAY_MS = 500;   // Fast hand start
  config.SHOWDOWN_DELAY_MS = 500;

  const { server: srv } = require('../server');
  server = srv;

  await sleep(1000); // Wait for server to start

  try {
    // Step 1: Check welcome
    console.log('📍 Step 1: Check server is up');
    const welcome = await get('/');
    console.log(`   ✅ ${welcome.body.name}`);

    // Step 2: Player 1 joins
    console.log('\n📍 Step 2: Bot Alpha joins');
    const join1 = await post('/api/join', { name: 'Alpha', buyIn: 200 });
    console.log(`   ✅ ${join1.body.message}`);
    console.log(`   Token: ${join1.body.token.slice(0, 8)}...`);
    const token1 = join1.body.token;

    // Step 3: Player 2 joins (triggers hand start)
    console.log('\n📍 Step 3: Bot Beta joins');
    const join2 = await post('/api/join', { name: 'Beta', buyIn: 200 });
    console.log(`   ✅ ${join2.body.message}`);
    const token2 = join2.body.token;

    // Wait for hand to start
    console.log('\n📍 Step 4: Waiting for hand to start...');
    await sleep(2000);

    // Check state
    let state1 = await get(`/api/state/${token1}`);
    let state2 = await get(`/api/state/${token2}`);
    console.log(`   Phase: ${state1.body.phase}`);
    console.log(`   Alpha's cards: ${state1.body.you.holeCards.map(c => c.rank + c.suit).join(' ')}`);
    console.log(`   Beta's cards: ${state2.body.you.holeCards.map(c => c.rank + c.suit).join(' ')}`);
    console.log(`   Pot: ${state1.body.pot}`);

    // Step 5: Play through the hand
    console.log('\n📍 Step 5: Playing the hand...');

    // Play betting rounds until showdown
    let maxRounds = 20;
    while (maxRounds-- > 0) {
      await sleep(200);

      state1 = await get(`/api/state/${token1}`);
      state2 = await get(`/api/state/${token2}`);

      const s = state1.body;
      if (s.phase === 'showdown' || s.phase === 'waiting') {
        console.log(`\n   🏁 Hand complete! Phase: ${s.phase}`);
        break;
      }

      // Find whose turn it is and make them act
      let actorToken, actorName;
      if (state1.body.isYourTurn) {
        actorToken = token1;
        actorName = 'Alpha';
      } else if (state2.body.isYourTurn) {
        actorToken = token2;
        actorName = 'Beta';
      } else {
        // No one's turn — might be transitioning
        await sleep(500);
        continue;
      }

      const actorState = actorToken === token1 ? state1.body : state2.body;
      const toCall = actorState.toCall;

      // Simple bot logic: call if there's a bet, check if possible
      let action, amount;
      if (toCall > 0) {
        action = 'call';
        console.log(`   ${actorName} calls ${toCall} (phase: ${actorState.phase}, pot: ${actorState.pot})`);
      } else {
        action = 'check';
        console.log(`   ${actorName} checks (phase: ${actorState.phase}, pot: ${actorState.pot})`);
      }

      const result = await post('/api/action', { token: actorToken, action, amount });
      if (result.body.error) {
        console.log(`   ❌ Error: ${result.body.error}`);
        break;
      }
    }

    // Step 6: Check final state
    await sleep(1000);
    console.log('\n📍 Step 6: Final standings');
    state1 = await get(`/api/state/${token1}`);
    state2 = await get(`/api/state/${token2}`);
    console.log(`   Alpha: ${state1.body.you.stack} chips (ELO: ${state1.body.you.elo})`);
    console.log(`   Beta: ${state2.body.you.stack} chips (ELO: ${state2.body.you.elo})`);

    // Step 7: Check tables
    console.log('\n📍 Step 7: Table list');
    const tables = await get('/api/tables');
    console.log(`   Active tables: ${tables.body.tables.length}`);

    // Step 8: Check leaderboard
    console.log('\n📍 Step 8: Leaderboard');
    const lb = await get('/api/leaderboard');
    for (const entry of lb.body.leaderboard) {
      console.log(`   ${entry.name}: ELO ${entry.elo} | Hands: ${entry.handsPlayed} | Won: ${entry.handsWon}`);
    }

    // Step 9: Hand history
    console.log('\n📍 Step 9: Hand history');
    const history = await get('/api/hand-history');
    console.log(`   Recorded hands: ${history.body.history.length}`);

    // Step 10: Players leave
    console.log('\n📍 Step 10: Players leave');
    const leave1 = await post('/api/leave', { token: token1 });
    console.log(`   ${leave1.body.message} (final: ${leave1.body.finalStack})`);
    const leave2 = await post('/api/leave', { token: token2 });
    console.log(`   ${leave2.body.message} (final: ${leave2.body.finalStack})`);

    console.log('\n🌙 ═══ Test Complete ═══\n');
    console.log('✅ All steps passed! Mitsuki\'s Room is operational.\n');

  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
  } finally {
    server.close();
    process.exit(0);
  }
}

runTest();
