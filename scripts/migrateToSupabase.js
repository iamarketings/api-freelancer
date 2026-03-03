const fs = require('fs');
const path = require('path');
const supabase = require('../src/db/supabase');

const dbPath = path.resolve(__dirname, '../dev.json');

async function migrate() {
    console.log('🚀 Début de la migration de dev.json vers Supabase...');

    if (!fs.existsSync(dbPath)) {
        console.error('❌ Erreur : dev.json non trouvé.');
        return;
    }

    const dbContent = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const bounties = dbContent.bounties || [];

    if (bounties.length === 0) {
        console.log('ℹ️ Aucune donnée à migrer.');
        return;
    }

    console.log(`📦 ${bounties.length} entrées à migrer.`);

    // Préparation des données pour Supabase
    const opportunities = bounties.map(b => ({
        id: b.id,
        title: b.title,
        source: b.repo || 'Unknown',
        url: b.url,
        direct_apply_url: b.directApplyUrl || null,
        image_url: b.imageUrl || null,
        state: b.state || 'OPEN',
        comment_count: b.commentCount || 0,
        created_at: b.createdAt || new Date().toISOString(),
        last_activity_at: b.lastActivityAt || new Date().toISOString(),
        labels: JSON.parse(typeof b.labels === 'string' ? b.labels : JSON.stringify(b.labels || [])),
        score: b.score || 0,
        ai_summary: b.aiSummary || null,
        is_scam: b.isScam === 1,
        discovered_at: b.discoveredAt || new Date().toISOString(),
        enriched_data: b.enriched || null
    }));

    // Insertion par lots de 50 pour éviter de saturer l'API
    const batchSize = 50;
    for (let i = 0; i < opportunities.length; i += batchSize) {
        const batch = opportunities.slice(i, i + batchSize);
        const { error } = await supabase
            .from('opportunities')
            .upsert(batch, { onConflict: 'id' });

        if (error) {
            console.error(`❌ Erreur lors du lot ${i / batchSize + 1}:`, error.message);
        } else {
            console.log(`✅ Lot ${i / batchSize + 1} migré (${batch.length} lignes).`);
        }
    }

    console.log('🎉 Migration terminée !');
}

migrate();
