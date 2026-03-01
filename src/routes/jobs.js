const express = require('express');
const { fetchOpportunities } = require('../controllers/opportunitiesController');
const router = express.Router();

/**
 * GET /api/jobs
 * Offres d'emploi remote (Remotive + Jobicy) avec pagination
 */
router.get('/', (req, res) => {
    fetchOpportunities(req, res, (query) => {
        return query.in('source', ['Remotive', 'Jobicy']);
    });
});

/**
 * POST /api/jobs/refresh
 * Force la resynchronisation de Remotive et Jobicy
 */
router.post('/refresh', (req, res) => {
    const { runRemotiveFetcherJob } = require('../jobs/remotiveFetcher');
    const { runJobicyFetcherJob } = require('../jobs/jobicyFetcher');
    runRemotiveFetcherJob().catch(console.error);
    setTimeout(() => runJobicyFetcherJob().catch(console.error), 5000);
    res.json({ success: true, message: "Mise à jour Remotive + Jobicy lancée en arrière-plan." });
});

module.exports = router;
