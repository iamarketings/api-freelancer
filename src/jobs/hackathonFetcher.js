const axios = require('axios');
const cron = require('node-cron');
const db = require('../db/database');
require('dotenv').config();

/**
 * Récupère les hackathons ouverts depuis l'API officielle de Devpost.
 * Utilise l'API JSON native de Devpost (pas de scraping, pas de Puppeteer).
 */
async function fetchDevpostHackathons() {
    const allHackathons = [];
    const MAX_PAGES = 5; // 5 * 24 = 120 hackathons max

    for (let page = 1; page <= MAX_PAGES; page++) {
        try {
            const response = await axios.get('https://devpost.com/api/hackathons', {
                params: {
                    page: page,
                    per_page: 24,
                    status: 'open', // Uniquement les hackathons actifs
                    order_by: 'deadline',
                    sort_by: 'asc',
                },
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (compatible; BountyHunterBot/1.0)',
                },
                timeout: 10000,
            });

            const hackathons = response.data.hackathons;

            if (!hackathons || hackathons.length === 0) {
                console.log(`[Devpost API] Fin des résultats à la page ${page}.`);
                break;
            }

            allHackathons.push(...hackathons);
            console.log(`[Devpost API] Page ${page} récupérée (${allHackathons.length} hackathons total)`);

            // Pause courtoise entre les requêtes
            await new Promise(resolve => setTimeout(resolve, 800));

        } catch (error) {
            console.error(`[Devpost API] Erreur page ${page}:`, error.message);
            break;
        }
    }

    return allHackathons;
}

/**
 * Calcule un score de pertinence pour un hackathon Devpost
 * basé sur les récompenses et l'imminence de la deadline.
 */
function calculateHackathonScore(hack) {
    let score = 70; // Score de base pour un hackathon

    // Bonus si le prix est élevé
    if (hack.total_prizes && hack.total_prizes > 10000) score += 20;
    else if (hack.total_prizes && hack.total_prizes > 1000) score += 10;

    // Bonus si la deadline est proche (urgence)
    if (hack.submission_period_dates) {
        try {
            const deadline = new Date(hack.ends_at || hack.submission_period_dates.split(' - ')[1]);
            const daysLeft = (deadline - new Date()) / (1000 * 60 * 60 * 24);
            if (daysLeft > 0 && daysLeft < 7) score += 10; // Deadline dans la semaine
            else if (daysLeft < 0) return 0; // Déjà expiré
        } catch (e) { /* date non parsable */ }
    }

    // Bonus si beaucoup de participants (preuve de légitimité)
    if (hack.registrations_count && hack.registrations_count > 500) score += 5;

    return Math.min(score, 100);
}

async function runHackathonFetcherJob() {
    console.log('🌐 [CRON] Début de la récupération des Hackathons Devpost...');

    try {
        const hackathons = await fetchDevpostHackathons();
        console.log(`[CRON] ${hackathons.length} hackathons trouvés sur Devpost.`);

        let addedCount = 0;
        let updatedCount = 0;

        for (const hack of hackathons) {
            const hackId = `devpost-${hack.id || hack.url.split('/').pop()}`;
            const score = calculateHackathonScore(hack);
            const summary = hack.tagline || hack.description || 'Hackathon en ligne avec récompenses à la clé.';
            const prizes = hack.total_prizes ? ` Prix total : $${hack.total_prizes.toLocaleString()}.` : '';

            const existing = db.get('bounties').find({ id: hackId }).value();

            if (existing) {
                // Mise à jour du statut (si le hackathon est terminé, on le clôt)
                db.get('bounties')
                    .find({ id: hackId })
                    .assign({
                        state: score === 0 ? 'CLOSED' : 'OPEN',
                        lastActivityAt: new Date().toISOString(),
                        score: score,
                    })
                    .write();
                updatedCount++;
            } else {
                const newHackathon = {
                    id: hackId,
                    title: `[Hackathon] ${hack.title}`,
                    repo: 'Devpost',
                    url: hack.url || `https://devpost.com/hackathons/${hack.id}`,
                    state: 'OPEN',
                    commentCount: hack.registrations_count || 0,
                    createdAt: new Date(hack.created_at || new Date()).toISOString(),
                    lastActivityAt: new Date().toISOString(),
                    labels: JSON.stringify(['hackathon', 'devpost']),
                    score: score,
                    aiSummary: summary + prizes,
                    isScam: 0, // Les hackathons Devpost sont vérifiés par la plateforme
                    discoveredAt: new Date().toISOString(),
                };

                db.get('bounties').push(newHackathon).write();
                addedCount++;
                console.log(`✨ Hackathon ajouté: ${hack.title} (Score: ${score})`);
            }
        }

        console.log(`✅ [CRON] Devpost terminé : ${addedCount} ajoutés, ${updatedCount} mis à jour.`);
    } catch (error) {
        console.error('❌ [CRON] Erreur récupération Devpost :', error);
    }
}

function startHackathonCron() {
    console.log('⏰ CRON Hackathons planifié toutes les 6 heures (0 */6 * * *).');
    cron.schedule('0 */6 * * *', runHackathonFetcherJob);
}

module.exports = { startHackathonCron, runHackathonFetcherJob };
