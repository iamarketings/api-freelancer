const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const db = require('../db/database');
const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com/v1',
});

const { jobWorkerPool } = require('../services/workerService');

/**
 * Scrape le contenu HTML d'une page job Remotive
 */
async function scrapeJobPage(url) {
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
            timeout: 20000 // Timeout augmenté à 20s
        });
        const $ = cheerio.load(response.data);

        const container = $('.job-description').length ? $('.job-description') : $('section.tw-mt-16.tw-mb-16');
        const descriptionHtml = container.html() || '';
        const descriptionText = container.text().trim() || '';

        // Extraction des liens brut pour aider l'IA
        const rawLinks = [];
        container.find('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.startsWith('http')) rawLinks.push(href);
        });

        return { html: descriptionHtml, text: descriptionText, links: [...new Set(rawLinks)] };
    } catch (err) {
        console.error(`[Remotive Scraper] Erreur sur ${url}:`, err.message);
        return { html: '', text: '', links: [] };
    }
}

/**
 * Analyse approfondie avec DeepSeek
 */
async function analyzeJobDeeply(job, scrapedContent) {
    try {
        const prompt = `Tu es un expert en recrutement technique pour le marché FRANCOPHONE. 
Ton objectif est d'enrichir une offre d'emploi pour une plateforme premium.

IMPORTANT : TOUTES tes réponses dans l'objet "enriched" DOIVENT être en FRANÇAIS. Traduis fidèlement et professionnellement.

Titre : ${job.title}
Entreprise : ${job.company || 'Inconnue'}
URL Source : ${job.url}

Description (Extrait) :
"""
${scrapedContent.text.substring(0, 5000)}
"""

Liens trouvés sur la page :
${scrapedContent.links.join('\n')}

CONSIGNES DE SÉCURITÉ ET QUALITÉ :
1. "directApplyUrl" : Identifie l'URL de candidature finale (Greenhouse, Lever, Breezy, Workable, Ashby, Site Carrière). 
   - IGNORE les liens vers remotive.com ou les réseaux sociaux.
   - Si plusieurs liens, privilégie celui qui ressemble à un formulaire de candidature.
   - Si tu ne trouves rien, mets null.
2. "enriched" : Traduis TOUT en français (responsabilités, profil, avantages). Sois précis.
3. "labels" : 5-8 tags techniques pertinents (en anglais si c'est l'usage technique, ex: "React").

Format JSON STRICT attendu :
{
  "directApplyUrl": "https://...",
  "enriched": {
    "company": "Nom de l'entreprise",
    "salary": {
      "min": number ou null,
      "max": number ou null,
      "currency": "USD/EUR/...",
      "unit": "hour/year/month",
      "notes": "Précisions en français (ex: selon expérience)"
    },
    "location": {
      "remote": true,
      "regions": ["USA", "Europe", "Monde", etc.]
    },
    "contractType": "CDI/Freelance/CDD/Temps partiel",
    "experienceRequired": {
      "minYears": number ou null,
      "level": "junior/intermédiaire/senior/lead"
    },
    "summary": "Résumé captivant en 2-3 phrases (FRANÇAIS)",
    "responsibilities": ["Points clés en FRANÇAIS"],
    "requiredProfile": ["Compétences clés en FRANÇAIS"],
    "disqualifiers": ["Points éliminatoires en FRANÇAIS"],
    "keyBenefits": ["Avantages en FRANÇAIS"],
    "applicationProcess": "Description du process en FRANÇAIS"
  },
  "labels": ["Tag1", "Tag2"]
}`;

        const response = await openai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'Réponds uniquement en JSON valide, sans texte explicatif. Langue : Français.' },
                { role: 'user', content: prompt }
            ],
            response_format: { type: 'json_object' },
            timeout: 30000 // Timeout IA augmenté
        });

        const rawContent = response.choices[0].message.content;
        const cleanContent = rawContent.replace(/```json|```/g, '').trim();
        return JSON.parse(cleanContent);

    } catch (err) {
        console.error('[Remotive AI] Erreur DeepSeek:', err.message);
        return null;
    }
}

async function fetchRemotiveJobs() {
    try {
        const response = await axios.get('https://remotive.com/api/remote-jobs', {
            params: { limit: 50 },
            headers: { 'Accept': 'application/json' },
            timeout: 15000,
        });
        return response.data.jobs || [];
    } catch (err) {
        console.error('[Remotive API] Erreur:', err.message);
        return [];
    }
}

let isRunning = false;

async function runRemotiveFetcherJob() {
    if (isRunning) return;
    isRunning = true;
    console.log('💼 [CRON] Début Enrichment Profond Remotive (Worker Pool)...');

    try {
        const jobs = await fetchRemotiveJobs();
        const promises = [];

        for (const job of jobs) {
            const jobId = `remotive-${job.id}`;
            const existing = db.get('bounties').find({ id: jobId }).value();

            if (existing && existing.enriched) continue;

            const task = async () => {
                console.log(`🔍 [Worker] Scraping & AI : ${job.title}...`);
                const scraped = await scrapeJobPage(job.url);
                const analysis = await analyzeJobDeeply(job, scraped);

                if (!analysis) return;

                const jobData = {
                    id: jobId,
                    title: job.title,
                    repo: 'Remotive',
                    url: job.url,
                    directApplyUrl: analysis.directApplyUrl || job.url,
                    imageUrl: job.company_logo || null,
                    state: 'OPEN',
                    commentCount: 0,
                    createdAt: new Date(job.publication_date || new Date()).toISOString(),
                    lastActivityAt: new Date().toISOString(),
                    labels: JSON.stringify(analysis.labels || []),
                    score: 75,
                    aiSummary: analysis.enriched.summary,
                    isScam: 0,
                    discoveredAt: new Date().toISOString(),
                    enriched: analysis.enriched
                };

                if (existing) {
                    db.get('bounties').find({ id: jobId }).assign(jobData).write();
                } else {
                    db.get('bounties').push(jobData).write();
                }
                console.log(`✨ [Worker] Enrichi : ${job.title}`);
            };

            // Ajout au pool de workers (limité à 5)
            promises.push(jobWorkerPool.addTask(task));
        }

        await Promise.allSettled(promises);
        console.log(`✅ [CRON] Remotive Enrichment fini.`);
    } catch (err) {
        console.error('❌ [CRON] Erreur Remotive Enrichment:', err);
    } finally {
        isRunning = false;
    }
}

function startRemotiveCron() {
    cron.schedule('0 */12 * * *', runRemotiveFetcherJob);
}

module.exports = { startRemotiveCron, runRemotiveFetcherJob };
