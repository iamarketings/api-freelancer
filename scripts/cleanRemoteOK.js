/**
 * Script de nettoyage — Supprime toutes les entrées RemoteOK de dev.json
 * À lancer UNE SEULE FOIS : node scripts/cleanRemoteOK.js
 */
require('dotenv').config();
const db = require('../src/db/database');

const before = db.get('bounties').value().length;
const remoteokEntries = db.get('bounties').filter(b => b.id && b.id.startsWith('remoteok-')).value();

console.log(`📊 Avant nettoyage : ${before} entrées au total`);
console.log(`🗑️  Entrées RemoteOK à supprimer : ${remoteokEntries.length}`);

// Suppression de toutes les entrées RemoteOK
db.get('bounties')
    .remove(b => b.id && b.id.startsWith('remoteok-'))
    .write();

const after = db.get('bounties').value().length;
console.log(`✅ Nettoyage terminé. ${before - after} entrées supprimées. Total restant : ${after}`);
