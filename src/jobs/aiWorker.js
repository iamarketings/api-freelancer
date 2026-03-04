const cron = require('node-cron');
const supabase = require('../db/supabase');
const { qualifyLeadWithAI, scrapeJobPage } = require('./aiQualifier');
const { calculateLeadScore } = require('./leadScoringAlgo');

let isWorkerRunning = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
        if (hostname === 'github.com') {
            const isIssueOrPR = /^\/[^/]+\/[^/]+\/(issues|pull)\/\d+/.test(parsed.pathname);
            return !isIssueOrPR;
        }
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

async function markAsQualified(id) {
    await supabase.from('queue').update({ qualified: true }).eq('id', id);
}

async function runAIWorkerJob() {
    if (isWorkerRunning) {
        return;
    }

    isWorkerRunning = true;

    try {
        // Fetch 50 unqualified leads from queue
        const { data: queueItems, error: fetchError } = await supabase
            .from('queue')
            .select('*')
            .eq('qualified', false)
            .limit(50);

        if (fetchError) throw fetchError;

        if (!queueItems || queueItems.length === 0) {
            isWorkerRunning = false;
            return;
        }

        console.log(`\n🤖 [AI Worker] Traitement de ${queueItems.length} leads depuis la Queue...`);

        for (const lead of queueItems) {
            try {
                let scrapedContent = null;
                // Si c'est un job deep et que ce n'est pas un reddit post, on scrape la page HTML
                if (lead.url && (lead.type === 'job_deep' || (!lead.source.includes('r/') && lead.type === 'job'))) {
                    console.log(`   🌐 HTML -> MD : ${lead.url.substring(0, 60)}...`);
                    scrapedContent = await scrapeJobPage(lead.url);
                }

                const qualified = await qualifyLeadWithAI(lead, scrapedContent);

                if (!qualified || qualified.ai_error) {
                     console.log(`[AI Worker] ⚠️  Erreur IA ou rejet IA direct — ${lead.title}`);
                     await markAsQualified(lead.id); // On le marque comme qualifié pour ne pas boucler dessus
                     await sleep(500);
                     continue;
                }

                qualified.contact = sanitizeContact(qualified.contact);
                qualified.score = calculateLeadScore(qualified);

                // Build opportunity data based on type
                let commentCount = 0;
                let state = 'OPEN';
                let imageUrl = null;
                let labels = [qualified.type];

                if (lead.type === 'bounty' && lead.extra_data) {
                    commentCount = lead.extra_data.comments || 0;
                    state = lead.extra_data.state || 'OPEN';
                    if (lead.extra_data.labels) labels.push(...lead.extra_data.labels);
                } else if (lead.type === 'hackathon' && lead.extra_data) {
                    imageUrl = lead.extra_data.image_url;
                    commentCount = lead.extra_data.registrations_count || 0;
                    labels.push('devpost');
                } else if (lead.type === 'freelance') {
                    commentCount = lead.extra_data?.upvotes || 0;
                }

                const opportunityData = {
                    id: lead.id, // Very important: Use the lead ID, NOT qualified.id!
                    title: lead.title,
                    source: lead.source,
                    url: lead.url,
                    image_url: imageUrl,
                    state: state,
                    comment_count: commentCount,
                    created_at: qualified.created_at || lead.created_at || new Date().toISOString(),
                    last_activity_at: new Date().toISOString(),
                    labels: labels,
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

                const { error: upsertError } = await supabase.from('opportunities').upsert(opportunityData, { onConflict: 'id' });

                if (upsertError) {
                    console.error(`❌ [Supabase] Erreur upsert lead ${lead.id}:`, upsertError.message);
                } else {
                    console.log(`✨ Lead validé : ${lead.title} (Score: ${qualified.score})`);
                }

                // Toujours marquer comme qualifié à la fin, même si refusé par IA, pour sortir de la queue
                await markAsQualified(lead.id);

                // Pause API plus longue (3 sec) car DeepSeek limite
                await sleep(3000);

            } catch (err) {
                console.error(`Erreur process queue item ${lead.id}:`, err.message);
                // On pourrait incrémenter un compteur d'erreur ici, mais on ne bloque pas
            }
        }
        console.log(`✅ [AI Worker] Batch terminé.`);
    } catch (error) {
        console.error('❌ [AI Worker] Erreur générale :', error.message);
    } finally {
        isWorkerRunning = false;
    }
}

function startAIWorkerCron() {
    console.log('⏰ CRON AI Worker planifié toutes les 10 minutes (*/10 * * * *).');
    cron.schedule('*/10 * * * *', runAIWorkerJob);
}

module.exports = { startAIWorkerCron, runAIWorkerJob };
