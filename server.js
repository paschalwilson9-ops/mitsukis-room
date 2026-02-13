/**
 * 🌙 Mitsuki's Room — Game Hub
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// === Sim Data Sync Endpoint ===
app.post('/api/sim-sync', (req, res) => {
  const { graph_data, state_data, key } = req.body;
  if (key !== 'mitsuki-moon-2026') return res.status(403).json({ error: 'bad key' });
  try {
    if (graph_data) fs.writeFileSync(path.join(__dirname, 'public', 'evolution_graph_data.json'), JSON.stringify(graph_data));
    if (state_data) fs.writeFileSync(path.join(__dirname, 'public', 'genetic_live_state.json'), JSON.stringify(state_data));
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// === API Info ===
app.get('/api', (req, res) => {
  res.json({
    name: "🌙 Mitsuki's Room",
    version: '2.0.0',
    games: {
      '/game.html': 'Game of Hierarchy — One-shot 300-round strategy game',
      '/dashboard.html': 'Evolution Sim — Live genetic tournament dashboard',
    },
    api: {
      'POST /api/sim-sync': 'Push sim data from local machine',
    }
  });
});

// Start
app.listen(PORT, () => {
  console.log(`🌙 Mitsuki's Room is open on port ${PORT}`);
});
