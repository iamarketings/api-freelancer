const axios = require('axios');
const cron = require('node-cron');
const supabase = require('../db/supabase');
require('dotenv').config();

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';

/**
 * Ce CRON s'occupe du "Nettoyage" (Cleanup). 
 * Il récupère tous les projets actuellement 
 * stockés comme 'OPEN' dans Supabase et demande à GitHub 
 * leur vrai statut actuel en temps réel.
 */
async function runCleanupJob() {
    console.log('🧹 [CRON] Début du nettoyage des anciens Bounties (Supabase)...');

    try {
        // 1. Récupérer uniquement les Bounties GitHub ouverts
        // On considère que si la source contient un "/", c'est un repo GitHub nameWithOwner
        const { data: openBounties, error: fetchError } = await supabase
            .from('opportunities')
            .select('id, source')
            .eq('state', 'OPEN')
            .like('source', '%/%');

        if (fetchError) throw fetchError;

        if (!openBounties || openBounties.length === 0) {
            console.log('🧹 [CRON] Aucun projet ouvert à vérifier.');
            return;
        }

        console.log(`🧹 [CRON] ${openBounties.length} projets ouverts à vérifier sur GitHub...`);

        const CHUNK_SIZE = 100;
        for (let i = 0; i < openBounties.length; i += CHUNK_SIZE) {
            const batch = openBounties.slice(i, i + CHUNK_SIZE);
            const nodeIds = batch.map(b => b.id);

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

            const response = await axios.post(
                GITHUB_GRAPHQL_ENDPOINT,
                { query, variables: { ids: nodeIds } },
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

            for (let j = 0; j < nodes.length; j++) {
                const node = nodes[j];
                const originalBounty = batch[j];

                // Si le node est null (404) ou CLOSED
                if (!node || node.state === 'CLOSED') {
                    const { error: updateError } = await supabase
                        .from('opportunities')
                        .update({ state: 'CLOSED', last_activity_at: new Date().toISOString() })
                        .eq('id', originalBounty.id);

                    if (updateError) {
                        console.error(`❌ [Supabase] Erreur cleanup ID ${originalBounty.id}:`, updateError.message);
                    } else {
                        console.log(`🧹 [CRON] Projet clos/supprimé : ${originalBounty.id}`);
                    }
                }
            }
        }

    } catch (error) {
        console.error("🧹 [CRON] Erreur générale Cleanup :", error.message);
    }

    console.log('✅ 🧹 [CRON] Fin du nettoyage.');
}

function startCleanupCron() {
    console.log('⏰ CRON Nettoyage planifié tous les jours à minuit (0 0 * * *).');
    cron.schedule('0 0 * * *', runCleanupJob);
}

module.exports = { startCleanupCron, runCleanupJob };
