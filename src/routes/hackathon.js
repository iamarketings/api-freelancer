const express = require('express');
const { fetchOpportunities } = require('../controllers/opportunitiesController');
const router = express.Router();

/**
 * GET /api/hackathon
 * Retourne uniquement les hackathons Devpost avec pagination (?page=1&limit=50)
 */
router.get('/', (req, res) => {
    fetchOpportunities(req, res, (query) => {
        return query.eq('source', 'Devpost');
    });
});

/**
 * POST /api/hackathon/refresh
 * Force la resynchronisation des hackathons Devpost
 */
router.post('/refresh', (req, res) => {
    const { runHackathonFetcherJob } = require('../jobs/hackathonFetcher');
    runHackathonFetcherJob().catch(console.error);
    res.json({ success: true, message: "Mise à jour Devpost lancée en arrière-plan." });
});

module.exports = router;
