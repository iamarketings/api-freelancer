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

// === CONFIGURATION IA & FALLBACK ===

const openRouterClient = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
        'HTTP-Referer': process.env.APP_URL || 'https://localhost',
        'X-Title': 'LeadQualifier',
    },
});

const deepseekClient = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com'
});

const OPENROUTER_PRIMARY = process.env.AI_MODEL || 'deepseek/deepseek-chat';

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
        const prompt = `Tu es un expert en recrutement IT francophone.
Rendez-moi un JSON strict qualifiant l'opportunité suivante. 
SI l'offre est un scam, trop vague OU qu'il n'y a STRICTEMENT AUCUN moyen de contacter l'entreprise en direct (hors plateforme), retourne "contact": {} pour forcer le rejet.
Pour GitHub Bounties, le lien du repo/issue est un contact valide.

TITRE: ${sanitizeForPrompt(lead.title)}
SOURCE: ${sanitizeForPrompt(lead.source)}
URL: ${sanitizeForPrompt(lead.url)}
EMAILS DETECTES: ${emailsInfo}
DESCRIPTION: ${contextBlock}

FORMAT ATTENDU EXACT:
{
  "title": "Titre propre",
  "source": "${sanitizeForPrompt(lead.source)}",
  "url": "${sanitizeForPrompt(lead.url)}",
  "created_at": "${sanitizeForPrompt(lead.created_at)}",
  "is_scam": false,
  "urgency": false,
  "contact": {
    "email": "email direct entreprise ou null",
    "telegram": null,
    "discord": null,
    "external_link": "lien formulaire direct/github ou null",
    "website": "site officiel ou null"
  },
  "labels": ["tag1", "tag2"],
  "enriched": {
    "company": "Entreprise",
    "salary": { "min": null, "max": null, "currency": "USD", "unit": "year", "notes": "" },
    "location": { "remote": true, "regions": [] },
    "contractType": "CDI",
    "experienceRequired": { "minYears": null, "level": "senior" },
    "summary": "Résumé ultra complet et engageant en FRANÇAIS. Minimum 3 à 4 paragraphes détaillant: le contexte complet du projet, le rôle exact attendu, les défis techniques à relever et l'impact de la mission. Utilise un ton professionnel et accrocheur pour retenir le visiteur sur le site web.",
    "responsibilities": ["Resp 1"],
    "requiredProfile": ["Comp 1"],
    "disqualifiers": [],
    "keyBenefits": [],
    "applicationProcess": ""
  }
}

Règles: 
1. Si "contact" n'a aucune vraie piste directe (hors URLs de plateformes distantes), mets "contact": {}.
2. "labels": 3 à 5 mots-clés IT max.
3. Toujours répondre en français pour "enriched".
4. Le champ "summary" DOIT être très détaillé, descriptif, et donner envie de postuler. Ne fais pas de résumé de 2 lignes, développe le contexte au maximum.`;

        const messages = [
            { role: 'system', content: 'Réponds uniquement en JSON valide et bien formé.' },
            { role: 'user', content: prompt }
        ];

        let response = null;
        let usedProvider = '';

        try {
            console.log(`   🤖 [AI] Tentative via OpenRouter...`);
            // 1. Essai OPENROUTER (Cheap fallbacks)
            response = await withRetry(() =>
                openRouterClient.chat.completions.create({
                    model: OPENROUTER_PRIMARY,
                    messages,
                    max_tokens: 1500,
                    response_format: { type: 'json_object' },
                    extra_body: {
                        require_parameters: true,
                    },
                    timeout: 45000,
                })
                , 2, 1000);
            usedProvider = 'OpenRouter';

        } catch (errorOR) {
            console.warn(`   ⚠️ [AI] OpenRouter a échoué (${errorOR.message}). Bascule sur DeepSeek...`);

            // 2. Essai DEEPSEEK DIRECT (Dernier recours)
            response = await withRetry(() =>
                deepseekClient.chat.completions.create({
                    model: 'deepseek-chat',
                    messages,
                    max_tokens: 1500,
                    response_format: { type: 'json_object' },
                    timeout: 30000,
                })
                , 2, 1000);
            usedProvider = 'DeepSeek';
        }

        console.log(`   ✅ [AI] Qualifié avec succès via ${usedProvider}.`);

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