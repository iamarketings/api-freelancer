const express = require('express');
const db = require('../db/database');
const router = express.Router();

/**
 * GET /api/freelance
 * Retourne uniquement les offres RemoteOK avec pagination (?page=1&limit=50)
 */
router.get('/', (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limitAllowed = [10, 50, 100];
        let reqLimit = parseInt(req.query.limit) || 50;
        const limit = limitAllowed.includes(reqLimit) ? reqLimit : 50;
        const startIndex = (page - 1) * limit;

        const allJobs = db.get('bounties')
            .filter({ state: 'OPEN', repo: 'RemoteOK' })
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
        console.error("Erreur Fetch RemoteOK LowDB :", error);
        res.status(500).json({ success: false, error: "Erreur Serveur." });
    }
});

/**
 * POST /api/freelance/refresh
 * Force la resynchronisation des offres RemoteOK
 */
router.post('/refresh', (req, res) => {
    const { runRemoteOKFetcherJob } = require('../jobs/remoteokFetcher');
    runRemoteOKFetcherJob().catch(console.error);
    res.json({ success: true, message: "Mise à jour RemoteOK lancée en arrière-plan." });
});

module.exports = router;
