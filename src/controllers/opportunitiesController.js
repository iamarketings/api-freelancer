const supabase = require('../db/supabase');

const fetchOpportunities = async (req, res, queryModifier) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limitAllowed = [10, 50, 100];
        let reqLimit = parseInt(req.query.limit) || 50;
        const limit = limitAllowed.includes(reqLimit) ? reqLimit : 50;

        const from = (page - 1) * limit;
        const to = from + limit - 1;

        let query = supabase
            .from('opportunities')
            .select('*', { count: 'exact' })
            .eq('state', 'OPEN')
            .order('score', { ascending: false });

        if (queryModifier) {
            query = queryModifier(query, req);
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
                id: item.id,
                title: item.title,
                source: item.source,
                repo: item.source, // backwards compatibility
                url: item.url,
                imageUrl: item.image_url,
                state: item.state,
                commentCount: item.comment_count,
                createdAt: item.created_at,
                lastActivityAt: item.last_activity_at,
                labels: item.labels,
                score: item.score,
                aiSummary: item.ai_summary,
                summaryFr: item.summary_fr,
                isScam: item.is_scam,
                discoveredAt: item.discovered_at,

                // Nouveaux champs V2 (Lab)
                contact: item.contact,
                budget: item.budget,
                skills: item.skills,
                enriched: item.enriched || item.enriched_data
            }))
        });
    } catch (error) {
        console.error("Erreur Fetch Opportunities Supabase :", error.message);
        res.status(500).json({ success: false, error: "Erreur Serveur." });
    }
};

module.exports = {
    fetchOpportunities
};
