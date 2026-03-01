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
