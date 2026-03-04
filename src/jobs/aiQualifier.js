/**
 * ═══════════════════════════════════════════════════════════════════════
 *  AI QUALIFIER — Qualification IA des leads
 *  - Convertit le HTML en Markdown propre avant envoi à l'IA (~70% moins de tokens)
 *  - Contact = coordonnées DIRECTES du client final (pas de liens plateformes)
 *  - Retry automatique sur erreur réseau / 429
 * ═══════════════════════════════════════════════════════════════════════
 */

const { OpenAI } = require('openai');
const axios = require('axios');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Optional: jsonrepair for robust JSON parsing
let jsonrepair;
try { jsonrepair = require('jsonrepair').jsonrepair; } catch { }

// === CONFIGURATION IA ===
const PRIMARY_MODEL = process.env.AI_MODEL || 'google/gemma-3-27b-it:free';
const FALLBACK_MODELS = [
    'google/gemma-3-27b-it:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'qwen/qwen-2.5-72b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
    'microsoft/phi-3-medium-128k-instruct:free',
    'openrouter/free',
];

const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
        'HTTP-Referer': process.env.APP_URL || 'https://localhost',
        'X-Title': 'LeadQualifier',
    },
});

const HTTP_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
};

const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
});

const USELESS_TAGS = ['script', 'style', 'nav', 'header', 'footer', 'iframe', 'noscript', 'svg', 'img', 'form', 'button'];

const PLATFORM_DOMAINS = [
    'remoteok.com', 'weworkremotely.com', 'remotive.com', 'jobicy.com',
    'reddit.com', 'devpost.com', 'linkedin.com', 'indeed.com',
    'glassdoor.com', 'wellfound.com', 'angel.co', 'simplyhired.com',
    'ziprecruiter.com', 'monster.com', 'lever.co', 'greenhouse.io',
    'workable.com', 'bamboohr.com', 'ashbyhq.com', 'smartrecruiters.com',
];

function isPlatformLink(url = '') {
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

function htmlToMarkdown(html = '', maxChars = 4000) {
    if (!html) return { markdown: '', rawText: '' };
    const $ = cheerio.load(html);
    USELESS_TAGS.forEach(tag => $(tag).remove());
    const rawText = $.root().text().replace(/\s+/g, ' ').trim();
    let md = turndown.turndown($.html());
    md = md.replace(/\n{3,}/g, '\n\n').trim();
    if (md.length > maxChars) {
        const truncated = md.substring(0, maxChars);
        const lastNewline = truncated.lastIndexOf('\n');
        md = (lastNewline > maxChars * 0.8 ? truncated.substring(0, lastNewline) : truncated)
            + '\n\n*[contenu tronqué]*';
    }
    return { markdown: md, rawText };
}

async function scrapeJobPage(url) {
    const empty = { markdown: '', rawHtml: '', rawText: '', directLinks: [] };
    try {
        if (!url || !url.startsWith('http')) return empty;
        const response = await axios.get(url, {
            headers: HTTP_HEADERS,
            timeout: 20000,
            validateStatus: s => s === 200,
        });
        const contentType = response.headers['content-type'] || '';
        if (!contentType.includes('text/html')) {
            console.warn(`⚠️  [Scraper] Content-Type inattendu (${contentType}) pour ${url}`);
            return empty;
        }
        const $ = cheerio.load(response.data);
        const container = $('.job__desc, .job-description, section.tw-mt-16, [class*="description"], main, article, body').first();
        const directLinks = [];
        container.find('a').each((_, el) => {
            const href = $(el).attr('href');
            if (href && href.startsWith('http') && !isPlatformLink(href)) {
                directLinks.push(href);
            }
        });
        const rawHtml = container.html() || '';
        const { markdown, rawText } = htmlToMarkdown(rawHtml, 4000);
        return { markdown, rawHtml, rawText, directLinks: [...new Set(directLinks)] };
    } catch (err) {
        console.warn(`⚠️  [Scraper] Impossible de scraper ${url}: ${err.message}`);
        return empty;
    }
}

function extractEmails(rawContent = '') {
    const EMAIL_REGEX = /([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/g;
    const BLACKLIST = ['.png', '.jpg', '.gif', '.svg', 'sentry', 'w3.org', 'example.com', 'schema.org', '@2x'];
    const found = rawContent.match(EMAIL_REGEX) || [];
    return [...new Set(found)].filter(email =>
        !BLACKLIST.some(b => email.toLowerCase().includes(b))
    );
}

function sanitizeForPrompt(str) {
    if (!str) return '';
    return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

function extractValidJSON(rawResponse) {
    if (!rawResponse) return null;
    let cleaned = rawResponse.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(cleaned); } catch { }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
        const candidate = cleaned.substring(start, end + 1);
        try { return JSON.parse(candidate); } catch { }
        try {
            const repaired = candidate.replace(/(?<!\\)"/g, '\\"').replace(/(?<!\\)\n/g, '\\n').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
            return JSON.parse(repaired);
        } catch { }
    }
    if (jsonrepair) {
        try { return JSON.parse(jsonrepair(cleaned)); } catch { }
    }
    return null;
}

async function withRetry(fn, maxRetries = 3, baseDelay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try { return await fn(); }
        catch (error) {
            const isRetryable = error.status === 429 || error.status >= 500 || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
            if (!isRetryable || attempt === maxRetries) throw error;
            const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500;
            console.warn(`⚠️  [Retry] Tentative ${attempt}/${maxRetries} dans ${Math.round(delay)}ms...`);
            await new Promise(res => setTimeout(res, delay));
        }
    }
}

async function qualifyLeadWithAI(lead, scrapedContent = null) {
    console.log(`🧠 Qualification IA : ${lead.title}`);
    const rawForEmails = (scrapedContent?.rawHtml || '') + ' ' + (scrapedContent?.rawText || '') + ' ' + (lead.preview || '');
    const emailsFound = extractEmails(rawForEmails);
    const emailsInfo = emailsFound.length > 0 ? `Emails détectés dans la source : ${emailsFound.join(', ')}` : `Statut email : AUCUN EMAIL DÉTECTÉ.`;
    const markdownContent = scrapedContent?.markdown || '';
    const previewContent = lead.preview || '';
    const directLinks = scrapedContent?.directLinks || [];
    const contentForPrompt = markdownContent || previewContent;
    const contextBlock = markdownContent
        ? `Description de l'offre (Markdown) :\n\`\`\`markdown\n${markdownContent}\n\`\`\`\nLiens directs détectés (hors plateformes) :\n${directLinks.join('\n') || '(aucun)'}`
        : `Contenu de l'annonce :\n"""\n${previewContent}\n"""`;

    try {
        const prompt = `Tu es un expert en recrutement technique ultra-sélectif sur le marché FRANCOPHONE.
Ton rôle est DOUBLE : (1) filtrer les offres non sérieuses, (2) générer une FICHE QUALIFIÉE ultra-détaillée pour les bonnes offres.

=== SOURCE DE L'ANNONCE ===
Plateforme source : ${sanitizeForPrompt(lead.source)}
Type : ${sanitizeForPrompt(lead.type)}
Titre : ${sanitizeForPrompt(lead.title)}
URL originale : ${sanitizeForPrompt(lead.url)}
Publié le : ${sanitizeForPrompt(lead.created_at)}

${emailsInfo}

${contextBlock}

=== RÈGLES ABSOLUES ===

RÈGLE 1 — CONTACT DIRECT CLIENT FINAL (CRITIQUE) :
L'objectif est de mettre en relation directe avec le CLIENT FINAL, pas de renvoyer vers la plateforme source.
- Ne jamais utiliser les URLs des plateformes comme contact (remoteok.com, weworkremotely.com, remotive.com, jobicy.com, reddit.com, linkedin.com, indeed.com, etc.)
- "external_link" doit être un formulaire de candidature DIRECT sur le site de l'entreprise, ou null
- "website" doit être le site officiel de l'entreprise, pas sa page sur une plateforme
- "email" doit être l'email DIRECT de recrutement de l'entreprise (RH, hiring manager), pas un email générique de plateforme
- POUR LES BOUNTIES GitHub : le contact valide est l'URL de l'issue GitHub elle-même. Mets "external_link": "${sanitizeForPrompt(lead.url)}", "website": domaine du repo, "email": null. Ne rejette JAMAIS un bounty pour absence d'email.
- POUR LES AUTRES SOURCES : si AUCUN contact direct n'est identifiable (email OU formulaire direct OU site officiel avec page carrière), retourne "contact": {} pour déclencher le rejet.

RÈGLE 2 — REJET STRICT :
Rejette (contact: {}) si :
- Aucun moyen de contacter directement l'entreprise sans passer par la plateforme source
- L'offre ressemble à un scam (is_scam: true)
- L'offre est trop vague pour être qualifiable

RÈGLE 3 — CORRECTION D'URL :
Corrige toute URL malformée (hxxps://, manque de protocole, etc.) en URL valide https://.

=== FORMAT DE RÉPONSE JSON STRICT ===
{
  "title": "Titre propre (sans préfixes [HIRING], [FOR HIRE], etc.)",
  "source": "${sanitizeForPrompt(lead.source)}",
  "url": "${sanitizeForPrompt(lead.url)}",
  "created_at": "${sanitizeForPrompt(lead.created_at)}",
  "is_scam": false,
  "urgency": false,
  "contact": {
    "email": "email@entreprise.com ou null — JAMAIS un email de plateforme",
    "telegram": null,
    "discord": null,
    "external_link": "URL formulaire DIRECT entreprise ou URL issue GitHub ou null",
    "website": "https://site-officiel-entreprise.com   ou null"
  },
  "labels": ["Tag1", "Tag2"],
  "enriched": {
    "company": "Nom de l'entreprise",
    "salary": {
      "min": null,
      "max": null,
      "currency": "USD | EUR | GBP | RTC | SOL | BTC | ETH | null",
      "unit": "hour | year | month | project | null",
      "notes": "ex: 140 000 - 157 000 USD/an, ou 'Non spécifié'"
    },
    "location": {
      "remote": true,
      "regions": ["USA", "Europe", "Monde"]
    },
    "originalLanguage": "Anglais | Français | Espagnol | Allemand | etc.",
    "contractType": "CDI | Freelance | CDD | Temps partiel | Mission",
    "experienceRequired": {
      "minYears": null,
      "level": "junior | intermédiaire | senior | lead"
    },
    "summary": "Résumé accrocheur en 2-3 phrases en FRANÇAIS",
    "responsibilities": ["Responsabilité clé 1 en FRANÇAIS"],
    "requiredProfile": ["Compétence ou expérience requise 1 en FRANÇAIS"],
    "disqualifiers": ["Critère éliminatoire 1 en FRANÇAIS"],
    "keyBenefits": ["Avantage notable 1 en FRANÇAIS"],
    "applicationProcess": "Description du processus de candidature en FRANÇAIS"
  }
}

Instructions finales :
- "contact": {} (objet vide) si aucun contact direct trouvable → rejet automatique
- "labels" = 5 à 8 tags techniques PERTINENTS (anglais si usage technique standard)
- "urgency": true UNIQUEMENT si l'annonce contient "urgent", "ASAP", "immediate start"
- "currency": accepte chaque crypto mentionnée (RTC, SOL, USDC, BTC, etc.)
- Champ inconnu → null (jamais chaîne vide)
- Tout l'objet "enriched" en FRANÇAIS professionnel`;

        const messages = [
            { role: 'system', content: 'Réponds uniquement en JSON valide et bien formé, sans texte explicatif ni balises markdown. Langue de l\'objet enriched : Français.' },
            { role: 'user', content: prompt }
        ];

        const estimatedTokens = Math.min(4000, 2000 + Math.floor((contentForPrompt?.length || 0) / 4));

        const response = await withRetry(() =>
            openai.chat.completions.create({
                model: PRIMARY_MODEL,
                messages,
                max_tokens: estimatedTokens,
                response_format: { type: 'json_object' },
                extra_body: {
                    models: FALLBACK_MODELS,
                    plugins: [{ id: 'response-healing' }],
                    require_parameters: true,
                },
                timeout: 45000,
            })
        );

        const usedModel = response.model || PRIMARY_MODEL;
        if (usedModel !== PRIMARY_MODEL) {
            console.log(`   ↩️  [AI Fallback] Modèle utilisé : ${usedModel} (primaire: ${PRIMARY_MODEL})`);
        }

        const finishReason = response.choices[0].finish_reason;
        if (finishReason === 'length') {
            console.warn(`⚠️  [AI] Réponse tronquée (finish_reason=length) pour : ${lead.title.substring(0, 50)}`);
        }

        const raw = response.choices[0].message.content.replace(/```json|```/g, '').trim();
        const result = extractValidJSON(raw);

        if (!result) {
            if (process.env.DEBUG_AI === 'true') console.log('🔍 RAW AI RESPONSE:', raw.substring(0, 500) + '...');
            throw new Error('Impossible de parser la réponse JSON de l\'IA');
        }

        if (result.contact && typeof result.contact === 'object') {
            if (result.contact.external_link && isPlatformLink(result.contact.external_link)) {
                console.warn(`⚠️  [AI] external_link plateforme détecté et supprimé : ${result.contact.external_link}`);
                result.contact.external_link = null;
            }
            if (result.contact.website && isPlatformLink(result.contact.website)) {
                console.warn(`⚠️  [AI] website plateforme détecté et supprimé : ${result.contact.website}`);
                result.contact.website = null;
            }
        }

        return result;

    } catch (error) {
        console.error(`❌ Erreur IA (primaire + fallback) sur "${lead.title}":`, error.message);
        return {
            title: lead.title,
            source: lead.source,
            url: lead.url,
            created_at: lead.created_at,
            is_scam: false,
            urgency: false,
            ai_error: true,
            contact: {},
            labels: [],
            enriched: {
                company: 'Inconnue',
                salary: { min: null, max: null, currency: null, unit: null, notes: 'Erreur IA' },
                location: { remote: true, regions: [] },
                originalLanguage: null,
                contractType: null,
                experienceRequired: { minYears: null, level: null },
                summary: 'Erreur lors de la qualification IA.',
                responsibilities: [],
                requiredProfile: [],
                disqualifiers: [],
                keyBenefits: [],
                applicationProcess: null,
            },
        };
    }
}

module.exports = { qualifyLeadWithAI, scrapeJobPage };