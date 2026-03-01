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
 * Analyse l'offre avec DeepSeek :
 * 1. Vérifie que l'offre est accessible directement (sans abonnement)
 * 2. Extrait le lien direct de candidature depuis la description HTML
 * 3. Génère un résumé neutre
 */
async function analyzeJob(job) {
    try {
        // Nettoyage du HTML pour extraire le texte brut
        const cleanDescription = (job.description || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .substring(0, 1500);

        const prompt = `Tu analyses une offre d'emploi remote. Réponds UNIQUEMENT en JSON valide.

Titre : ${job.title}
Entreprise : ${job.company || 'Inconnue'}
Description :
"""
${cleanDescription}
"""

Tâches :
1. Trouve l'URL de candidature DIRECTE dans la description (lien vers Breezy, Greenhouse, Lever, Workable, Ashby, un site d'entreprise, etc.). Ce n'est PAS une URL de remotive.com ou jobicy.com. Si tu n'en trouves pas, retourne null.
2. Est-ce que cette offre est accessible directement sans abonnement payant ? (true/false)
3. Résume la mission en 1-2 phrases sans mentionner de plateforme de recrutement.

JSON attendu (STRICT) :
{
  "directApplyUrl": "https://..." ou null,
  "isDirectApply": true ou false,
  "summary": "Résumé ici..."
}`;

        const response = await openai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'Réponds uniquement en JSON valide, sans texte autour.' },
                { role: 'user', content: prompt }
            ],
            response_format: { type: 'json_object' }
        });

        const rawContent = response.choices[0].message.content;
        const cleanContent = rawContent.replace(/```json|```/g, '').trim();
        return JSON.parse(cleanContent);

    } catch (err) {
        console.error('[Remotive] Erreur DeepSeek:', err.message);
        return { directApplyUrl: null, isDirectApply: true, summary: (job.description || '').substring(0, 150) };
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

let isRunning = false;

async function runRemotiveFetcherJob() {
    if (isRunning) {
        console.log('⚠️ [CRON] Remotive déjà en cours, ignoré.');
        return;
    }
    isRunning = true;
    console.log('💼 [CRON] Début de la récupération des offres Remotive...');

    try {
        const jobs = await fetchRemotiveJobs();
        let addedCount = 0;
        let skippedCount = 0;

        for (const job of jobs) {
            const jobId = `remotive-${job.id}`;
            const existing = db.get('bounties').find({ id: jobId }).value();

            if (existing) {
                // Si l'entrée existe mais n'a pas encore de directApplyUrl, on re-vérifie
                if (!existing.directApplyUrl) {
                    const aiCheck = await analyzeJob({
                        title: job.title,
                        company: job.company_name,
                        description: job.description,
                    });
                    db.get('bounties').find({ id: jobId }).assign({
                        directApplyUrl: aiCheck.directApplyUrl,
                        aiSummary: aiCheck.summary,
                        lastActivityAt: new Date().toISOString(),
                    }).write();
                } else {
                    db.get('bounties').find({ id: jobId }).assign({
                        lastActivityAt: new Date().toISOString()
                    }).write();
                }
                continue;
            }

            // Nouvelle offre : analyse DeepSeek complète
            const aiCheck = await analyzeJob({
                title: job.title,
                company: job.company_name,
                description: job.description,
                url: job.url,
            });

            if (!aiCheck.isDirectApply) {
                console.log(`⏭️  Ignorée (accès restreint) : ${job.title}`);
                skippedCount++;
                continue;
            }

            const tags = Array.isArray(job.tags) ? job.tags.slice(0, 8) : [];

            db.get('bounties').push({
                id: jobId,
                title: job.title,
                repo: 'Remotive',
                url: job.url,                                          // URL Remotive (référence)
                directApplyUrl: aiCheck.directApplyUrl,                // URL directe extraite par IA
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
            console.log(`✨ Remotive ajouté: ${job.title} → ${aiCheck.directApplyUrl || '(pas de lien direct)'}`);
            await new Promise(r => setTimeout(r, 600));
        }

        console.log(`✅ [CRON] Remotive terminé : ${addedCount} ajoutées, ${skippedCount} ignorées.`);
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
