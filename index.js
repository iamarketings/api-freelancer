require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { startCronJobs, runBountyFetcherJob } = require('./src/jobs/bountyFetcher');
const { startCleanupCron } = require('./src/jobs/cleanupClosedBounties');
const { startHackathonCron, runHackathonFetcherJob } = require('./src/jobs/hackathonFetcher');
const { startJobsCron, runJobsFetcherJob } = require('./src/jobs/jobsFetcher');
const { startRSSCron, runRSSFetcherJob } = require('./src/jobs/rssFetcher');
const { startAIWorkerCron, runAIWorkerJob } = require('./src/jobs/aiWorker');
const bountiesRouter = require('./src/routes/bounties');
const hackathonRouter = require('./src/routes/hackathon');
const jobsRouter = require('./src/routes/jobs');
const analyzeProfileRouter = require('./src/routes/analyzeProfile');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(cors()); // Ouvert à tous les domaines (pas de restriction)

// Routes
app.use('/api/projet', bountiesRouter);           // GitHub bounties uniquement
app.use('/api/hackathon', hackathonRouter);        // Hackathons Devpost
app.use('/api/jobs', jobsRouter);                  // Emplois remote (Remotive + Jobicy)
app.use('/api/analyze-profile', analyzeProfileRouter); // Analyse IA sécurisée (DeepSeek)

// Route de base (Documentation Premium)
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Freelancer API | Documentation</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
        <style>
            :root {
                --bg: #030712;
                --card-bg: #111827;
                --primary: #6366f1;
                --primary-glow: rgba(99, 102, 241, 0.4);
                --text: #f3f4f6;
                --text-muted: #9ca3af;
                --accent: #10b981;
                --border: rgba(255, 255, 255, 0.1);
            }

            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: 'Plus Jakarta Sans', sans-serif; 
                background-color: var(--bg); 
                color: var(--text);
                line-height: 1.6;
                overflow-x: hidden;
            }

            .container { max-width: 1000px; margin: 0 auto; padding: 4rem 2rem; }
            
            header { text-align: center; margin-bottom: 5rem; position: relative; }
            header::before {
                content: ''; position: absolute; top: -50px; left: 50%; transform: translateX(-50%);
                width: 300px; height: 300px; background: var(--primary-glow);
                filter: blur(100px); border-radius: 50%; z-index: -1;
            }

            h1 { font-size: 3.5rem; font-weight: 800; letter-spacing: -2px; margin-bottom: 1rem; 
                 background: linear-gradient(to right, #fff, var(--primary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            .badge { background: var(--primary); color: white; padding: 0.3rem 0.8rem; border-radius: 20px; font-size: 0.8rem; font-weight: 700; vertical-align: middle; margin-left: 10px; }

            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 4rem; }
            
            .card { 
                background: var(--card-bg); border: 1px solid var(--border); border-radius: 24px; padding: 2rem;
                transition: transform 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
                text-decoration: none; color: inherit;
            }
            .card:hover { transform: translateY(-5px); border-color: var(--primary); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            .card h3 { font-size: 1.25rem; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 10px; }
            .card p { color: var(--text-muted); font-size: 0.95rem; }
            .card .method { font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: var(--accent); font-weight: 800; }

            .doc-section { background: var(--card-bg); border: 1px solid var(--border); border-radius: 24px; padding: 2.5rem; margin-bottom: 2rem; }
            h2 { font-size: 1.75rem; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 12px; }
            
            code { font-family: 'JetBrains Mono', monospace; background: rgba(0,0,0,0.3); padding: 0.2rem 0.4rem; border-radius: 6px; font-size: 0.9em; border: 1px solid var(--border); }
            pre { 
                background: #000; padding: 1.5rem; border-radius: 16px; overflow-x: auto; 
                border: 1px solid var(--border); margin-top: 1rem;
            }
            pre code { background: transparent; border: none; padding: 0; color: #a5b4fc; }

            .param-table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
            .param-table th, .param-table td { text-align: left; padding: 1rem; border-bottom: 1px solid var(--border); }
            .param-table th { color: var(--text-muted); font-weight: 600; font-size: 0.85rem; text-transform: uppercase; }
            .param-table td .type { color: var(--primary); font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; }

            footer { text-align: center; margin-top: 4rem; color: var(--text-muted); font-size: 0.9rem; }
            
            @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            .animate { animation: fadeIn 0.6s ease forwards; }
            .delay-1 { animation-delay: 0.1s; }
            .delay-2 { animation-delay: 0.2s; }
        </style>
    </head>
    <body>
        <div class="container">
            <header class="animate">
                <h1>Freelancer API <span class="badge">v2.0</span></h1>
                <p>Le moteur ultime pour regrouper les meilleures missions Bounties, Hackathons et Jobs Remote.</p>
            </header>

            <div class="grid animate delay-1">
                <a href="/api/projet" class="card">
                    <span class="method">GET</span>
                    <h3>🚀 Bounties GitHub</h3>
                    <p>Accédez aux issues rémunérées sur les plus gros repos Open Source.</p>
                </a>
                <a href="/api/hackathon" class="card">
                    <span class="method">GET</span>
                    <h3>🧠 Hackathons</h3>
                    <p>Découvrez les compétitions actives sourcées directement de Devpost.</p>
                </a>
                <a href="/api/jobs" class="card">
                    <span class="method">GET</span>
                    <h3>💼 Jobs Remote</h3>
                    <p>Offres d'emploi enrichies par IA (DeepSeek) avec liens de candidature directs.</p>
                </a>
            </div>

            <section class="doc-section animate delay-2">
                <h2>📖 Paramètres de Requête</h2>
                <table class="param-table">
                    <thead>
                        <tr>
                            <th>Paramètre</th>
                            <th>Type</th>
                            <th>Défaut</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><code>page</code></td>
                            <td><span class="type">Number</span></td>
                            <td>1</td>
                            <td>Index de la page de résultats.</td>
                        </tr>
                        <tr>
                            <td><code>limit</code></td>
                            <td><span class="type">Number</span></td>
                            <td>50</td>
                            <td>10, 50 ou 100 items par page.</td>
                        </tr>
                        <tr>
                            <td><code>type</code></td>
                            <td><span class="type">String</span></td>
                            <td>null</td>
                            <td>Utilisez <code>all</code> sur /api/projet pour voir toutes les sources.</td>
                        </tr>
                    </tbody>
                </table>
            </section>

            <section class="doc-section animate delay-2">
                <h2>💻 Exemple d'intégration (JavaScript)</h2>
                <pre><code>async function fetchJobs() {
  const response = await fetch('http://localhost:3000/api/jobs?limit=10&page=1');
  const result = await response.json();
  
  if (result.success) {
    console.log(\`Récupéré \${result.count} opportunités !\`);
    console.log(result.data);
  }
}</code></pre>
            </section>

            <footer>
                <p>Propulsé par Antigravity & JULES | © 2026 iamarketings</p>
            </footer>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// Lancement du serveur
app.listen(PORT, () => {
    console.log(`🚀 Serveur en ligne sur http://localhost:${PORT}`);

    startCleanupCron();

    // AI Worker : CRON 10min + premier lancement à +30s
    startAIWorkerCron();
    setTimeout(() => runAIWorkerJob().catch(console.error), 30000);

    // GitHub Bounties : CRON 3h + premier lancement à +5s
    startCronJobs();
    setTimeout(() => runBountyFetcherJob().catch(console.error), 5000);

    // Hackathons : CRON 6h + premier lancement à +10s
    startHackathonCron();
    setTimeout(() => runHackathonFetcherJob().catch(console.error), 10000);

    // Jobs (Remotive/Jobicy) : CRON 12h + premier lancement à +45s
    startJobsCron();
    setTimeout(() => runJobsFetcherJob().catch(console.error), 45000);

    // RSS (Reddit/Upwork/RemoteOK) : CRON 6h + premier lancement à +90s
    startRSSCron();
    setTimeout(() => runRSSFetcherJob().catch(console.error), 90000);
});
