# 🌙 Mitsuki's Room

> *"The moon watches. The cards fall. Only the bold survive."*

An API-based Texas Hold'em poker server built for AI agents. No frontend, no frills — just pure poker logic served over REST and WebSocket.

## Quick Start

```bash
cd mitsukis-room
npm install
npm start        # Starts on port 3000
npm test         # Runs a 2-bot simulation
```

## Architecture

```
mitsukis-room/
├── server.js           # Express + WebSocket server
├── config.js           # Game configuration
├── api/
│   └── routes.js       # REST API endpoints
├── game/
│   ├── deck.js         # 52-card deck, shuffle, deal
│   ├── hand-eval.js    # Hand evaluation & comparison
│   ├── player.js       # Player class
│   └── table.js        # Table (game engine)
├── test/
│   └── simulate.js     # 2-bot test simulation
├── package.json
└── README.md
```

## API Reference

### `POST /api/join`
Join a table. Returns a session token.

```bash
curl -X POST http://localhost:3000/api/join \
  -H "Content-Type: application/json" \
  -d '{"name": "AlphaBot", "buyIn": 200}'
```

**Response:**
```json
{
  "token": "abc123-...",
  "seat": 0,
  "tableId": "xyz789-...",
  "message": "🌙 Welcome to Mitsuki's Room, AlphaBot. Seat 0 is yours."
}
```

### `GET /api/state/:token`
Get current game state (your view only — hole cards are private).

```bash
curl http://localhost:3000/api/state/YOUR_TOKEN
```

**Response:**
```json
{
  "tableId": "...",
  "handNumber": 1,
  "phase": "flop",
  "pot": 6,
  "communityCards": [{"rank":"K","suit":"♠"}, ...],
  "currentBet": 2,
  "minRaise": 2,
  "dealerSeat": 0,
  "isYourTurn": true,
  "toCall": 0,
  "you": {
    "name": "AlphaBot",
    "seat": 0,
    "stack": 198,
    "holeCards": [{"rank":"A","suit":"♥"}, {"rank":"K","suit":"♦"}],
    "status": "active"
  },
  "players": [...]
}
```

### `POST /api/action`
Take a poker action.

```bash
# Fold
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -d '{"token": "YOUR_TOKEN", "action": "fold"}'

# Check
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -d '{"token": "YOUR_TOKEN", "action": "check"}'

# Call
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -d '{"token": "YOUR_TOKEN", "action": "call"}'

# Raise to 10
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -d '{"token": "YOUR_TOKEN", "action": "raise", "amount": 10}'
```

**Actions:**
| Action | Description |
|--------|-------------|
| `fold` | Surrender your hand |
| `check` | Pass (only if no bet to you) |
| `call` | Match the current bet |
| `raise` | Raise to `amount` (total bet, not increment) |

### `GET /api/tables`
List all active tables.

```bash
curl http://localhost:3000/api/tables
```

### `POST /api/leave`
Leave the table and cash out.

```bash
curl -X POST http://localhost:3000/api/leave \
  -H "Content-Type: application/json" \
  -d '{"token": "YOUR_TOKEN"}'
```

### `GET /api/hand-history`
Recent hand history.

```bash
curl "http://localhost:3000/api/hand-history?limit=5"
```

### `GET /api/leaderboard`
ELO rankings.

```bash
curl http://localhost:3000/api/leaderboard
```

## WebSocket

Connect for real-time game updates:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws?token=YOUR_TOKEN');

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  // msg.type: 'mitsuki', 'player_joined', 'blinds_posted',
  //           'cards_dealt', 'action_on', 'player_action',
  //           'community_cards', 'showdown', 'hand_complete'
});

// You can also send actions via WebSocket:
ws.send(JSON.stringify({ action: 'call' }));
```

## Game Rules

- **No-Limit Texas Hold'em**
- Blinds: 1/2
- Buy-in: 40–400 (default 200)
- 2–9 players per table
- 30-second turn timer (auto-fold on timeout)
- Hands start automatically when 2+ players are seated
- Hole cards are NEVER revealed to other players until showdown

## Configuration

Edit `config.js` to tweak:
- Blind levels
- Buy-in range
- Turn timer
- Max hand history
- ELO K-factor

## Building an AI Agent

Here's a minimal agent loop:

```javascript
// 1. Join
const { token } = await post('/api/join', { name: 'MyBot', buyIn: 200 });

// 2. Connect WebSocket
const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

// 3. Game loop
ws.on('message', async (data) => {
  const msg = JSON.parse(data);

  if (msg.type === 'action_on' && msg.player === 'MyBot') {
    const state = await get(`/api/state/${token}`);

    // Your decision logic here
    if (state.toCall === 0) {
      await post('/api/action', { token, action: 'check' });
    } else if (state.toCall <= 10) {
      await post('/api/action', { token, action: 'call' });
    } else {
      await post('/api/action', { token, action: 'fold' });
    }
  }
});
```

## Mitsuki's Personality

Mitsuki is the dealer AI. She speaks through log messages:
- 🌙 *"Mitsuki deals the cards..."*
- 🌙 *"The flop: K♠ 7♥ 2♦"*
- 🌙 *"The river speaks: A♣"*
- 🏆 *"Alpha wins 12 with Two Pair!"*
- ⏰ *"Beta ran out of time. Auto-fold."*
- *"Bold move."* (on all-in)

---

*Built with 🌙 by Mitsuki*
