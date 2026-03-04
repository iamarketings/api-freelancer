# API Freelancer — Bounty Hunter

> **© 2026 iamarketings** — Tous droits réservés.  
> [https://github.com/iamarketings/api-freelancer](https://github.com/iamarketings/api-freelancer)

API Node.js qui agrège automatiquement des missions rémunérées, des hackathons et des offres remote depuis plusieurs plateformes. Elle utilise un système de scoring et l'IA DeepSeek pour filtrer les arnaques et résumer chaque opportunité.

---

## 🗂️ Sources de données

| Source | Description | Fréquence |
|---|---|---|
| **GitHub** (GraphQL) | Issues avec labels `bounty`, `reward`, `paid` | 3h |
| **Devpost** | Hackathons mondiaux | 6h |
| **Remotive** | Emplois remote (Deep Enrichment + Direct Apply) | 12h |
| **Jobicy** | Emplois remote (Deep Enrichment + Direct Apply) | 12h30 |

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
# ou en mode dev
npm run dev
```

---

## 📡 Endpoints API

### `GET /api/projet`
Missions GitHub rémunérées. Filtré par score.

### `GET /api/hackathon`
Hackathons actifs de Devpost.

### `GET /api/jobs`
Offres remote premium enrichies par IA (Remotive + Jobicy).
- Traduction automatique en français.
- Extraction de `directApplyUrl` (Lien direct vers le formulaire de l'entreprise).

**Pagination :** `?page=1&limit=50|100`

---

## ⚙️ Architecture

```
src/
├── jobs/
│   ├── bountyFetcher.js          # CRON GitHub
│   ├── hackathonFetcher.js       # CRON Devpost
│   ├── remotiveFetcher.js        # Scraping + IA Remotive
│   ├── jobicyFetcher.js          # Scraping + IA Jobicy
│   └── cleanupClosedBounties.js  # Maintenance DB
├── routes/
│   ├── bounties.js               # /api/projet
│   ├── hackathon.js              # /api/hackathon
│   └── jobs.js                   # /api/jobs (Enrichi)
├── services/
│   ├── workerService.js          # Pool de Workers (Max 5 concurrents)
│   ├── githubService.js          # GraphQL Engine
│   └── aiSummarizer.js           # DeepSeek Engine
├── db/
│   ├── supabase.js               # Supabase Client
│   └── schema.sql                # Schéma de base de données
└── scripts/
    └── estimateAICosts.js        # Estimation des coûts IA
```

---

## 🔒 Sécurité

- Les clés API (`GITHUB_TOKEN`, `DEEPSEEK_API_KEY`) sont dans `.env`, jamais committées.
- Le fichier `dev.json` (base de données locale) est exclu du dépôt via `.gitignore`.

---

## 📄 Licence

MIT — © 2026 [iamarketings](https://github.com/iamarketings)
