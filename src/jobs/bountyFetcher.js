const cron = require('node-cron');
const supabase = require('../db/supabase');
const { fetchBountyIssues } = require('../services/githubService');
const { analyzeBountyWithAI } = require('../services/aiSummarizer');
const { calculateBountyScore } = require('../utils/scoringAlgo');

// Verrou pour éviter que deux cycles CRON s'exécutent en même temps (Race Condition)
let isRunning = false;

async function runBountyFetcherJob() {
    if (isRunning) {
        console.log('⚠️ [CRON] Job déjà en cours, ce cycle est ignoré.');
        return;
    }

    isRunning = true;
    console.log('🔄 [CRON] Début de la récupération des Bounties GitHub (Supabase)...');

    try {
        const issues = await fetchBountyIssues();
        console.log(`[CRON] ${issues.length} issues trouvées.`);

        const newIssuesToProcess = [];

        for (const issue of issues) {
            if (!issue) continue;

            const repo = issue.repository;
            const now = new Date();
            const lastPushDate = new Date(repo.pushedAt);
            const daysSincePushed = (now - lastPushDate) / (1000 * 60 * 60 * 24);

            if (repo.stargazerCount < 2 || daysSincePushed > 365) {
                // Ignore silentement pour ne pas spammer les logs
                continue;
            }

            const { data: existingBounty } = await supabase
                .from('opportunities')
                .select('id')
                .eq('id', issue.id)
                .single();

            const currentScore = calculateBountyScore(issue);

            if (existingBounty) {
                await supabase
                    .from('opportunities')
                    .update({
                        state: issue.state,
                        comment_count: issue.comments.totalCount,
                        last_activity_at: new Date(issue.updatedAt).toISOString(),
                        score: currentScore,
                    })
                    .eq('id', issue.id);
            } else {
                newIssuesToProcess.push({ issue, currentScore });
            }
        }

        console.log(`🤖 ${newIssuesToProcess.length} nouveaux projets à évaluer avec l'IA...`);

        // Traitement séquentiel (1 par 1) pour ne pas exploser les limites de l'IA
        for (let i = 0; i < newIssuesToProcess.length; i++) {
            const { issue, currentScore } = newIssuesToProcess[i];

            try {
                const aiAnalysis = await analyzeBountyWithAI(issue);

                const finalScore = aiAnalysis.isScam ? 0 : currentScore;
                const labels = issue.labels.nodes.map(l => l.name);

                const newBounty = {
                    id: issue.id,
                    title: issue.title,
                    source: issue.repository.nameWithOwner,
                    url: issue.url,
                    state: issue.state,
                    comment_count: issue.comments.totalCount,
                    created_at: new Date(issue.createdAt).toISOString(),
                    last_activity_at: new Date(issue.updatedAt).toISOString(),
                    labels: labels,
                    score: finalScore,
                    ai_summary: aiAnalysis.summary,
                    is_scam: aiAnalysis.isScam,
                    discovered_at: new Date().toISOString()
                };

                const { error } = await supabase
                    .from('opportunities')
                    .insert(newBounty);

                if (error) {
                    console.error(`❌ [Supabase] Erreur insertion bounty ${issue.id}:`, error.message);
                } else {
                    console.log(`✨ Projet validé (${i + 1}/${newIssuesToProcess.length}): ${issue.title} (Scam: ${aiAnalysis.isScam})`);
                }

                // Optionnel : petite pause entre chaque appel pour être encore plus sûr
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (err) {
                console.error(`Erreur IA sur l'issue ${issue.id}:`, err.message);
            }
        }
    } catch (error) {
        console.error('❌ [CRON] Erreur générale :', error.message);
    } finally {
        // On libère toujours le verrou, même en cas d'erreur
        isRunning = false;
    }

    console.log('✅ [CRON] Fin du cycle.');
}

function startCronJobs() {
    console.log('⏰ CRON planifié toutes les 3 heures (0 */3 * * *).');
    cron.schedule('0 */3 * * *', runBountyFetcherJob);
}

module.exports = { startCronJobs, runBountyFetcherJob };
