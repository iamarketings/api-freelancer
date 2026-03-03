const axios = require('axios');
const cron = require('node-cron');
const supabase = require('../db/supabase');
require('dotenv').config();

/**
 * Nettoie le HTML des champs de l'API Devpost (ex: prize_amount qui contient des <span>)
 */
function stripHtml(str) {
    if (!str) return '';
    return str.replace(/<[^>]*>/g, '').trim();
}

async function fetchDevpostHackathons() {
    const allHackathons = [];
    const MAX_PAGES = 5;

    for (let page = 1; page <= MAX_PAGES; page++) {
        try {
            const response = await axios.get('https://devpost.com/api/hackathons', {
                params: { page, per_page: 24, status: 'open', order_by: 'deadline', sort_by: 'asc' },
                headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; BountyHunterBot/1.0)' },
                timeout: 10000,
            });

            const hackathons = response.data.hackathons;
            if (!hackathons || hackathons.length === 0) break;

            allHackathons.push(...hackathons);
            console.log(`[Devpost API] Page ${page} récupérée (${allHackathons.length} hackathons total)`);
            await new Promise(resolve => setTimeout(resolve, 800));

        } catch (error) {
            console.error(`[Devpost API] Erreur page ${page}:`, error.message);
            continue; // On continue sur la page suivante même en cas de hoquet réseau
        }
    }

    return allHackathons;
}

function calculateHackathonScore(hack) {
    let score = 70;

    const prizeStr = stripHtml(hack.prize_amount || '');
    const prizeNum = parseInt(prizeStr.replace(/[^0-9]/g, '')) || 0;
    if (prizeNum > 10000) score += 20;
    else if (prizeNum > 1000) score += 10;

    if (hack.registrations_count && hack.registrations_count > 500) score += 5;
    if (hack.managed_by_devpost_badge) score += 5; // Badge officiel Devpost

    return Math.min(score, 100);
}

async function runHackathonFetcherJob() {
    console.log('🌐 [CRON] Début de la récupération des Hackathons Devpost (Supabase)...');

    try {
        const hackathons = await fetchDevpostHackathons();
        console.log(`[CRON] ${hackathons.length} hackathons trouvés sur Devpost.`);

        let addedCount = 0;
        let updatedCount = 0;

        for (const hack of hackathons) {
            const hackId = `devpost-${hack.id}`;
            const score = calculateHackathonScore(hack);

            // Image : l'URL commence par "//" (sans https:), on la corrige
            const imageUrl = hack.thumbnail_url
                ? (hack.thumbnail_url.startsWith('//') ? 'https:' + hack.thumbnail_url : hack.thumbnail_url)
                : null;

            // Résumé : on compose une phrase avec les données disponibles
            const prizeStr = stripHtml(hack.prize_amount || '');
            const location = hack.displayed_location?.location || 'En ligne';
            const dates = hack.submission_period_dates || '';
            let summary = `Hackathon ${location}.`;
            if (prizeStr) summary += ` Prix : ${prizeStr}.`;
            if (dates) summary += ` Dates : ${dates}.`;

            const hackData = {
                id: hackId,
                title: `[Hackathon] ${hack.title}`,
                source: 'Devpost',
                url: hack.url || `https://devpost.com/hackathons/${hack.id}`,
                image_url: imageUrl,
                state: 'OPEN',
                comment_count: hack.registrations_count || 0,
                created_at: new Date().toISOString(),
                last_activity_at: new Date().toISOString(),
                labels: ['hackathon', 'devpost'],
                score,
                ai_summary: summary,
                is_scam: false,
                discovered_at: new Date().toISOString()
            };

            const { error } = await supabase
                .from('opportunities')
                .upsert(hackData, { onConflict: 'id' });

            if (error) {
                console.error(`❌ [Supabase] Erreur upsert hackathon ${hackId}:`, error.message);
            } else {
                console.log(`✨ Hackathon traité : ${hack.title}`);
                addedCount++;
            }
        }

        console.log(`✅ [CRON] Devpost terminé : ${addedCount + updatedCount} hackathons traités.`);
    } catch (error) {
        console.error('❌ [CRON] Erreur récupération Devpost :', error.message);
    }
}

function startHackathonCron() {
    console.log('⏰ CRON Hackathons planifié toutes les 6 heures (0 */6 * * *).');
    cron.schedule('0 */6 * * *', runHackathonFetcherJob);
}

module.exports = { startHackathonCron, runHackathonFetcherJob };
