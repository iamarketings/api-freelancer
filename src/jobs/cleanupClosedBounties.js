const axios = require('axios');
const cron = require('node-cron');
const db = require('../db/database');
require('dotenv').config();

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';

/**
 * Ce CRON s'occupe du "Nettoyage" (Cleanup). 
 * Il récupère tous les projets actuellement 
 * stockés comme 'OPEN' dans dev.json et demande à GitHub 
 * leur vrai statut actuel en temps réel.
 */
async function runCleanupJob() {
    console.log('🧹 [CRON] Début du nettoyage des anciens Bounties...');

    // 1. Récupérer uniquement les Bounties ouverts
    const openBounties = db.get('bounties').filter({ state: 'OPEN' }).value();

    if (openBounties.length === 0) {
        console.log('🧹 [CRON] Aucun projet ouvert à vérifier.');
        return;
    }

    console.log(`🧹 [CRON] ${openBounties.length} projets ouverts à vérifier sur GitHub...`);

    // L'API GraphQL permet de requêter des "nœuds" par leur ID global
    // On peut demander 100 nœuds à la fois
    const CHUNK_SIZE = 100;

    for (let i = 0; i < openBounties.length; i += CHUNK_SIZE) {
        const batch = openBounties.slice(i, i + CHUNK_SIZE);
        const nodeIds = batch.map(b => b.id);

        // Requête GraphQL demandant spécifiquement le statut de ces IDs
        const query = `
          query($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Issue {
                id
                state
              }
            }
          }
        `;

        try {
            const response = await axios.post(
                GITHUB_GRAPHQL_ENDPOINT,
                {
                    query,
                    variables: { ids: nodeIds }
                },
                {
                    headers: {
                        'Authorization': `bearer ${process.env.GITHUB_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (response.data.errors) {
                console.error("🧹 [CRON] Erreurs GraphQL Cleanup:", response.data.errors);
                continue;
            }

            const nodes = response.data.data.nodes;

            let closedCount = 0;

            // 2. Parcourir les nœuds retournés par GitHub
            nodes.forEach((node, index) => {
                // Si le node est null, c'est que l'issue a été complètement supprimée par son créateur (404)
                // Si l'état a changé en CLOSED, on met à jour.
                if (!node || node.state === 'CLOSED') {
                    const bountyIdTarget = batch[index].id;

                    db.get('bounties')
                        .find({ id: bountyIdTarget })
                        .assign({ state: 'CLOSED', lastActivityAt: new Date().toISOString() })
                        .write();

                    closedCount++;
                }
            });

            if (closedCount > 0) {
                console.log(`🧹 [CRON] ${closedCount} projets ont été clos/supprimés sur GitHub. Base mise à jour.`);
            }

        } catch (error) {
            console.error("🧹 [CRON] Erreur appel API Cleanup:", error.message);
        }
    }

    console.log('✅ 🧹 [CRON] Fin du nettoyage.');
}

function startCleanupCron() {
    console.log('⏰ CRON Nettoyage planifié tous les jours à minuit (0 0 * * *).');
    cron.schedule('0 0 * * *', runCleanupJob);
}

module.exports = { startCleanupCron, runCleanupJob };
