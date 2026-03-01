const axios = require('axios');
const cron = require('node-cron');
const db = require('../db/database');
require('dotenv').config();

/**
 * Récupère les offres freelance depuis l'API publique de RemoteOK.
 * Pas d'authentification requise, JSON natif.
 */
async function fetchRemoteOKJobs() {
    try {
        const response = await axios.get('https://remoteok.com/api', {
            headers: {
                // User-Agent obligatoire, sinon RemoteOK renvoie 403
                'User-Agent': 'Mozilla/5.0 (compatible; BountyHunterBot/1.0)',
                'Accept': 'application/json',
            },
            timeout: 15000,
        });

        // Le premier élément est un objet légal (pas une offre), on le skip
        const jobs = response.data.filter(item => item.id && item.position);
        console.log(`[RemoteOK API] ${jobs.length} offres récupérées.`);
        return jobs;

    } catch (error) {
        console.error('[RemoteOK API] Erreur:', error.message);
        return [];
    }
}

/**
 * Calcule un score de pertinence pour une offre RemoteOK.
 */
function calculateJobScore(job) {
    let score = 60;

    // Bonus si salaire indiqué
    const salaryMin = parseInt(job.salary_min) || 0;
    const salaryMax = parseInt(job.salary_max) || 0;
    if (salaryMax > 150000) score += 25;
    else if (salaryMax > 80000) score += 15;
    else if (salaryMax > 0) score += 5;

    // Bonus si offre récente (moins de 7 jours)
    if (job.date) {
        const daysDiff = (new Date() - new Date(job.date)) / (1000 * 60 * 60 * 24);
        if (daysDiff < 2) score += 15;
        else if (daysDiff < 7) score += 8;
    }

    return Math.min(score, 100);
}

async function runRemoteOKFetcherJob() {
    console.log('💼 [CRON] Début de la récupération des offres RemoteOK...');

    try {
        const jobs = await fetchRemoteOKJobs();

        let addedCount = 0;
        let updatedCount = 0;

        for (const job of jobs) {
            const jobId = `remoteok-${job.id}`;
            const score = calculateJobScore(job);

            // Construction du résumé
            const salaryMin = parseInt(job.salary_min) || 0;
            const salaryMax = parseInt(job.salary_max) || 0;
            let summary = `Offre remote chez ${job.company || 'une entreprise'}.`;
            if (salaryMin > 0 && salaryMax > 0) {
                summary += ` Salaire : $${salaryMin.toLocaleString()} - $${salaryMax.toLocaleString()}/an.`;
            } else if (salaryMax > 0) {
                summary += ` Salaire jusqu'à $${salaryMax.toLocaleString()}/an.`;
            }
            if (job.location) summary += ` Localisation : ${job.location}.`;

            const imageUrl = job.company_logo || null;
            const labels = JSON.stringify(
                Array.isArray(job.tags) ? job.tags.slice(0, 8) : ['remote', 'freelance']
            );

            const existing = db.get('bounties').find({ id: jobId }).value();

            if (existing) {
                db.get('bounties')
                    .find({ id: jobId })
                    .assign({ score, lastActivityAt: new Date().toISOString(), aiSummary: summary })
                    .write();
                updatedCount++;
            } else {
                db.get('bounties').push({
                    id: jobId,
                    title: job.position,
                    repo: 'RemoteOK',
                    url: job.url || `https://remoteok.com/remote-jobs/${job.id}`,
                    imageUrl,
                    state: 'OPEN',
                    commentCount: 0,
                    createdAt: new Date(job.date || new Date()).toISOString(),
                    lastActivityAt: new Date().toISOString(),
                    labels,
                    score,
                    aiSummary: summary,
                    isScam: 0,
                    discoveredAt: new Date().toISOString(),
                }).write();
                addedCount++;
            }
        }

        console.log(`✅ [CRON] RemoteOK terminé : ${addedCount} ajoutées, ${updatedCount} mises à jour.`);
    } catch (error) {
        console.error('❌ [CRON] Erreur RemoteOK :', error);
    }
}

function startRemoteOKCron() {
    console.log('⏰ CRON RemoteOK planifié toutes les 12 heures (0 */12 * * *).');
    cron.schedule('0 */12 * * *', runRemoteOKFetcherJob);
}

module.exports = { startRemoteOKCron, runRemoteOKFetcherJob };
