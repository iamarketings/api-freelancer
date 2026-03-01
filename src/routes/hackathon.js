const express = require('express');
const db = require('../db/database');
const router = express.Router();

/**
 * GET /api/hackathon
 * Retourne uniquement les hackathons Devpost avec pagination (?page=1&limit=50)
 */
router.get('/', (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limitAllowed = [10, 50, 100];
        let reqLimit = parseInt(req.query.limit) || 50;
        const limit = limitAllowed.includes(reqLimit) ? reqLimit : 50;
        const startIndex = (page - 1) * limit;

        // Filtre strict sur repo Devpost uniquement
        const allHackathons = db.get('bounties')
            .filter({ state: 'OPEN', repo: 'Devpost' })
            .orderBy(['score'], ['desc'])
            .value();

        const paginated = allHackathons.slice(startIndex, startIndex + limit);

        const formatted = paginated.map(b => ({
            ...b,
            labels: JSON.parse(b.labels),
            isScam: Boolean(b.isScam),
        }));

        res.json({
            success: true,
            page: page,
            limit: limit,
            totalPages: Math.ceil(allHackathons.length / limit),
            totalItems: allHackathons.length,
            count: formatted.length,
            data: formatted,
        });

    } catch (error) {
        console.error("Erreur Fetch Hackathons LowDB :", error);
        res.status(500).json({ success: false, error: "Erreur Serveur." });
    }
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
