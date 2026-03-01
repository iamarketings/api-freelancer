const { OpenAI } = require('openai');
require('dotenv').config();

// Configuration du client OpenAI pour utiliser l'API de DeepSeek
const openai = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com/v1', // L'URL de base de l'API DeepSeek
});

/**
 * Envoie la description et les données d'un bounty à DeepSeek
 * Pour obtenir un résumé et évaluer si c'est un Scam
 */
async function analyzeBountyWithAI(issue) {
    try {
        const prompt = `Tu es un expert qui analyse des projets de développement et des missions freelance. 
Voici la description d'un projet qui offre une récompense.

Nom du projet : ${issue.repository.nameWithOwner}
Titre de la mission : ${issue.title}
Mots-clés : ${issue.labels.nodes.map(l => l.name).join(', ')}
Description de la mission : 
"""
${issue.bodyText.substring(0, 1500)}
"""

Tâche 1 : Résumé (1 à 2 phrases max)
Décris brièvement la nature du travail demandé. 
TRES IMPORTANT : Ne prononce JAMAIS les mots "GitHub", "Issue", "dépôt" ou "repository" dans ton résumé. Parle de "projet", de "mission" ou de "tâche" à accomplir.

Tâche 2 : Analyse de Scam (OUI/NON)
Est-ce que cette issue ressemble à une arnaque (scam) ? (ex: demande de payer pour participer, lien suspect, description très vague pour une énorme somme, etc.). Réponds OUI ou NON, suivi d'une très courte justification.

Format de réponse STRICT attendu en JSON :
{
  "summary": "Résumé ici...",
  "isScam": true ou false,
  "scamReason": "Justification si c'est un scam, sinon laisse vide"
}
`;

        // Appel à DeepSeek
        const response = await openai.chat.completions.create({
            model: "deepseek-chat", // ou "deepseek-coder" selon ce qui marche le mieux
            messages: [
                { role: "system", content: "Réponds uniquement au format JSON valide." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" }
        });

        // Parsing de la réponse JSON renvoyée par l'IA
        const aiResult = JSON.parse(response.choices[0].message.content);
        return aiResult;

    } catch (error) {
        console.error("Erreur lors de l'appel à DeepSeek:", error.message);
        // En cas d'erreur de l'IA (quota ou down), on retourne des valeurs par défaut sécurisées
        return {
            summary: "Résumé non disponible (Erreur IA)",
            isScam: false,
            scamReason: ""
        };
    }
}

module.exports = { analyzeBountyWithAI };
