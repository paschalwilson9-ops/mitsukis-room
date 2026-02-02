/**
 * 🌙 Mitsuki's Room — Hand Evaluator
 * Evaluates the best 5-card poker hand from 7 cards (2 hole + 5 community).
 * Returns a hand rank and score for comparison.
 *
 * Hand Rankings (lower rank = better):
 * 1: Royal Flush, 2: Straight Flush, 3: Four of a Kind, 4: Full House,
 * 5: Flush, 6: Straight, 7: Three of a Kind, 8: Two Pair, 9: One Pair, 10: High Card
 */

const { RANK_VALUES } = require('./deck');

const HAND_NAMES = {
  1: 'Royal Flush',
  2: 'Straight Flush',
  3: 'Four of a Kind',
  4: 'Full House',
  5: 'Flush',
  6: 'Straight',
  7: 'Three of a Kind',
  8: 'Two Pair',
  9: 'One Pair',
  10: 'High Card',
};

/**
 * Generate all 5-card combinations from an array of cards.
 */
function combinations(cards, k = 5) {
  const result = [];
  function combo(start, chosen) {
    if (chosen.length === k) {
      result.push([...chosen]);
      return;
    }
    for (let i = start; i < cards.length; i++) {
      chosen.push(cards[i]);
      combo(i + 1, chosen);
      chosen.pop();
    }
  }
  combo(0, []);
  return result;
}

/**
 * Evaluate a 5-card hand.
 * Returns { rank, score, name } where score is an array for tiebreaking.
 */
function evaluate5(cards) {
  const values = cards.map(c => RANK_VALUES[c.rank]).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);

  // Check flush
  const isFlush = suits.every(s => s === suits[0]);

  // Check straight
  let isStraight = false;
  let straightHigh = 0;

  // Normal straight check
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.length >= 5) {
    for (let i = 0; i <= unique.length - 5; i++) {
      if (unique[i] - unique[i + 4] === 4) {
        isStraight = true;
        straightHigh = unique[i];
        break;
      }
    }
    // Ace-low straight (A-2-3-4-5 = wheel)
    if (!isStraight && unique.includes(14) && unique.includes(2) && unique.includes(3) && unique.includes(4) && unique.includes(5)) {
      isStraight = true;
      straightHigh = 5; // 5-high straight
    }
  }

  // Count ranks
  const counts = {};
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1;
  }

  const pairs = [];
  let threeKind = 0;
  let fourKind = 0;

  for (const [val, count] of Object.entries(counts)) {
    const v = parseInt(val);
    if (count === 4) fourKind = v;
    else if (count === 3) threeKind = v;
    else if (count === 2) pairs.push(v);
  }
  pairs.sort((a, b) => b - a);

  // Kickers: values not part of the made hand, sorted descending
  function kickers(exclude) {
    return values.filter(v => !exclude.includes(v)).sort((a, b) => b - a);
  }

  // Royal Flush
  if (isFlush && isStraight && straightHigh === 14) {
    return { rank: 1, score: [1], name: HAND_NAMES[1] };
  }

  // Straight Flush
  if (isFlush && isStraight) {
    return { rank: 2, score: [2, straightHigh], name: HAND_NAMES[2] };
  }

  // Four of a Kind
  if (fourKind) {
    const k = kickers([fourKind]);
    return { rank: 3, score: [3, fourKind, ...k.slice(0, 1)], name: HAND_NAMES[3] };
  }

  // Full House
  if (threeKind && pairs.length >= 1) {
    return { rank: 4, score: [4, threeKind, pairs[0]], name: HAND_NAMES[4] };
  }

  // Flush
  if (isFlush) {
    return { rank: 5, score: [5, ...values.slice(0, 5)], name: HAND_NAMES[5] };
  }

  // Straight
  if (isStraight) {
    return { rank: 6, score: [6, straightHigh], name: HAND_NAMES[6] };
  }

  // Three of a Kind
  if (threeKind) {
    const k = kickers([threeKind]);
    return { rank: 7, score: [7, threeKind, ...k.slice(0, 2)], name: HAND_NAMES[7] };
  }

  // Two Pair
  if (pairs.length >= 2) {
    const k = kickers([pairs[0], pairs[1]]);
    return { rank: 8, score: [8, pairs[0], pairs[1], ...k.slice(0, 1)], name: HAND_NAMES[8] };
  }

  // One Pair
  if (pairs.length === 1) {
    const k = kickers([pairs[0]]);
    return { rank: 9, score: [9, pairs[0], ...k.slice(0, 3)], name: HAND_NAMES[9] };
  }

  // High Card
  return { rank: 10, score: [10, ...values.slice(0, 5)], name: HAND_NAMES[10] };
}

/**
 * Evaluate the best 5-card hand from 7 cards.
 * Returns { rank, score, name, bestCards }
 */
function evaluateHand(sevenCards) {
  const combos = combinations(sevenCards, 5);
  let best = null;

  for (const combo of combos) {
    const result = evaluate5(combo);
    if (!best || compareScores(result.score, best.score) > 0) {
      best = { ...result, bestCards: combo };
    }
  }

  return best;
}

/**
 * Compare two score arrays.
 * Returns positive if a is better, negative if b is better, 0 if tied.
 */
function compareScores(a, b) {
  // Lower rank number = better hand
  if (a[0] !== b[0]) return b[0] - a[0]; // Inverted because rank 1 > rank 10

  // Same rank — compare kickers
  for (let i = 1; i < Math.max(a.length, b.length); i++) {
    const va = a[i] || 0;
    const vb = b[i] || 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/**
 * Compare two evaluated hands.
 * Returns positive if a wins, negative if b wins, 0 if tie.
 */
function compareHands(handA, handB) {
  return compareScores(handA.score, handB.score);
}

/**
 * Find the winner(s) from an array of { player, hand } objects.
 * Returns array of winners (multiple = split pot).
 */
function determineWinners(playerHands) {
  if (playerHands.length === 0) return [];
  if (playerHands.length === 1) return [playerHands[0]];

  let best = [playerHands[0]];

  for (let i = 1; i < playerHands.length; i++) {
    const cmp = compareHands(playerHands[i].hand, best[0].hand);
    if (cmp > 0) {
      best = [playerHands[i]];
    } else if (cmp === 0) {
      best.push(playerHands[i]);
    }
  }

  return best;
}

module.exports = {
  evaluateHand,
  compareHands,
  determineWinners,
  HAND_NAMES,
};
