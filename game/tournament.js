/**
 * 🌙 Mitsuki's Room — Tournament
 * Tournament lobby and management system
 */

const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const TOURNAMENT_STATES = {
  LOBBY: 'lobby',          // Waiting for players
  COUNTDOWN: 'countdown',   // Countdown active
  STARTING: 'starting',    // Transitioning to game
  RUNNING: 'running',      // Tournament in progress
  FINISHED: 'finished'     // Tournament ended
};

class Tournament {
  constructor(options = {}) {
    this.id = uuidv4();
    this.name = options.name || "The Second Mitsuki Invitational";
    this.prizePool = options.prizePool || "$1 USDC";
    this.maxPlayers = options.maxPlayers || 8;
    this.minPlayers = options.minPlayers || 4;
    this.buyIn = config.DEFAULT_BUY_IN; // Fixed at 200 chips
    this.countdownSeconds = options.countdownSeconds || 60;
    
    this.state = TOURNAMENT_STATES.LOBBY;
    this.players = new Map(); // playerId -> { name, joinTime, ready }
    this.readyPlayers = new Set(); // Players who clicked ready
    this.eliminatedPlayers = []; // { name, place, eliminationTime }
    
    this.countdownTimer = null;
    this.remainingTime = 0;
    this.table = null; // Will be set when tournament starts
    
    // Callbacks set by TournamentManager
    this.onStateChange = () => {};
    this.onPlayerJoin = () => {};
    this.onCountdownStart = () => {};
    this.onTournamentStart = () => {};
    this.onPlayerEliminated = () => {};
    this.onTournamentEnd = () => {};
  }

  // ─── Player Management ───────────────────────────────────────

  joinLobby(playerId, playerName) {
    if (this.state !== TOURNAMENT_STATES.LOBBY && this.state !== TOURNAMENT_STATES.COUNTDOWN) {
      return { error: 'Tournament is not accepting new players' };
    }

    if (this.players.size >= this.maxPlayers) {
      return { error: 'Tournament is full' };
    }

    if (this.players.has(playerId)) {
      return { error: 'You are already in this tournament' };
    }

    // Check for duplicate names
    const existingNames = [...this.players.values()].map(p => p.name.toLowerCase());
    if (existingNames.includes(playerName.toLowerCase())) {
      return { error: 'That name is already taken in this tournament' };
    }

    this.players.set(playerId, {
      name: playerName,
      joinTime: Date.now(),
      ready: false
    });

    this.onPlayerJoin(playerId, playerName);

    // Check if we should start countdown
    if (this.players.size >= this.minPlayers && this.state === TOURNAMENT_STATES.LOBBY) {
      this.startCountdown();
    }

    return { 
      success: true, 
      message: `Welcome to ${this.name}! ${this.players.size}/${this.maxPlayers} players joined.`
    };
  }

  setPlayerReady(playerId, ready = true) {
    const player = this.players.get(playerId);
    if (!player) {
      return { error: 'You are not in this tournament' };
    }

    player.ready = ready;
    if (ready) {
      this.readyPlayers.add(playerId);
    } else {
      this.readyPlayers.delete(playerId);
    }

    return { success: true };
  }

  // ─── Countdown Management ────────────────────────────────────

  startCountdown() {
    if (this.state !== TOURNAMENT_STATES.LOBBY) return;
    
    this.state = TOURNAMENT_STATES.COUNTDOWN;
    this.remainingTime = this.countdownSeconds;
    this.onCountdownStart();

    this.countdownTimer = setInterval(() => {
      this.remainingTime--;
      
      if (this.remainingTime <= 0) {
        this.startTournament();
      }
    }, 1000);
  }

  stopCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    
    if (this.state === TOURNAMENT_STATES.COUNTDOWN) {
      this.state = TOURNAMENT_STATES.LOBBY;
      this.remainingTime = 0;
    }
  }

  // ─── Tournament Flow ──────────────────────────────────────────

  startTournament() {
    this.stopCountdown();
    this.state = TOURNAMENT_STATES.STARTING;
    
    // Clear any players who aren't actually participating
    const finalPlayers = [...this.players.entries()];
    
    setTimeout(() => {
      this.state = TOURNAMENT_STATES.RUNNING;
      this.onTournamentStart(finalPlayers);
    }, 2000); // 2 second delay for dramatic effect
  }

  eliminatePlayer(playerId, place) {
    const player = this.players.get(playerId);
    if (!player) return;

    this.eliminatedPlayers.push({
      name: player.name,
      place: place,
      eliminationTime: Date.now()
    });

    this.onPlayerEliminated(playerId, player.name, place);

    // Check if tournament is over (only 1 player left)
    const remainingPlayers = [...this.players.values()].filter(p => 
      !this.eliminatedPlayers.some(e => e.name === p.name)
    );

    if (remainingPlayers.length <= 1) {
      this.endTournament(remainingPlayers[0]);
    }
  }

  endTournament(winner) {
    this.state = TOURNAMENT_STATES.FINISHED;
    this.onTournamentEnd(winner, this.eliminatedPlayers);
  }

  // ─── Public State ──────────────────────────────────────────────

  getPublicState() {
    const playerList = [...this.players.entries()].map(([id, player]) => ({
      id, // Include ID for ready status tracking
      name: player.name,
      joinTime: player.joinTime,
      ready: player.ready
    }));

    return {
      id: this.id,
      name: this.name,
      prizePool: this.prizePool,
      state: this.state,
      playerCount: this.players.size,
      maxPlayers: this.maxPlayers,
      minPlayers: this.minPlayers,
      buyIn: this.buyIn,
      players: playerList,
      readyCount: this.readyPlayers.size,
      countdownTime: this.remainingTime,
      eliminatedPlayers: this.eliminatedPlayers,
      canJoin: this.state === TOURNAMENT_STATES.LOBBY || 
               (this.state === TOURNAMENT_STATES.COUNTDOWN && this.players.size < this.maxPlayers)
    };
  }

  // ─── Cleanup ───────────────────────────────────────────────────

  destroy() {
    this.stopCountdown();
    this.players.clear();
    this.readyPlayers.clear();
    this.eliminatedPlayers = [];
  }
}

module.exports = { Tournament, TOURNAMENT_STATES };