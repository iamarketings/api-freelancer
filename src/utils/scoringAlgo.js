// Algorithme de scoring d'une issue "Bounty" (sur 100 points)
// Plus le score est proche de 100, plus le projet est intéressant pour le développeur.

function calculateBountyScore(issueData) {
    let score = 50; // Score de base moyen

    // 1. Analyse des assignations (Critique)
    // Si quelqu'un est déjà assigné, c'est presque mort
    if (issueData.assignees && issueData.assignees.nodes && issueData.assignees.nodes.length > 0) {
        return 0; // On met le score à 0 direct.
    }

    // 2. Concurrence via les commentaires (La "foule")
    const comments = issueData.comments ? issueData.comments.totalCount : 0;
    if (comments === 0) {
        score += 30; // Pépite cachée !
    } else if (comments <= 3) {
        score += 15; // Peu de concurrence
    } else if (comments > 10) {
        score -= 20; // Trop de monde ou trop de débats complexes
    } else if (comments > 20) {
        score -= 40; // Nid à problèmes
    }

    // 3. Fraîcheur de l'issue (L'âge)
    const createdAt = new Date(issueData.createdAt);
    const now = new Date();
    const ageInDays = (now - createdAt) / (1000 * 60 * 60 * 24);

    if (ageInDays < 3) {
        score += 20; // Très récent, fonce !
    } else if (ageInDays < 7) {
        score += 10; // Récent
    } else if (ageInDays > 90) {
        score -= 10; // Un peu vieux, risque d'abandon
    } else if (ageInDays > 365) {
        score -= 30; // Très vieux (Vaporware ?)
    }

    // 4. Activité récente
    if (issueData.updatedAt) {
        const updatedAt = new Date(issueData.updatedAt);
        const inactivityInDays = (now - updatedAt) / (1000 * 60 * 60 * 24);
        if (inactivityInDays > 60) {
            score -= 15; // Le mainteneur ne regarde plus l'issue
        }
    }

    // On s'assure que le score reste entre 0 et 100
    return Math.max(0, Math.min(100, score));
}

module.exports = { calculateBountyScore };
