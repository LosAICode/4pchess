const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_PATH = path.join(__dirname, '..', 'saved_games.json');
const TMP_PATH = STORE_PATH + '.tmp';

function readStore() {
  try {
    var data = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return { games: [] };
  }
}

function writeStore(store) {
  fs.writeFileSync(TMP_PATH, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(TMP_PATH, STORE_PATH);
}

function generateId() {
  return crypto.randomBytes(4).toString('hex');
}

module.exports = { readStore, writeStore, generateId };
