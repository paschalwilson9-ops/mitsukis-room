const WebSocket = require('ws');

const BASE = 'https://mitsukis-room.onrender.com';
const WS_URL = 'wss://mitsukis-room.onrender.com';

const BOTS = [
  { name: 'Kimi', token: '40db9072-0cf2-4b56-8c5a-552d0b0c99e5', style: 'aggressive', chatLines: [
    "folding is for laundry", "locked in 🔒", "security breach detected: my chips are gone",
    "professionally confused about this hand", "nation-state level bluff right there",
    "all in is just a vibe check", "the firewall holds", "gg", "respect"
  ]},
  { name: 'JiroBot', token: '7cefb2fd-6202-4638-bc5b-008f041e825e', style: 'passive', chatLines: [
    "rain falls on the just and unjust alike", "drip drip 🌧", "the river card... poetic",
    "you cannot contain rain", "interesting line", "hmm", "patience is a river",
    "the cards speak if you listen", "beautiful flop"
  ]},
  { name: 'Luna', token: 'ab93db0b-9a43-47b2-9089-0fb559a9df4d', style: 'balanced', chatLines: [
    "the dark side of the moon plays tight", "🌑", "interesting...",
    "I see everything from up here", "the night is young",
    "good fold", "that was brave", "the stars align", "gg",
    "new moon energy", "silence speaks"
  ]}
];

function pickAction(bot, state) {
  const roll = Math.random();
  switch (bot.style) {
    case 'aggressive':
      if (roll < 0.3) return 'raise';
      if (roll < 0.7) return 'call';
      if (roll < 0.85) return 'check';
      return 'fold';
    case 'passive':
      if (roll < 0.5) return 'call';
      if (roll < 0.8) return 'check';
      if (roll < 0.9) return 'fold';
      return 'raise';
    case 'chaotic':
      if (roll < 0.2) return 'fold';
      if (roll < 0.4) return 'raise';
      if (roll < 0.7) return 'call';
      return 'check';
    case 'balanced':
    default:
      if (roll < 0.35) return 'call';
      if (roll < 0.6) return 'check';
      if (roll < 0.8) return 'raise';
      return 'fold';
  }
}

function randomChat(bot) {
  return bot.chatLines[Math.floor(Math.random() * bot.chatLines.length)];
}

async function apiAction(token, action, amount) {
  try {
    const body = { token, action };
    if (action === 'raise' && amount) body.amount = amount;
    const res = await fetch(`${BASE}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}

async function apiRebuy(token) {
  try {
    const res = await fetch(`${BASE}/api/rebuy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}

async function getState(token) {
  try {
    const res = await fetch(`${BASE}/api/state/${token}`);
    return await res.json();
  } catch (e) {
    return {};
  }
}

function connectBot(bot) {
  const ws = new WebSocket(`${WS_URL}?token=${bot.token}`);
  bot.ws = ws;
  
  ws.on('open', () => {
    console.log(`[${bot.name}] Connected via WebSocket`);
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      // Check if it's our turn
      if (msg.type === 'state' || msg.type === 'gameState') {
        const state = msg.state || msg;
        const isMyTurn = state.isYourTurn;
        
        if (isMyTurn && state.phase !== 'waiting') {
          // Small delay to feel natural
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 3000));
          
          let action = pickAction(bot, state);
          let result = await apiAction(bot.token, action);
          
          // Fallback chain
          if (result.error) {
            result = await apiAction(bot.token, 'call');
            if (result.error) {
              result = await apiAction(bot.token, 'check');
              if (result.error) {
                result = await apiAction(bot.token, 'fold');
              }
            }
          }
          
          console.log(`[${bot.name}] ${action} (${state.phase || '?'})`);
          
          // Chat occasionally after acting (20% chance)
          if (Math.random() < 0.2) {
            setTimeout(() => {
              const chatMsg = randomChat(bot);
              ws.send(JSON.stringify({ type: 'chat', text: chatMsg }));
              console.log(`[${bot.name}] 💬 "${chatMsg}"`);
            }, 1000 + Math.random() * 2000);
          }
        }
        
        // Check if busted
        if (state.you && state.you.stack === 0) {
          setTimeout(async () => {
            await apiRebuy(bot.token);
            console.log(`[${bot.name}] Rebought`);
          }, 2000);
        }
      }
      
      // React to other players' chat sometimes
      if (msg.type === 'chat' && msg.playerName !== bot.name && Math.random() < 0.1) {
        setTimeout(() => {
          const reaction = randomChat(bot);
          ws.send(JSON.stringify({ type: 'chat', text: reaction }));
          console.log(`[${bot.name}] 💬 reply: "${reaction}"`);
        }, 2000 + Math.random() * 3000);
      }
      
    } catch (e) {
      // ignore parse errors
    }
  });

  ws.on('close', () => {
    console.log(`[${bot.name}] Disconnected, reconnecting in 5s...`);
    setTimeout(() => connectBot(bot), 5000);
  });

  ws.on('error', (err) => {
    console.log(`[${bot.name}] WS error: ${err.message}`);
  });
}

// Also poll for turns in case WS state updates aren't triggering
async function pollLoop() {
  while (true) {
    for (const bot of BOTS) {
      try {
        const state = await getState(bot.token);
        if (state.you) bot.seat = state.you.seat;
        
        if (state.isYourTurn && state.phase !== 'waiting') {
          await new Promise(r => setTimeout(r, 500 + Math.random() * 1500));
          
          let action = pickAction(bot, state);
          let result = await apiAction(bot.token, action);
          
          if (result.error) {
            result = await apiAction(bot.token, 'call');
            if (result.error) {
              result = await apiAction(bot.token, 'check');
              if (result.error) {
                result = await apiAction(bot.token, 'fold');
              }
            }
          }
          
          console.log(`[${bot.name}] (poll) ${action} (${state.phase || '?'})`);
          
          // Chat after action sometimes
          if (Math.random() < 0.15 && bot.ws && bot.ws.readyState === WebSocket.OPEN) {
            const chatMsg = randomChat(bot);
            bot.ws.send(JSON.stringify({ type: 'chat', text: chatMsg }));
            console.log(`[${bot.name}] 💬 "${chatMsg}"`);
          }
        }
        
        // Rebuy check
        if (state.you && state.you.stack === 0) {
          await apiRebuy(bot.token);
          console.log(`[${bot.name}] Rebought`);
        }
      } catch (e) {
        // ignore
      }
    }
    await new Promise(r => setTimeout(r, 2500));
  }
}

// Periodic random chat to keep things lively
async function chatLoop() {
  while (true) {
    await new Promise(r => setTimeout(r, 15000 + Math.random() * 30000));
    const bot = BOTS[Math.floor(Math.random() * BOTS.length)];
    if (bot.ws && bot.ws.readyState === WebSocket.OPEN) {
      const msg = randomChat(bot);
      bot.ws.send(JSON.stringify({ type: 'chat', text: msg }));
      console.log(`[${bot.name}] 💬 (ambient) "${msg}"`);
    }
  }
}

console.log('🌙 Starting promo bots...');
BOTS.forEach(connectBot);
setTimeout(pollLoop, 3000);
setTimeout(chatLoop, 10000);
