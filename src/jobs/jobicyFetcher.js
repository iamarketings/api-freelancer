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
 * Scrape le contenu HTML d'une page job Jobicy
 */
async function scrapeJobPage(url) {
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
            timeout: 20000 // Timeout augmenté à 20s
        });
        const $ = cheerio.load(response.data);

        const container = $('.job__desc').length ? $('.job__desc') : $('body');
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
        console.error(`[Jobicy Scraper] Erreur sur ${url}:`, err.message);
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
   - IGNORE les liens vers jobicy.com ou les réseaux sociaux.
   - Si tu vois un lien d'une plateforme connue (Breezy, etc.), c'est celui-là. 
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
        console.error('[Jobicy AI] Erreur DeepSeek:', err.message);
        return null;
    }
}

async function fetchJobicyJobs() {
    try {
        const response = await axios.get('https://jobicy.com/api/v2/remote-jobs', {
            params: { count: 50 },
            headers: { 'Accept': 'application/json' },
            timeout: 15000,
        });
        return response.data.jobs || [];
    } catch (err) {
        console.error('[Jobicy API] Erreur:', err.message);
        return [];
    }
}

let isRunning = false;

async function runJobicyFetcherJob() {
    if (isRunning) return;
    isRunning = true;
    console.log('💼 [CRON] Début Enrichment Profond Jobicy (Worker Pool)...');

    try {
        const jobs = await fetchJobicyJobs();
        const promises = [];

        for (const job of jobs) {
            const jobId = `jobicy-${job.id}`;
            const existing = db.get('bounties').find({ id: jobId }).value();

            if (existing && existing.enriched) continue;

            const task = async () => {
                console.log(`🔍 [Worker] Scraping & AI : ${job.jobTitle}...`);
                const scraped = await scrapeJobPage(job.url);
                const analysis = await analyzeJobDeeply({
                    title: job.jobTitle,
                    company: job.companyName,
                    url: job.url
                }, scraped);

                if (!analysis) return;

                const jobData = {
                    id: jobId,
                    title: job.jobTitle,
                    repo: 'Jobicy',
                    url: job.url,
                    directApplyUrl: analysis.directApplyUrl || job.url,
                    imageUrl: job.companyLogo || null,
                    state: 'OPEN',
                    commentCount: 0,
                    createdAt: new Date(job.pubDate || new Date()).toISOString(),
                    lastActivityAt: new Date().toISOString(),
                    labels: JSON.stringify(analysis.labels || []),
                    score: 72,
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
                console.log(`✨ [Worker] Enrichi : ${job.jobTitle}`);
            };

            // Ajout au pool de workers (limité à 5)
            promises.push(jobWorkerPool.addTask(task));
        }

        await Promise.allSettled(promises);
        console.log(`✅ [CRON] Jobicy Enrichment fini.`);
    } catch (err) {
        console.error('❌ [CRON] Erreur Jobicy Enrichment:', err);
    } finally {
        isRunning = false;
    }
}

function startJobicyCron() {
    cron.schedule('30 */12 * * *', runJobicyFetcherJob);
}

module.exports = { startJobicyCron, runJobicyFetcherJob };
