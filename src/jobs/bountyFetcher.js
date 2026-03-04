const cron = require('node-cron');
const axios = require('axios');
const supabase = require('../db/supabase');

let isRunning = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchBountyIssues() {
    const newLeads = [];
    console.log('\n💻 [Bounties] GitHub Bounties (GraphQL)...');

    if (!process.env.GITHUB_TOKEN) {
        console.warn('   ⚠️  GITHUB_TOKEN non défini. Scraping GitHub ignoré.');
        return newLeads;
    }

    const query = `
      query($cursor: String) {
        search(query: "label:bounty,reward,paid state:open type:issue", type: ISSUE, first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            ... on Issue {
              id title url state createdAt bodyText
              labels(first: 5) { nodes { name } }
              comments { totalCount }
              repository { nameWithOwner stargazerCount pushedAt }
            }
          }
        }
      }
    `;

    let hasNextPage = true;
    let cursor = null;
    let pageCount = 0;
    const MAX_PAGES = 10;
    const seenLocal = new Set();

    while (hasNextPage && pageCount < MAX_PAGES) {
        try {
            const resp = await axios.post(
                'https://api.github.com/graphql',
                { query, variables: { cursor } },
                {
                    headers: {
                        'Authorization': `bearer ${process.env.GITHUB_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 15000,
                }
            );

            if (resp.data.errors) throw new Error(JSON.stringify(resp.data.errors));

            const searchData = resp.data.data?.search;
            const nodes = searchData?.nodes || [];
            pageCount++;

            for (const issue of nodes) {
                if (!issue?.repository) continue;

                const repo = issue.repository;
                const daysSincePush = (Date.now() - new Date(repo.pushedAt)) / (1000 * 60 * 60 * 24);
                if (repo.stargazerCount < 2 || daysSincePush > 365) continue;

                const id = `github::${issue.id}`;
                if (seenLocal.has(id)) continue;
                seenLocal.add(id);

                const labels = issue.labels?.nodes?.map(l => l.name) || [];

                newLeads.push({
                    id, source: 'GitHub',
                    title: `[Bounty] ${issue.title}`,
                    url: issue.url,
                    created_at: issue.createdAt,
                    preview: (issue.bodyText || '').substring(0, 800),
                    type: 'bounty',
                    extra_data: { comments: issue.comments?.totalCount || 0, repository: repo.nameWithOwner, state: issue.state, labels },
                    qualified: false
                });
            }

            hasNextPage = searchData?.pageInfo?.hasNextPage || false;
            cursor = searchData?.pageInfo?.endCursor || null;
            console.log(`   [Bounties] GitHub page ${pageCount}/${MAX_PAGES} (Trouvés: ${newLeads.length})`);
            await sleep(500);

        } catch (err) {
            console.error(`   ❌ GitHub GraphQL page ${pageCount + 1}: ${err.message}`);
            break;
        }
    }

    return newLeads;
}

async function runBountyFetcherJob() {
    if (isRunning) {
        console.log('⚠️ [CRON] Job Bounties déjà en cours, cycle ignoré.');
        return;
    }

    isRunning = true;
    console.log('🔄 [CRON] Début de la récupération des Bounties GitHub...');

    try {
        const issues = await fetchBountyIssues();
        console.log(`[CRON] ${issues.length} issues actives trouvées.`);

        if (issues.length === 0) return;

        // 1. Récupérer les IDs déjà en base pour éviter un traitement IA inutile
        const { data: existingData } = await supabase.from('opportunities').select('id').in('id', issues.map(i => i.id));
        const existingIds = new Set(existingData?.map(r => r.id) || []);

        const newIssues = issues.filter(issue => !existingIds.has(issue.id));
        const existingIssues = issues.filter(issue => existingIds.has(issue.id));

        // 2. Mettre à jour l'état et les commentaires des Bounties existants (Skipper la file d'attente)
        if (existingIssues.length > 0) {
            console.log(`🔄 Mise à jour rapide de ${existingIssues.length} bounties existants (sans IA)...`);
            for (const issue of existingIssues) {
                await supabase.from('opportunities')
                    .update({
                        comment_count: issue.extra_data?.comments || 0,
                        state: issue.extra_data?.state || 'OPEN',
                        last_activity_at: new Date().toISOString()
                    })
                    .eq('id', issue.id);
            }
        }

        // 3. Envoyer uniquement les nouveaux à la Queue IA
        if (newIssues.length > 0) {
            console.log(`🚀 Ajout de ${newIssues.length} nouveaux Bounties dans la Queue...`);
            const { error } = await supabase.from('queue').upsert(newIssues, { onConflict: 'id', ignoreDuplicates: true });
            if (error) console.error(`❌ [Supabase] Erreur insertion queue (Bounties):`, error.message);
        } else {
            console.log(`✅ [CRON] Aucun nouveau Bounty à envoyer à l'IA.`);
        }
    } catch (error) {
        console.error('❌ [CRON] Erreur générale Bounties :', error.message);
    } finally {
        isRunning = false;
    }
}

function startCronJobs() {
    console.log('⏰ CRON GitHub planifié toutes les 3 heures (0 */3 * * *).');
    cron.schedule('0 */3 * * *', runBountyFetcherJob);
}

module.exports = { startCronJobs, runBountyFetcherJob };
