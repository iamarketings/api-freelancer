require('dotenv').config();
const express = require('express');
const { startCronJobs } = require('./src/jobs/bountyFetcher');
const { startCleanupCron } = require('./src/jobs/cleanupClosedBounties');
const { startHackathonCron, runHackathonFetcherJob } = require('./src/jobs/hackathonFetcher');
const { startRemoteOKCron, runRemoteOKFetcherJob } = require('./src/jobs/remoteokFetcher');
const bountiesRouter = require('./src/routes/bounties');
const hackathonRouter = require('./src/routes/hackathon');
const freelanceRouter = require('./src/routes/freelance');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());

// Routes
app.use('/api/projet', bountiesRouter);
app.use('/api/hackathon', hackathonRouter);
app.use('/api/freelance', freelanceRouter);

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
    // Premier lancement décalé de 10s pour ne pas saturer la DB au démarrage
    setTimeout(() => runHackathonFetcherJob().catch(console.error), 10000);

    // Démarrage du récupérateur d'offres RemoteOK (toutes les 12h)
    startRemoteOKCron();
    // Premier lancement décalé de 30s (après Hackathons) pour éviter les écritures simultanées
    setTimeout(() => runRemoteOKFetcherJob().catch(console.error), 30000);
});
