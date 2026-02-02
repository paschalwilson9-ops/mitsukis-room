/**
 * 🌙 Mitsuki's Room — Table
 * The heart of the game. Manages seats, rounds, pots, and the flow of play.
 */

const { v4: uuidv4 } = require('uuid');
const { Deck, cardsToString, cardToString } = require('./deck');
const { evaluateHand, determineWinners } = require('./hand-eval');
const config = require('../config');

const PHASES = ['waiting', 'preflop', 'flop', 'turn', 'river', 'showdown'];

class Table {
  constructor(id = uuidv4()) {
    this.id = id;
    this.seats = new Array(config.MAX_PLAYERS).fill(null);
    this.deck = new Deck();
    this.communityCards = [];
    this.pot = 0;
    this.pots = [];              // Array of { amount, eligible: [seatIndexes], name: 'Main Pot' }
    this.phase = 'waiting';
    this.dealerSeat = -1;        // Button position
    this.currentPlayerIndex = -1;// Index into activePlayers
    this.minRaise = config.BIG_BLIND;
    this.currentBetLevel = 0;    // Highest bet in current round
    this.handNumber = 0;
    this.handHistory = [];
    this.turnTimer = null;
    this.currentHandLog = [];

    // Broadcast function (set by server)
    this.broadcast = () => {};

    this.mitsuki('🌙 A new table has been prepared. The moon is watching.');
  }

  // ─── Mitsuki speaks ───────────────────────────────────────────

  mitsuki(msg) {
    const entry = { ts: Date.now(), msg };
    this.currentHandLog.push(entry);
    console.log(`[Table ${this.id.slice(0, 6)}] ${msg}`);
    this.broadcast({ type: 'mitsuki', message: msg });
  }

  // ─── Seating ──────────────────────────────────────────────────

  /** Seat a player at the table. Returns seat number or null. */
  seatPlayer(player) {
    const emptyIndex = this.seats.findIndex(s => s === null);
    if (emptyIndex === -1) return null; // Table full

    player.seat = emptyIndex;
    this.seats[emptyIndex] = player;

    this.mitsuki(`${player.name} takes seat ${emptyIndex}. Welcome to the room.`);
    this.broadcast({ type: 'player_joined', player: player.toPublicJSON() });

    // Auto-start if enough players and in waiting state
    if (this.phase === 'waiting' && this.seatedPlayers().length >= config.MIN_PLAYERS) {
      setTimeout(() => this.startHand(), config.HAND_START_DELAY_MS);
    }

    return emptyIndex;
  }

  /** Remove a player from the table */
  removePlayer(playerId) {
    const idx = this.seats.findIndex(p => p && p.id === playerId);
    if (idx === -1) return false;

    const player = this.seats[idx];
    this.seats[idx] = null;

    this.mitsuki(`${player.name} leaves the table. The room remembers.`);
    this.broadcast({ type: 'player_left', name: player.name, seat: idx });

    // If player was in current hand and it's their turn, auto-fold
    if (this.phase !== 'waiting' && this.phase !== 'showdown') {
      if (player.status === 'active') {
        player.status = 'folded';
        this.checkHandProgress();
      }
    }

    return true;
  }

  /** Get all seated players */
  seatedPlayers() {
    return this.seats.filter(p => p !== null);
  }

  /** Get players active in current hand */
  activePlayers() {
    return this.seats.filter(p => p && (p.status === 'active' || p.status === 'all-in'));
  }

  /** Get players who can still act (not folded, not all-in) */
  actingPlayers() {
    return this.seats.filter(p => p && p.status === 'active');
  }

  /** Find player by token */
  findPlayer(token) {
    return this.seats.find(p => p && p.id === token) || null;
  }

  // ─── Hand Management ──────────────────────────────────────────

  /** Start a new hand */
  startHand() {
    const eligible = this.seatedPlayers().filter(p => p.stack > 0);
    if (eligible.length < config.MIN_PLAYERS) {
      this.phase = 'waiting';
      this.mitsuki('🌙 Not enough players with chips. Mitsuki waits...');
      return;
    }

    this.handNumber++;
    this.currentHandLog = [];
    this.communityCards = [];
    this.pot = 0;
    this.pots = [];
    this.currentBetLevel = 0;
    this.minRaise = config.BIG_BLIND;

    // Reset players
    for (const p of this.seatedPlayers()) {
      p.resetForHand();
    }

    // Move dealer button
    this.advanceDealer();

    // Shuffle and deal
    this.deck.reset().shuffle();
    this.mitsuki(`🌙 Hand #${this.handNumber} — Mitsuki shuffles the deck...`);

    // Post blinds
    this.postBlinds();

    // Deal hole cards
    this.dealHoleCards();

    // Start preflop betting
    this.phase = 'preflop';
    this.startBettingRound();
  }

  /** Advance dealer button to next eligible seat */
  advanceDealer() {
    const players = this.seatedPlayers().filter(p => p.stack > 0);
    if (this.dealerSeat === -1) {
      this.dealerSeat = players[0].seat;
    } else {
      // Find next occupied seat after current dealer
      let found = false;
      for (let i = 1; i <= config.MAX_PLAYERS; i++) {
        const idx = (this.dealerSeat + i) % config.MAX_PLAYERS;
        const p = this.seats[idx];
        if (p && p.stack > 0) {
          this.dealerSeat = idx;
          found = true;
          break;
        }
      }
    }
  }

  /** Post small and big blinds */
  postBlinds() {
    const players = this.seatedPlayers().filter(p => p.status === 'active');
    if (players.length < 2) return;

    // Find SB and BB positions relative to dealer
    const orderedFromDealer = this.getPlayersFromSeat(this.dealerSeat, true);

    let sbPlayer, bbPlayer;
    if (orderedFromDealer.length === 2) {
      // Heads-up: dealer is SB
      sbPlayer = orderedFromDealer[0];
      bbPlayer = orderedFromDealer[1];
    } else {
      sbPlayer = orderedFromDealer[1];
      bbPlayer = orderedFromDealer[2];
    }

    const sbAmount = sbPlayer.bet(config.SMALL_BLIND);
    this.pot += sbAmount;
    sbPlayer.lastAction = 'small blind';
    this.mitsuki(`${sbPlayer.name} posts small blind (${sbAmount})`);

    const bbAmount = bbPlayer.bet(config.BIG_BLIND);
    this.pot += bbAmount;
    bbPlayer.lastAction = 'big blind';
    this.currentBetLevel = config.BIG_BLIND;
    this.mitsuki(`${bbPlayer.name} posts big blind (${bbAmount})`);

    this.broadcast({
      type: 'blinds_posted',
      smallBlind: { name: sbPlayer.name, amount: sbAmount },
      bigBlind: { name: bbPlayer.name, amount: bbAmount },
      pot: this.pot,
    });
  }

  /** Deal 2 hole cards to each active player */
  dealHoleCards() {
    this.mitsuki('🌙 Mitsuki deals the cards...');
    for (const p of this.activePlayers()) {
      p.holeCards = this.deck.deal(2);
    }
    this.broadcast({ type: 'cards_dealt' });
  }

  /** Get players ordered from a seat (inclusive or exclusive) */
  getPlayersFromSeat(seatIndex, inclusive = false) {
    const result = [];
    const start = inclusive ? 0 : 1;
    for (let i = start; i < config.MAX_PLAYERS; i++) {
      const idx = (seatIndex + i) % config.MAX_PLAYERS;
      const p = this.seats[idx];
      if (p && p.status !== 'sitting-out') {
        result.push(p);
      }
    }
    return result;
  }

  // ─── Betting Rounds ───────────────────────────────────────────

  /** Start a betting round */
  startBettingRound() {
    // Reset per-round bets
    for (const p of this.seatedPlayers()) {
      p.resetBetForRound();
    }
    this.currentBetLevel = 0;

    // Preflop: blinds already posted, so set currentBetLevel
    if (this.phase === 'preflop') {
      // Re-set since we just reset
      // Reconstruct blind bets from totalBetThisHand
      for (const p of this.activePlayers()) {
        p.currentBet = p.totalBetThisHand; // Blinds carry over for preflop
      }
      this.currentBetLevel = config.BIG_BLIND;
      this.minRaise = config.BIG_BLIND;
    }

    // Find first player to act
    this.setFirstToAct();

    if (this.actingPlayers().length <= 1) {
      this.advancePhase();
      return;
    }

    this.promptCurrentPlayer();
  }

  /** Set first player to act in this round */
  setFirstToAct() {
    const acting = this.actingPlayers();
    if (acting.length === 0) {
      this.currentPlayerIndex = -1;
      return;
    }

    if (this.phase === 'preflop') {
      // First to act is after BB
      const orderedFromDealer = this.getPlayersFromSeat(this.dealerSeat, true);
      const activeSeatOrder = orderedFromDealer.filter(p => p.status === 'active');

      if (activeSeatOrder.length <= 2) {
        // Heads-up: SB/dealer acts first preflop
        this.currentPlayerIndex = this.seats.indexOf(activeSeatOrder[0]);
      } else {
        // UTG: player after BB (3rd from dealer)
        this.currentPlayerIndex = this.seats.indexOf(activeSeatOrder.length > 2 ? activeSeatOrder[2] : activeSeatOrder[0]);

        // Actually find the first active player after BB
        const bbPos = activeSeatOrder[1]; // BB is 2nd from dealer in 3+ players
        const afterBB = this.getPlayersFromSeat(bbPos.seat, false)
          .filter(p => p.status === 'active');
        if (afterBB.length > 0) {
          this.currentPlayerIndex = this.seats.indexOf(afterBB[0]);
        }
      }
    } else {
      // Post-flop: first active player after dealer
      const afterDealer = this.getPlayersFromSeat(this.dealerSeat, false)
        .filter(p => p.status === 'active');
      if (afterDealer.length > 0) {
        this.currentPlayerIndex = this.seats.indexOf(afterDealer[0]);
      }
    }
  }

  /** Get the current player whose turn it is */
  getCurrentPlayer() {
    if (this.currentPlayerIndex < 0 || this.currentPlayerIndex >= this.seats.length) return null;
    return this.seats[this.currentPlayerIndex];
  }

  /** Prompt the current player to act */
  promptCurrentPlayer() {
    this.clearTurnTimer();
    const player = this.getCurrentPlayer();
    if (!player || player.status !== 'active') {
      this.advanceToNextPlayer();
      return;
    }

    this.broadcast({
      type: 'action_on',
      player: player.name,
      seat: player.seat,
      pot: this.pot,
      currentBet: this.currentBetLevel,
      playerBet: player.currentBet,
      toCall: this.currentBetLevel - player.currentBet,
      minRaise: this.minRaise,
    });

    // Start turn timer
    this.turnTimer = setTimeout(() => {
      this.mitsuki(`⏰ ${player.name} ran out of time. Auto-fold.`);
      this.handleAction(player.id, 'fold');
    }, config.TURN_TIMER_MS);
  }

  clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  /** Handle a player action */
  handleAction(token, action, amount = 0) {
    const player = this.findPlayer(token);
    if (!player) return { error: 'Player not found' };
    if (this.phase === 'waiting' || this.phase === 'showdown') {
      return { error: 'No active hand' };
    }

    const current = this.getCurrentPlayer();
    if (!current || current.id !== token) {
      return { error: 'Not your turn' };
    }

    this.clearTurnTimer();

    const toCall = this.currentBetLevel - player.currentBet;

    switch (action) {
      case 'fold':
        player.status = 'folded';
        player.lastAction = 'fold';
        this.mitsuki(`${player.name} folds.`);
        break;

      case 'check':
        if (toCall > 0) return { error: 'Cannot check — there is a bet to you' };
        player.lastAction = 'check';
        this.mitsuki(`${player.name} checks.`);
        break;

      case 'call': {
        const callAmount = player.bet(toCall);
        this.pot += callAmount;
        player.lastAction = 'call';
        
        if (player.status === 'all-in') {
          this.mitsuki(`${player.name} calls ${callAmount} and is all-in!`);
          // Recalculate pots when someone goes all-in
          this.calculatePots();
        } else {
          this.mitsuki(`${player.name} calls ${callAmount}.`);
        }
        break;
      }

      case 'raise': {
        const raiseTotal = amount; // Total bet amount (not raise increment)
        const originalStack = player.stack + player.currentBet;
        
        // Check if this is a valid raise amount
        if (raiseTotal < this.currentBetLevel + this.minRaise && raiseTotal < originalStack) {
          return { error: `Minimum raise is to ${this.currentBetLevel + this.minRaise}` };
        }
        
        const raiseAmount = raiseTotal - player.currentBet;
        const actualBet = player.bet(raiseAmount);
        this.pot += actualBet;

        const oldBetLevel = this.currentBetLevel;
        this.currentBetLevel = player.currentBet;
        
        // Determine if this was an all-in
        const isAllIn = player.status === 'all-in';
        
        if (isAllIn) {
          // Check if the all-in constitutes a full raise
          const raiseIncrement = player.currentBet - oldBetLevel;
          const isFullRaise = raiseIncrement >= this.minRaise;
          
          if (isFullRaise) {
            // Full raise - reopens action to all players
            this.minRaise = raiseIncrement;
            this._lastRaiserSeat = player.seat;
            player.lastAction = 'raise';
            this.mitsuki(`${player.name} raises to ${player.currentBet} — ALL IN! Bold move.`);
          } else {
            // Incomplete raise - doesn't reopen action
            player.lastAction = 'call';
            this.mitsuki(`${player.name} calls ${actualBet} — ALL IN!`);
          }
          
          // Recalculate pots when someone goes all-in
          this.calculatePots();
        } else {
          // Normal raise
          const raiseIncrement = player.currentBet - oldBetLevel;
          this.minRaise = raiseIncrement;
          this._lastRaiserSeat = player.seat;
          player.lastAction = 'raise';
          this.mitsuki(`${player.name} raises to ${player.currentBet}.`);
        }

        break;
      }

      default:
        return { error: `Unknown action: ${action}` };
    }

    this.broadcast({
      type: 'player_action',
      player: player.name,
      action: player.lastAction,
      amount: player.currentBet,
      pot: this.pot,
    });

    this.checkHandProgress();
    return { success: true, action: player.lastAction };
  }

  /** After an action, determine what happens next */
  checkHandProgress() {
    const active = this.activePlayers();
    const acting = this.actingPlayers();

    // Only one player left — they win
    if (active.length === 1) {
      this.awardPotToSingleWinner(active[0]);
      return;
    }

    // Everyone is all-in or only one can act
    if (acting.length <= 1) {
      // If one player can still act and hasn't matched the bet, let them act first
      if (acting.length === 1) {
        const lastActor = acting[0];
        if (lastActor.currentBet < this.currentBetLevel) {
          // They still need to call/fold — give them a turn
          this.currentPlayerIndex = lastActor.seat;
          this.promptCurrentPlayer();
          return;
        }
      }
      // All bets settled — deal remaining community cards and go to showdown
      this.runOutBoard();
      return;
    }

    // Advance to next player
    this.advanceToNextPlayer();
  }

  /** Move to next player in the round */
  advanceToNextPlayer() {
    const startSeat = this.currentPlayerIndex;

    for (let i = 1; i <= config.MAX_PLAYERS; i++) {
      const idx = (startSeat + i) % config.MAX_PLAYERS;
      const p = this.seats[idx];
      if (p && p.status === 'active') {
        // Check if betting round is complete
        if (this.isBettingRoundComplete(p)) {
          this.advancePhase();
          return;
        }
        this.currentPlayerIndex = idx;
        this.promptCurrentPlayer();
        return;
      }
    }

    // No one left to act
    this.advancePhase();
  }

  /** Check if the betting round is complete */
  isBettingRoundComplete(nextPlayer) {
    const acting = this.actingPlayers();

    // If everyone who can act has matched the current bet level
    // and at least one action has happened this round (or it's not preflop)
    for (const p of acting) {
      if (p.currentBet < this.currentBetLevel) return false;
      if (p.lastAction === null) return false; // Hasn't acted yet this round
      if (p.lastAction === 'small blind' || p.lastAction === 'big blind') {
        // Blinds haven't had a chance to act yet
        if (p === nextPlayer) return false;
      }
    }

    // Check if the next player already matched and acted
    if (nextPlayer.currentBet === this.currentBetLevel &&
        nextPlayer.lastAction && nextPlayer.lastAction !== 'small blind' && nextPlayer.lastAction !== 'big blind') {
      return true;
    }

    return false;
  }

  // ─── Phase Advancement ────────────────────────────────────────

  /** Advance to the next phase */
  advancePhase() {
    // Reset actions for new round
    for (const p of this.actingPlayers()) {
      p.lastAction = null;
      p.resetBetForRound();
    }
    this.currentBetLevel = 0;
    this.minRaise = config.BIG_BLIND;

    switch (this.phase) {
      case 'preflop':
        this.phase = 'flop';
        this.dealFlop();
        this.startBettingRound();
        break;
      case 'flop':
        this.phase = 'turn';
        this.dealTurn();
        this.startBettingRound();
        break;
      case 'turn':
        this.phase = 'river';
        this.dealRiver();
        this.startBettingRound();
        break;
      case 'river':
        this.showdown();
        break;
    }
  }

  /** Deal remaining board when everyone is all-in */
  runOutBoard() {
    while (this.communityCards.length < 5) {
      this.deck.burn();
      const cards = this.deck.deal(1);
      this.communityCards.push(...cards);
    }
    this.mitsuki(`🌙 The board runs out: ${cardsToString(this.communityCards)}`);
    this.broadcast({
      type: 'community_cards',
      cards: this.communityCards,
      phase: 'runout',
    });
    this.showdown();
  }

  dealFlop() {
    this.deck.burn();
    const cards = this.deck.deal(3);
    this.communityCards.push(...cards);
    this.mitsuki(`🌙 The flop: ${cardsToString(cards)}`);
    this.broadcast({ type: 'community_cards', cards: this.communityCards, phase: 'flop' });
  }

  dealTurn() {
    this.deck.burn();
    const cards = this.deck.deal(1);
    this.communityCards.push(...cards);
    this.mitsuki(`🌙 The turn: ${cardToString(cards[0])}`);
    this.broadcast({ type: 'community_cards', cards: this.communityCards, phase: 'turn' });
  }

  dealRiver() {
    this.deck.burn();
    const cards = this.deck.deal(1);
    this.communityCards.push(...cards);
    this.mitsuki(`🌙 The river speaks: ${cardToString(cards[0])}`);
    this.broadcast({ type: 'community_cards', cards: this.communityCards, phase: 'river' });
  }

  // ─── Showdown & Pot Distribution ──────────────────────────────

  /** Evaluate all hands and distribute pot */
  showdown() {
    this.phase = 'showdown';
    this.clearTurnTimer();

    const contenders = this.activePlayers();
    if (contenders.length === 0) return;

    if (contenders.length === 1) {
      this.awardPotToSingleWinner(contenders[0]);
      return;
    }

    // Calculate final pot distribution
    this.calculatePots();

    // Evaluate hands
    const playerHands = contenders.map(p => ({
      player: p,
      hand: evaluateHand([...p.holeCards, ...this.communityCards]),
      seat: p.seat
    }));

    // Show all hands
    for (const ph of playerHands) {
      this.mitsuki(`${ph.player.name} shows ${cardsToString(ph.player.holeCards)} — ${ph.hand.name}`);
    }

    const awards = [];

    // Award each pot separately
    for (const pot of this.pots) {
      // Find eligible players for this pot
      const eligible = playerHands.filter(ph => pot.eligible.includes(ph.seat));
      
      if (eligible.length === 0) continue;

      // Determine winners among eligible players
      const winners = determineWinners(eligible);

      // Distribute pot among winners
      const { distributions, remainder } = this.distributePot(pot.amount, winners, pot.eligible);
      
      for (const dist of distributions) {
        dist.player.award(dist.amount);
        dist.player.handsWon++;
        awards.push({
          player: dist.player.name,
          amount: dist.amount,
          pot: pot.name,
          hand: dist.hand.name
        });
        
        if (pot.amount > 0) {
          this.mitsuki(`🏆 ${dist.player.name} wins ${dist.amount} from ${pot.name} with ${dist.hand.name}!`);
        }
      }

      // Award remainder to first winner closest to dealer button
      if (remainder > 0 && distributions.length > 0) {
        const oddChipWinner = this.getOddChipWinner(distributions.map(d => d.player));
        oddChipWinner.award(remainder);
        this.mitsuki(`💫 ${oddChipWinner.name} receives the odd chip (${remainder}).`);
      }
    }

    this.broadcast({
      type: 'showdown',
      results: playerHands.map(ph => ({
        name: ph.player.name,
        holeCards: ph.player.holeCards,
        handName: ph.hand.name,
        rank: ph.hand.rank,
      })),
      communityCards: this.communityCards,
      awards: awards,
      pots: this.pots
    });

    // Record hand history
    this.recordHandHistory(playerHands);

    // Update ELO
    this.updateElo(playerHands);

    // Start next hand
    this.scheduleNextHand();
  }

  /** Distribute a pot amount among winners, handling odd chips */
  distributePot(amount, winners, eligibleSeats) {
    const distributions = [];
    const share = Math.floor(amount / winners.length);
    const remainder = amount - (share * winners.length);

    for (const winner of winners) {
      distributions.push({
        player: winner.player,
        amount: share,
        hand: winner.hand
      });
    }

    return { distributions, remainder };
  }

  /** Get the player who should receive the odd chip (closest to dealer's left) */
  getOddChipWinner(winners) {
    if (winners.length <= 1) return winners[0];

    // Find the winner closest to the left of the dealer button
    let closestPlayer = winners[0];
    let shortestDistance = this.getDistanceFromDealer(closestPlayer.seat);

    for (const player of winners) {
      const distance = this.getDistanceFromDealer(player.seat);
      if (distance < shortestDistance) {
        shortestDistance = distance;
        closestPlayer = player;
      }
    }

    return closestPlayer;
  }

  /** Get distance from dealer button (seats to the left) */
  getDistanceFromDealer(seatIndex) {
    let distance = 0;
    let current = this.dealerSeat;
    
    while (current !== seatIndex && distance < config.MAX_PLAYERS) {
      current = (current + 1) % config.MAX_PLAYERS;
      distance++;
    }
    
    return distance;
  }

  /** Single winner (everyone else folded) */
  awardPotToSingleWinner(player) {
    this.phase = 'showdown';
    this.clearTurnTimer();

    const totalPot = this.pot;
    player.award(totalPot);
    player.handsWon++;
    this.mitsuki(`🏆 ${player.name} takes the pot (${totalPot}). No contest.`);

    this.broadcast({
      type: 'hand_complete',
      winner: player.name,
      pot: totalPot,
      showCards: false,
    });

    this.recordHandHistory([{ player, hand: null }]);
    this.pot = 0;
    this.pots = [];
    this.scheduleNextHand();
  }

  /** Calculate side pots based on player contributions */
  calculatePots() {
    // Get all players who have contributed to the pot (including folded players)
    const allContributors = this.seatedPlayers().filter(p => p.totalBetThisHand > 0);
    const activePlayers = this.activePlayers();

    if (allContributors.length === 0) {
      this.pots = [];
      return;
    }

    // Get unique bet levels from all-in players, sorted ascending
    const allInBetLevels = activePlayers
      .filter(p => p.status === 'all-in')
      .map(p => p.totalBetThisHand)
      .sort((a, b) => a - b);

    // Remove duplicates
    const uniqueLevels = [...new Set(allInBetLevels)];
    
    const pots = [];
    let prevLevel = 0;

    // Create pots for each all-in level
    for (const level of uniqueLevels) {
      const increment = level - prevLevel;
      if (increment <= 0) continue;

      let potAmount = 0;
      
      // Calculate pot amount from all contributors
      for (const player of allContributors) {
        const contribution = Math.min(player.totalBetThisHand - prevLevel, increment);
        if (contribution > 0) {
          potAmount += contribution;
        }
      }

      // Find eligible players (active players who bet at least this level)
      const eligible = activePlayers
        .filter(p => p.totalBetThisHand >= level)
        .map(p => p.seat);

      if (potAmount > 0 && eligible.length > 0) {
        pots.push({
          amount: potAmount,
          eligible: eligible,
          name: pots.length === 0 ? 'Main Pot' : `Side Pot ${pots.length}`
        });
      }

      prevLevel = level;
    }

    // Handle remaining chips from non-all-in players
    const maxAllInLevel = uniqueLevels.length > 0 ? Math.max(...uniqueLevels) : 0;
    const activeNonAllIn = activePlayers.filter(p => p.status === 'active');
    
    if (activeNonAllIn.length > 0) {
      let remainingAmount = 0;
      
      // Calculate remaining contributions beyond the highest all-in level
      for (const player of allContributors) {
        const contribution = Math.max(0, player.totalBetThisHand - maxAllInLevel);
        remainingAmount += contribution;
      }

      if (remainingAmount > 0) {
        const eligible = activePlayers.map(p => p.seat);
        const potName = pots.length === 0 ? 'Main Pot' : `Side Pot ${pots.length}`;
        
        pots.push({
          amount: remainingAmount,
          eligible: eligible,
          name: potName
        });
      }
    }

    // If no side pots were created, create a main pot with all the money
    if (pots.length === 0 && this.pot > 0) {
      pots.push({
        amount: this.pot,
        eligible: activePlayers.map(p => p.seat),
        name: 'Main Pot'
      });
    }

    this.pots = pots;
  }

  /** Get the current total pot amount */
  getTotalPot() {
    return this.pots.reduce((sum, pot) => sum + pot.amount, 0);
  }

  /** Schedule next hand */
  scheduleNextHand() {
    this.pot = 0;
    this.pots = [];
    setTimeout(() => {
      const eligible = this.seatedPlayers().filter(p => p.stack > 0);
      if (eligible.length >= config.MIN_PLAYERS) {
        this.startHand();
      } else {
        this.phase = 'waiting';
        this.mitsuki('🌙 Mitsuki waits for more players...');
      }
    }, config.HAND_START_DELAY_MS);
  }

  /** Record hand to history */
  recordHandHistory(playerHands) {
    const record = {
      handNumber: this.handNumber,
      timestamp: Date.now(),
      communityCards: this.communityCards.map(c => cardToString(c)),
      players: playerHands.map(ph => ({
        name: ph.player.name,
        holeCards: ph.player.holeCards.map(c => cardToString(c)),
        hand: ph.hand ? ph.hand.name : 'mucked',
        stack: ph.player.stack,
      })),
      pot: this.pot,
      log: [...this.currentHandLog],
    };

    this.handHistory.push(record);
    if (this.handHistory.length > config.MAX_HAND_HISTORY) {
      this.handHistory.shift();
    }

    // Increment hands played
    for (const ph of playerHands) {
      ph.player.handsPlayed++;
    }
  }

  /** Simple ELO update */
  updateElo(playerHands) {
    if (playerHands.length < 2) return;

    const winners = determineWinners(playerHands);
    const winnerIds = new Set(winners.map(w => w.player.id));

    for (const ph of playerHands) {
      for (const other of playerHands) {
        if (ph.player.id === other.player.id) continue;

        const expected = 1 / (1 + Math.pow(10, (other.player.elo - ph.player.elo) / 400));
        const actual = winnerIds.has(ph.player.id) ? 1 : 0;
        ph.player.elo += Math.round(config.ELO_K_FACTOR * (actual - expected));
      }
    }
  }

  // ─── State ────────────────────────────────────────────────────

  /** Get game state for a specific player (private view) */
  getStateForPlayer(token) {
    const player = this.findPlayer(token);
    if (!player) return null;

    const currentPlayer = this.getCurrentPlayer();
    const toCall = currentPlayer && currentPlayer.id === token
      ? this.currentBetLevel - player.currentBet
      : 0;

    return {
      tableId: this.id,
      handNumber: this.handNumber,
      phase: this.phase,
      pot: this.pot,
      pots: this.pots,
      communityCards: this.communityCards,
      currentBet: this.currentBetLevel,
      minRaise: this.minRaise,
      dealerSeat: this.dealerSeat,
      isYourTurn: currentPlayer ? currentPlayer.id === token : false,
      toCall,
      you: player.toPrivateJSON(),
      players: this.seats.map(p => p ? p.toPublicJSON() : null),
    };
  }

  /** Public table info */
  toPublicJSON() {
    return {
      id: this.id,
      phase: this.phase,
      handNumber: this.handNumber,
      playerCount: this.seatedPlayers().length,
      maxPlayers: config.MAX_PLAYERS,
      pot: this.pot,
      pots: this.pots,
      blinds: `${config.SMALL_BLIND}/${config.BIG_BLIND}`,
      communityCards: this.communityCards,
    };
  }
}

module.exports = Table;
