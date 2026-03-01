# API Freelancer — Bounty Hunter

> **© 2026 iamarketings** — Tous droits réservés.  
> [https://github.com/iamarketings/api-freelancer](https://github.com/iamarketings/api-freelancer)

API Node.js qui agrège automatiquement des missions rémunérées, des hackathons et des offres remote depuis plusieurs plateformes. Elle utilise un système de scoring et l'IA DeepSeek pour filtrer les arnaques et résumer chaque opportunité.

---

## 🗂️ Sources de données

| Source | Description | Fréquence de mise à jour |
|---|---|---|
| **GitHub** (GraphQL) | Issues avec labels `bounty`, `reward`, `paid` | Toutes les 3 heures |
| **Devpost** | Hackathons en cours | Toutes les 6 heures |
| **RemoteOK** | Offres d'emploi remote/freelance | Toutes les 12 heures |

---

## 🚀 Installation

### 1. Cloner le projet
```bash
git clone https://github.com/iamarketings/api-freelancer.git
cd api-freelancer
```

### 2. Installer les dépendances
```bash
pnpm install
```

### 3. Configurer les variables d'environnement
```bash
cp .env.example .env
```

Renseignez votre `.env` :
```env
PORT=3000
GITHUB_TOKEN=ghp_votre_token_github
DEEPSEEK_API_KEY=sk-votre_cle_deepseek
```

### 4. Lancer le serveur
```bash
npm start
# ou en mode dev (rechargement automatique)
npm run dev
```

---

## 📡 Endpoints API

L'API écoute sur `http://localhost:3000` par défaut.

### `GET /api/projet`
Missions GitHub rémunérées (bounties). Triées par score décroissant.

### `GET /api/hackathon`
Hackathons actifs depuis Devpost.

### `GET /api/freelance`
Offres d'emploi remote depuis RemoteOK.

**Paramètres de pagination disponibles sur toutes les routes :**
| Paramètre | Valeurs acceptées | Défaut |
|---|---|---|
| `page` | Entier ≥ 1 | `1` |
| `limit` | `10`, `50`, `100` | `50` |

**Exemple :**
```
GET /api/projet?page=2&limit=10
GET /api/hackathon?page=1&limit=100
GET /api/freelance?page=1&limit=50
```

**Format de réponse :**
```json
{
  "success": true,
  "page": 2,
  "limit": 10,
  "totalPages": 64,
  "totalItems": 639,
  "count": 10,
  "data": [ ... ]
}
```

### `POST /api/projet/refresh`
Force la synchronisation GitHub + analyse DeepSeek en arrière-plan.

### `POST /api/hackathon/refresh`
Force la resynchronisation des hackathons Devpost.

### `POST /api/freelance/refresh`
Force la resynchronisation des offres RemoteOK.

---

## ⚙️ Architecture

```
src/
├── jobs/
│   ├── bountyFetcher.js          # CRON GitHub (3h)
│   ├── hackathonFetcher.js       # CRON Devpost (6h)
│   ├── remoteokFetcher.js        # CRON RemoteOK (12h)
│   └── cleanupClosedBounties.js  # CRON nettoyage (minuit)
├── routes/
│   ├── bounties.js               # Route /api/projet
│   ├── hackathon.js              # Route /api/hackathon
│   └── freelance.js              # Route /api/freelance
├── services/
│   ├── githubService.js          # Requêtes GraphQL GitHub
│   └── aiSummarizer.js           # Intégration DeepSeek
├── utils/
│   └── scoringAlgo.js            # Algorithme de scoring
└── db/
    └── database.js               # LowDB (stockage JSON local)
```

---

## 🔒 Sécurité

- Les clés API (`GITHUB_TOKEN`, `DEEPSEEK_API_KEY`) sont dans `.env`, jamais committées.
- Le fichier `dev.json` (base de données locale) est exclu du dépôt via `.gitignore`.

---

## 📄 Licence

MIT — © 2026 [iamarketings](https://github.com/iamarketings)
