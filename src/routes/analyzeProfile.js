const express = require('express');
const router = express.Router();

/**
 * POST /api/analyze-profile
 * Proxy sécurisé vers DeepSeek API.
 * La clé API ne quitte jamais le backend.
 */
router.post('/', async (req, res) => {
    const { mission, userProfile } = req.body;

    if (!mission || !userProfile) {
        return res.status(400).json({ error: 'Paramètres mission et userProfile requis.' });
    }

    const userSkills = (userProfile.languages || []).join(', ') || 'non renseigné';
    const userFormations = (userProfile.formations || []).join(', ') || 'non renseigné';
    const userExp = userProfile.experience_years || 0;
    const userBio = userProfile.bio || '';

    const missionTags = (mission.labels || mission.tags || []).join(', ');
    const missionDesc = mission.ai_summary || mission.aiSummary || mission.desc || '';

    const prompt = `Tu es un conseiller bienveillant et expert en carrière tech. Analyse cette mission par rapport au profil du développeur et donne un avis honnête, positif et constructif (JAMAIS décourageant). Si le profil ne correspond pas à 100%, encourage-le et suggère des formations concrètes. Réponds TOUJOURS en français, de façon structurée.

PROFIL DU DÉVELOPPEUR:
- Compétences: ${userSkills}
- Formations suivies: ${userFormations}
- Années d'expérience: ${userExp} an(s)
- Bio: ${userBio || 'non renseignée'}

MISSION À ANALYSER:
- Titre: ${mission.title}
- Technologies requises: ${missionTags || 'non précisées'}
- Description: ${missionDesc}
- Score de pertinence: ${mission.score || 0}/100

STRUCTURE TA RÉPONSE AINSI (avec des emojis):
🎯 **Compatibilité estimée** : X% (sois honnête mais encadre positivement)
✅ **Points forts du profil** : liste ce qui correspond
📈 **Axes d'amélioration** : si manque de compétences, cite 1-2 formations concrètes à faire (Udemy, OpenClassrooms, etc.)
💡 **Conseil personnalisé** : un conseil actionnable et motivant pour postuler ou se préparer
🚀 **Verdict** : une phrase de conclusion positive et encourageante`;

    try {
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 800,
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('DeepSeek API error:', err);
            return res.status(502).json({ error: `Erreur DeepSeek: ${response.status}` });
        }

        const data = await response.json();
        const result = data.choices?.[0]?.message?.content || "Aucune réponse de l'IA.";
        return res.json({ success: true, result });

    } catch (err) {
        console.error('analyze-profile error:', err);
        return res.status(500).json({ error: "Erreur interne lors de l'analyse IA." });
    }
});

module.exports = router;
