/**
 * 🌙 Mitsuki's Room — Configuration
 * Tweak the game parameters here.
 */

module.exports = {
  // Server
  PORT: process.env.PORT || 3000,

  // Table limits
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 9,

  // Blinds
  SMALL_BLIND: 1,
  BIG_BLIND: 2,

  // Buy-in
  MIN_BUY_IN: 40,   // 20x big blind
  MAX_BUY_IN: 400,  // 200x big blind
  DEFAULT_BUY_IN: 200,

  // Timing
  TURN_TIMER_MS: 15000,       // 15 seconds to act (normal timer)
  TIME_BANK_SECONDS: 30,      // 30 seconds time bank per game
  HAND_START_DELAY_MS: 3000,  // 3 seconds between hands
  SHOWDOWN_DELAY_MS: 2000,    // 2 seconds to admire the showdown
  SIT_OUT_AUTO_REMOVE_MS: 10 * 60 * 1000, // 10 minutes auto-remove

  // Hand history
  MAX_HAND_HISTORY: 100,

  // ELO
  DEFAULT_ELO: 1000,
  ELO_K_FACTOR: 32,

  // AI Dealer
  DEALER_AI: {
    enabled: true,
    provider: 'auto',  // 'ollama', 'openai', 'anthropic', 'hardcoded', 'auto'
    model: 'llama3.2:1b',
    rateLimitMs: 5000,  // Max 1 comment every 5 seconds
    pitBossThreshold: 500,  // Pot size to trigger auto-verify
  },

  // Polish Features
  RUN_IT_TWICE: {
    enabled: true,
    promptTimeMs: 5000,  // 5 seconds to decide
  },
  
  BOMB_POTS: {
    enabled: true,
    ante: 5,  // 5x BB ante for bomb pot
    voteTimeMs: 10000,  // 10 seconds to vote
  },
};
