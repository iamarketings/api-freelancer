const express = require('express');
const supabase = require('../db/supabase');
const router = express.Router();

/**
 * GET /api/hackathon
 * Retourne uniquement les hackathons Devpost avec pagination (?page=1&limit=50)
 */
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limitAllowed = [10, 50, 100];
        let reqLimit = parseInt(req.query.limit) || 50;
        const limit = limitAllowed.includes(reqLimit) ? reqLimit : 50;

        const from = (page - 1) * limit;
        const to = from + limit - 1;

        const { data, error, count } = await supabase
            .from('opportunities')
            .select('*', { count: 'exact' })
            .eq('source', 'Devpost')
            .eq('state', 'OPEN')
            .order('score', { ascending: false })
            .range(from, to);

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
            })),
        });

    } catch (error) {
        console.error("Erreur Fetch Hackathons Supabase :", error.message);
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
