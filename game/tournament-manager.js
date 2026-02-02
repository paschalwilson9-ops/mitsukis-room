/**
 * 🌙 Mitsuki's Room — Tournament Manager
 * Manages tournament lifecycle and integration with table system
 */

const { Tournament, TOURNAMENT_STATES } = require('./tournament');
const config = require('../config');

class TournamentManager {
  constructor(tableManager) {
    this.tableManager = tableManager;
    this.activeTournament = null;
    this.playerTournamentMap = new Map(); // playerId -> tournamentId
  }

  // ─── Tournament Lifecycle ─────────────────────────────────────

  createTournament(options = {}) {
    // Only allow one active tournament for now
    if (this.activeTournament && 
        this.activeTournament.state !== TOURNAMENT_STATES.FINISHED) {
      return { error: 'A tournament is already active' };
    }

    const tournament = new Tournament(options);
    this.activeTournament = tournament;

    // Wire up event handlers
    tournament.onStateChange = () => this.broadcastTournamentUpdate();
    tournament.onPlayerJoin = (playerId, playerName) => {
      this.playerTournamentMap.set(playerId, tournament.id);
      this.broadcastTournamentUpdate();
    };
    tournament.onCountdownStart = () => {
      this.broadcastTournamentUpdate();
      this.broadcastMessage({
        type: 'tournament_countdown_start',
        message: `🌙 Tournament starting in ${tournament.countdownSeconds} seconds! More players can still join.`,
        countdown: tournament.countdownSeconds
      });
    };
    tournament.onTournamentStart = (players) => {
      this.startTournamentTable(players);
    };
    tournament.onPlayerEliminated = (playerId, playerName, place) => {
      this.broadcastMessage({
        type: 'tournament_elimination',
        message: `🌙 ${playerName} has been eliminated in ${place} place!`,
        player: playerName,
        place
      });
    };
    tournament.onTournamentEnd = (winner, eliminatedPlayers) => {
      this.broadcastMessage({
        type: 'tournament_end',
        message: `🌙 Tournament complete! ${winner ? winner.name + ' wins the ' + tournament.prizePool : 'No winner'}!`,
        winner: winner ? winner.name : null,
        prizePool: tournament.prizePool,
        results: eliminatedPlayers
      });
    };

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

    return this.activeTournament.joinLobby(playerId, playerName);
  }

  setPlayerReady(playerId, ready = true) {
    if (!this.activeTournament) {
      return { error: 'No active tournament' };
    }

    return this.activeTournament.setPlayerReady(playerId, ready);
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
  }
}

module.exports = TournamentManager;