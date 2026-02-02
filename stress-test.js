/**
 * 🌙 Mitsuki's Room — Stress Test
 * Multiple bot players with different strategies stress-testing the poker game.
 * 
 * This script tests:
 * - Multiple concurrent players
 * - Different playing strategies 
 * - All-in scenarios
 * - Side pot resolution
 * - Rebuy functionality
 * - Sit-out/return mechanics
 * - Chip conservation
 * - Error handling
 * 
 * Usage: node stress-test.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://mitsukis-room.onrender.com';
const POLL_INTERVAL = 2000; // 2 seconds
const MIN_HANDS = 50;
const SIT_OUT_AFTER_HANDS = 20;
const SIT_OUT_DURATION = 30000; // 30 seconds

// Test results tracking
const testResults = {
  startTime: new Date(),
  totalHands: 0,
  errors: [],
  sidePots: [],
  allIns: [],
  rebuys: [],
  sitOuts: [],
  chipsTracking: [],
  chatMessages: [],
  handsPlayed: 0,
  endTime: null
};

// ─── HTTP Helpers ─────────────────────────────────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = https.request(options, (res) => {
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

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function logError(error, context) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR in ${context}: ${error}`);
  testResults.errors.push({
    timestamp,
    context,
    error: error.toString(),
    stack: error.stack
  });
}

// ─── Bot Strategies ─────────────────────────────────────────────

class Bot {
  constructor(name, strategy, buyIn = 100) {
    this.name = name;
    this.strategy = strategy;
    this.buyIn = buyIn;
    this.token = null;
    this.active = false;
    this.handsPlayed = 0;
    this.sittingOut = false;
    this.sitOutStart = null;
  }

  async join() {
    try {
      log(`${this.name} attempting to join...`);
      const response = await post('/api/join', {
        name: this.name,
        buyIn: this.buyIn
      });

      if (response.status === 200) {
        this.token = response.body.token;
        this.active = true;
        log(`${this.name} joined successfully! Token: ${this.token.slice(0, 8)}...`);
        return true;
      } else {
        logError(new Error(`Join failed: ${JSON.stringify(response.body)}`), `${this.name} join`);
        return false;
      }
    } catch (error) {
      logError(error, `${this.name} join`);
      return false;
    }
  }

  async getState() {
    try {
      const response = await get(`/api/state/${this.token}`);
      if (response.status === 200) {
        return response.body;
      } else {
        logError(new Error(`State fetch failed: ${JSON.stringify(response.body)}`), `${this.name} state`);
        return null;
      }
    } catch (error) {
      logError(error, `${this.name} state`);
      return null;
    }
  }

  async makeAction(action, amount = 0) {
    try {
      const response = await post('/api/action', {
        token: this.token,
        action,
        amount
      });

      if (response.status === 200) {
        log(`${this.name} ${action}${amount > 0 ? ` ${amount}` : ''}`);
        return response.body;
      } else {
        logError(new Error(`Action failed: ${JSON.stringify(response.body)}`), `${this.name} ${action}`);
        return null;
      }
    } catch (error) {
      logError(error, `${this.name} ${action}`);
      return null;
    }
  }

  async sitOut() {
    try {
      const response = await post('/api/sit-out', { token: this.token });
      if (response.status === 200) {
        this.sittingOut = true;
        this.sitOutStart = Date.now();
        log(`${this.name} is now sitting out`);
        testResults.sitOuts.push({
          bot: this.name,
          action: 'sit-out',
          timestamp: new Date(),
          handsWhenSatOut: this.handsPlayed
        });
        return true;
      }
      return false;
    } catch (error) {
      logError(error, `${this.name} sit-out`);
      return false;
    }
  }

  async returnToGame() {
    try {
      const response = await post('/api/return', { token: this.token });
      if (response.status === 200) {
        this.sittingOut = false;
        this.sitOutStart = null;
        log(`${this.name} returned to the game`);
        testResults.sitOuts.push({
          bot: this.name,
          action: 'return',
          timestamp: new Date(),
          handsWhenReturned: this.handsPlayed
        });
        return true;
      }
      return false;
    } catch (error) {
      logError(error, `${this.name} return`);
      return false;
    }
  }

  async rebuy(amount) {
    try {
      const response = await post('/api/rebuy', {
        token: this.token,
        amount
      });

      if (response.status === 200) {
        log(`${this.name} rebought for ${amount} chips`);
        testResults.rebuys.push({
          bot: this.name,
          amount,
          timestamp: new Date(),
          newStack: response.body.newStack
        });
        return true;
      } else {
        logError(new Error(`Rebuy failed: ${JSON.stringify(response.body)}`), `${this.name} rebuy`);
        return false;
      }
    } catch (error) {
      logError(error, `${this.name} rebuy`);
      return false;
    }
  }

  // Strategy implementation
  decideAction(state) {
    const { you, toCall, phase, pot } = state;
    const { holeCards, stack } = you;

    switch (this.strategy) {
      case 'rock': return this.playRock(holeCards, toCall, stack, phase);
      case 'maniac': return this.playManiac(toCall, stack, pot);
      case 'caller': return this.playCaller(toCall, stack);
      case 'shark': return this.playShark(toCall, stack, pot, phase);
      default: return { action: 'fold' };
    }
  }

  // "The Rock" - Only plays premium hands, folds 80% of time
  playRock(holeCards, toCall, stack, phase) {
    if (!holeCards || holeCards.length < 2) return { action: 'fold' };
    
    const card1 = holeCards[0];
    const card2 = holeCards[1];
    const isPremium = this.isPremiumHand(card1, card2);

    if (!isPremium) {
      return { action: 'fold' };
    }

    // Premium hand - play aggressively
    if (toCall === 0) {
      const raiseAmount = Math.min(Math.floor(stack * 0.3), 50);
      return { action: 'raise', amount: raiseAmount };
    } else if (toCall < stack * 0.5) {
      return { action: 'call' };
    } else {
      return { action: 'fold' };
    }
  }

  // "The Maniac" - Raises every hand, goes all-in frequently
  playManiac(toCall, stack, pot) {
    const random = Math.random();
    
    // 30% chance to go all-in
    if (random < 0.3) {
      log(`${this.name} (Maniac) going ALL-IN!`);
      testResults.allIns.push({
        bot: this.name,
        stackSize: stack,
        timestamp: new Date(),
        pot
      });
      return { action: 'raise', amount: stack };
    }
    
    // 70% chance to raise aggressively
    if (toCall === 0) {
      const raiseAmount = Math.min(Math.floor(pot * 1.5), Math.floor(stack * 0.7));
      return { action: 'raise', amount: Math.max(raiseAmount, 10) };
    } else {
      // Always raise over the current bet
      const raiseAmount = Math.min(toCall * 2, Math.floor(stack * 0.8));
      return { action: 'raise', amount: raiseAmount };
    }
  }

  // "The Caller" - Never raises, always calls
  playCaller(toCall, stack) {
    if (toCall === 0) {
      return { action: 'check' };
    } else if (toCall < stack) {
      return { action: 'call' };
    } else {
      return { action: 'fold' };
    }
  }

  // "The Shark" - Balanced strategy
  playShark(toCall, stack, pot, phase) {
    if (toCall === 0) {
      return { action: 'check' };
    } else if (toCall <= pot * 0.1) {
      // Small bet - call
      return { action: 'call' };
    } else if (toCall > pot * 0.5) {
      // Big bet - fold
      return { action: 'fold' };
    } else {
      // Medium bet - call
      return { action: 'call' };
    }
  }

  isPremiumHand(card1, card2) {
    const ranks = [card1.rank, card2.rank];
    const suits = [card1.suit, card2.suit];
    
    // Pocket pairs AA, KK, QQ, JJ, 10-10
    if (ranks[0] === ranks[1]) {
      return ['A', 'K', 'Q', 'J', '10'].includes(ranks[0]);
    }
    
    // Premium suited/unsuited combinations
    const premiumCombos = [
      ['A', 'K'], ['A', 'Q'], ['A', 'J'],
      ['K', 'Q'], ['K', 'J'], ['Q', 'J']
    ];
    
    const sortedRanks = ranks.sort();
    return premiumCombos.some(combo => 
      combo[0] === sortedRanks[1] && combo[1] === sortedRanks[0]
    );
  }
}

// ─── Chip Conservation Checker ─────────────────────────────────

async function checkChipConservation() {
  try {
    const tablesResponse = await get('/api/tables');
    if (tablesResponse.status !== 200) return;

    let totalChips = 0;
    for (const table of tablesResponse.body.tables) {
      for (const player of table.players || []) {
        if (player.stack) totalChips += player.stack;
      }
      if (table.pot) totalChips += table.pot;
    }

    testResults.chipsTracking.push({
      timestamp: new Date(),
      totalChips,
      hands: testResults.handsPlayed
    });

    return totalChips;
  } catch (error) {
    logError(error, 'chip conservation check');
    return null;
  }
}

// ─── Main Test Loop ─────────────────────────────────────────────

async function runStressTest() {
  log('🌙 ═══ Starting Mitsuki\'s Room Stress Test ═══');
  
  // Create bots with different strategies
  const bots = [
    new Bot('Bot_1_Rock', 'rock', 100),
    new Bot('Bot_2_Maniac', 'maniac', 100), 
    new Bot('Bot_3_Caller', 'caller', 100),
    new Bot('Bot_4_Shark', 'shark', 100),
    new Bot('Bot_5_Test', 'rock', 100)
  ];

  // Join all bots
  log('📍 Phase 1: Joining bots to the table...');
  for (const bot of bots) {
    const success = await bot.join();
    if (!success) {
      log(`❌ Failed to join ${bot.name}, continuing with remaining bots`);
    }
    await sleep(500); // Stagger joins
  }

  const activeBots = bots.filter(bot => bot.active);
  log(`✅ ${activeBots.length} bots successfully joined`);

  if (activeBots.length < 2) {
    log('❌ Need at least 2 bots to run the test');
    return;
  }

  // Initial chip conservation check
  await checkChipConservation();

  log('📍 Phase 2: Running game loop...');
  
  let handsCompleted = 0;
  let loopIterations = 0;
  const maxIterations = 2000; // Prevent infinite loops

  while (handsCompleted < MIN_HANDS && loopIterations < maxIterations) {
    loopIterations++;
    
    try {
      // Check if Bot_4 should sit out after 20 hands
      if (handsCompleted >= SIT_OUT_AFTER_HANDS && !activeBots[3]?.sittingOut) {
        await activeBots[3]?.sitOut();
      }
      
      // Check if Bot_4 should return after sitting out for 30 seconds
      if (activeBots[3]?.sittingOut && 
          activeBots[3]?.sitOutStart && 
          Date.now() - activeBots[3].sitOutStart >= SIT_OUT_DURATION) {
        await activeBots[3]?.returnToGame();
      }

      // Poll each active bot
      for (const bot of activeBots) {
        if (!bot.active) continue;

        const state = await bot.getState();
        if (!state) continue;

        // Check for hand completion
        if (state.phase === 'waiting' && loopIterations % 10 === 0) {
          // Count hands only occasionally to avoid double-counting
          const currentHand = state.handNumber || 0;
          if (currentHand > handsCompleted) {
            handsCompleted = currentHand;
            testResults.handsPlayed = handsCompleted;
            log(`✅ Hand ${handsCompleted} completed`);
            
            // Check chip conservation every few hands
            await checkChipConservation();
          }
        }

        // Check for side pots
        if (state.sidePots && state.sidePots.length > 0) {
          log(`📊 Side pots detected: ${JSON.stringify(state.sidePots)}`);
          testResults.sidePots.push({
            handNumber: handsCompleted,
            sidePots: state.sidePots,
            timestamp: new Date()
          });
        }

        // Check if bot is busted and needs rebuy
        if (state.you.stack === 0 && !bot.sittingOut) {
          log(`💰 ${bot.name} is busted, attempting rebuy`);
          await bot.rebuy(100);
        }

        // Make action if it's bot's turn
        if (state.isYourTurn && !bot.sittingOut) {
          const decision = bot.decideAction(state);
          if (decision) {
            await bot.makeAction(decision.action, decision.amount || 0);
            bot.handsPlayed++;
          }
        }
      }

      await sleep(POLL_INTERVAL);
      
    } catch (error) {
      logError(error, 'main game loop');
      await sleep(POLL_INTERVAL * 2); // Wait longer on errors
    }
  }

  log(`📍 Phase 3: Testing hand history...`);
  try {
    const historyResponse = await get('/api/hand-history?limit=10');
    if (historyResponse.status === 200) {
      log(`✅ Hand history retrieved: ${historyResponse.body.history?.length || 0} hands`);
    } else {
      logError(new Error(`Hand history failed: ${JSON.stringify(historyResponse.body)}`), 'hand history');
    }
  } catch (error) {
    logError(error, 'hand history test');
  }

  // Final chip conservation check
  log('📍 Phase 4: Final chip conservation check...');
  await checkChipConservation();

  testResults.endTime = new Date();
  testResults.totalHands = handsCompleted;

  log(`🌙 ═══ Stress Test Complete ═══`);
  log(`Hands played: ${handsCompleted}`);
  log(`Test duration: ${Math.round((testResults.endTime - testResults.startTime) / 1000)}s`);
  log(`Errors encountered: ${testResults.errors.length}`);

  // Generate test report
  await generateTestReport();
}

// ─── Test Report Generation ─────────────────────────────────────

async function generateTestReport() {
  const reportPath = path.join(__dirname, 'TEST-REPORT.md');
  
  const duration = Math.round((testResults.endTime - testResults.startTime) / 1000);
  const errorCount = testResults.errors.length;
  const sidePotCount = testResults.sidePots.length;
  const allInCount = testResults.allIns.length;
  const rebuyCount = testResults.rebuys.length;
  const sitOutCount = testResults.sitOuts.length;

  // Chip conservation analysis
  const chipData = testResults.chipsTracking;
  const chipConservationIssues = [];
  if (chipData.length > 1) {
    for (let i = 1; i < chipData.length; i++) {
      const prev = chipData[i-1].totalChips;
      const curr = chipData[i].totalChips;
      const diff = Math.abs(curr - prev);
      if (diff > 10) { // Threshold for significant chip changes
        chipConservationIssues.push({
          hand: chipData[i].hands,
          previous: prev,
          current: curr,
          difference: curr - prev
        });
      }
    }
  }

  const report = `# Mitsuki's Room - Stress Test Report

**Test Date:** ${testResults.startTime.toISOString()}
**Duration:** ${duration} seconds
**Total Hands Played:** ${testResults.totalHands}

## Summary

| Metric | Count | Status |
|--------|-------|---------|
| Total Errors | ${errorCount} | ${errorCount === 0 ? '✅' : '⚠️'} |
| Side Pot Scenarios | ${sidePotCount} | ${sidePotCount > 0 ? '✅' : 'ℹ️'} |
| All-In Scenarios | ${allInCount} | ${allInCount > 0 ? '✅' : 'ℹ️'} |
| Rebuy Attempts | ${rebuyCount} | ${rebuyCount > 0 ? '✅' : 'ℹ️'} |
| Sit-Out Tests | ${sitOutCount} | ${sitOutCount > 0 ? '✅' : 'ℹ️'} |
| Chip Conservation Issues | ${chipConservationIssues.length} | ${chipConservationIssues.length === 0 ? '✅' : '⚠️'} |

## Bot Strategies Tested

1. **Bot_1_Rock "The Rock"** - Conservative premium hand strategy
2. **Bot_2_Maniac "The Maniac"** - Aggressive all-in strategy  
3. **Bot_3_Caller "The Caller"** - Passive calling strategy
4. **Bot_4_Shark "The Shark"** - Balanced strategy + sit-out test
5. **Bot_5_Test** - Additional rock strategy for more players

## Detailed Results

### Errors Encountered
${errorCount === 0 ? 'No errors encountered! ✅' : testResults.errors.map(err => `
**${err.context}** (${err.timestamp})
\`\`\`
${err.error}
\`\`\`
`).join('\n')}

### Side Pot Scenarios
${sidePotCount === 0 ? 'No side pots created during testing.' : testResults.sidePots.map(sp => `
- **Hand ${sp.handNumber}**: ${sp.sidePots.length} side pots created
  - ${JSON.stringify(sp.sidePots, null, 2)}
`).join('\n')}

### All-In Scenarios  
${allInCount === 0 ? 'No all-ins occurred during testing.' : testResults.allIns.map(ai => `
- **${ai.bot}**: All-in with ${ai.stackSize} chips (pot: ${ai.pot})
`).join('\n')}

### Rebuy Scenarios
${rebuyCount === 0 ? 'No rebuys attempted during testing.' : testResults.rebuys.map(rb => `
- **${rb.bot}**: Rebought ${rb.amount} chips → ${rb.newStack} total
`).join('\n')}

### Sit-Out Tests
${sitOutCount === 0 ? 'No sit-out tests performed.' : testResults.sitOuts.map(so => `
- **${so.bot}**: ${so.action} at hand ${so.action === 'sit-out' ? so.handsWhenSatOut : so.handsWhenReturned}
`).join('\n')}

### Chip Conservation Analysis
${chipConservationIssues.length === 0 ? 
  'No chip conservation issues detected! ✅' : 
  `⚠️ **${chipConservationIssues.length} potential chip conservation issues:**
${chipConservationIssues.map(issue => `
- Hand ${issue.hand}: ${issue.previous} → ${issue.current} (${issue.difference > 0 ? '+' : ''}${issue.difference})
`).join('\n')}`}

### Chip Tracking Over Time
${chipData.map(cd => `- Hand ${cd.hands}: ${cd.totalChips} total chips`).join('\n')}

## Test Configuration

- **Server:** ${BASE_URL}
- **Poll Interval:** ${POLL_INTERVAL}ms
- **Minimum Hands:** ${MIN_HANDS}
- **Sit-Out Test:** After ${SIT_OUT_AFTER_HANDS} hands for ${SIT_OUT_DURATION/1000}s

## Recommendations

${errorCount > 0 ? '- **Fix API Errors**: Address the errors listed above to improve stability.' : ''}
${chipConservationIssues.length > 0 ? '- **Investigate Chip Issues**: Check the chip conservation problems identified.' : ''}
${sidePotCount === 0 ? '- **Test Side Pots**: Consider scenarios that would create side pots.' : ''}
${allInCount === 0 ? '- **Test All-Ins**: The maniac bot should trigger more all-in scenarios.' : ''}

## Overall Assessment

${errorCount === 0 && chipConservationIssues.length === 0 ? 
  '🌙 **EXCELLENT**: The poker system handled the stress test without major issues!' :
  errorCount < 5 && chipConservationIssues.length < 3 ?
  '⚠️ **GOOD**: Minor issues detected, but system is generally stable.' :
  '❌ **NEEDS WORK**: Multiple issues detected that should be addressed.'}

---
*Generated by Mitsuki's Room Stress Test at ${new Date().toISOString()}*
`;

  await fs.promises.writeFile(reportPath, report);
  log(`📄 Test report written to: ${reportPath}`);
}

// ─── Run the test ─────────────────────────────────────────────

runStressTest().catch(error => {
  console.error('Fatal error in stress test:', error);
  process.exit(1);
});