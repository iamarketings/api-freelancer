require('dotenv').config({ path: '../.env' }); // Essaye le dossier parent d'abord
require('dotenv').config(); // Fallback

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ ERREUR : Variables d'environnement Supabase manquantes.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Prix DeepSeek Chat (approx) - par 1 000 000 tokens
const INPUT_COST_PER_M = 0.14; // $0.14 / 1M tokens (DeepSeek-V3 cache miss)
const OUTPUT_COST_PER_M = 0.28; // $0.28 / 1M tokens

// Token estimator simple: 1 token ≈ 4 caractères en moyenne.
const estimateTokens = (text) => {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
};

// Taille du prompt système + instructions
const BASE_PROMPT_TOKENS = 500;

async function analyzeCosts() {
    console.log("🔍 Récupération des leads en attente dans la queue...");

    // On veut tous les leads non qualifiés pour avoir le vrai total
    const { data: queueItems, error } = await supabase
        .from('queue')
        .select('*')
        .eq('qualified', false);

    if (error) {
        console.error("❌ Erreur Supabase:", error.message);
        return;
    }

    if (!queueItems || queueItems.length === 0) {
        console.log("✅ La queue est vide. Coût estimé : 0.00 $");
        return;
    }

    let totalEstimatedInputTokens = 0;
    let jobDeepCount = 0;

    for (const lead of queueItems) {
        // Le texte qui sera passé dans l'IA (en ignorant le scrape page pour l'instant)
        // car le vrai scraping n'a lieu qu'au moment du traitement.
        let leadContentTokens = estimateTokens(JSON.stringify(lead));

        // Si c'est un job deep, le vrai traitement va aller crawler l'URL.
        // On va ajouter un buffer forfaitaire de ~1500 tokens pour simuler le contenu de la page web scrappée.
        if (lead.type === 'job_deep' || (!lead.source.includes('r/') && lead.type === 'job')) {
            leadContentTokens += 1500;
            jobDeepCount++;
        } else if (lead.extra_data && lead.extra_data.description) {
            // Pour Reddit/Github qui ont déjà une description
            leadContentTokens += estimateTokens(lead.extra_data.description);
        }

        totalEstimatedInputTokens += (BASE_PROMPT_TOKENS + leadContentTokens);
    }

    const totalLeads = queueItems.length;
    // L'output est limité à 1000 tokens dans aiQualifier. Mais en moyenne une qualification json = ~400 tokens
    const AVG_OUTPUT_TOKENS_PER_LEAD = 400;
    const totalEstimatedOutputTokens = totalLeads * AVG_OUTPUT_TOKENS_PER_LEAD;

    const estimatedInputCost = (totalEstimatedInputTokens / 1_000_000) * INPUT_COST_PER_M;
    const estimatedOutputCost = (totalEstimatedOutputTokens / 1_000_000) * OUTPUT_COST_PER_M;
    const totalCost = estimatedInputCost + estimatedOutputCost;

    console.log("\n📊 --- ESTIMATION DES COÛTS IA (DEEPSEEK-CHAT) ---");
    console.log(`📌 Leads en attente      : ${totalLeads}`);
    console.log(`🌐 Dont "Job Deep" (web) : ${jobDeepCount} (nécessiteront un scraping = tokens bonus)`);
    console.log(`\n🧮 Tokens Input (Prompt) : ~${totalEstimatedInputTokens.toLocaleString('fr-FR')} tokens`);
    console.log(`🧮 Tokens Output (JSON)  : ~${totalEstimatedOutputTokens.toLocaleString('fr-FR')} tokens`);
    console.log(`\n💸 Coût Input estimé     : $${estimatedInputCost.toFixed(4)}`);
    console.log(`💸 Coût Output estimé    : $${estimatedOutputCost.toFixed(4)}`);
    console.log(`=================================================`);
    console.log(`💰 COÛT TOTAL ESTIMÉ     : $${totalCost.toFixed(4)} (USD)`);
    console.log(`=================================================\n`);
    console.log("ℹ️ Note: L'API DeepSeek est très peu coûteuse par rapport à OpenAI. Cette estimation inclut une marge pour le scraping des pages web.");
}

analyzeCosts();
