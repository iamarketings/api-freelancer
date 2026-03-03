const axios = require('axios');
require('dotenv').config();

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';

/**
 * Récupère les issues contenant les labels liés aux Bounties (paid, bounty...)
 * Utilise la pagination (cursor) pour récupérer jusqu'à 1000 résultats (10 requêtes de 100).
 */
async function fetchBountyIssues() {
  let allIssues = [];
  let hasNextPage = true;
  let endCursor = null;
  let pageCount = 0;
  const maxPages = 10; // 10 pages de 100 = 1000 items max

  while (hasNextPage && pageCount < maxPages) {
    const query = `
      query($cursor: String) {
        search(query: "label:bounty,reward,paid state:open type:issue", type: ISSUE, first: 100, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ... on Issue {
              id
              title
              url
              state
              createdAt
              updatedAt
              bodyText
              
              comments {
                totalCount
              }
              
              assignees(first: 5) {
                nodes {
                  login
                }
              }
              
              labels(first: 10) {
                nodes {
                  name
                  color
                }
              }
              
              repository {
                nameWithOwner
                stargazerCount
                pushedAt
              }
            }
          }
        }
      }
    `;

    try {
      const response = await axios.post(
        GITHUB_GRAPHQL_ENDPOINT,
        {
          query,
          variables: { cursor: endCursor }
        },
        {
          headers: {
            'Authorization': `bearer ${process.env.GITHUB_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data.errors) {
        console.error("Erreurs GraphQL GitHub:", response.data.errors);
        break; // Arrête la boucle en cas d'erreur API
      }

      const searchData = response.data.data.search;

      allIssues = allIssues.concat(searchData.nodes);

      // Mise à jour de la pagination
      hasNextPage = searchData.pageInfo.hasNextPage;
      endCursor = searchData.pageInfo.endCursor;
      pageCount++;

      console.log(`[GitHub API] Page ${pageCount}/10 récupérée (${allIssues.length} issues total)`);

    } catch (error) {
      console.error("Erreur appel API GitHub:", error.message);
      break;
    }
  }

  return allIssues;
}

module.exports = { fetchBountyIssues };
