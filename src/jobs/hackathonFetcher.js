const cron = require('node-cron');
const axios = require('axios');
const supabase = require('../db/supabase');

let isRunning = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
                const prizeStr = stripHtml(hack.prize_amount || '');
                const location = hack.displayed_location?.location || 'En ligne';
                const dates = hack.submission_period_dates || '';
                let preview = `Hackathon ${location}.`;
                if (prizeStr) preview += ` Prix : ${prizeStr}.`;
                if (dates) preview += ` Dates : ${dates}.`;

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
                    },
                    qualified: false
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
    console.log('🔄 [CRON] Début de la récupération des Hackathons Devpost...');

    try {
        const issues = await fetchDevpostHackathons();
        console.log(`[CRON] ${issues.length} hackathons actifs trouvés.`);

        if (issues.length === 0) return;

        // 1. Récupérer les IDs déjà en base
        const { data: existingData } = await supabase.from('opportunities').select('id').in('id', issues.map(i => i.id));
        const existingIds = new Set(existingData?.map(r => r.id) || []);

        const newIssues = issues.filter(issue => !existingIds.has(issue.id));
        const existingIssues = issues.filter(issue => existingIds.has(issue.id));

        // 2. Mettre à jour l'état et les commentaires des existants (sans IA)
        if (existingIssues.length > 0) {
            console.log(`🔄 Mise à jour rapide de ${existingIssues.length} hackathons existants...`);
            for (const issue of existingIssues) {
                await supabase.from('opportunities')
                    .update({
                        comment_count: issue.extra_data?.registrations_count || 0,
                        last_activity_at: new Date().toISOString()
                    })
                    .eq('id', issue.id);
            }
        }

        // 3. Envoyer uniquement les nouveaux à la Queue IA
        if (newIssues.length > 0) {
            console.log(`🚀 Ajout de ${newIssues.length} nouveaux Hackathons dans la Queue...`);
            const { error } = await supabase.from('queue').upsert(newIssues, { onConflict: 'id', ignoreDuplicates: true });
            if (error) console.error(`❌ [Supabase] Erreur insertion queue (Hackathons):`, error.message);
        } else {
            console.log(`✅ [CRON] Aucun nouveau Hackathon à envoyer à l'IA.`);
        }
    } catch (error) {
        console.error('❌ [CRON] Erreur générale Hackathons :', error.message);
    } finally {
        isRunning = false;
    }
}

function startHackathonCron() {
    console.log('⏰ CRON Hackathons planifié toutes les 6 heures (0 */6 * * *).');
    cron.schedule('0 */6 * * *', runHackathonFetcherJob);
}

module.exports = { startHackathonCron, runHackathonFetcherJob };
