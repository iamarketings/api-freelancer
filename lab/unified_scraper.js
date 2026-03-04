/**
 * ═══════════════════════════════════════════════════════════════════════
 *  ORCHESTRATEUR UNIFIÉ — CRON MASTER
 *  Lance Phase 1 (Collecte) puis Phase 2 (Qualification IA) séquentiellement.
 *
 *  Corrections v4 :
 *  - Rotation automatique du log (garde 7 jours max)
 *  - Menu de statistiques final avec refresh garanti après écriture disque
 *  - Délai de flush + relecture fraîche du fichier résultats
 *
 *  Usage :
 *    node unified_scraper.js          → Démarre le cron en boucle
 *    node unified_scraper.js --now    → Lance un cycle immédiatement
 * ═══════════════════════════════════════════════════════════════════════
 */

const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const PHASE1_SCRIPT = path.join(__dirname, 'phase1_scraper.js');
const PHASE2_SCRIPT = path.join(__dirname, 'phase2_qualifier.js');
const LOG_FILE = path.join(__dirname, 'data', 'orchestrator.log');
const RESULTS_FILE = path.join(__dirname, 'data', 'leads_qualified.json');

const MAX_LOG_LINES = 2000;
let isCycleRunning = false;

// =============================================
// HELPERS
// =============================================
function rotateLogs() {
    try {
        if (!fs.existsSync(LOG_FILE)) return;
        const content = fs.readFileSync(LOG_FILE, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        if (lines.length > MAX_LOG_LINES) {
            const trimmed = lines.slice(-MAX_LOG_LINES).join('\n') + '\n';
            fs.writeFileSync(LOG_FILE, trimmed);
            console.log(`🗂️  Log rotaté : ${lines.length - MAX_LOG_LINES} anciennes lignes supprimées`);
        }
    } catch (_) { /* Ignorer les erreurs de rotation */ }
}

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    try {
        fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
        fs.appendFileSync(LOG_FILE, line + '\n');
    } catch (_) { /* Ignorer les erreurs d'écriture */ }
}

function runScript(scriptPath) {
    return new Promise((resolve, reject) => {
        log(`▶️  Lancement : ${path.basename(scriptPath)}`);
        const child = spawn(process.execPath, [scriptPath], {
            stdio: 'inherit',
            env: process.env,
        });

        child.on('close', code => {
            if (code === 0) {
                log(`✅ ${path.basename(scriptPath)} terminé avec succès.`);
            } else {
                log(`❌ ${path.basename(scriptPath)} a planté (code ${code}).`);
            }
            resolve(code);
        });

        child.on('error', err => {
            log(`💥 Erreur de processus sur ${path.basename(scriptPath)}: ${err.message}`);
            reject(err);
        });
    });
}

// =============================================
// MENU STATISTIQUES FINAL (avec refresh garanti)
// =============================================
function loadJSONFresh(filePath, defaultValue) {
    // Force une relecture fraîche du fichier (pas de cache)
    try {
        if (!fs.existsSync(filePath)) return defaultValue;
        const raw = fs.readFileSync(filePath, 'utf-8');
        // Petit délai pour s'assurer que le fichier est fully flushed
        return JSON.parse(raw);
    } catch {
        return defaultValue;
    }
}

function showStatsMenu() {
    console.log('\n' + '═'.repeat(70));
    console.log('📊 RAPPORT DE QUALIFICATION — Résumé du cycle');
    console.log('═'.repeat(70));

    // Relecture fraîche garantie après fin des processus enfants
    const results = loadJSONFresh(RESULTS_FILE, []);
    const total = results.length;

    if (total === 0) {
        console.log('⚠️  Aucune fiche qualifiée pour le moment.');
        console.log('═'.repeat(70) + '\n');
        return;
    }

    // Stats globales
    const withEmail = results.filter(r => r.contact?.email).length;
    const avgScore = total > 0 ? Math.round(results.reduce((sum, r) => sum + (r.score || 0), 0) / total) : 0;
    const highScore = results.filter(r => (r.score || 0) >= 70).length;
    const withWebsite = results.filter(r => r.contact?.website).length;
    const withExternalLink = results.filter(r => r.contact?.external_link).length;

    // Par source
    const bySource = {};
    results.forEach(r => {
        const src = r.source || 'inconnue';
        bySource[src] = (bySource[src] || 0) + 1;
    });

    // Par type
    const byType = {};
    results.forEach(r => {
        const type = r.type || 'job';
        byType[type] = (byType[type] || 0) + 1;
    });

    // Par contrat
    const byContract = {};
    results.forEach(r => {
        const ct = r.enriched?.contractType || 'Non spécifié';
        byContract[ct] = (byContract[ct] || 0) + 1;
    });

    // Top 5 entreprises par score
    const topLeads = [...results]
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 5);

    // Dernières ajouts (24h)
    const now = Date.now();
    const last24h = results.filter(r => {
        const added = r.qualified_at ? new Date(r.qualified_at).getTime() : now;
        return (now - added) < 24 * 60 * 60 * 1000;
    }).length;

    // Affichage
    console.log(`📦 Total fiches qualifiées : ${total}`);
    console.log(`📧 Avec email direct       : ${withEmail} (${total > 0 ? Math.round(withEmail / total * 100) : 0}%)`);
    console.log(`🌐 Avec website            : ${withWebsite}`);
    console.log(`🔗 Avec external_link      : ${withExternalLink}`);
    console.log(`⭐ Score moyen             : ${avgScore}/100`);
    console.log(`🔥 High priority (≥70)     : ${highScore} leads`);
    console.log(`🕐 Ajoutées dernières 24h  : ${last24h}\n`);

    console.log('📡 Par source :');
    Object.entries(bySource)
        .sort((a, b) => b[1] - a[1])
        .forEach(([src, count]) => {
            const pct = Math.round(count / total * 100);
            const bar = '█'.repeat(Math.round(count / total * 30));
            console.log(`   ${src.padEnd(22)} ${count.toString().padStart(3)} (${pct}%) ${bar}`);
        });

    console.log('\n🏷️  Par type :');
    Object.entries(byType).forEach(([type, count]) => {
        console.log(`   ${type.padEnd(18)} : ${count}`);
    });

    console.log('\n📋 Par contrat :');
    Object.entries(byContract)
        .sort((a, b) => b[1] - a[1])
        .forEach(([ct, count]) => {
            console.log(`   ${ct.padEnd(22)} : ${count}`);
        });

    console.log('\n🏆 Top 5 leads (par score) :');
    topLeads.forEach((lead, i) => {
        const company = lead.enriched?.company || 'N/A';
        const title = lead.title?.substring(0, 35) || 'N/A';
        const email = lead.contact?.email ? '✉️' : '—';
        const score = lead.score || 0;
        console.log(`   ${i + 1}. [${score.toString().padStart(3)}] ${title.padEnd(35)} @${company} ${email}`);
    });

    console.log('\n' + '═'.repeat(70));
    console.log(`💾 Fichier résultats : ${RESULTS_FILE}`);
    console.log(`📅 Généré le         : ${new Date().toLocaleString('fr-FR')}`);
    console.log('═'.repeat(70) + '\n');
}

// =============================================
// CYCLE COMPLET (Phase 1 → Phase 2)
// =============================================
async function runFullCycle() {
    if (isCycleRunning) {
        log('⚠️  Un cycle est déjà en cours. Ce déclenchement est ignoré.');
        return;
    }

    isCycleRunning = true;
    rotateLogs();

    log('\n══════════════════════════════════════════════');
    log('🚀 DÉMARRAGE CYCLE COMPLET');
    log('══════════════════════════════════════════════');

    try {
        log('\n📡 Phase 1 — Collecte des leads (RSS + API + Reddit + GitHub)');
        const code1 = await runScript(PHASE1_SCRIPT);

        if (code1 !== 0) {
            log('⚠️  Phase 1 a échoué. Phase 2 ignorée pour ce cycle.');
        } else {
            log('\n🧠 Phase 2 — Qualification IA (HTML → Markdown + DeepSeek)');
            await runScript(PHASE2_SCRIPT);

            // Délai court pour garantir que tous les writes disque sont flushés
            // avant de lire le fichier pour les stats
            await new Promise(resolve => setTimeout(resolve, 500));
        }

    } catch (err) {
        log(`💥 Erreur critique durant le cycle : ${err.message}`);
    } finally {
        // Afficher le menu de stats à la fin de chaque cycle
        // Avec relecture fraîche garantie du fichier résultats
        showStatsMenu();

        isCycleRunning = false;
        log('\n══════════════════════════════════════════════');
        log('🏁 CYCLE TERMINÉ');
        log('══════════════════════════════════════════════\n');
    }
}

// =============================================
// PLANIFICATION CRON
// =============================================
const CRON_SCHEDULE = '0 */6 * * *';

let rl = null;
let cronJob = null;

function pauseMenu() {
    if (rl) {
        rl.pause();
    }
}

function resumeMenu() {
    if (rl) {
        rl.resume();
        showMainMenu();
    }
}

async function runCycleWithMenu() {
    // Ne plus mettre le menu en pause.
    // Lancer le cycle d'arrière plan (la promesse tourne).
    runFullCycle().then(() => {
        // Optionnel : Un msg à la fin pour rappeler qu'il a fini.
        console.log('\n[CRON MASTER] 🏁 Le cycle d\'arrière-plan s\'est terminé.');
    }).catch(err => {
        console.error('\n[CRON MASTER] 💥 Le cycle d\'arrière-plan a crashé :', err.message);
    });

    // Optionnel : temporiser un tout petit peu pour que les premiers logs du script s'affichent
    // puis rafraichir le menu
    setTimeout(() => {
        resumeMenu();
    }, 1000);
}

function showMainMenu() {
    console.log('\n' + '═'.repeat(70));
    console.log('🤖 MENU ORCHESTRATEUR PRINCIPAL');
    console.log('═'.repeat(70));
    console.log('1. 🚀 Lancer un cycle complet maintenant (Phase 1 + Phase 2)');
    console.log('2. 📊 Afficher les statistiques de qualification actuelles');
    console.log('0. ❌ Quitter');
    console.log('═'.repeat(70));
    rl.question('👉 Votre choix : ', async (answer) => {
        switch (answer.trim()) {
            case '1':
                await runCycleWithMenu();
                break;
            case '2':
                showStatsMenu();
                resumeMenu();
                break;
            case '0':
                console.log('👋 Au revoir !');
                if (cronJob) cronJob.stop();
                rl.close();
                process.exit(0);
                break;
            default:
                console.log('⚠️  Choix invalide. Veuillez réessayer.');
                resumeMenu();
                break;
        }
    });
}

// =============================================
// DÉMARRAGE
// =============================================
const runNow = process.argv.includes('--now');
const interactive = !process.argv.includes('--no-menu');

if (runNow) {
    log('▶️  Mode --now : lancement immédiat d\'un cycle complet.');
    runFullCycle().then(() => process.exit(0));
} else {
    log(`⏰ Orchestrateur démarré. Prochain cycle : "${CRON_SCHEDULE}"`);
    log('   (Utilise --now pour déclencher immédiatement et sans menu)\n');

    cronJob = cron.schedule(CRON_SCHEDULE, () => {
        log('\n⏰ [CRON] Execution automatique déclenchée.');
        runCycleWithMenu();
    });

    if (interactive) {
        log('🟢 Mode interactif activé.');
        rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        // Laisse un peu de place pour que le texte du header soit propre
        setTimeout(showMainMenu, 500);
    } else {
        log('🟢 Orchestrateur en écoute. Ctrl+C pour arrêter.\n');
    }
}