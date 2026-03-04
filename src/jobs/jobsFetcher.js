const cron = require('node-cron');
const axios = require('axios');
const Parser = require('rss-parser');
const supabase = require('../db/supabase');
const { qualifyLeadWithAI, scrapeJobPage } = require('./aiQualifier');
const { calculateLeadScore } = require('./leadScoringAlgo');

let isRunning = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const parser = new Parser({
    customFields: { item: ['content:encoded', 'description', 'pubDate', 'category'] },
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BountyHunterBot/2.0)' },
});

const HTTP_HEADERS = {
    'Accept': 'application/json, application/rss+xml',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
};

const NEGATIVE_KEYWORDS = [
    'hiring', 'looking for', '[hiring]', 'we are hiring', 'join our team',
    'full-time', 'fulltime', 'full time', 'intern', 'internship', 'equity only',
    'unpaid', 'co-founder', 'cofounder', 'volunteer', 'revshare', 'profit share'
];

function containsNegativeKeyword(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return NEGATIVE_KEYWORDS.some(kw => lower.includes(kw));
}

function normalizeUrl(url) {
    if (!url) return null;
    try {
        const u = new URL(url);
        u.search = ''; u.hash = '';
        return u.toString();
    } catch { return url; }
}

async function fetchJobs() {
    const newLeads = [];
    console.log('\n💼 [Jobs] Remotive & Jobicy APIs...');

    // 1. Jobicy
    try {
        const resp = await axios.get('https://jobicy.com/api/v2/remote-jobs', { headers: HTTP_HEADERS, timeout: 15000 });
        const jobs = resp.data.jobs || [];
        for (const job of jobs) {
            const title = job.jobTitle || '(sans titre)';
            if (containsNegativeKeyword(title)) continue;

            newLeads.push({
                id: `jobicy-${job.id}`,
                source: 'Jobicy',
                title,
                url: job.url || '',
                created_at: job.pubDate ? new Date(job.pubDate).toISOString() : new Date().toISOString(),
                preview: job.jobExcerpt || '',
                type: 'job_deep',
            });
        }
        console.log(`   [Jobs] Jobicy OK`);
    } catch (err) { console.error(`   ❌ Jobicy API: ${err.message}`); }

    // 2. Remotive
    try {
        const resp = await axios.get('https://remotive.com/api/remote-jobs', { params: { limit: 50 }, headers: HTTP_HEADERS, timeout: 15000 });
        const jobs = resp.data.jobs || [];
        for (const job of jobs) {
            const title = job.title || '(sans titre)';
            if (containsNegativeKeyword(title)) continue;

            newLeads.push({
                id: `remotive-${job.id}`,
                source: 'Remotive',
                title,
                url: job.url || '',
                created_at: job.publication_date ? new Date(job.publication_date).toISOString() : new Date().toISOString(),
                preview: (job.description || '').replace(/<[^>]*>/g, '').substring(0, 800),
                type: 'job_deep',
            });
        }
        console.log(`   [Jobs] Remotive OK`);
    } catch (err) { console.error(`   ❌ Remotive API: ${err.message}`); }

    return newLeads;
}

// Validation logic for Job contacts
const PLATFORM_DOMAINS = [
    'remoteok.com', 'weworkremotely.com', 'remotive.com', 'jobicy.com',
    'reddit.com', 'devpost.com', 'linkedin.com', 'indeed.com',
    'glassdoor.com', 'wellfound.com', 'angel.co', 'simplyhired.com',
    'ziprecruiter.com', 'monster.com', 'lever.co', 'greenhouse.io',
    'workable.com', 'bamboohr.com', 'ashbyhq.com', 'smartrecruiters.com',
];

function isPlatformUrl(url = '') {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.replace('www.', '');
        return PLATFORM_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`));
    } catch { return false; }
}

function sanitizeContact(contact = {}) {
    if (typeof contact !== 'object' || contact === null) return {};
    const cleaned = { ...contact };
    if (cleaned.external_link && isPlatformUrl(cleaned.external_link)) cleaned.external_link = null;
    if (cleaned.website && isPlatformUrl(cleaned.website)) cleaned.website = null;
    for (const key of ['email', 'telegram', 'discord']) {
        if (cleaned[key] === '') cleaned[key] = null;
    }
    return cleaned;
}

async function runJobsFetcherJob() {
    if (isRunning) {
        console.log('⚠️ [CRON] Job Jobs déjà en cours, cycle ignoré.');
        return;
    }

    isRunning = true;
    console.log('🔄 [CRON] Début de la récupération des Jobs Remote (Supabase)...');

    try {
        const issues = await fetchJobs();
        console.log(`[CRON] ${issues.length} jobs trouvés.`);

        // Récupérer les IDs déjà en base
        const { data: existingData } = await supabase.from('opportunities').select('id, score').in('id', issues.map(i => i.id));
        const existingIds = new Set(existingData?.map(r => r.id) || []);

        const newIssuesToProcess = issues.filter(issue => !existingIds.has(issue.id));

        console.log(`🤖 ${newIssuesToProcess.length} nouveaux jobs à évaluer avec l'IA...`);

        // Traitement séquentiel
        for (let i = 0; i < newIssuesToProcess.length; i++) {
            const lead = newIssuesToProcess[i];

            try {
                // Scraping de la page en profondeur
                let scrapedContent = null;
                if (lead.url) {
                    console.log(`   🌐 HTML -> MD : ${lead.url.substring(0, 60)}...`);
                    scrapedContent = await scrapeJobPage(lead.url);
                }

                const qualified = await qualifyLeadWithAI(lead, scrapedContent);

                if (!qualified || qualified.ai_error) {
                     console.log(`[Jobs] ⚠️  Erreur IA ou ignoré — ${lead.title}`);
                     await sleep(500);
                     continue;
                }

                qualified.contact = sanitizeContact(qualified.contact);

                // Un job doit au moins avoir un email (sauf si l'IA s'est trompée et que c'est ok dans ton cas)
                // Ici on applique la règle assouplie : s'il n'y a pas d'email, on prend quand même mais on alerte
                const hasEmail = Boolean(qualified.contact.email && qualified.contact.email.includes('@'));
                if (!hasEmail) {
                     console.log(`[Jobs] 📧 Attention pas d'email direct trouvé : ${qualified.title.substring(0, 30)}`);
                }

                qualified.score = calculateLeadScore(qualified);

                const opportunityData = {
                    id: qualified.id,
                    title: qualified.title,
                    source: qualified.source,
                    url: qualified.url,
                    image_url: null,
                    state: 'OPEN',
                    comment_count: 0,
                    created_at: qualified.created_at || new Date().toISOString(),
                    last_activity_at: new Date().toISOString(),
                    labels: [qualified.type, 'remote'],
                    score: qualified.score,
                    ai_summary: qualified.summary || '',
                    is_scam: qualified.is_scam || false,
                    discovered_at: new Date().toISOString(),
                    contact: qualified.contact || null,
                    budget: qualified.budget || null,
                    skills: qualified.skills || [],
                    summary_fr: qualified.summary_fr || '',
                    enriched: qualified.enriched || null
                };

                const { error } = await supabase.from('opportunities').upsert(opportunityData, { onConflict: 'id' });

                if (error) {
                    console.error(`❌ [Supabase] Erreur upsert job ${lead.id}:`, error.message);
                } else {
                    console.log(`✨ Job validé (${i + 1}/${newIssuesToProcess.length}): ${lead.title} (Score: ${qualified.score})`);
                }

                // Pause API plus longue (3 sec) car DeepSeek peut limiter le HTML lourd
                await sleep(3000);

            } catch (err) {
                console.error(`Erreur IA sur le job ${lead.id}:`, err.message);
            }
        }
    } catch (error) {
        console.error('❌ [CRON] Erreur générale Jobs :', error.message);
    } finally {
        isRunning = false;
    }

    console.log('✅ [CRON] Fin du cycle Jobs.');
}

function startJobsCron() {
    console.log('⏰ CRON Jobs (Remotive/Jobicy) planifié toutes les 12 heures (0 */12 * * *).');
    cron.schedule('0 */12 * * *', runJobsFetcherJob);
}

module.exports = { startJobsCron, runJobsFetcherJob };
