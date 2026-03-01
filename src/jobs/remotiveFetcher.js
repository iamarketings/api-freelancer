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
URL de candidature : ${job.url || ''}

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

        const result = JSON.parse(response.choices[0].message.content);
        return result;
    } catch (err) {
        // En cas d'erreur IA, on accepte l'offre par défaut
        return { isDirectApply: true, summary: job.description?.substring(0, 150) || 'Offre remote.' };
    }
}

async function fetchRemotiveJobs() {
    try {
        const response = await axios.get('https://remotive.com/api/remote-jobs', {
            params: { limit: 100 },
            headers: { 'Accept': 'application/json' },
            timeout: 15000,
        });
        const jobs = response.data.jobs || [];
        console.log(`[Remotive API] ${jobs.length} offres récupérées.`);
        return jobs;
    } catch (err) {
        console.error('[Remotive API] Erreur:', err.message);
        return [];
    }
}

async function runRemotiveFetcherJob() {
    console.log('💼 [CRON] Début de la récupération des offres Remotive...');
    let isRunning = false;
    if (isRunning) return;
    isRunning = true;

    try {
        const jobs = await fetchRemotiveJobs();
        let addedCount = 0;

        for (const job of jobs) {
            const jobId = `remotive-${job.id}`;
            const existing = db.get('bounties').find({ id: jobId }).value();

            if (existing) {
                db.get('bounties').find({ id: jobId }).assign({
                    lastActivityAt: new Date().toISOString()
                }).write();
                continue;
            }

            // Filtre DeepSeek : on vérifie que l'offre est accessible directement
            const aiCheck = await isJobDirectlyAccessible({
                title: job.title,
                company: job.company_name,
                description: job.description,
                url: job.url,
            });

            if (!aiCheck.isDirectApply) {
                console.log(`⏭️  Offre ignorée (accès restreint) : ${job.title}`);
                continue;
            }

            const tags = Array.isArray(job.tags) ? job.tags.slice(0, 8) : [];

            db.get('bounties').push({
                id: jobId,
                title: job.title,
                repo: 'Remotive',
                url: job.url,
                imageUrl: job.company_logo || null,
                state: 'OPEN',
                commentCount: 0,
                createdAt: new Date(job.publication_date || new Date()).toISOString(),
                lastActivityAt: new Date().toISOString(),
                labels: JSON.stringify(tags),
                score: 75,
                aiSummary: aiCheck.summary,
                isScam: 0,
                discoveredAt: new Date().toISOString(),
            }).write();

            addedCount++;
            console.log(`✨ Remotive ajouté: ${job.title}`);
            await new Promise(r => setTimeout(r, 600));
        }

        console.log(`✅ [CRON] Remotive terminé : ${addedCount} ajoutées.`);
    } catch (err) {
        console.error('❌ [CRON] Erreur Remotive:', err);
    } finally {
        isRunning = false;
    }
}

function startRemotiveCron() {
    console.log('⏰ CRON Remotive planifié toutes les 12h (0 */12 * * *).');
    cron.schedule('0 */12 * * *', runRemotiveFetcherJob);
}

module.exports = { startRemotiveCron, runRemotiveFetcherJob };
