const express = require('express');
const { fetchOpportunities } = require('../controllers/opportunitiesController');
const router = express.Router();

/**
 * GET /api/projet
 * Retourne la liste des projets avec pagination (?page=1&limit=50)
 */
router.get('/', (req, res) => {
    fetchOpportunities(req, res, (query, request) => {
        let modifiedQuery = query.eq('is_scam', false);

        const showAll = request.query.type === 'all';
        if (!showAll) {
            // Filtrer pour n'avoir que GitHub (on exclut les plateformes connues)
            modifiedQuery = modifiedQuery.not('source', 'in', '("Remotive","Jobicy","Devpost")');
        }

        return modifiedQuery;
    });
});

router.post('/refresh', (req, res) => {
    const { runBountyFetcherJob } = require('../jobs/bountyFetcher');
    runBountyFetcherJob().catch(console.error);
    res.json({ success: true, message: "Mise à jour GitHub -> IA lancée en arrière-plan." });
});

module.exports = router;
