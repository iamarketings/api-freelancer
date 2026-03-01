const cron = require('node-cron');
const db = require('../db/database');
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
    console.log('🔄 [CRON] Début de la récupération des Bounties GitHub...');

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

            const existingBounty = db.get('bounties').find({ id: issue.id }).value();
            const currentScore = calculateBountyScore(issue);

            if (existingBounty) {
                db.get('bounties')
                    .find({ id: issue.id })
                    .assign({
                        state: issue.state,
                        commentCount: issue.comments.totalCount,
                        lastActivityAt: new Date(issue.updatedAt).toISOString(),
                        score: currentScore,
                    })
                    .write();
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
                const labelsStr = JSON.stringify(issue.labels.nodes.map(l => l.name));

                const newBounty = {
                    id: issue.id,
                    title: issue.title,
                    repo: issue.repository.nameWithOwner,
                    url: issue.url,
                    state: issue.state,
                    commentCount: issue.comments.totalCount,
                    createdAt: new Date(issue.createdAt).toISOString(),
                    lastActivityAt: new Date(issue.updatedAt).toISOString(),
                    labels: labelsStr,
                    score: finalScore,
                    aiSummary: aiAnalysis.summary,
                    isScam: aiAnalysis.isScam ? 1 : 0,
                    discoveredAt: new Date().toISOString()
                };

                db.get('bounties').push(newBounty).write();
                console.log(`✨ Projet validé (${i + 1}/${newIssuesToProcess.length}): ${issue.title} (Scam: ${aiAnalysis.isScam})`);

                // Optionnel : petite pause entre chaque appel pour être encore plus sûr
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (err) {
                console.error(`Erreur IA sur l'issue ${issue.id}:`, err.message);
            }
        }
    } catch (error) {
        console.error('❌ [CRON] Erreur générale :', error);
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
