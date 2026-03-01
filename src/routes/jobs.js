const express = require('express');
const supabase = require('../db/supabase');
const router = express.Router();

/**
 * GET /api/jobs
 * Offres d'emploi remote (Remotive + Jobicy) avec pagination
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
            .in('source', ['Remotive', 'Jobicy'])
            .eq('state', 'OPEN')
            .order('score', { ascending: false })
            .range(from, to);

        if (error) throw error;

        res.json({
            success: true,
            page,
            limit,
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
                isScam: item.is_scam,
                enriched: item.enriched_data || null
            })),
        });

    } catch (error) {
        console.error("Erreur Fetch Jobs Supabase :", error.message);
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
