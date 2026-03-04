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

    // Pour ne pas ajouter deux fois la même issue dans ce cycle
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
                });
            }

            hasNextPage = searchData?.pageInfo?.hasNextPage || false;
            cursor      = searchData?.pageInfo?.endCursor || null;
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
    console.log('🔄 [CRON] Début de la récupération des Bounties GitHub (Supabase)...');

    try {
        const issues = await fetchBountyIssues();
        console.log(`[CRON] ${issues.length} issues actives trouvées.`);

        // Récupérer les IDs déjà en base pour éviter un traitement IA inutile
        const { data: existingData } = await supabase.from('opportunities').select('id, score').in('id', issues.map(i => i.id));
        const existingIds = new Set(existingData?.map(r => r.id) || []);

        const newIssuesToProcess = issues.filter(issue => !existingIds.has(issue.id));

        console.log(`🤖 ${newIssuesToProcess.length} nouveaux projets GitHub à évaluer avec l'IA...`);

        // Traitement séquentiel
        for (let i = 0; i < newIssuesToProcess.length; i++) {
            const lead = newIssuesToProcess[i];

            try {
                const qualified = await qualifyLeadWithAI(lead, null);

                if (!qualified || qualified.ai_error) {
                     console.log(`[Bounties] ⚠️  Erreur IA ou ignoré — ${lead.title}`);
                     await sleep(500);
                     continue;
                }

                qualified.score = calculateLeadScore(qualified);

                const opportunityData = {
                    id: qualified.id,
                    title: qualified.title,
                    source: qualified.source,
                    url: qualified.url,
                    image_url: null,
                    state: lead.extra_data.state || 'OPEN',
                    comment_count: lead.extra_data.comments || 0,
                    created_at: qualified.created_at || new Date().toISOString(),
                    last_activity_at: new Date().toISOString(),
                    labels: lead.extra_data.labels || [],
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
                    console.error(`❌ [Supabase] Erreur upsert bounty ${lead.id}:`, error.message);
                } else {
                    console.log(`✨ Projet validé (${i + 1}/${newIssuesToProcess.length}): ${lead.title} (Score: ${qualified.score})`);
                }

                await sleep(500);

            } catch (err) {
                console.error(`Erreur IA sur l'issue ${lead.id}:`, err.message);
            }
        }
    } catch (error) {
        console.error('❌ [CRON] Erreur générale Bounties :', error.message);
    } finally {
        isRunning = false;
    }

    console.log('✅ [CRON] Fin du cycle Bounties.');
}

function startCronJobs() {
    console.log('⏰ CRON GitHub planifié toutes les 3 heures (0 */3 * * *).');
    cron.schedule('0 */3 * * *', runBountyFetcherJob);
}

module.exports = { startCronJobs, runBountyFetcherJob };
