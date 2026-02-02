/**
 * 🌙 Mitsuki's Room — Deck
 * A standard 52-card deck with shuffle and deal.
 */

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

// Numeric rank values for evaluation
const RANK_VALUES = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

class Deck {
  constructor() {
    this.cards = [];
    this.reset();
  }

  /** Build a fresh 52-card deck */
  reset() {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push({ rank, suit });
      }
    }
    return this;
  }

  /** Fisher-Yates shuffle — the only honest way */
  shuffle() {
    const a = this.cards;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return this;
  }

  /** Deal n cards off the top */
  deal(n = 1) {
    if (this.cards.length < n) {
      throw new Error('🌙 Not enough cards in the deck. Something went wrong.');
    }
    return this.cards.splice(0, n);
  }

  /** Burn one card (discard face-down) */
  burn() {
    return this.cards.splice(0, 1);
  }

  get remaining() {
    return this.cards.length;
  }
}

/** Pretty-print a card */
function cardToString(card) {
  return `${card.rank}${card.suit}`;
}

/** Pretty-print an array of cards */
function cardsToString(cards) {
  return cards.map(cardToString).join(' ');
}

module.exports = { Deck, SUITS, RANKS, RANK_VALUES, cardToString, cardsToString };
