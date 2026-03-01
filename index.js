require('dotenv').config();
const express = require('express');
const { startCronJobs } = require('./src/jobs/bountyFetcher');
const { startCleanupCron } = require('./src/jobs/cleanupClosedBounties');
const { startHackathonCron, runHackathonFetcherJob } = require('./src/jobs/hackathonFetcher');
const { startRemotiveCron, runRemotiveFetcherJob } = require('./src/jobs/remotiveFetcher');
const { startJobicyCron, runJobicyFetcherJob } = require('./src/jobs/jobicyFetcher');
const bountiesRouter = require('./src/routes/bounties');
const hackathonRouter = require('./src/routes/hackathon');
const freelanceRouter = require('./src/routes/freelance');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());

// Routes
app.use('/api/projet', bountiesRouter);       // GitHub bounties uniquement
app.use('/api/hackathon', hackathonRouter);   // Hackathons Devpost
app.use('/api/freelance', freelanceRouter);   // Offres Remotive + Jobicy (accès direct)

// Route de base
app.get('/', (req, res) => {
    res.send('API Freelancer en ligne ! Routes : /api/projet | /api/hackathon | /api/freelance');
});

// Lancement du serveur
app.listen(PORT, () => {
    console.log(`🚀 Serveur en ligne sur http://localhost:${PORT}`);

    startCronJobs();
    startCleanupCron();

    // Hackathons : CRON 6h + premier lancement à +10s
    startHackathonCron();
    setTimeout(() => runHackathonFetcherJob().catch(console.error), 10000);

    // Remotive : CRON 12h + premier lancement à +45s
    startRemotiveCron();
    setTimeout(() => runRemotiveFetcherJob().catch(console.error), 45000);

    // Jobicy : CRON 12h30 + premier lancement à +90s
    startJobicyCron();
    setTimeout(() => runJobicyFetcherJob().catch(console.error), 90000);
});
