const express = require('express');
const db = require('../db/database');
const router = express.Router();

/**
 * GET /api/jobs
 * Offres d'emploi remote (Remotive + Jobicy) avec pagination
 */
router.get('/', (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limitAllowed = [10, 50, 100];
        let reqLimit = parseInt(req.query.limit) || 50;
        const limit = limitAllowed.includes(reqLimit) ? reqLimit : 50;
        const startIndex = (page - 1) * limit;

        const allJobs = db.get('bounties')
            .filter(b => b.state === 'OPEN' && (b.repo === 'Remotive' || b.repo === 'Jobicy'))
            .orderBy(['score'], ['desc'])
            .value();

        const paginated = allJobs.slice(startIndex, startIndex + limit);

        const formatted = paginated.map(b => ({
            ...b,
            labels: JSON.parse(b.labels),
            isScam: Boolean(b.isScam),
        }));

        res.json({
            success: true,
            page,
            limit,
            totalPages: Math.ceil(allJobs.length / limit),
            totalItems: allJobs.length,
            count: formatted.length,
            data: formatted,
        });

    } catch (error) {
        console.error("Erreur Fetch Jobs LowDB :", error);
        res.status(500).json({ success: false, error: "Erreur Serveur." });
    }
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
