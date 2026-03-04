const cron = require('node-cron');
const axios = require('axios');
const Parser = require('rss-parser');
const supabase = require('../db/supabase');

let isRunning = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const parser = new Parser({
    customFields: { item: ['content:encoded', 'description', 'pubDate', 'category'] },
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BountyHunterBot/2.0)' },
});

const RSS_FEEDS = [
    { url: 'https://remoteok.com/remote-jobs.rss', source: 'RemoteOK', type: 'job' },
    { url: 'https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss', source: 'WeWorkRemotely', type: 'job' },
    { url: 'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss', source: 'WeWorkRemotely', type: 'job' },
    { url: 'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss', source: 'WeWorkRemotely', type: 'job' }
];

const REDDIT_SUBS = []; // Désactivé à la demande de l'utilisateur

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

async function fetchRSSAndReddit() {
    const newLeads = [];
    console.log('\n📡 [RSS] Scraping Flux RSS et Reddit...');

    // 1. RSS
    for (const feed of RSS_FEEDS) {
        try {
            console.log(`   ⏳ Lecture : ${feed.source}...`);
            const parsed = await parser.parseURL(feed.url);

            for (const item of parsed.items) {
                const title = item.title || '';
                if (feed.type === 'freelance' && containsNegativeKeyword(title)) continue;

                const url = item.link || '';
                const htmlContent = item['content:encoded'] || item.content || item.description || '';
                const textContent = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

                newLeads.push({
                    id: `rss-${item.guid || item.id || normalizeUrl(item.link) || title}`,
                    source: `${feed.source} All`,
                    title, url,
                    created_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
                    preview: textContent.substring(0, 800),
                    type: feed.type,
                    qualified: false
                });
            }
        } catch (err) { console.error(`   ❌ Erreur RSS ${feed.source}: ${err.message}`); }
    }

    // 2. Reddit
    for (const sub of REDDIT_SUBS) {
        try {
            console.log(`   👽 Lecture : r/${sub}...`);
            const resp = await axios.get(`https://www.reddit.com/r/${sub}/new.json?limit=25`, { headers: HTTP_HEADERS, timeout: 10000 });
            const posts = resp.data?.data?.children || [];

            for (const p of posts) {
                const post = p.data;
                const title = post.title || '';

                if (title.toLowerCase().includes('[for hire]')) continue;

                newLeads.push({
                    id: `reddit-${post.id}`,
                    source: `r/${sub}`,
                    title,
                    url: `https://reddit.com${post.permalink}`,
                    created_at: new Date(post.created_utc * 1000).toISOString(),
                    preview: (post.selftext || '').substring(0, 800),
                    type: 'freelance',
                    extra_data: { upvotes: post.ups },
                    qualified: false
                });
            }
            await sleep(1500); // Rate limit
        } catch (err) { console.error(`   ❌ Erreur Reddit r/${sub}: ${err.message}`); }
    }

    return newLeads;
}

async function runRSSFetcherJob() {
    if (isRunning) {
        console.log('⚠️ [CRON] Job RSS déjà en cours, cycle ignoré.');
        return;
    }

    isRunning = true;
    console.log('🔄 [CRON] Début de la récupération des Flux RSS et Reddit...');

    try {
        const issues = await fetchRSSAndReddit();
        console.log(`[CRON] ${issues.length} leads trouvés.`);

        if (issues.length === 0) return;

        // 1. Récupérer les IDs déjà en base
        const { data: existingData } = await supabase.from('opportunities').select('id').in('id', issues.map(i => i.id));
        const existingIds = new Set(existingData?.map(r => r.id) || []);

        const newIssues = issues.filter(issue => !existingIds.has(issue.id));
        const existingIssues = issues.filter(issue => existingIds.has(issue.id));

        // 2. Mettre à jour l'état et les commentaires des existants (sans IA)
        if (existingIssues.length > 0) {
            console.log(`🔄 Mise à jour rapide de ${existingIssues.length} flux RSS/Reddit existants...`);
            for (const issue of existingIssues) {
                if (issue.type === 'freelance' && issue.extra_data?.upvotes !== undefined) {
                    await supabase.from('opportunities')
                        .update({
                            comment_count: issue.extra_data.upvotes,
                            last_activity_at: new Date().toISOString()
                        })
                        .eq('id', issue.id);
                }
            }
        }

        // 3. Envoyer uniquement les nouveaux à la Queue IA
        if (newIssues.length > 0) {
            console.log(`🚀 Ajout de ${newIssues.length} nouveaux leads RSS dans la Queue...`);
            const { error } = await supabase.from('queue').upsert(newIssues, { onConflict: 'id', ignoreDuplicates: true });
            if (error) console.error(`❌ [Supabase] Erreur insertion queue (RSS):`, error.message);
        } else {
            console.log(`✅ [CRON] Aucun nouveau lead RSS à envoyer à l'IA.`);
        }

    } catch (error) {
        console.error('❌ [CRON] Erreur générale RSS :', error.message);
    } finally {
        isRunning = false;
    }
}

function startRSSCron() {
    console.log('⏰ CRON RSS (Upwork/Reddit/RemoteOK) planifié toutes les 6 heures (0 */6 * * *).');
    cron.schedule('0 */6 * * *', runRSSFetcherJob);
}

module.exports = { startRSSCron, runRSSFetcherJob };
