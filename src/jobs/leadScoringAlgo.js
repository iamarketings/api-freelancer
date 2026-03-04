/**
 * ═══════════════════════════════════════════════════════════════════════
 *  LEAD SCORING ALGORITHM — Score sur 100 points
 *
 *  Corrections v2 :
 *  - Les GitHub Bounties ne sont plus pénalisés pour absence d'email
 *  - Détection du type de lead (bounty vs job) pour adapter la logique de contact
 *  - Score multiplié par source APRÈS calcul de base
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * @param {Object} lead - Lead qualifié (structure enrichie)
 * @returns {number} Score entre 0 et 100
 */
function calculateLeadScore(lead) {
    let score = 20; // Base neutre

    const isBounty = lead.type === 'bounty' || (lead.source || '').toLowerCase().includes('github');

    // ─── 1. FRAÎCHEUR (±25 points) ──────────────────────────────────────
    if (lead.created_at) {
        const ageH = (Date.now() - new Date(lead.created_at)) / (1000 * 60 * 60);
        if (ageH < 12)       score += 25;   // Très récent
        else if (ageH < 24)  score += 15;   // Moins d'un jour
        else if (ageH < 72)  score += 5;    // Moins de 3 jours
        else if (ageH > 168) score -= 15;   // Plus d'une semaine
    }

    // ─── 2. BUDGET / SALAIRE (±20 points) ───────────────────────────────
    const salaryNotes = lead.enriched?.salary?.notes || '';
    const salaryMin   = lead.enriched?.salary?.min;
    const budgetStr   = (salaryNotes || (salaryMin ? `${salaryMin}` : '')).toLowerCase().trim();
    const budgetAbsent = !budgetStr || ['non spécifié', 'n/a', 'erreur ia'].some(v => budgetStr.includes(v));

    if (!budgetAbsent) score += 20;  // Budget explicite = bon signe
    else               score -= 10;  // Pas de budget = perte de temps potentielle

    // ─── 3. QUALITÉ DU CONTACT (±35 points) ─────────────────────────────
    const c = lead.contact || {};
    const hasAnyContact = typeof c === 'object' && Object.keys(c).length > 0
        && Object.values(c).some(val => val !== null && val !== '');

    if (hasAnyContact) {
        if (isBounty) {
            // Pour les bounties : external_link (URL de l'issue) = contact valide principal
            if (c.external_link) score += 25;  // Lien issue = accès direct au client
            if (c.website)        score += 10;  // Site du repo = bonus
            // Pas de pénalité pour absence d'email sur les bounties
        } else {
            // Pour les offres d'emploi : email direct = priorité absolue
            if (c.email)          score += 20;  // Email direct recruteur = top
            if (c.website)        score += 10;  // Site officiel = sérieux
            if (c.external_link)  score += 5;   // Formulaire direct = bonus
        }
    } else {
        score -= 15;  // Contact vide = mauvais signe (ne devrait pas arriver, rejeté en phase 2)
    }

    // ─── 4. RICHESSE DE L'ANNONCE (+8 points max) ────────────────────────
    const enriched = lead.enriched || {};
    if ((enriched.responsibilities?.length  || 0) > 2) score += 3;
    if ((enriched.requiredProfile?.length   || 0) > 2) score += 3;
    if ((enriched.keyBenefits?.length       || 0) > 1) score += 2;

    // ─── 5. CONCURRENCE (Commentaires GitHub) ────────────────────────────
    // Chaque commentaire = -2 pts (trop de concurrence sur ce bounty)
    const commentsCount = lead.extra_data?.comments || 0;
    if (commentsCount > 0) {
        score -= Math.min(commentsCount * 2, 20);  // Plafond à -20 pts
    }

    // ─── 6. MULTIPLICATEUR PAR SOURCE ────────────────────────────────────
    // Appliqué en dernier sur le score brut
    const SOURCE_MULTIPLIERS = {
        remoteok:    1.15,
        wwr:         1.15,
        jobicy:      1.15,
        remotive:    1.10,
        devpost:     1.05,
        github:      1.05,
        slavelabour: 0.80,
        jobs4bitcoins: 0.80,
    };

    const src = (lead.source || '').toLowerCase();
    const multiplier = Object.entries(SOURCE_MULTIPLIERS)
        .find(([key]) => src.includes(key))?.[1] ?? 1.0;

    return Math.max(0, Math.min(100, Math.round(score * multiplier)));
}

module.exports = { calculateLeadScore };
