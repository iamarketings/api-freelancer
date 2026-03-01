const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const dbPath = path.resolve(__dirname, '../../dev.json');
const adapter = new FileSync(dbPath);
const db = low(adapter);

// Initialiser la base JSON si elle est vide
db.defaults({ bounties: [] }).write();

console.log("✅ Connecté à la base de données JSON locale (lowdb).");

module.exports = db;
