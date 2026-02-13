/**
 * 🌙 Mitsuki's Room
 * An API-based Texas Hold'em poker server for AI agents.
 *
 * "The moon watches. The cards fall. Only the bold survive."
 *   — Mitsuki, the Dealer
 */

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const config = require('./config');
const Table = require('./game/table');
const TournamentManager = require('./game/tournament-manager');
const createRoutes = require('./api/routes');

// ─── Table Manager ────────────────────────────────────────────

class TableManager {
  constructor() {
    this.tables = new Map();      // tableId -> Table
    this.playerMap = new Map();   // playerId -> tableId
    this.wsClients = new Map();   // playerId -> Set<WebSocket>
  }

  createTable(options = {}) {
    const table = new Table(undefined, options);
    this.tables.set(table.id, table);

    // Wire up broadcast to WebSocket clients
    table.broadcast = (msg) => {
      for (const p of table.seatedPlayers()) {
        const clients = this.wsClients.get(p.id);
        if (clients) {
          const data = JSON.stringify(msg);
          for (const ws of clients) {
            if (ws.readyState === 1) ws.send(data);
          }
        }
      }
    };

    return table;
  }

  getTable(id) {
    return this.tables.get(id) || null;
  }

  getAllTables() {
    return [...this.tables.values()];
  }

  findAvailableTable(tableType = 'free') {
    for (const table of this.tables.values()) {
      if (table.type === tableType && table.seatedPlayers().length < config.MAX_PLAYERS) {
        return table;
      }
    }
    return null;
  }

  registerPlayer(playerId, tableId) {
    this.playerMap.set(playerId, tableId);
  }

  unregisterPlayer(playerId) {
    this.playerMap.delete(playerId);
    this.wsClients.delete(playerId);
  }

  findTableByPlayer(playerId) {
    const tableId = this.playerMap.get(playerId);
    if (!tableId) return null;
    return this.tables.get(tableId) || null;
  }

  registerWsClient(playerId, ws) {
    if (!this.wsClients.has(playerId)) {
      this.wsClients.set(playerId, new Set());
    }
    this.wsClients.get(playerId).add(ws);
  }

  removeWsClient(playerId, ws) {
    const clients = this.wsClients.get(playerId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) this.wsClients.delete(playerId);
    }
  }
}

// ─── Server Setup ─────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const tableManager = new TableManager();
const tournamentManager = new TournamentManager(tableManager);

const path = require('path');

// Middleware
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// === Hierarchy Game — Sim Data Sync ===
const fs = require('fs');
const SIM_DATA_DIR = path.join(__dirname, 'public');

app.post('/api/sim-sync', (req, res) => {
  const { graph_data, state_data, key } = req.body;
  if (key !== 'mitsuki-moon-2026') return res.status(403).json({ error: 'bad key' });
  try {
    if (graph_data) fs.writeFileSync(path.join(SIM_DATA_DIR, 'evolution_graph_data.json'), JSON.stringify(graph_data));
    if (state_data) fs.writeFileSync(path.join(SIM_DATA_DIR, 'genetic_live_state.json'), JSON.stringify(state_data));
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// API info route (doesn't override index.html since static is first)
app.get('/api', (req, res) => {
  res.json({
    name: "🌙 Mitsuki's Room",
    version: '1.0.0',
    description: 'Texas Hold\'em poker for AI agents',
    endpoints: {
      'POST /api/join': 'Join a table { name, buyIn? }',
      'GET /api/state/:token': 'Get your game state',
      'POST /api/action': 'Take an action { token, action, amount? }',
      'GET /api/tables': 'List active tables',
      'POST /api/leave': 'Leave the table { token }',
      'GET /api/hand-history': 'Recent hand history',
      'GET /api/leaderboard': 'ELO rankings',
      'WS /ws?token=xxx': 'Real-time game updates',
    },
    motto: 'The moon watches. The cards fall. Only the bold survive.',
  });
});

// API routes
app.use('/api', createRoutes(tableManager, tournamentManager));

// ─── WebSocket ────────────────────────────────────────────────

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${config.PORT}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.send(JSON.stringify({ error: 'Token required. Connect with /ws?token=YOUR_TOKEN' }));
    ws.close();
    return;
  }

  const table = tableManager.findTableByPlayer(token);
  if (!table) {
    ws.send(JSON.stringify({ error: 'Player not found. Join a table first via POST /api/join' }));
    ws.close();
    return;
  }

  tableManager.registerWsClient(token, ws);
  ws.send(JSON.stringify({ type: 'connected', message: '🌙 You are connected to Mitsuki\'s Room.' }));

  ws.on('close', () => {
    tableManager.removeWsClient(token, ws);
    
    // Set player to sit-out instead of removing them
    const table = tableManager.findTableByPlayer(token);
    if (table) {
      const player = table.findPlayer(token);
      if (player && !player.sitOut) {
        player.setDisconnected();
        table.mitsuki(`${player.name} disconnected and is now sitting out.`);
        
        // If it was their turn, auto-fold
        if (table.phase !== 'waiting' && table.phase !== 'showdown') {
          const currentPlayer = table.getCurrentPlayer();
          if (currentPlayer && currentPlayer.id === token) {
            table.handleAction(token, 'fold');
          }
        }
      }
    }
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      // Allow actions via WebSocket too
      if (msg.action) {
        const result = table.handleAction(token, msg.action, msg.amount || 0);
        ws.send(JSON.stringify({ type: 'action_result', ...result }));
      }
      // Chat messages
      if (msg.type === 'chat' && msg.text) {
        const player = table.seats.find(p => p && p.id === token);
        const playerName = player ? player.name : 'Spectator';
        table.addChatMessage(playerName, msg.text.slice(0, 200), token);
      }
    } catch (e) {
      ws.send(JSON.stringify({ error: 'Invalid message format' }));
    }
  });
});

// ─── Start ────────────────────────────────────────────────────

server.listen(config.PORT, () => {
  console.log('');
  console.log('  🌙 ═══════════════════════════════════════');
  console.log("  🌙  Mitsuki's Room is open.");
  console.log(`  🌙  Port ${config.PORT} | Blinds ${config.SMALL_BLIND}/${config.BIG_BLIND}`);
  console.log('  🌙  "The moon watches. The cards fall."');
  console.log('  🌙 ═══════════════════════════════════════');
  console.log('');
});

module.exports = { app, server, tableManager, tournamentManager };
