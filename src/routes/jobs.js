const express = require('express');
const { fetchOpportunities } = require('../controllers/opportunitiesController');
const router = express.Router();

/**
 * GET /api/jobs
 * Offres d'emploi remote (Remotive, Jobicy, RemoteOK, WeWorkRemotely, etc) avec pagination
 */
router.get('/', (req, res) => {
    fetchOpportunities(req, res, (query) => {
        // We include both Job/Freelenance APIs and the RSS sources
        return query.not('source', 'in', '("Devpost","GitHub")');
    });
});

/**
 * POST /api/jobs/refresh
 * Force la resynchronisation
 */
router.post('/refresh', (req, res) => {
    const { runJobsFetcherJob } = require('../jobs/jobsFetcher');
    const { runRSSFetcherJob } = require('../jobs/rssFetcher');

    runJobsFetcherJob().catch(console.error);
    setTimeout(() => runRSSFetcherJob().catch(console.error), 5000);

    res.json({ success: true, message: "Mise à jour Jobs (API + RSS) lancée en arrière-plan." });
});

module.exports = router;
