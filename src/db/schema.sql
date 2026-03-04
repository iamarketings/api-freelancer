-- Schéma pour la table des opportunités (GitHub, Devpost, Remotive, Jobicy)
CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source TEXT NOT NULL, -- 'GitHub', 'Devpost', 'Remotive', 'Jobicy'
    url TEXT NOT NULL,
    direct_apply_url TEXT,
    image_url TEXT,
    state TEXT DEFAULT 'OPEN',
    comment_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    labels JSONB DEFAULT '[]'::jsonb,
    score INTEGER DEFAULT 0,
    ai_summary TEXT,
    is_scam BOOLEAN DEFAULT FALSE,
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    enriched_data JSONB -- Stockage flexible pour les données spécifiques (salaires, responsabilités, etc.)
);

-- Index pour accélérer les recherches et le tri
CREATE INDEX IF NOT EXISTS idx_opportunities_source ON opportunities(source);
CREATE INDEX IF NOT EXISTS idx_opportunities_score ON opportunities(score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_state ON opportunities(state);
