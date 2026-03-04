/**
 * ═══════════════════════════════════════════════════════════════════════
 *  PHASE 2 — QUALIFICATEUR IA
 *
 *  v4 — Règle stricte : EMAIL OBLIGATOIRE (sauf GitHub issues/PR)
 *  - Un website seul NE suffit plus pour valider un lead
 *  - Un external_link seul NE suffit plus (sauf bounty GitHub)
 *  - Telegram/Discord NE suffisent plus
 *  - Validation en 4 couches : null → ai_error → sanitize → email requis
 *  - Détection et suppression des liens plateformes résiduels
 *  - Métriques de rejet détaillées par raison
 *  - Race condition corrigée (index atomique partagé)
 *  - Sauvegarde incrémentale (zéro perte si crash)
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { qualifyLeadWithAI, scrapeJobPage } = require('./aiQualifier');
const { calculateLeadScore } = require('./leadScoringAlgo');

// === FICHIERS DE DONNÉES ===
const QUEUE_FILE = path.join(__dirname, 'data', 'queue.json');
const RESULTS_FILE = path.join(__dirname, 'data', 'leads_qualified.json');

// === CONFIG WORKERS ===
const WORKER_COUNT = 23;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// =============================================
// GARDE-FOUS CONTACT — Domaines plateformes interdits
// Ces domaines ne sont JAMAIS des contacts directs valides
// =============================================
const PLATFORM_DOMAINS = [
    'remoteok.com', 'weworkremotely.com', 'remotive.com', 'jobicy.com',
    'reddit.com', 'devpost.com', 'linkedin.com', 'indeed.com',
    'glassdoor.com', 'wellfound.com', 'angel.co', 'simplyhired.com',
    'ziprecruiter.com', 'monster.com', 'lever.co', 'greenhouse.io',
    'workable.com', 'bamboohr.com', 'ashbyhq.com', 'smartrecruiters.com',
];

/**
 * Vérifie si une URL appartient à une plateforme intermédiaire.
 *
 * Cas spécial GitHub :
 * - github.com/user/repo/issues/123  → VALIDE  (contact direct d'un bounty)
 * - github.com/user/repo/pull/42     → VALIDE  (contact direct d'un bounty)
 * - github.com/user/repo             → INVALIDE (page repo = pas un contact)
 * - github.com/user                  → INVALIDE (profil = pas un contact)
 */
function isPlatformUrl(url = '') {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.replace('www.', '');

        if (hostname === 'github.com') {
            const isIssueOrPR = /^\/[^/]+\/[^/]+\/(issues|pull)\/\d+/.test(parsed.pathname);
            return !isIssueOrPR;
        }

        return PLATFORM_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`));
    } catch {
        return false;
    }
}

/**
 * Détecte si un lien est une issue/PR GitHub valide pour un bounty
 */
function isValidGitHubBountyLink(url = '') {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.replace('www.', '');
        if (hostname === 'github.com') {
            return /^\/[^/]+\/[^/]+\/(issues|pull)\/\d+/.test(parsed.pathname);
        }
    } catch { }
    return false;
}

/**
 * Nettoie l'objet contact :
 * - Supprime les liens de plateformes intermédiaires
 * - Supprime les chaînes vides
 * Retourne { cleaned, stripped } où stripped = nombre de champs supprimés
 */
function sanitizeContact(contact = {}) {
    if (typeof contact !== 'object' || contact === null) return { cleaned: {}, stripped: 0 };

    const cleaned = { ...contact };
    let stripped = 0;

    if (cleaned.external_link && isPlatformUrl(cleaned.external_link)) {
        console.warn(`   🛡️  [Garde-fou] external_link plateforme supprimé : ${cleaned.external_link}`);
        cleaned.external_link = null;
        stripped++;
    }

    if (cleaned.website && isPlatformUrl(cleaned.website)) {
        console.warn(`   🛡️  [Garde-fou] website plateforme supprimé : ${cleaned.website}`);
        cleaned.website = null;
        stripped++;
    }

    Object.keys(cleaned).forEach(k => {
        if (cleaned[k] === '') cleaned[k] = null;
    });

    return { cleaned, stripped };
}

/**
 * Valide qu'un lead a un EMAIL de contact (RÈGLE STRICTE).
 *
 * EXCEPTION UNIQUE :
 * - Bounty GitHub avec lien d'issue/PR valide → accepté sans email
 *
 * TOUT LE RESTE :
 * - email OBLIGATOIRE (sinon rejeté)
 * - external_link seul → REJETÉ
 * - website seul → REJETÉ
 * - telegram/discord seul → REJETÉ
 *
 * @param {Object} contact
 * @param {string} type
 * @param {string|null} externalLink
 * @returns {{ valid: boolean, reason: string }}
 */
function validateContact(contact, type = 'job', externalLink = null) {
    if (!contact || typeof contact !== 'object' || Object.keys(contact).length === 0) {
        return { valid: false, reason: 'contact_empty' };
    }

    // EXCEPTION : Bounty GitHub avec issue/PR valide
    const isGitHubBounty = type === 'bounty' && isValidGitHubBountyLink(externalLink);
    if (isGitHubBounty) {
        return { valid: true, reason: 'ok_github_bounty' };
    }

    // RÈGLE STRICTE : email obligatoire pour TOUT le reste
    if (contact.email && typeof contact.email === 'string' && contact.email.includes('@')) {
        return { valid: true, reason: 'ok' };
    }

    // Pas d'email → rejet (peu importe le reste)
    if (contact.website) return { valid: false, reason: 'website_only' };
    if (contact.external_link) return { valid: false, reason: 'link_no_email' };
    if (contact.telegram || contact.discord) return { valid: false, reason: 'social_no_email' };

    return { valid: false, reason: 'no_email' };
}

// =============================================
// TOKEN BUCKET — Rate limiting global
// =============================================
class TokenBucket {
    constructor(maxTokens, refillRateMs) {
        this.tokens = maxTokens;
        this.maxTokens = maxTokens;
        this.waiters = [];

        const timer = setInterval(() => {
            if (this.tokens < this.maxTokens) {
                this.tokens++;
                const next = this.waiters.shift();
                if (next) next();
            }
        }, refillRateMs);
        timer.unref();
    }

    async acquire() {
        if (this.tokens > 0) { this.tokens--; return; }
        await new Promise(resolve => this.waiters.push(resolve));
        this.tokens--;
    }
}

const bucket = new TokenBucket(WORKER_COUNT, 100);

// =============================================
// HELPERS JSON
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

// =============================================
// MÉTRIQUES DE REJET
// =============================================
const rejectionMetrics = {
    validated: 0,
    no_contact_empty: 0,
    no_email_required: 0,        // ← NOUVEAU : pas d'email (règle stricte)
    no_contact_website_only: 0,
    no_contact_link_no_email: 0, // external_link sans email
    no_contact_social_no_email: 0, // telegram/discord sans email
    no_contact_bounty: 0,
    platform_links_stripped: 0,
    ai_error: 0,
    max_retries: 0,
};

function logMetrics() {
    const rejected =
        rejectionMetrics.no_contact_empty +
        rejectionMetrics.no_email_required +
        rejectionMetrics.no_contact_website_only +
        rejectionMetrics.no_contact_link_no_email +
        rejectionMetrics.no_contact_social_no_email +
        rejectionMetrics.no_contact_bounty +
        rejectionMetrics.ai_error +
        rejectionMetrics.max_retries;
    const total = rejectionMetrics.validated + rejected;
    const pct = v => total > 0 ? ` (${Math.round(v / total * 100)}%)` : '';

    console.log(`\n📊 Métriques de qualification :`);
    console.log(`   ✅ Validés                : ${rejectionMetrics.validated}${pct(rejectionMetrics.validated)}`);
    console.log(`   ❌ Contact vide (IA)      : ${rejectionMetrics.no_contact_empty}${pct(rejectionMetrics.no_contact_empty)}`);
    console.log(`   📧 Email manquant (rejet) : ${rejectionMetrics.no_email_required}${pct(rejectionMetrics.no_email_required)}`);
    console.log(`   🌐 Website seul           : ${rejectionMetrics.no_contact_website_only}${pct(rejectionMetrics.no_contact_website_only)}`);
    console.log(`   🔗 Lien sans email        : ${rejectionMetrics.no_contact_link_no_email}${pct(rejectionMetrics.no_contact_link_no_email)}`);
    console.log(`   💬 Social sans email      : ${rejectionMetrics.no_contact_social_no_email}${pct(rejectionMetrics.no_contact_social_no_email)}`);
    console.log(`   🔗 Bounty sans lien       : ${rejectionMetrics.no_contact_bounty}${pct(rejectionMetrics.no_contact_bounty)}`);
    console.log(`   🛡️  Liens plateformes ôtés : ${rejectionMetrics.platform_links_stripped}`);
    console.log(`   ⚠️  Erreur IA              : ${rejectionMetrics.ai_error}${pct(rejectionMetrics.ai_error)}`);
    console.log(`   🔁 Max retries            : ${rejectionMetrics.max_retries}${pct(rejectionMetrics.max_retries)}`);
    console.log(`   📦 Total traités          : ${total}\n`);
}

// =============================================
// APPEL IA AVEC RETRY AUTOMATIQUE
// =============================================
async function qualifyWithRetry(lead, workerId) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await bucket.acquire();

            let scrapedContent = null;
            if (lead.type === 'job_deep' && lead.url) {
                console.log(`[Worker ${workerId}] 🌐 Scraping HTML → Markdown : ${lead.url.substring(0, 60)}...`);
                scrapedContent = await scrapeJobPage(lead.url);
            }

            return await qualifyLeadWithAI(lead, scrapedContent);

        } catch (err) {
            const is429 = err.message?.includes('429') || err.status === 429;
            const isRetryable = is429 || err.message?.includes('network') || err.code === 'ECONNRESET';

            if (isRetryable && attempt < MAX_RETRIES) {
                const waitMs = Math.pow(2, attempt) * 1000;
                console.warn(`[Worker ${workerId}] ⚠️  ${is429 ? 'Rate limit 429' : 'Erreur réseau'} — retry dans ${waitMs / 1000}s (${attempt}/${MAX_RETRIES})`);
                await sleep(waitMs);
            } else {
                console.error(`[Worker ${workerId}] ❌ Échec définitif après ${attempt} tentatives: ${err.message}`);
                rejectionMetrics.max_retries++;
                return null;
            }
        }
    }
    return null;
}

// =============================================
// WORKER — Index atomique partagé
// =============================================
async function runWorker(workerId, toProcess, currentIndexRef, results, existingResults) {
    while (true) {
        const index = currentIndexRef.value++;
        if (index >= toProcess.length) break;

        const lead = toProcess[index];
        console.log(`[Worker ${workerId}] 🔍 (${index + 1}/${toProcess.length}) → ${lead.title.substring(0, 50)}...`);

        const qualified = await qualifyWithRetry(lead, workerId);

        if (!qualified) {
            await sleep(BASE_DELAY_MS);
            continue;
        }

        if (qualified.ai_error) {
            rejectionMetrics.ai_error++;
            console.log(`[Worker ${workerId}] ⚠️  Erreur IA — ignoré`);
            await sleep(BASE_DELAY_MS);
            continue;
        }

        const { cleaned, stripped } = sanitizeContact(qualified.contact);
        qualified.contact = cleaned;
        if (stripped > 0) rejectionMetrics.platform_links_stripped += stripped;

        // Validation avec email obligatoire
        const { valid, reason } = validateContact(qualified.contact, lead.type, qualified.contact?.external_link);

        if (!valid) {
            const company = qualified.enriched?.company || lead.title.substring(0, 30);
            switch (reason) {
                case 'contact_empty':
                    rejectionMetrics.no_contact_empty++;
                    break;
                case 'no_email_required':
                case 'website_only':
                case 'link_no_email':
                case 'social_no_email':
                    rejectionMetrics.no_email_required++;
                    console.log(`[Worker ${workerId}] 📧 Rejeté (pas d'email) : ${company}`);
                    break;
                case 'bounty_no_link':
                    rejectionMetrics.no_contact_bounty++;
                    break;
                default:
                    rejectionMetrics.no_email_required++;
            }
            console.log(`[Worker ${workerId}] ⏭️  Ignoré [${reason}] — ${lead.title.substring(0, 40)}`);
            await sleep(BASE_DELAY_MS);
            continue;
        }

        // Lead validé
        qualified.score = calculateLeadScore(qualified);
        qualified.qualified = true;
        results.push(qualified);
        rejectionMetrics.validated++;

        const allSorted = [...existingResults, ...results].sort((a, b) => b.score - a.score);
        saveJSON(RESULTS_FILE, allSorted);

        console.log(`[Worker ${workerId}] ✅ Score ${qualified.score} — ${qualified.title.substring(0, 40)}`);
        await sleep(BASE_DELAY_MS);
    }
}

// =============================================
// MAIN
// =============================================
async function qualify() {
    console.log(`\n🚀 [Phase 2] Démarrage qualificateur IA — ${new Date().toLocaleString()}`);

    const queue = loadJSON(QUEUE_FILE, []);
    const existingResults = loadJSON(RESULTS_FILE, []);

    const alreadyQualified = new Set(existingResults.map(l => l.id));
    const toProcess = queue.filter(l => !alreadyQualified.has(l.id) && !l.qualified);

    console.log(`📋 File totale      : ${queue.length} leads`);
    console.log(`✅ Déjà qualifiés   : ${alreadyQualified.size}`);
    console.log(`🔥 À traiter        : ${toProcess.length} leads`);
    console.log(`⚙️  Workers          : ${WORKER_COUNT} | Rate limit : 10 req/sec max\n`);

    if (toProcess.length === 0) {
        console.log('✨ Rien à qualifier. Lance d\'abord phase1_scraper.js');
        return;
    }

    const currentIndexRef = { value: 0 };
    const newResults = [];

    const workers = Array.from({ length: WORKER_COUNT }, (_, i) =>
        runWorker(i + 1, toProcess, currentIndexRef, newResults, existingResults)
    );

    await Promise.all(workers);

    const allResults = [...existingResults, ...newResults].sort((a, b) => b.score - a.score);
    saveJSON(RESULTS_FILE, allResults);

    logMetrics();
    console.log(`🎉 [Phase 2] Terminé !`);
    console.log(`   Nouveaux leads qualifiés : ${newResults.length}`);
    console.log(`   Total en base            : ${allResults.length}`);
    console.log(`   Fichier                  : ${RESULTS_FILE}\n`);
}

qualify().catch(err => {
    console.error('💥 Erreur critique Phase 2:', err);
    process.exit(1);
});