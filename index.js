require('dotenv').config();
const express = require('express');
const { startCronJobs } = require('./src/jobs/bountyFetcher');
const { startCleanupCron } = require('./src/jobs/cleanupClosedBounties');
const { startHackathonCron, runHackathonFetcherJob } = require('./src/jobs/hackathonFetcher');
const bountiesRouter = require('./src/routes/bounties');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());

// Routes
app.use('/api/projet', bountiesRouter);

// Handler Route de base
app.get('/', (req, res) => {
    res.send('API Bounty Hunter en ligne ! Visitez /api/projet');
});

// Lancement du serveur
app.listen(PORT, () => {
    console.log(`🚀 Serveur en ligne sur http://localhost:${PORT}`);

    // Démarrage de l'orchestrateur de Tâches de Fond (Le fameux CRON)
    startCronJobs();
    // Démarrage du Nettoyeur de Bounties (tous les jours à minuit)
    startCleanupCron();
    // Démarrage du récupérateur de Hackathons Devpost (toutes les 6h)
    startHackathonCron();
    // Premier lancement immédiat pour peupler la base
    runHackathonFetcherJob().catch(console.error);
});
