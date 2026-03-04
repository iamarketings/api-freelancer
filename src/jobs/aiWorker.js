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
        let hasMoreLeads = true;
        let batchCount = 0;

        while (hasMoreLeads) {
            batchCount++;
            // Fetch 500 unqualified leads from queue
            const { data: queueItems, error: fetchError } = await supabase
                .from('queue')
                .select('*')
                .eq('qualified', false)
                .limit(500);

            if (fetchError) throw fetchError;

            if (!queueItems || queueItems.length === 0) {
                console.log(`\n✅ [AI Worker] Plus aucun lead en attente. Queue complètement vidée !`);
                hasMoreLeads = false;
                break;
            }

            console.log(`\n🤖 [AI Worker] (Boucle ${batchCount}) Traitement de ${queueItems.length} leads depuis la Queue...`);

            const CONCURRENCY = 25;
            for (let i = 0; i < queueItems.length; i += CONCURRENCY) {
                const chunk = queueItems.slice(i, i + CONCURRENCY);
                console.log(`\n⏳ Traitement du lot ${Math.floor(i / CONCURRENCY) + 1} (${chunk.length} leads en parallèle)...`);

                await Promise.all(chunk.map(async (lead) => {
                    try {
                        let scrapedContent = null;
                        if (lead.url && (lead.type === 'job_deep' || (!lead.source.includes('r/') && lead.type === 'job'))) {
                            console.log(`   🌐 HTML -> MD : ${lead.url.substring(0, 60)}...`);
                            scrapedContent = await scrapeJobPage(lead.url);
                        }

                        const qualified = await qualifyLeadWithAI(lead, scrapedContent);

                        if (!qualified || qualified.ai_error) {
                            console.log(`[AI Worker] ⚠️  Erreur IA ou rejet IA direct — ${lead.title}`);
                            await markAsQualified(lead.id);
                            return;
                        }

                        qualified.contact = sanitizeContact(qualified.contact);
                        qualified.score = calculateLeadScore(qualified);

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
                            id: lead.id,
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
                            ai_summary: qualified.enriched?.summary || qualified.summary || '',
                            is_scam: qualified.is_scam || false,
                            discovered_at: new Date().toISOString(),
                            contact: qualified.contact || null,
                            budget: qualified.enriched?.salary?.notes || qualified.budget || null,
                            skills: qualified.enriched?.requiredProfile || qualified.skills || [],
                            summary_fr: qualified.enriched?.summary || qualified.summary_fr || '',
                            enriched: qualified.enriched || null
                        };

                        const { error: upsertError } = await supabase.from('opportunities').upsert(opportunityData, { onConflict: 'id' });

                        if (upsertError) {
                            console.error(`❌ [Supabase] Erreur upsert lead ${lead.id}:`, upsertError.message);
                        } else {
                            console.log(`✨ Lead validé : ${lead.title} (Score: ${qualified.score})`);
                        }

                        await markAsQualified(lead.id);

                    } catch (err) {
                        console.error(`Erreur process queue item ${lead.id}:`, err.message);
                    }
                }));

                // Légère pause après avoir bombardé 25 requêtes d'un coup
                await sleep(4000);
            }
            console.log(`✅ [AI Worker] Sous-lot ${batchCount} terminé. Recherche de la suite...`);
        }
    } catch (error) {
        console.error('❌ [AI Worker] Erreur générale :', error.message);
    } finally {
        isWorkerRunning = false;
    }
}

function startAIWorkerCron() {
    console.log('⏰ CRON AI Worker planifié toutes les 20 minutes (*/20 * * * *).');
    cron.schedule('*/20 * * * *', runAIWorkerJob);
}

module.exports = { startAIWorkerCron, runAIWorkerJob };
