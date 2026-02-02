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
  TURN_TIMER_MS: 30000,       // 30 seconds to act
  HAND_START_DELAY_MS: 3000,  // 3 seconds between hands
  SHOWDOWN_DELAY_MS: 2000,    // 2 seconds to admire the showdown

  // Hand history
  MAX_HAND_HISTORY: 100,

  // ELO
  DEFAULT_ELO: 1000,
  ELO_K_FACTOR: 32,
};
