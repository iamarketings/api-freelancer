const express = require('express');
const db = require('../db/database');
const router = express.Router();

/**
 * GET /api/projet
 * Retourne la liste des projets avec pagination (?page=1&limit=50)
 */
router.get('/', (req, res) => {
    try {
        // Paramètres de pagination avec valeurs par défaut
        const page = parseInt(req.query.page) || 1;
        const limitAllowed = [10, 50, 100];
        let reqLimit = parseInt(req.query.limit) || 50;

        // Restriction de la limite aux valeurs demandées
        const limit = limitAllowed.includes(reqLimit) ? reqLimit : 50;
        const startIndex = (page - 1) * limit;

        // On récupère et trie toutes les données valides
        const allBounties = db.get('bounties')
            .filter({ isScam: 0, state: 'OPEN' })
            .orderBy(['score'], ['desc'])
            .value();

        // On applique la pagination en découpant le tableau
        const paginatedBounties = allBounties.slice(startIndex, startIndex + limit);

        // On re-parse le JSON des labels
        const formattedBounties = paginatedBounties.map(b => ({
            ...b,
            labels: JSON.parse(b.labels),
            isScam: Boolean(b.isScam)
        }));

        res.json({
            success: true,
            page: page,
            limit: limit,
            totalPages: Math.ceil(allBounties.length / limit),
            totalItems: allBounties.length,
            count: formattedBounties.length,
            data: formattedBounties
        });

    } catch (error) {
        console.error("Erreur Fetch Bounties LowDB :", error);
        res.status(500).json({ success: false, error: "Erreur Serveur." });
    }
});

router.post('/refresh', (req, res) => {
    const { runBountyFetcherJob } = require('../jobs/bountyFetcher');
    runBountyFetcherJob().catch(console.error);
    res.json({ success: true, message: "Mise à jour GitHub -> IA lancée en arrière-plan." });
});

module.exports = router;
