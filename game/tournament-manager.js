/**
 * 🌙 Mitsuki's Room — Tournament Manager
 * Manages tournament lifecycle and integration with table system
 * Now with file-based persistence to survive deploys/restarts
 */

const fs = require('fs');
const path = require('path');
const { Tournament, TOURNAMENT_STATES } = require('./tournament');
const config = require('../config');

const STATE_FILE = path.join(__dirname, '..', '.tournament-state.json');

class TournamentManager {
  constructor(tableManager) {
    this.tableManager = tableManager;
    this.activeTournament = null;
    this.playerTournamentMap = new Map(); // playerId -> tournamentId

    // Restore tournament state from disk on startup
    this._restoreState();
  }

  // ─── Persistence ──────────────────────────────────────────────

  _saveState() {
    if (!this.activeTournament || this.activeTournament.state === TOURNAMENT_STATES.FINISHED) {
      // Clean up state file if no active tournament
      try { fs.unlinkSync(STATE_FILE); } catch (e) {}
      return;
    }

    try {
      const state = {
        id: this.activeTournament.id,
        name: this.activeTournament.name,
        prizePool: this.activeTournament.prizePool,
        maxPlayers: this.activeTournament.maxPlayers,
        minPlayers: this.activeTournament.minPlayers,
        buyIn: this.activeTournament.buyIn,
        countdownSeconds: this.activeTournament.countdownSeconds,
        state: this.activeTournament.state,
        players: Array.from(this.activeTournament.players.entries()).map(([id, data]) => ({
          id,
          name: data.name,
          joinTime: data.joinTime,
          ready: data.ready || false
        })),
        readyPlayers: Array.from(this.activeTournament.readyPlayers),
        eliminatedPlayers: this.activeTournament.eliminatedPlayers,
        savedAt: Date.now()
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('Failed to save tournament state:', err.message);
    }
  }

  _restoreState() {
    try {
      if (!fs.existsSync(STATE_FILE)) return;

      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const state = JSON.parse(raw);

      // Only restore lobby/countdown states (not running games — those need table state too)
      if (state.state !== TOURNAMENT_STATES.LOBBY && state.state !== TOURNAMENT_STATES.COUNTDOWN) {
        console.log(`Tournament state "${state.state}" cannot be restored after restart — skipping`);
        fs.unlinkSync(STATE_FILE);
        return;
      }

      // Check if state is stale (> 24 hours old)
      if (Date.now() - state.savedAt > 24 * 60 * 60 * 1000) {
        console.log('Tournament state is stale (>24h) — discarding');
        fs.unlinkSync(STATE_FILE);
        return;
      }

      console.log(`Restoring tournament "${state.name}" with ${state.players.length} players...`);

      // Create tournament with saved options
      const tournament = new Tournament({
        name: state.name,
        prizePool: state.prizePool,
        maxPlayers: state.maxPlayers,
        minPlayers: state.minPlayers,
        countdownSeconds: state.countdownSeconds
      });

      // Override the auto-generated ID with the saved one
      tournament.id = state.id;

      // Restore players
      for (const player of state.players) {
        tournament.players.set(player.id, {
          name: player.name,
          joinTime: player.joinTime,
          ready: player.ready
        });
        if (player.ready) {
          tournament.readyPlayers.add(player.id);
        }
        this.playerTournamentMap.set(player.id, tournament.id);
      }

      // Restore eliminated players
      tournament.eliminatedPlayers = state.eliminatedPlayers || [];

      this.activeTournament = tournament;
      this._wireUpHandlers(tournament);

      console.log(`Tournament restored: ${state.players.length} players, state: ${state.state}`);
    } catch (err) {
      console.error('Failed to restore tournament state:', err.message);
      try { fs.unlinkSync(STATE_FILE); } catch (e) {}
    }
  }

  // ─── Tournament Lifecycle ─────────────────────────────────────

  _wireUpHandlers(tournament) {
    tournament.onStateChange = () => {
      this.broadcastTournamentUpdate();
      this._saveState();
    };
    tournament.onPlayerJoin = (playerId, playerName) => {
      this.playerTournamentMap.set(playerId, tournament.id);
      this.broadcastTournamentUpdate();
      this._saveState();
    };
    tournament.onCountdownStart = () => {
      this.broadcastTournamentUpdate();
      this._saveState();
      this.broadcastMessage({
        type: 'tournament_countdown_start',
        message: `🌙 Tournament starting in ${tournament.countdownSeconds} seconds! More players can still join.`,
        countdown: tournament.countdownSeconds
      });
    };
    tournament.onTournamentStart = (players) => {
      this.startTournamentTable(players);
      this._saveState();
    };
    tournament.onPlayerEliminated = (playerId, playerName, place) => {
      this._saveState();
      this.broadcastMessage({
        type: 'tournament_elimination',
        message: `🌙 ${playerName} has been eliminated in ${place} place!`,
        player: playerName,
        place
      });
    };
    tournament.onTournamentEnd = (winner, eliminatedPlayers) => {
      this._saveState(); // Will clean up the file since state = FINISHED
      this.broadcastMessage({
        type: 'tournament_end',
        message: `🌙 Tournament complete! ${winner ? winner.name + ' wins the ' + tournament.prizePool : 'No winner'}!`,
        winner: winner ? winner.name : null,
        prizePool: tournament.prizePool,
        results: eliminatedPlayers
      });
    };
  }

  createTournament(options = {}) {
    // Only allow one active tournament for now
    if (this.activeTournament && 
        this.activeTournament.state !== TOURNAMENT_STATES.FINISHED) {
      return { error: 'A tournament is already active' };
    }

    const tournament = new Tournament(options);
    this.activeTournament = tournament;
    this._wireUpHandlers(tournament);
    this._saveState();

    return { success: true, tournament };
  }

  startTournamentTable(players) {
    if (!this.activeTournament) return;

    // Create a tournament table
    const table = this.tableManager.createTable({ 
      type: 'tournament',
      minBuyIn: config.DEFAULT_BUY_IN,
      maxBuyIn: config.DEFAULT_BUY_IN,
      isRebuyAllowed: false // No rebuys in tournament
    });

    // Set tournament reference
    this.activeTournament.table = table;
    table.tournament = this.activeTournament;

    // Seat all players
    for (const [playerId, playerData] of players) {
      const Player = require('./player');
      const player = new Player(playerData.name, config.DEFAULT_BUY_IN);
      player.id = playerId; // Use tournament player ID
      
      const seat = table.seatPlayer(player);
      if (seat !== null) {
        this.tableManager.registerPlayer(playerId, table.id);
      }
    }

    // Override table's player elimination to notify tournament
    const originalRemovePlayer = table.removePlayer.bind(table);
    table.removePlayer = (playerId) => {
      const player = table.findPlayer(playerId);
      if (player && this.activeTournament) {
        // Calculate elimination place
        const remainingPlayers = table.seatedPlayers().filter(p => p.id !== playerId);
        const place = this.getOrdinalPlace(remainingPlayers.length + 1);
        this.activeTournament.eliminatePlayer(playerId, place);
      }
      return originalRemovePlayer(playerId);
    };

    this.broadcastMessage({
      type: 'tournament_table_ready',
      message: '🌙 Tournament table is ready! The competition begins now.',
      tableId: table.id,
      playerCount: players.length
    });

    // Start the first hand after a brief delay
    setTimeout(() => {
      if (table.seatedPlayers().length >= 2) {
        table.startNewHand();
      }
    }, 3000);
  }

  getOrdinalPlace(num) {
    const ordinals = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
    return ordinals[num] || `${num}th`;
  }

  // ─── Player Management ────────────────────────────────────────

  joinTournament(playerId, playerName, tournamentOptions = {}) {
    // Create tournament if none exists
    if (!this.activeTournament || this.activeTournament.state === TOURNAMENT_STATES.FINISHED) {
      const result = this.createTournament(tournamentOptions);
      if (result.error) return result;
    }

    const result = this.activeTournament.joinLobby(playerId, playerName);
    if (!result.error) this._saveState();
    return result;
  }

  setPlayerReady(playerId, ready = true) {
    if (!this.activeTournament) {
      return { error: 'No active tournament' };
    }

    const result = this.activeTournament.setPlayerReady(playerId, ready);
    if (!result.error) this._saveState();
    return result;
  }

  leaveTournament(playerId) {
    if (!this.activeTournament) {
      return { error: 'No active tournament' };
    }

    const player = this.activeTournament.players.get(playerId);
    if (!player) {
      return { error: 'You are not in this tournament' };
    }

    // Remove from tournament
    this.activeTournament.players.delete(playerId);
    this.activeTournament.readyPlayers.delete(playerId);
    this.playerTournamentMap.delete(playerId);

    // If tournament is in countdown and we drop below minimum, stop countdown
    if (this.activeTournament.state === TOURNAMENT_STATES.COUNTDOWN && 
        this.activeTournament.players.size < this.activeTournament.minPlayers) {
      this.activeTournament.stopCountdown();
    }

    this.broadcastTournamentUpdate();
    this._saveState();
    return { success: true, message: `${player.name} left the tournament lobby` };
  }

  // ─── State Management ─────────────────────────────────────────

  getActiveTournament() {
    return this.activeTournament;
  }

  getTournamentStatus() {
    if (!this.activeTournament) {
      return null;
    }

    return this.activeTournament.getPublicState();
  }

  // ─── Broadcasting ─────────────────────────────────────────────

  broadcastTournamentUpdate() {
    if (!this.activeTournament) return;

    const status = this.getTournamentStatus();
    this.broadcastMessage({
      type: 'tournament_update',
      tournament: status
    });
  }

  broadcastMessage(message) {
    // Broadcast to all tournament players
    if (this.activeTournament) {
      for (const playerId of this.activeTournament.players.keys()) {
        const clients = this.tableManager.wsClients?.get(playerId);
        if (clients) {
          const data = JSON.stringify(message);
          for (const ws of clients) {
            if (ws.readyState === 1) ws.send(data);
          }
        }
      }
    }
  }

  // ─── Cleanup ───────────────────────────────────────────────────

  cleanup() {
    if (this.activeTournament) {
      this.activeTournament.destroy();
      this.activeTournament = null;
    }
    this.playerTournamentMap.clear();
    this._saveState(); // Clean up state file
  }
}

module.exports = TournamentManager;
