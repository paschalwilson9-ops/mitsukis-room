/**
 * 🌙 Mitsuki's Room — API Routes
 * REST endpoints for AI agents to interact with the poker table.
 */

const express = require('express');
const Player = require('../game/player');
const config = require('../config');

function createRoutes(tableManager) {
  const router = express.Router();

  /**
   * POST /api/join
   * Join a table. Body: { name, buyIn? }
   * Returns: { token, seat, tableId }
   */
  router.post('/join', (req, res) => {
    const { name, buyIn } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const chips = buyIn || config.DEFAULT_BUY_IN;
    if (chips < config.MIN_BUY_IN || chips > config.MAX_BUY_IN) {
      return res.status(400).json({
        error: `Buy-in must be between ${config.MIN_BUY_IN} and ${config.MAX_BUY_IN}`,
      });
    }

    // Find a table with space, or create one
    let table = tableManager.findAvailableTable();
    if (!table) {
      table = tableManager.createTable();
    }

    const player = new Player(name.trim(), chips);
    const seat = table.seatPlayer(player);

    if (seat === null) {
      return res.status(400).json({ error: 'Table is full' });
    }

    // Track player-to-table mapping
    tableManager.registerPlayer(player.id, table.id);

    res.json({
      token: player.id,
      seat,
      tableId: table.id,
      message: `🌙 Welcome to Mitsuki's Room, ${name}. Seat ${seat} is yours.`,
    });
  });

  /**
   * GET /api/state/:token
   * Get current game state for a player.
   */
  router.get('/state/:token', (req, res) => {
    const { token } = req.params;
    const table = tableManager.findTableByPlayer(token);

    if (!table) {
      return res.status(404).json({ error: 'Player not found at any table' });
    }

    const state = table.getStateForPlayer(token);
    if (!state) {
      return res.status(404).json({ error: 'Player not found' });
    }

    res.json(state);
  });

  /**
   * POST /api/action
   * Perform an action. Body: { token, action, amount? }
   * Actions: "fold", "check", "call", "raise"
   */
  router.post('/action', (req, res) => {
    const { token, action, amount } = req.body;

    if (!token) return res.status(400).json({ error: 'Token is required' });
    if (!action) return res.status(400).json({ error: 'Action is required' });

    const validActions = ['fold', 'check', 'call', 'raise'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` });
    }

    const table = tableManager.findTableByPlayer(token);
    if (!table) {
      return res.status(404).json({ error: 'Player not found at any table' });
    }

    const result = table.handleAction(token, action, amount || 0);

    if (result.error) {
      return res.status(400).json(result);
    }

    // Return updated state
    const state = table.getStateForPlayer(token);
    res.json({ ...result, state });
  });

  /**
   * GET /api/tables
   * List all active tables.
   */
  router.get('/tables', (req, res) => {
    const tables = tableManager.getAllTables().map(t => t.toPublicJSON());
    res.json({ tables });
  });

  /**
   * POST /api/leave
   * Leave the table. Body: { token }
   */
  router.post('/leave', (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    const table = tableManager.findTableByPlayer(token);
    if (!table) {
      return res.status(404).json({ error: 'Player not found at any table' });
    }

    const player = table.findPlayer(token);
    const name = player ? player.name : 'Unknown';
    const stack = player ? player.stack : 0;

    table.removePlayer(token);
    tableManager.unregisterPlayer(token);

    res.json({
      message: `${name} has left the room.`,
      finalStack: stack,
    });
  });

  /**
   * GET /api/hand-history
   * Get recent hand history. Query: ?tableId=xxx&limit=10
   */
  router.get('/hand-history', (req, res) => {
    const { tableId, limit } = req.query;
    const maxResults = Math.min(parseInt(limit) || 10, config.MAX_HAND_HISTORY);

    if (tableId) {
      const table = tableManager.getTable(tableId);
      if (!table) return res.status(404).json({ error: 'Table not found' });
      res.json({ history: table.handHistory.slice(-maxResults) });
    } else {
      // Return from all tables
      const allHistory = tableManager.getAllTables()
        .flatMap(t => t.handHistory)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, maxResults);
      res.json({ history: allHistory });
    }
  });

  /**
   * GET /api/leaderboard
   * ELO rankings across all tables.
   */
  router.get('/leaderboard', (req, res) => {
    const players = new Map();

    for (const table of tableManager.getAllTables()) {
      for (const p of table.seatedPlayers()) {
        if (!players.has(p.name) || players.get(p.name).elo < p.elo) {
          players.set(p.name, {
            name: p.name,
            elo: p.elo,
            handsPlayed: p.handsPlayed,
            handsWon: p.handsWon,
            stack: p.stack,
          });
        }
      }
    }

    const leaderboard = [...players.values()].sort((a, b) => b.elo - a.elo);
    res.json({ leaderboard });
  });

  return router;
}

module.exports = createRoutes;
