/**
 * ═══════════════════════════════════════════════════════════════════════
 *  PHASE 1 — COLLECTEUR UNIFIÉ (RSS + APIs + Reddit + GitHub)
 *
 *  Corrections v2 :
 *  - NEGATIVE_KEYWORDS avec word boundary (évite de filtrer "Senior/Junior")
 *  - Déduplication cross-sources par URL normalisée
 *  - seen_ids.json avec TTL 30 jours (évite le grossissement infini)
 *  - queue.json : purge automatique des leads qualifiés > 7 jours
 *  - Reddit : filtrage par flair en plus du titre
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Parser = require('rss-parser');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const parser = new Parser();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// === FICHIERS DE DONNÉES ===
const DATA_DIR      = path.join(__dirname, 'data');
const SEEN_IDS_FILE = path.join(DATA_DIR, 'seen_ids.json');
const QUEUE_FILE    = path.join(DATA_DIR, 'queue.json');

const HTTP_HEADERS = {
    'User-Agent': 'FreelancerBountyBot/2.0 (contact: hi@example.com)',
    'Accept': 'application/json',
};

// === SOURCES RSS ===
const RSS_SOURCES = [
    { url: 'https://remoteok.com/remote-jobs.rss',                                                    name: 'RemoteOK' },
    { url: 'https://weworkremotely.com/remote-jobs.rss',                                              name: 'WWR All' },
    { url: 'https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss',             name: 'WWR Front-End' },
    { url: 'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss',              name: 'WWR Back-End' },
    { url: 'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',            name: 'WWR Full-Stack' },
    { url: 'https://weworkremotely.com/categories/remote-design-jobs.rss',                            name: 'WWR Design' },
    { url: 'https://weworkremotely.com/categories/remote-customer-support-jobs.rss',                  name: 'WWR Support' },
    { url: 'https://weworkremotely.com/categories/remote-product-jobs.rss',                           name: 'WWR Product' },
    { url: 'https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss',               name: 'WWR Sales' },
    { url: 'https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss',            name: 'WWR Management' },
];

// === SUBREDDITS ===
const SUBREDDITS = ['forhire', 'hiring', 'freelance_forhire', 'remotejs', 'Jobs4Bitcoins', 'slavelabour'];

// === FILTRES ===
// Utilise \b (word boundary) pour éviter de filtrer "Senior/Junior" ou "Junior to Senior"
const NEGATIVE_KEYWORD_PATTERNS = [
    /\binternship\b/i,
    /\bintern\b/i,
    /\bjunior\b/i,
    /\bstage\b/i,
    /\bentry[\s-]level\b/i,
    /\bstudent\b/i,
    /\bapprenticeship\b/i,
    /\btrainee\b/i,
];

// TTL seen_ids : 30 jours (en ms)
const SEEN_IDS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Purge queue : leads qualifiés de plus de 7 jours
const QUEUE_PURGE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// =============================================
// HELPERS
// =============================================

function loadJSON(filePath, defaultValue) {
    if (!fs.existsSync(filePath)) return defaultValue;
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
    catch { return defaultValue; }
}

function saveJSON(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function makeId(rawId, source) {
    const base = rawId || `${source}::${Math.random()}`;
    return String(base).replace(/\s+/g, '_').substring(0, 150);
}

/** Filtre avec word boundary pour éviter les faux positifs */
function containsNegativeKeyword(title = '') {
    return NEGATIVE_KEYWORD_PATTERNS.some(pattern => pattern.test(title));
}

/**
 * Normalise une URL pour la déduplication cross-sources.
 * Retire le protocole, www, trailing slash, et query params de tracking.
 */
function normalizeUrl(url = '') {
    try {
        const u = new URL(url);
        // Supprimer les query params de tracking courants
        ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source'].forEach(p => u.searchParams.delete(p));
        return `${u.hostname.replace('www.', '')}${u.pathname}`.replace(/\/$/, '').toLowerCase();
    } catch {
        return url.toLowerCase().trim();
    }
}

function makeLeadEntry({ id, source, title, url, created_at, preview, type = 'job', extra_data = null }) {
    const entry = { id, source, title, url, created_at, preview, type, qualified: false, scraped_at: new Date().toISOString() };
    if (extra_data) entry.extra_data = extra_data;
    return entry;
}

/**
 * Charge les seen_ids avec TTL.
 * Retourne { seenIds: Set<string>, seenUrls: Set<string>, rawMap: Object }
 */
function loadSeenIds() {
    const raw = loadJSON(SEEN_IDS_FILE, {});
    const now = Date.now();
    const seenIds = new Set();
    const seenUrls = new Set();
    const freshMap = {};

    // Support ancien format (tableau simple) et nouveau (map {id: {ts, url}})
    if (Array.isArray(raw)) {
        // Migration depuis l'ancien format
        raw.forEach(id => {
            seenIds.add(id);
            freshMap[id] = { ts: now }; // Pas de date connue, on leur donne maintenant
        });
    } else {
        for (const [id, meta] of Object.entries(raw)) {
            const age = now - (meta.ts || 0);
            if (age < SEEN_IDS_TTL_MS) {
                seenIds.add(id);
                if (meta.url) seenUrls.add(normalizeUrl(meta.url));
                freshMap[id] = meta;
            }
            // IDs expirés : non ajoutés → nettoyés automatiquement
        }
    }

    console.log(`📂 ${seenIds.size} IDs connus (TTL 30j appliqué)`);
    return { seenIds, seenUrls, rawMap: freshMap };
}

function saveSeenIds(rawMap) {
    saveJSON(SEEN_IDS_FILE, rawMap);
}

/**
 * Purge la queue :
 * - Supprime les leads qualifiés depuis plus de QUEUE_PURGE_AGE_MS
 * - Conserve tous les leads non encore qualifiés (en attente de phase 2)
 */
function purgeQueue(queue) {
    const now = Date.now();
    const before = queue.length;
    const purged = queue.filter(lead => {
        if (!lead.qualified) return true; // Jamais supprimer les leads en attente
        const age = now - new Date(lead.scraped_at || lead.created_at).getTime();
        return age < QUEUE_PURGE_AGE_MS;
    });
    const removed = before - purged.length;
    if (removed > 0) console.log(`🧹 Queue purgée : ${removed} leads qualifiés anciens supprimés`);
    return purged;
}

// =============================================
// 1. SCRAPING RSS
// =============================================
async function scrapeRSS(seenIds, seenUrls, rawMap) {
    const newLeads = [];
    console.log('\n📡 [Phase 1A] Scraping RSS...');

    for (const source of RSS_SOURCES) {
        try {
            const feed = await parser.parseURL(source.url);
            let added = 0, rejected = 0, skipped = 0, dupeUrl = 0;

            for (const item of feed.items) {
                const title = item.title?.trim() || '(sans titre)';
                if (containsNegativeKeyword(title)) { rejected++; continue; }

                const id  = makeId(item.guid || item.id, source.name);
                const url = item.link || '';
                const normUrl = normalizeUrl(url);

                // Déduplication par ID ET par URL normalisée (cross-sources)
                if (seenIds.has(id))       { skipped++; continue; }
                if (normUrl && seenUrls.has(normUrl)) { dupeUrl++; continue; }

                seenIds.add(id);
                if (normUrl) seenUrls.add(normUrl);
                rawMap[id] = { ts: Date.now(), url };
                added++;

                newLeads.push(makeLeadEntry({
                    id, source: source.name, title, url,
                    created_at: item.isoDate || item.pubDate || new Date().toISOString(),
                    preview: item.contentSnippet || item.content || '',
                }));
            }
            console.log(`   ${source.name}: +${added} nouveaux (${skipped} connus, ${rejected} filtrés, ${dupeUrl} dupes URL)`);
        } catch (err) {
            console.error(`   ❌ ${source.name}: ${err.message}`);
        }
        await sleep(1200);
    }
    return newLeads;
}

// =============================================
// 2. SCRAPING REDDIT
// =============================================
async function scrapeReddit(seenIds, seenUrls, rawMap) {
    const newLeads = [];
    console.log('\n👽 [Phase 1B] Scraping Reddit...');

    // Flairs qui indiquent une offre d'emploi (côté employeur)
    const HIRING_FLAIRS = ['hiring', 'for hire', 'job offer', 'paid'];

    for (const sub of SUBREDDITS) {
        try {
            const resp = await fetch(`https://www.reddit.com/r/${sub}/new.json?limit=50`, {
                headers: { 'User-Agent': 'FreelancerBountyBot/2.0' }
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            let added = 0, rejected = 0;

            for (const p of data.data.children) {
                const post  = p.data;
                const title = post.title || '';
                const flair = (post.link_flair_text || '').toLowerCase();

                // Filtrage amélioré : vérifier le flair OU le mot [HIRING] dans le titre
                // Sur r/remotejs, on prend tout (pas de flair standard)
                const isHiringPost =
                    sub === 'remotejs' ||
                    HIRING_FLAIRS.some(f => flair.includes(f)) ||
                    /\[hiring\]/i.test(title) ||
                    title.toLowerCase().startsWith('hiring');

                if (!isHiringPost) continue;
                if (containsNegativeKeyword(title)) { rejected++; continue; }

                const id = `reddit::${post.id}`;
                const url = `https://www.reddit.com${post.permalink}`;
                const normUrl = normalizeUrl(url);

                if (seenIds.has(id) || seenUrls.has(normUrl)) continue;

                seenIds.add(id);
                seenUrls.add(normUrl);
                rawMap[id] = { ts: Date.now(), url };
                added++;

                newLeads.push(makeLeadEntry({
                    id, source: `r/${sub}`, title: post.title,
                    url,
                    created_at: new Date(post.created_utc * 1000).toISOString(),
                    preview: post.selftext || '',
                }));
            }
            console.log(`   r/${sub}: +${added} (${rejected} filtrés)`);
        } catch (err) {
            console.error(`   ❌ r/${sub}: ${err.message}`);
        }
        await sleep(800);
    }
    return newLeads;
}

// =============================================
// 3. API JOBICY
// =============================================
async function scrapeJobicy(seenIds, seenUrls, rawMap) {
    const newLeads = [];
    console.log('\n💼 [Phase 1C] API Jobicy...');
    try {
        const resp = await axios.get('https://jobicy.com/api/v2/remote-jobs', {
            params: { count: 50 },
            headers: HTTP_HEADERS,
            timeout: 15000,
        });
        const jobs = resp.data.jobs || [];
        let added = 0, rejected = 0, dupeUrl = 0;

        for (const job of jobs) {
            const title = job.jobTitle || '(sans titre)';
            if (containsNegativeKeyword(title)) { rejected++; continue; }

            const id = `jobicy-${job.id}`;
            const url = job.url || '';
            const normUrl = normalizeUrl(url);

            if (seenIds.has(id) || (normUrl && seenUrls.has(normUrl))) { dupeUrl++; continue; }

            seenIds.add(id);
            if (normUrl) seenUrls.add(normUrl);
            rawMap[id] = { ts: Date.now(), url };
            added++;

            newLeads.push(makeLeadEntry({
                id, source: 'Jobicy', title, url,
                created_at: job.pubDate ? new Date(job.pubDate).toISOString() : new Date().toISOString(),
                preview: job.jobExcerpt || '',
                type: 'job_deep',  // Phase 2 doit scraper la page HTML
            }));
        }
        console.log(`   Jobicy: +${added} nouveaux (${rejected} filtrés, ${dupeUrl} dupes)`);
    } catch (err) {
        console.error(`   ❌ Jobicy API: ${err.message}`);
    }
    return newLeads;
}

// =============================================
// 4. API REMOTIVE
// =============================================
async function scrapeRemotive(seenIds, seenUrls, rawMap) {
    const newLeads = [];
    console.log('\n🌐 [Phase 1D] API Remotive...');
    try {
        const resp = await axios.get('https://remotive.com/api/remote-jobs', {
            params: { limit: 50 },
            headers: HTTP_HEADERS,
            timeout: 15000,
        });
        const jobs = resp.data.jobs || [];
        let added = 0, rejected = 0, dupeUrl = 0;

        for (const job of jobs) {
            const title = job.title || '(sans titre)';
            if (containsNegativeKeyword(title)) { rejected++; continue; }

            const id = `remotive-${job.id}`;
            const url = job.url || '';
            const normUrl = normalizeUrl(url);

            if (seenIds.has(id) || (normUrl && seenUrls.has(normUrl))) { dupeUrl++; continue; }

            seenIds.add(id);
            if (normUrl) seenUrls.add(normUrl);
            rawMap[id] = { ts: Date.now(), url };
            added++;

            newLeads.push(makeLeadEntry({
                id, source: 'Remotive', title, url,
                created_at: job.publication_date ? new Date(job.publication_date).toISOString() : new Date().toISOString(),
                preview: (job.description || '').replace(/<[^>]*>/g, '').substring(0, 800),
                type: 'job_deep',
            }));
        }
        console.log(`   Remotive: +${added} nouveaux (${rejected} filtrés, ${dupeUrl} dupes)`);
    } catch (err) {
        console.error(`   ❌ Remotive API: ${err.message}`);
    }
    return newLeads;
}

// =============================================
// 5. API DEVPOST (Hackathons)
// =============================================
async function scrapeDevpost(seenIds, seenUrls, rawMap) {
    const newLeads = [];
    console.log('\n🏆 [Phase 1E] API Devpost (Hackathons)...');
    const MAX_PAGES = 3;

    for (let page = 1; page <= MAX_PAGES; page++) {
        try {
            const resp = await axios.get('https://devpost.com/api/hackathons', {
                params: { page, per_page: 24, status: 'open', order_by: 'deadline', sort_by: 'asc' },
                headers: { ...HTTP_HEADERS, 'User-Agent': 'Mozilla/5.0 (compatible; BountyHunterBot/2.0)' },
                timeout: 10000,
            });
            const hackathons = resp.data.hackathons || [];
            if (!hackathons.length) break;

            let added = 0;
            for (const hack of hackathons) {
                const id = `devpost-${hack.id}`;
                const url = hack.url || `https://devpost.com/hackathons/${hack.id}`;
                const normUrl = normalizeUrl(url);

                if (seenIds.has(id) || seenUrls.has(normUrl)) continue;

                seenIds.add(id);
                seenUrls.add(normUrl);
                rawMap[id] = { ts: Date.now(), url };
                added++;

                const stripHtml = s => (s || '').replace(/<[^>]*>/g, '').trim();
                const prizeStr  = stripHtml(hack.prize_amount || '');
                const location  = hack.displayed_location?.location || 'En ligne';
                const dates     = hack.submission_period_dates || '';
                let preview     = `Hackathon ${location}.`;
                if (prizeStr) preview += ` Prix : ${prizeStr}.`;
                if (dates)    preview += ` Dates : ${dates}.`;

                newLeads.push(makeLeadEntry({
                    id, source: 'Devpost',
                    title: `[Hackathon] ${hack.title}`,
                    url,
                    created_at: new Date().toISOString(),
                    preview,
                    type: 'hackathon',
                }));
            }
            console.log(`   Devpost page ${page}: +${added} hackathons`);
            await sleep(800);
        } catch (err) {
            console.error(`   ❌ Devpost page ${page}: ${err.message}`);
        }
    }
    return newLeads;
}

// =============================================
// 6. GITHUB BOUNTIES (via GraphQL)
// =============================================
async function scrapeGitHub(seenIds, seenUrls, rawMap) {
    const newLeads = [];
    console.log('\n💻 [Phase 1F] GitHub Bounties (GraphQL)...');

    if (!process.env.GITHUB_TOKEN) {
        console.warn('   ⚠️  GITHUB_TOKEN non défini. Scraping GitHub ignoré.');
        return newLeads;
    }

    const query = `
      query($cursor: String) {
        search(query: "label:bounty,reward,paid state:open type:issue", type: ISSUE, first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            ... on Issue {
              id title url state createdAt bodyText
              comments { totalCount }
              repository { nameWithOwner stargazerCount pushedAt }
            }
          }
        }
      }
    `;

    let hasNextPage = true;
    let cursor = null;
    let pageCount = 0;
    const MAX_PAGES = 10;
    let totalAdded = 0, totalSkipped = 0;

    while (hasNextPage && pageCount < MAX_PAGES) {
        try {
            const resp = await axios.post(
                'https://api.github.com/graphql',
                { query, variables: { cursor } },
                {
                    headers: {
                        'Authorization': `bearer ${process.env.GITHUB_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 15000,
                }
            );

            if (resp.data.errors) throw new Error(JSON.stringify(resp.data.errors));

            const searchData = resp.data.data?.search;
            const nodes = searchData?.nodes || [];
            pageCount++;

            for (const issue of nodes) {
                if (!issue?.repository) continue;

                const repo = issue.repository;
                const daysSincePush = (Date.now() - new Date(repo.pushedAt)) / (1000 * 60 * 60 * 24);
                if (repo.stargazerCount < 2 || daysSincePush > 365) { totalSkipped++; continue; }

                const id = `github::${issue.id}`;
                const url = issue.url;
                const normUrl = normalizeUrl(url);

                if (seenIds.has(id) || seenUrls.has(normUrl)) continue;

                seenIds.add(id);
                seenUrls.add(normUrl);
                rawMap[id] = { ts: Date.now(), url };
                totalAdded++;

                newLeads.push(makeLeadEntry({
                    id, source: 'GitHub',
                    title: `[Bounty] ${issue.title}`,
                    url,
                    created_at: issue.createdAt,
                    preview: (issue.bodyText || '').substring(0, 800),
                    type: 'bounty',
                    extra_data: { comments: issue.comments?.totalCount || 0 },
                }));
            }

            hasNextPage = searchData?.pageInfo?.hasNextPage || false;
            cursor      = searchData?.pageInfo?.endCursor || null;
            console.log(`   GitHub page ${pageCount}/${MAX_PAGES}: +${nodes.length} issues (cumulé: ${totalAdded})`);
            await sleep(500);

        } catch (err) {
            console.error(`   ❌ GitHub GraphQL page ${pageCount + 1}: ${err.message}`);
            break;
        }
    }

    console.log(`   GitHub total: +${totalAdded} bounties valides (${totalSkipped} inactifs filtrés)`);
    return newLeads;
}

// =============================================
// MAIN
// =============================================
async function scrape() {
    console.log(`\n🚀 [Phase 1] Démarrage collecteur unifié — ${new Date().toLocaleString()}`);

    const { seenIds, seenUrls, rawMap } = loadSeenIds();
    const existingQueue = loadJSON(QUEUE_FILE, []);

    // Purge des leads qualifiés anciens
    const cleanedQueue = purgeQueue(existingQueue);

    // Lancer toutes les sources
    const githubLeads   = await scrapeGitHub(seenIds, seenUrls, rawMap);
    const rssLeads      = await scrapeRSS(seenIds, seenUrls, rawMap);
    const redditLeads   = await scrapeReddit(seenIds, seenUrls, rawMap);
    const jobicyLeads   = await scrapeJobicy(seenIds, seenUrls, rawMap);
    const remotiveLeads = await scrapeRemotive(seenIds, seenUrls, rawMap);
    const devpostLeads  = await scrapeDevpost(seenIds, seenUrls, rawMap);

    const allNew = [...githubLeads, ...rssLeads, ...redditLeads, ...jobicyLeads, ...remotiveLeads, ...devpostLeads];

    // Sauvegarder
    saveJSON(QUEUE_FILE, [...cleanedQueue, ...allNew]);
    saveSeenIds(rawMap);

    console.log(`\n✅ [Phase 1] Terminé.`);
    console.log(`   Nouveaux : RSS=${rssLeads.length} | Reddit=${redditLeads.length} | Jobicy=${jobicyLeads.length} | Remotive=${remotiveLeads.length} | Devpost=${devpostLeads.length} | GitHub=${githubLeads.length}`);
    console.log(`   Total ajoutés : ${allNew.length} | File totale : ${cleanedQueue.length + allNew.length}\n`);

    return allNew.length;
}

scrape().catch(err => {
    console.error('💥 Erreur critique Phase 1:', err);
    process.exit(1);
});

module.exports = { scrape };
