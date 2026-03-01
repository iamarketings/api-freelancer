const express = require('express');
const supabase = require('../db/supabase');
const router = express.Router();

/**
 * GET /api/projet
 * Retourne la liste des projets avec pagination (?page=1&limit=50)
 */
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limitAllowed = [10, 50, 100];
        let reqLimit = parseInt(req.query.limit) || 50;
        const limit = limitAllowed.includes(reqLimit) ? reqLimit : 50;

        const from = (page - 1) * limit;
        const to = from + limit - 1;

        const showAll = req.query.type === 'all';

        let query = supabase
            .from('opportunities')
            .select('*', { count: 'exact' })
            .eq('state', 'OPEN')
            .eq('is_scam', false)
            .order('score', { ascending: false });

        if (!showAll) {
            // Filtrer pour n'avoir que GitHub (on exclut les plateformes connues)
            query = query.not('source', 'in', '("Remotive","Jobicy","Devpost")');
        }

        const { data, error, count } = await query.range(from, to);

        if (error) throw error;

        res.json({
            success: true,
            page: page,
            limit: limit,
            totalPages: Math.ceil(count / limit),
            totalItems: count,
            count: data.length,
            data: data.map(item => ({
                ...item,
                repo: item.source,
                directApplyUrl: item.direct_apply_url,
                imageUrl: item.image_url,
                commentCount: item.comment_count,
                createdAt: item.created_at,
                lastActivityAt: item.last_activity_at,
                aiSummary: item.ai_summary,
                isScam: item.is_scam
            }))
        });

    } catch (error) {
        console.error("Erreur Fetch Bounties Supabase :", error.message);
        res.status(500).json({ success: false, error: "Erreur Serveur." });
    }
});

router.post('/refresh', (req, res) => {
    const { runBountyFetcherJob } = require('../jobs/bountyFetcher');
    runBountyFetcherJob().catch(console.error);
    res.json({ success: true, message: "Mise à jour GitHub -> IA lancée en arrière-plan." });
});

module.exports = router;
