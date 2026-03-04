const cron = require('node-cron');
const axios = require('axios');
const supabase = require('../db/supabase');

let isRunning = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HTTP_HEADERS = {
    'Accept': 'application/json',
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
                qualified: false
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
                qualified: false
            });
        }
        console.log(`   [Jobs] Remotive OK`);
    } catch (err) { console.error(`   ❌ Remotive API: ${err.message}`); }

    return newLeads;
}

async function runJobsFetcherJob() {
    if (isRunning) {
        console.log('⚠️ [CRON] Job Jobs déjà en cours, cycle ignoré.');
        return;
    }

    isRunning = true;
    console.log('🔄 [CRON] Début de la récupération des Jobs Remote...');

    try {
        const issues = await fetchJobs();
        console.log(`[CRON] ${issues.length} jobs trouvés.`);

        if (issues.length === 0) return;

        // 1. Récupérer les IDs déjà en base
        const { data: existingData } = await supabase.from('opportunities').select('id').in('id', issues.map(i => i.id));
        const existingIds = new Set(existingData?.map(r => r.id) || []);

        const newIssues = issues.filter(issue => !existingIds.has(issue.id));

        // Note: Pour les jobs, il n'y a pas forcément de `comment_count` ou autre à mettre à jour
        // On se contente d'ajouter les nouveaux.

        // 2. Envoyer uniquement les nouveaux à la Queue IA
        if (newIssues.length > 0) {
            console.log(`🚀 Ajout de ${newIssues.length} nouveaux Jobs dans la Queue...`);
            const { error } = await supabase.from('queue').upsert(newIssues, { onConflict: 'id', ignoreDuplicates: true });
            if (error) console.error(`❌ [Supabase] Erreur insertion queue (Jobs):`, error.message);
        } else {
            console.log(`✅ [CRON] Aucun nouveau Job à envoyer à l'IA.`);
        }

    } catch (error) {
        console.error('❌ [CRON] Erreur générale Jobs :', error.message);
    } finally {
        isRunning = false;
    }
}

function startJobsCron() {
    console.log('⏰ CRON Jobs (Remotive/Jobicy) planifié toutes les 12 heures (0 */12 * * *).');
    cron.schedule('0 */12 * * *', runJobsFetcherJob);
}

module.exports = { startJobsCron, runJobsFetcherJob };
