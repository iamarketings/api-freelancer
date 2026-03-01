/**
 * Nettoyage base de données — Supprime entrées Remotive et Jobicy
 * (stockées sans directApplyUrl ou avec l'ancien libellé /api/freelance)
 * À relancer: node scripts/cleanJobsDB.js
 */
require('dotenv').config();
const db = require('../src/db/database');

const before = db.get('bounties').value().length;
const remotive = db.get('bounties').filter(b => b.id && b.id.startsWith('remotive-')).value().length;
const jobicy = db.get('bounties').filter(b => b.id && b.id.startsWith('jobicy-')).value().length;

console.log(`📊 Avant nettoyage : ${before} entrées totales`);
console.log(`🗑️  Remotive : ${remotive} | Jobicy : ${jobicy}`);

db.get('bounties')
    .remove(b => b.id && (b.id.startsWith('remotive-') || b.id.startsWith('jobicy-')))
    .write();

const after = db.get('bounties').value().length;
console.log(`✅ Supprimées : ${before - after}. Restantes : ${after}`);
