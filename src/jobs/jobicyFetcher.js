const axios = require('axios');
const cron = require('node-cron');
const db = require('../db/database');
const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com/v1',
});

/**
 * Filtre IA : vérifie si l'offre est accessible directement sans abonnement
 */
async function isJobDirectlyAccessible(job) {
    try {
        const prompt = `Tu analyses une offre d'emploi remote/freelance. Réponds UNIQUEMENT en JSON.

Titre : ${job.title}
Entreprise : ${job.company || 'Inconnue'}
Description : ${(job.description || '').substring(0, 800)}
URL : ${job.url || ''}

Questions :
1. Est-ce que cette offre semble accessible DIRECTEMENT (sans abonnement payant ni inscription premium) ?
2. Donne un résumé de 1-2 phrases sur la mission (sans mentionner de plateforme).

Réponds en JSON strict :
{
  "isDirectApply": true ou false,
  "summary": "Résumé ici..."
}`;

        const response = await openai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'Réponds uniquement en JSON valide.' },
                { role: 'user', content: prompt }
            ],
            response_format: { type: 'json_object' }
        });

        return JSON.parse(response.choices[0].message.content);
    } catch (err) {
        return { isDirectApply: true, summary: (job.description || '').substring(0, 150) || 'Offre remote.' };
    }
}

async function fetchJobicyJobs() {
    try {
        const response = await axios.get('https://jobicy.com/api/v0/remote-jobs', {
            params: { count: 50, geo: 'worldwide' },
            headers: { 'Accept': 'application/json' },
            timeout: 15000,
        });
        const jobs = response.data.jobs || [];
        console.log(`[Jobicy API] ${jobs.length} offres récupérées.`);
        return jobs;
    } catch (err) {
        console.error('[Jobicy API] Erreur:', err.message);
        return [];
    }
}

let isRunning = false;

async function runJobicyFetcherJob() {
    if (isRunning) {
        console.log('⚠️ [CRON] Jobicy déjà en cours, ignoré.');
        return;
    }

    isRunning = true;
    console.log('💼 [CRON] Début de la récupération des offres Jobicy...');

    try {
        const jobs = await fetchJobicyJobs();
        let addedCount = 0;

        for (const job of jobs) {
            const jobId = `jobicy-${job.id}`;
            const existing = db.get('bounties').find({ id: jobId }).value();

            if (existing) {
                db.get('bounties').find({ id: jobId }).assign({
                    lastActivityAt: new Date().toISOString()
                }).write();
                continue;
            }

            const aiCheck = await isJobDirectlyAccessible({
                title: job.jobTitle,
                company: job.companyName,
                description: job.jobDescription,
                url: job.url,
            });

            if (!aiCheck.isDirectApply) {
                console.log(`⏭️  Offre ignorée (accès restreint) : ${job.jobTitle}`);
                continue;
            }

            const tags = Array.isArray(job.jobIndustry)
                ? job.jobIndustry.concat(job.jobType || []).slice(0, 8)
                : ['remote', 'freelance'];

            db.get('bounties').push({
                id: jobId,
                title: job.jobTitle,
                repo: 'Jobicy',
                url: job.url,
                imageUrl: job.companyLogo || null,
                state: 'OPEN',
                commentCount: 0,
                createdAt: new Date(job.pubDate || new Date()).toISOString(),
                lastActivityAt: new Date().toISOString(),
                labels: JSON.stringify(tags),
                score: 72,
                aiSummary: aiCheck.summary,
                isScam: 0,
                discoveredAt: new Date().toISOString(),
            }).write();

            addedCount++;
            console.log(`✨ Jobicy ajouté: ${job.jobTitle}`);
            await new Promise(r => setTimeout(r, 600));
        }

        console.log(`✅ [CRON] Jobicy terminé : ${addedCount} ajoutées.`);
    } catch (err) {
        console.error('❌ [CRON] Erreur Jobicy:', err);
    } finally {
        isRunning = false;
    }
}

function startJobicyCron() {
    console.log('⏰ CRON Jobicy planifié toutes les 12h (30 */12 * * *).');
    cron.schedule('30 */12 * * *', runJobicyFetcherJob);
}

module.exports = { startJobicyCron, runJobicyFetcherJob };
