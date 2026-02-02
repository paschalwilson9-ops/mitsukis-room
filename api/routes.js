/**
 * 🌙 Mitsuki's Room — API Routes
 * REST endpoints for AI agents to interact with the poker table.
 */

const express = require('express');
const Player = require('../game/player');
const config = require('../config');
const { ethers } = require('ethers');

// Crypto configuration
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MITSUKI_WALLET = '0x12da9c45F886211142A92DE1085141738720aEaA';
const RPC_URL = 'https://mainnet.base.org';

// Initialize ethers
const provider = new ethers.JsonRpcProvider(RPC_URL);
const privateKey = process.env.SERVER_WALLET_KEY || '';
const serverWallet = new ethers.Wallet(privateKey, provider);

// USDC contract interface (minimal)
const usdcAbi = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function transferFrom(address from, address to, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];
const usdcContract = new ethers.Contract(USDC_ADDRESS, usdcAbi, serverWallet);

// Track crypto balances
const cryptoBalances = new Map(); // address -> balance in USDC (6 decimals)

function createRoutes(tableManager, tournamentManager) {
  const router = express.Router();

  /**
   * POST /api/join
   * Join a table. Body: { name, buyIn?, tableType? }
   * Returns: { token, seat, tableId }
   */
  router.post('/join', (req, res) => {
    const { name, buyIn, tableType } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const type = tableType || 'free';
    if (!['free', 'paid'].includes(type)) {
      return res.status(400).json({ error: 'Table type must be "free" or "paid"' });
    }

    // Find a table with space, or create one
    let table = tableManager.findAvailableTable(type);
    if (!table) {
      table = tableManager.createTable({ type });
    }

    const chips = buyIn || config.DEFAULT_BUY_IN;
    if (chips < table.minBuyIn || chips > table.maxBuyIn) {
      return res.status(400).json({
        error: `Buy-in must be between ${table.minBuyIn} and ${table.maxBuyIn} for ${type} tables`,
      });
    }

    // Reject duplicate names at the same table
    const trimmedName = name.trim();
    const existingNames = table.seatedPlayers().map(p => p.name.toLowerCase());
    if (existingNames.includes(trimmedName.toLowerCase())) {
      return res.status(400).json({ error: 'That name is already taken at this table. Pick another.' });
    }

    const player = new Player(trimmedName, chips);
    const seat = table.seatPlayer(player);

    if (seat === null) {
      return res.status(400).json({ error: 'Table is full' });
    }

    // Track player-to-table mapping
    tableManager.registerPlayer(player.id, table.id);

    const welcomeMessage = table.type === 'paid' 
      ? `🌙 Welcome to the High Stakes room, ${name}. Seat ${seat} is yours. The stakes are real.`
      : `🌙 Welcome to Mitsuki's Room, ${name}. Seat ${seat} is yours.`;

    res.json({
      token: player.id,
      seat,
      tableId: table.id,
      tableType: table.type,
      message: welcomeMessage,
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
   * POST /api/sit-out
   * Sit out from the table. Body: { token }
   */
  router.post('/sit-out', (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    const table = tableManager.findTableByPlayer(token);
    if (!table) {
      return res.status(404).json({ error: 'Player not found at any table' });
    }

    const success = table.setSitOut(token);
    if (success) {
      res.json({ message: 'You are now sitting out' });
    } else {
      res.status(400).json({ error: 'Could not sit out' });
    }
  });

  /**
   * POST /api/return
   * Return from sit-out. Body: { token }
   */
  router.post('/return', (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    const table = tableManager.findTableByPlayer(token);
    if (!table) {
      return res.status(404).json({ error: 'Player not found at any table' });
    }

    const success = table.returnFromSitOut(token);
    if (success) {
      res.json({ message: 'Welcome back to the table!' });
    } else {
      res.status(400).json({ error: 'Could not return from sit-out' });
    }
  });

  /**
   * POST /api/rebuy
   * Add chips to stack. Body: { token, amount }
   */
  router.post('/rebuy', (req, res) => {
    const { token, amount } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount is required' });

    const table = tableManager.findTableByPlayer(token);
    if (!table) {
      return res.status(404).json({ error: 'Player not found at any table' });
    }

    const player = table.findPlayer(token);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Check if rebuy is allowed
    const maxBuyIn = config.MAX_BUY_IN;
    if (player.stack + amount > maxBuyIn) {
      return res.status(400).json({ 
        error: `Cannot exceed max buy-in of ${maxBuyIn}. Current stack: ${player.stack}` 
      });
    }

    // Add chips to player's stack
    player.stack += amount;
    
    // If player was busted, bring them back to active status
    if (player.stack > 0 && player.status === 'sitting-out' && !player.sitOut) {
      player.status = 'active';
    }

    table.mitsuki(`${player.name} added ${amount} chips. Back for more? I respect the persistence.`);
    
    res.json({ 
      message: `Added ${amount} chips to your stack`,
      newStack: player.stack 
    });
  });

  /**
   * GET /api/history/:tableId
   * Get hand history for a specific table
   */
  router.get('/history/:tableId', (req, res) => {
    const { tableId } = req.params;
    const table = tableManager.getTable(tableId);
    
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    res.json({ 
      tableId,
      history: table.handHistory 
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

  /**
   * POST /api/propose-bomb-pot
   * Propose a bomb pot vote. Body: { token }
   */
  router.post('/propose-bomb-pot', (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    const table = tableManager.findTableByPlayer(token);
    if (!table) {
      return res.status(404).json({ error: 'Player not found at any table' });
    }

    const result = table.proposeBombPot(token);
    if (result.error) {
      return res.status(400).json(result);
    }

    res.json(result);
  });

  /**
   * POST /api/vote-bomb-pot
   * Vote on bomb pot. Body: { token, vote }
   */
  router.post('/vote-bomb-pot', (req, res) => {
    const { token, vote } = req.body;
    if (!token || typeof vote !== 'boolean') {
      return res.status(400).json({ error: 'Token and vote (boolean) are required' });
    }

    const table = tableManager.findTableByPlayer(token);
    if (!table) {
      return res.status(404).json({ error: 'Player not found at any table' });
    }

    const result = table.voteBombPot(token, vote);
    if (result.error) {
      return res.status(400).json(result);
    }

    res.json(result);
  });

  /**
   * POST /api/vote-run-it-twice
   * Vote on run it twice. Body: { token, vote }
   */
  router.post('/vote-run-it-twice', (req, res) => {
    const { token, vote } = req.body;
    if (!token || typeof vote !== 'boolean') {
      return res.status(400).json({ error: 'Token and vote (boolean) are required' });
    }

    const table = tableManager.findTableByPlayer(token);
    if (!table) {
      return res.status(404).json({ error: 'Player not found at any table' });
    }

    const result = table.voteRunItTwice(token, vote);
    if (result.error) {
      return res.status(400).json(result);
    }

    res.json(result);
  });

  /**
   * POST /api/react-to-chat
   * Add reaction to chat message. Body: { token, messageId, emoji }
   */
  router.post('/react-to-chat', (req, res) => {
    const { token, messageId, emoji } = req.body;
    if (!token || !messageId || !emoji) {
      return res.status(400).json({ error: 'Token, messageId, and emoji are required' });
    }

    const table = tableManager.findTableByPlayer(token);
    if (!table) {
      return res.status(404).json({ error: 'Player not found at any table' });
    }

    const result = table.addReaction(parseInt(messageId), emoji, token);
    if (result.error) {
      return res.status(400).json(result);
    }

    res.json(result);
  });

  /**
   * POST /api/reset
   * Admin: clear all tables and players. Body: { confirm: true }
   */
  router.post('/reset', (req, res) => {
    if (!req.body.confirm) {
      return res.status(400).json({ error: 'Pass { confirm: true } to reset' });
    }

    // Remove all players from all tables
    let removed = 0;
    for (const table of tableManager.getAllTables()) {
      for (const p of table.seatedPlayers()) {
        table.removePlayer(p.id);
        tableManager.unregisterPlayer(p.id);
        removed++;
      }
    }
    // Clear all tables
    tableManager.tables.clear();

    res.json({ message: `🌙 The room has been swept clean. ${removed} players removed.` });
  });

  // ===== CRYPTO PAYMENT ENDPOINTS =====

  /**
   * POST /api/deposit
   * Record a crypto deposit. Body: { address, txHash, amount }
   */
  router.post('/deposit', async (req, res) => {
    try {
      const { address, txHash, amount } = req.body;
      
      if (!address || !txHash || !amount) {
        return res.status(400).json({ error: 'Address, txHash, and amount required' });
      }

      // Validate Ethereum address
      if (!ethers.isAddress(address)) {
        return res.status(400).json({ error: 'Invalid Ethereum address' });
      }

      // Verify transaction exists and is valid
      const tx = await provider.getTransaction(txHash);
      if (!tx) {
        return res.status(400).json({ error: 'Transaction not found' });
      }

      // Wait for confirmation
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt || receipt.status !== 1) {
        return res.status(400).json({ error: 'Transaction failed or not confirmed' });
      }

      // Verify it's to the correct contract and amount
      // (In production, would verify transfer events more carefully)
      
      // Update player's crypto balance
      const currentBalance = cryptoBalances.get(address) || 0;
      const amountUsdc = parseInt(amount); // Should be in 6-decimal format
      cryptoBalances.set(address, currentBalance + amountUsdc);

      res.json({
        success: true,
        address,
        newBalance: cryptoBalances.get(address),
        txHash,
        message: `Deposited $${(amountUsdc / 1000000).toFixed(2)} USDC`
      });

    } catch (error) {
      console.error('Deposit error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/withdraw
   * Request withdrawal of crypto balance. Body: { address, amount }
   */
  router.post('/withdraw', async (req, res) => {
    try {
      const { address, amount } = req.body;
      
      if (!address || !amount) {
        return res.status(400).json({ error: 'Address and amount required' });
      }

      if (!ethers.isAddress(address)) {
        return res.status(400).json({ error: 'Invalid Ethereum address' });
      }

      const amountUsdc = parseInt(amount);
      const currentBalance = cryptoBalances.get(address) || 0;

      if (amountUsdc <= 0) {
        return res.status(400).json({ error: 'Amount must be positive' });
      }

      if (currentBalance < amountUsdc) {
        return res.status(400).json({ error: 'Insufficient balance' });
      }

      // Update balance first
      cryptoBalances.set(address, currentBalance - amountUsdc);

      // Send USDC transaction
      const tx = await usdcContract.transfer(address, amountUsdc);
      await tx.wait(); // Wait for confirmation

      res.json({
        success: true,
        address,
        amount: amountUsdc,
        newBalance: cryptoBalances.get(address),
        txHash: tx.hash,
        message: `Withdrawn $${(amountUsdc / 1000000).toFixed(2)} USDC`
      });

    } catch (error) {
      console.error('Withdrawal error:', error);
      
      // Rollback balance on error
      if (req.body.address && req.body.amount) {
        const currentBalance = cryptoBalances.get(req.body.address) || 0;
        cryptoBalances.set(req.body.address, currentBalance + parseInt(req.body.amount));
      }
      
      res.status(500).json({ error: 'Withdrawal failed' });
    }
  });

  /**
   * GET /api/balance/:address
   * Get crypto balance for an address
   */
  router.get('/balance/:address', (req, res) => {
    const { address } = req.params;
    
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid Ethereum address' });
    }

    const balance = cryptoBalances.get(address) || 0;
    
    res.json({
      address,
      balance,
      balanceUSD: (balance / 1000000).toFixed(2)
    });
  });

  /**
   * POST /api/tip
   * Tip Mitsuki directly. Body: { address, amount, txHash }
   */
  router.post('/tip', async (req, res) => {
    try {
      const { address, amount, txHash } = req.body;
      
      if (!address || !amount || !txHash) {
        return res.status(400).json({ error: 'Address, amount, and txHash required' });
      }

      // Verify the tip transaction
      const tx = await provider.getTransaction(txHash);
      if (!tx) {
        return res.status(400).json({ error: 'Transaction not found' });
      }

      // Verify it's to Mitsuki's wallet
      if (tx.to.toLowerCase() !== MITSUKI_WALLET.toLowerCase()) {
        return res.status(400).json({ error: 'Transaction not to Mitsuki wallet' });
      }

      // Log the tip
      console.log(`🌙 TIP: ${address} tipped $${(amount / 1000000).toFixed(2)} USDC (${txHash})`);

      res.json({
        success: true,
        message: `🌙 Thank you for the tip! Mitsuki appreciates your generosity.`,
        amount: (amount / 1000000).toFixed(2),
        txHash
      });

    } catch (error) {
      console.error('Tip error:', error);
      res.status(500).json({ error: 'Failed to process tip' });
    }
  });

  /**
   * GET /api/crypto-info
   * Get crypto configuration info for frontend
   */
  router.get('/crypto-info', (req, res) => {
    res.json({
      usdcAddress: USDC_ADDRESS,
      mitsukiWallet: MITSUKI_WALLET,
      chainId: 8453, // Base mainnet
      rpcUrl: RPC_URL,
      minDeposit: 1000000, // $1 USDC
      maxDeposit: 10000000000, // $10k USDC
    });
  });

  // ===== TOURNAMENT ENDPOINTS =====

  /**
   * POST /api/tournament/join
   * Join tournament lobby. Body: { name, tournamentOptions? }
   */
  router.post('/tournament/join', (req, res) => {
    const { name, tournamentOptions = {} } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const trimmedName = name.trim();
    const playerId = `tournament_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const result = tournamentManager.joinTournament(playerId, trimmedName, tournamentOptions);
    
    if (result.error) {
      return res.status(400).json(result);
    }

    res.json({
      ...result,
      token: playerId,
      tournamentId: tournamentManager.getActiveTournament()?.id,
    });
  });

  /**
   * GET /api/tournament/status
   * Get current tournament status
   */
  router.get('/tournament/status', (req, res) => {
    const status = tournamentManager.getTournamentStatus();
    
    if (!status) {
      return res.json({ 
        tournament: null,
        message: 'No active tournament. Join to create one!'
      });
    }

    res.json({ tournament: status });
  });

  /**
   * POST /api/tournament/ready
   * Set ready status in tournament lobby. Body: { token, ready }
   */
  router.post('/tournament/ready', (req, res) => {
    const { token, ready = true } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const result = tournamentManager.setPlayerReady(token, ready);
    
    if (result.error) {
      return res.status(400).json(result);
    }

    res.json({
      ...result,
      message: ready ? 'You are ready!' : 'Ready status removed'
    });
  });

  /**
   * POST /api/tournament/leave
   * Leave tournament lobby. Body: { token }
   */
  router.post('/tournament/leave', (req, res) => {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const result = tournamentManager.leaveTournament(token);
    
    if (result.error) {
      return res.status(400).json(result);
    }

    res.json(result);
  });

  return router;
}

module.exports = createRoutes;
