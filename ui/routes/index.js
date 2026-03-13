var express = require('express');
var router = express.Router();

const addon = require('../build/Release/addon');
const {
  Worker, isMainThread, parentPort, workerData,
} = require('node:worker_threads');
const gameStore = require('./game_store');


/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});


var worker = null;

router.post('/chess-api', async function(req, res, next) {
  var req_json = req.body;

  function setImmediatePromise() {
    return new Promise((resolve, reject) => {
        // do we need setImmediate here?
      setImmediate(() => {
        if (worker != null) {
          worker.postMessage('cancel');
          worker.terminate();
        }
        worker = new Worker('./routes/eval_board.js', {
          workerData: req_json,
        });
        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', (code) => {
          resolve(null);
        });

      });
    });
  }

  var move_result = await setImmediatePromise();

  if (move_result != null) {
    res.json(move_result);
  } else {
    res.json({});
  }
})

// --- Saved games API ---

router.get('/api/games', function(req, res) {
  var store = gameStore.readStore();
  var summary = store.games.map(function(g) {
    return { id: g.id, name: g.name, metadata: g.metadata,
             created_at: g.created_at, updated_at: g.updated_at };
  });
  summary.sort(function(a, b) {
    return new Date(b.updated_at) - new Date(a.updated_at);
  });
  res.json({ games: summary });
});

router.get('/api/games/:id', function(req, res) {
  var store = gameStore.readStore();
  var game = store.games.find(function(g) { return g.id === req.params.id; });
  if (!game) return res.status(404).json({ error: 'Game not found' });
  res.json(game);
});

router.post('/api/games', function(req, res) {
  var store = gameStore.readStore();
  var now = new Date().toISOString();
  var game = {
    id: gameStore.generateId(),
    name: req.body.name || 'Untitled Game',
    pgn: req.body.pgn,
    move_index: req.body.move_index != null ? req.body.move_index : -1,
    rotation: req.body.rotation || 0,
    created_at: now,
    updated_at: now,
    metadata: req.body.metadata || {},
  };
  store.games.push(game);
  gameStore.writeStore(store);
  res.json(game);
});

router.delete('/api/games/:id', function(req, res) {
  var store = gameStore.readStore();
  var idx = store.games.findIndex(function(g) { return g.id === req.params.id; });
  if (idx === -1) return res.status(404).json({ error: 'Game not found' });
  store.games.splice(idx, 1);
  gameStore.writeStore(store);
  res.json({ success: true });
});

module.exports = router;

