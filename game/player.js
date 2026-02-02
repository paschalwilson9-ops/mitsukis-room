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

    // Stats
    this.elo = config.DEFAULT_ELO;
    this.handsPlayed = 0;
    this.handsWon = 0;
  }

  /** Reset for a new hand */
  resetForHand() {
    this.holeCards = [];
    this.status = this.stack > 0 ? 'active' : 'sitting-out';
    this.currentBet = 0;
    this.totalBetThisHand = 0;
    this.lastAction = null;
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

  /** Public view — what other players see */
  toPublicJSON() {
    return {
      name: this.name,
      seat: this.seat,
      stack: this.stack,
      status: this.status,
      currentBet: this.currentBet,
      lastAction: this.lastAction,
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
}

module.exports = Player;
