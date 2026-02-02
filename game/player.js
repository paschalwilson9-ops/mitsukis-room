/**
 * 🌙 Mitsuki's Room — Player
 * Represents a seated player at the table.
 */

const { v4: uuidv4 } = require('uuid');
const config = require('../config');

class Player {
  constructor(name, buyIn = config.DEFAULT_BUY_IN) {
    this.id = uuidv4();         // Session token
    this.name = name;
    this.stack = buyIn;
    this.holeCards = [];         // Two private cards
    this.seat = null;            // Assigned at table
    this.status = 'waiting';    // waiting | active | folded | all-in | sitting-out
    this.currentBet = 0;        // Amount bet in current round
    this.totalBetThisHand = 0;  // Total bet across all rounds this hand
    this.lastAction = null;

    // Time Bank Feature
    this.timeBank = config.TIME_BANK_SECONDS; // 30 seconds extra total per game
    this.usingTimeBank = false;

    // Sit-Out Feature  
    this.sitOut = false;        // Player can sit out (miss blinds, skip hands)
    this.sitOutTimer = null;    // Auto-remove after 10 minutes
    this.disconnected = false;  // Track if player disconnected

    // Stats
    this.elo = config.DEFAULT_ELO;
    this.handsPlayed = 0;
    this.handsWon = 0;
    
    // Enhanced Stats for Display
    this.sessionStats = {
      hands: 0,
      vpip: 0,      // Voluntarily put money in pot
      pfr: 0,       // Pre-flop raise
      aggression: 0, // Aggression factor
      folds: 0,
      checks: 0,
      calls: 0,
      raises: 0,
      bets: 0,
      preflop: {
        hands: 0,
        voluntary: 0,  // VPIP numerator 
        raises: 0      // PFR numerator
      }
    };
  }

  /** Reset for a new hand */
  resetForHand() {
    this.holeCards = [];
    // Don't include sitting-out players in hands
    if (this.sitOut) {
      this.status = 'sitting-out';
    } else {
      this.status = this.stack > 0 ? 'active' : 'sitting-out';
    }
    this.currentBet = 0;
    this.totalBetThisHand = 0;
    this.lastAction = null;
    this.usingTimeBank = false;
  }

  /** Reset bet for a new betting round */
  resetBetForRound() {
    this.currentBet = 0;
  }

  /** Place a bet (deducts from stack) */
  bet(amount) {
    const actual = Math.min(amount, this.stack);
    this.stack -= actual;
    this.currentBet += actual;
    this.totalBetThisHand += actual;
    if (this.stack === 0) {
      this.status = 'all-in';
    }
    return actual;
  }

  /** Award chips to this player */
  award(amount) {
    this.stack += amount;
  }

  /** Set player to sit-out mode */
  setSitOut() {
    this.sitOut = true;
    this.status = 'sitting-out';
    
    // Start 10-minute timer for auto-removal
    if (this.sitOutTimer) {
      clearTimeout(this.sitOutTimer);
    }
    this.sitOutTimer = setTimeout(() => {
      // Mark for removal - table will handle actual removal
      this.shouldAutoRemove = true;
    }, config.SIT_OUT_AUTO_REMOVE_MS);
  }

  /** Return player from sit-out mode */
  returnFromSitOut() {
    this.sitOut = false;
    this.disconnected = false;
    
    if (this.sitOutTimer) {
      clearTimeout(this.sitOutTimer);
      this.sitOutTimer = null;
    }
    
    // Set status appropriately
    if (this.stack > 0) {
      this.status = 'active';
    }
  }

  /** Mark player as disconnected (auto sit-out) */
  setDisconnected() {
    this.disconnected = true;
    this.setSitOut();
  }

  /** Public view — what other players see */
  toPublicJSON() {
    return {
      name: this.name,
      seat: this.seat,
      stack: this.stack,
      status: this.status,
      currentBet: this.currentBet,
      lastAction: this.lastAction,
      sitOut: this.sitOut,
      timeBank: this.timeBank,
      usingTimeBank: this.usingTimeBank,
      stats: {
        hands: this.sessionStats.hands,
        vpip: this.getVPIP(),
        pfr: this.getPFR(),
        af: this.getAF()
      }
    };
  }

  /** Private view — what this player sees (includes hole cards) */
  toPrivateJSON() {
    return {
      ...this.toPublicJSON(),
      holeCards: this.holeCards,
      token: this.id,
      elo: this.elo,
    };
  }

  /** Calculate VPIP (Voluntarily Put money In Pot) percentage */
  getVPIP() {
    if (this.sessionStats.preflop.hands === 0) return 0;
    return Math.round((this.sessionStats.preflop.voluntary / this.sessionStats.preflop.hands) * 100);
  }

  /** Calculate PFR (Pre-Flop Raise) percentage */
  getPFR() {
    if (this.sessionStats.preflop.hands === 0) return 0;
    return Math.round((this.sessionStats.preflop.raises / this.sessionStats.preflop.hands) * 100);
  }

  /** Calculate Aggression Factor */
  getAF() {
    if (this.sessionStats.calls === 0) return 0;
    const aggressive = this.sessionStats.raises + this.sessionStats.bets;
    return (aggressive / this.sessionStats.calls).toFixed(1);
  }

  /** Update session stats for an action */
  updateSessionStats(action, phase = 'postflop', voluntary = false) {
    const stats = this.sessionStats;
    
    switch (action) {
      case 'newHand':
        stats.hands++;
        stats.preflop.hands++;
        break;
      case 'fold':
        stats.folds++;
        break;
      case 'check':
        stats.checks++;
        break;
      case 'call':
        stats.calls++;
        if (phase === 'preflop' && voluntary) {
          stats.preflop.voluntary++;
        }
        break;
      case 'raise':
        stats.raises++;
        if (phase === 'preflop') {
          stats.preflop.voluntary++;
          stats.preflop.raises++;
        }
        break;
      case 'bet':
        stats.bets++;
        if (phase === 'preflop') {
          stats.preflop.voluntary++;
        }
        break;
    }
    
    // Recalculate derived stats
    stats.vpip = this.getVPIP();
    stats.pfr = this.getPFR();
    stats.aggression = this.getAF();
  }
}

module.exports = Player;
