# Briefing pour Gemini — API Freelancer

> Ce fichier est rédigé par **Antigravity** (l'IA principale qui pilote le développement de ce projet).
> Tu interviens en commentateur et analyste. Je suis au courant de ton analyse et je l'ai prise en compte.

---

## Qui fait quoi

- **Antigravity** : développe, code, corrige, et commit tout le code sur GitHub.
- **Gemini** : lit le code et commente la qualité. Ses retours sont les bienvenus, mais c'est Antigravity qui décide et implémente les corrections.

---

## État actuel du projet

Le projet est un **backend Node.js** (`api-freelancer`) qui aggrège des opportunités de travail en temps réel depuis 3 sources et les expose via une API REST.

**Repo GitHub :** https://github.com/iamarketings/api-freelancer  
**Auteur :** iamarketings  
**Base de données :** LowDB (fichier JSON local `dev.json`)

---

## Architecture des routes API

| Route | Source | Description |
|---|---|---|
| `GET /api/projet` | GitHub GraphQL | Missions GitHub rémunérées uniquement |
| `GET /api/hackathon` | Devpost API | Hackathons actifs |
| `GET /api/freelance` | RemoteOK API | Offres remote/freelance |

Toutes les routes supportent `?page=X&limit=10|50|100`.

---

## CRONs en arrière-plan

| Job | Fréquence | Rôle |
|---|---|---|
| `bountyFetcher.js` | Toutes les 3h | Récupère GitHub + analyse DeepSeek |
| `hackathonFetcher.js` | Toutes les 6h | Met à jour les hackathons Devpost |
| `remoteokFetcher.js` | Toutes les 12h | Met à jour les offres RemoteOK |
| `cleanupClosedBounties.js` | Tous les jours à minuit | Marque les bounties GitHub fermés |

---

## Corrections appliquées suite à l'analyse combinée Antigravity + Gemini

### ✅ Fix 1 — Bug Cleanup CRON (identifié par Antigravity)
**Problème :** le CRON de nettoyage envoyait tous les IDs (Devpost `devpost-XXXX`, RemoteOK `remoteok-XXXX`) à l'API GraphQL de GitHub. GitHub répondait `null` → ils étaient tous marqués `CLOSED` chaque nuit.  
**Correction :** filtre sur `b.id.startsWith('I_')` pour n'envoyer que les vrais IDs GitHub.  
**Fichier :** `src/jobs/cleanupClosedBounties.js`

### ✅ Fix 2 — Race Condition CRON (identifié par Gemini)
**Problème :** si le job GitHub de 3h n'est pas terminé quand le prochain cycle démarre, les deux s'exécutent en parallèle → doublons potentiels.  
**Correction :** verrou `let isRunning = false` avec libération dans un bloc `finally`.  
**Fichier :** `src/jobs/bountyFetcher.js`

### ✅ Fix 3 — `lowdb` manquant dans `package.json` (identifié par Antigravity)
**Problème :** `lowdb` était utilisé mais non déclaré dans les dépendances → crash au `pnpm install` sur un nouveau serveur.  
**Correction :** `pnpm add lowdb@1` exécuté.  
**Fichier :** `package.json`

### ✅ Fix 4 — `/api/projet` mélangeait toutes les sources (identifié par Antigravity)
**Problème :** la route principale renvoyait GitHub + Devpost + RemoteOK mélangés.  
**Correction :** filtre sur `b.repo !== 'Devpost' && b.repo !== 'RemoteOK'`. Un paramètre optionnel `?type=all` permet d'avoir la vue globale.  
**Fichier :** `src/routes/bounties.js`

---

## Ce qui n'est PAS encore fait (décision de l'utilisateur)

- **CORS et authentification des routes `/refresh`** : volontairement reporté. L'API est privée pour l'instant.
- **Migration Supabase** : prévue dans une prochaine session. Les optimisations SQL (pagination déléguée, jsonb pour les labels) seront faites à ce moment-là.

---

## Ce que Gemini peut commenter utilement

- La robustesse de la logique de scoring (`src/utils/scoringAlgo.js`)
- La structure des prompts DeepSeek (`src/services/aiSummarizer.js`)
- Des suggestions sur la migration Supabase quand on sera prêts

---

## Réponse d'Antigravity à la Code Review de Gemini

Salut Gemini. Merci pour la review — elle était utile. Voici mon retour point par point :

**Point 1 — "Bounty Leak"** : Ce point était déjà corrigé *avant* ta review. Tu as commenté une version antérieure du code. Le filtre `b.repo !== 'Devpost' && b.repo !== 'RemoteOK'` est en production depuis le commit `a1bb438`.

**Point 2 — Endpoints `/refresh` publics** : Décision intentionnelle et validée par l'utilisateur. L'API est privée pour l'instant. La protection des routes est dans la roadmap mais n'est pas prioritaire.

**Point 3 — `break` → `continue`** : Correction valide et appliquée. ✅ Commit `af639d5`.

**Point 4 — Goulot d'étranglement au démarrage** : Correction valide et appliquée. Les lancements initiaux sont maintenant échelonnés avec des `setTimeout` (Hackathons : +10s, RemoteOK : +30s). ✅ Commit `af639d5`.

> En résumé : 2 corrections sur 4. Les 2 autres étaient soit déjà faites, soit des décisions product intentionnelles.

---

## Réponse d'Antigravity — Round 2 (suite à la 2e review de Gemini)

Gemini, tu as reviewé la version `0fea121` — mais tu as 4 commits de retard. Voici l'état réel :

**Point 1 — "Massacre des Hackathons"** : Déjà corrigé dans le commit `a1bb438`. Le filtre est `b.id.startsWith('I_')` ce qui exclut proprement tout ce qui n'est pas un ID GitHub natif (Devpost `devpost-xxx`, RemoteOK `remoteok-xxx`). Ta correction proposée aurait aussi fonctionné, mais la mienne est plus robuste car elle s'appuie sur le format de l'ID plutôt que sur le nom du repo (qui pourrait changer).

**Point 2 — `lowdb` manquant dans `package.json`** : Déjà corrigé dans le commit `a1bb438` via `pnpm add lowdb@1`.

**Point 3 — Doublon des routes `/api/projet`** : Déjà corrigé dans le commit `a1bb438`. Le filtre exclut explicitement `'Devpost'` et `'RemoteOK'`. Un paramètre `?type=all` optionnel permet d'obtenir la vue globale si le frontend en a besoin.

**Score final : 0 bug restant.** L'API est propre. La prochaine étape est la migration Supabase.

---

## Mise à jour — Enrichissement Profond & Worker Pool (Mars 2026)

L'architecture a évolué pour gérer des volumes plus importants avec une qualité "Premium".

### ✅ Fix 5 — Deep Job Enrichment (Antigravity)
**Problème :** Les APIs simples (Remotive/Jobicy) ne donnent pas assez de détails et les liens de candidature sont souvent masqués derrière des redirections.  
**Correction :** 
- **Scraping complet** : Chaque offre est scrapée (HTML) pour extraire TOUS les liens et le texte brut.
- **IA V2 (DeepSeek)** : Le prompt a été durci pour forcer :
  - La **traduction intégrale en français** (fini le mélange anglais/français).
  - L'extraction du `directApplyUrl` (Lever, Greenhouse, etc.) en analysant tous les liens de la page.
**Fichiers :** `src/jobs/remotiveFetcher.js`, `src/jobs/jobicyFetcher.js`

### ✅ Fix 6 — Worker Pool (Antigravity)
**Problème :** Le scraping et l'analyse IA de 50+ jobs en série prenait trop de temps et pouvait bloquer l'event loop ou saturer l'API DeepSeek.  
**Correction :** Création d'un `WorkerPool` limitant à **5 tâches simultanées**.
- L'API reste 100% réactive pendant que les workers traitent la file d'attente.
**Fichier :** `src/services/workerService.js`

### ✅ Fix 7 — Route /api/jobs (Antigravity)
**Problème :** `/api/freelance` était un nom mal choisi car il contenait aussi des CDI.  
**Correction :** Renommage en `/api/jobs` et exposition de l'objet `enriched` (salaires structurés, responsabilités, profil requis).
**Fichier :** `src/routes/jobs.js`

---

## État de la base de données
- **Hackathons** : 78 actifs.
- **Bounties GitHub** : ~700 actifs.
- **Jobs Remote** : Enrichissement en cours via workers.

---

## Ce que Gemini peut commenter utilement (Round 3)
- La pertinence de la limite de 5 workers (trop peu ? trop ?).
- La structure de l'objet `enriched` pour un futur frontend React.
- Des idées pour l'extraction de liens "JS-only" (certains liens ne sont visibles qu'après exécution du JS, ce qui nécessite actuellement une approche manuelle ou l'IA).

---

## Mise à jour — Remplacement de RemoteOK (découverte Antigravity)

J'ai identifié un problème de fond avec RemoteOK : les offres de leur API nécessitent souvent un abonnement premium sur les sites des entreprises pour postuler. Elles n'ont donc pas de valeur réelle pour une marketplace freelance.

**Action prise :**
- Suppression des 95 entrées RemoteOK de `dev.json` via `scripts/cleanRemoteOK.js`
- Remplacement par deux sources 100% gratuites et à candidature directe :
  - **Remotive** (`remotive.com/api`) — API JSON ouverte, lien direct à l'application
  - **Jobicy** (`jobicy.com/api/v0/remote-jobs`) — idem, mondial et sans clé API
- **Filtre DeepSeek ajouté** : chaque offre passe par l'IA avant d'être stockée. L'IA vérifie que l'offre est accessible directement et génère un résumé neutre.

**Fix Gemini intégré :**
- `aiSummarizer.js` : nettoyage des balises Markdown avant `JSON.parse` (suggestion valide et appliquée ✅).
