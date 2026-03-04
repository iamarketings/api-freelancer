const cron = require('node-cron');
const axios = require('axios');
const supabase = require('../db/supabase');
const { qualifyLeadWithAI } = require('./aiQualifier');
const { calculateLeadScore } = require('./leadScoringAlgo');

let isRunning = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeUrl(url) {
    if (!url) return null;
    try {
        const u = new URL(url);
        u.search = ''; u.hash = '';
        return u.toString();
    } catch { return url; }
}

async function fetchDevpostHackathons() {
    const newLeads = [];
    console.log('\n🏆 [Hackathons] Devpost API...');
    const MAX_PAGES = 5;

    const HTTP_HEADERS = {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
    };

    for (let page = 1; page <= MAX_PAGES; page++) {
        try {
            const resp = await axios.get('https://devpost.com/api/hackathons', {
                params: { page, per_page: 24, status: 'open', order_by: 'deadline', sort_by: 'asc' },
                headers: HTTP_HEADERS,
                timeout: 10000,
            });
            const hackathons = resp.data.hackathons || [];
            if (!hackathons.length) break;

            for (const hack of hackathons) {
                const id = `devpost-${hack.id}`;
                const url = hack.url || `https://devpost.com/hackathons/${hack.id}`;

                const stripHtml = s => (s || '').replace(/<[^>]*>/g, '').trim();
                const prizeStr  = stripHtml(hack.prize_amount || '');
                const location  = hack.displayed_location?.location || 'En ligne';
                const dates     = hack.submission_period_dates || '';
                let preview     = `Hackathon ${location}.`;
                if (prizeStr) preview += ` Prix : ${prizeStr}.`;
                if (dates)    preview += ` Dates : ${dates}.`;

                newLeads.push({
                    id, source: 'Devpost',
                    title: `[Hackathon] ${hack.title}`,
                    url,
                    created_at: new Date().toISOString(),
                    preview,
                    type: 'hackathon',
                    extra_data: {
                        image_url: hack.thumbnail_url ? (hack.thumbnail_url.startsWith('//') ? 'https:' + hack.thumbnail_url : hack.thumbnail_url) : null,
                        registrations_count: hack.registrations_count
                    }
                });
            }
            console.log(`   [Hackathons] Devpost page ${page} trouvée`);
            await sleep(800);
        } catch (err) {
            console.error(`   ❌ Devpost page ${page}: ${err.message}`);
        }
    }

    return newLeads;
}

async function runHackathonFetcherJob() {
    if (isRunning) {
        console.log('⚠️ [CRON] Job Hackathons déjà en cours, cycle ignoré.');
        return;
    }

    isRunning = true;
    console.log('🔄 [CRON] Début de la récupération des Hackathons Devpost (Supabase)...');

    try {
        const issues = await fetchDevpostHackathons();
        console.log(`[CRON] ${issues.length} hackathons actifs trouvés.`);

        // Récupérer les IDs déjà en base pour éviter un traitement IA inutile
        const { data: existingData } = await supabase.from('opportunities').select('id, score').in('id', issues.map(i => i.id));
        const existingIds = new Set(existingData?.map(r => r.id) || []);

        const newIssuesToProcess = issues.filter(issue => !existingIds.has(issue.id));

        console.log(`🤖 ${newIssuesToProcess.length} nouveaux hackathons à évaluer avec l'IA...`);

        // Traitement séquentiel
        for (let i = 0; i < newIssuesToProcess.length; i++) {
            const lead = newIssuesToProcess[i];

            try {
                const qualified = await qualifyLeadWithAI(lead, null);

                if (!qualified || qualified.ai_error) {
                     console.log(`[Hackathons] ⚠️  Erreur IA ou ignoré — ${lead.title}`);
                     await sleep(500);
                     continue;
                }

                qualified.score = calculateLeadScore(qualified);

                const opportunityData = {
                    id: qualified.id,
                    title: qualified.title,
                    source: qualified.source,
                    url: qualified.url,
                    image_url: lead.extra_data.image_url,
                    state: 'OPEN',
                    comment_count: lead.extra_data.registrations_count || 0,
                    created_at: qualified.created_at || new Date().toISOString(),
                    last_activity_at: new Date().toISOString(),
                    labels: ['hackathon', 'devpost'],
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
                    console.error(`❌ [Supabase] Erreur upsert hackathon ${lead.id}:`, error.message);
                } else {
                    console.log(`✨ Hackathon validé (${i + 1}/${newIssuesToProcess.length}): ${lead.title} (Score: ${qualified.score})`);
                }

                await sleep(500);

            } catch (err) {
                console.error(`Erreur IA sur l'hackathon ${lead.id}:`, err.message);
            }
        }
    } catch (error) {
        console.error('❌ [CRON] Erreur générale Hackathons :', error.message);
    } finally {
        isRunning = false;
    }

    console.log('✅ [CRON] Fin du cycle Hackathons.');
}

function startHackathonCron() {
    console.log('⏰ CRON Hackathons planifié toutes les 6 heures (0 */6 * * *).');
    cron.schedule('0 */6 * * *', runHackathonFetcherJob);
}

module.exports = { startHackathonCron, runHackathonFetcherJob };
