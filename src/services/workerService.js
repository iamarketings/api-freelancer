const db = require('../db/database');

class WorkerPool {
    constructor(maxWorkers = 5) {
        this.maxWorkers = maxWorkers;
        this.activeWorkers = 0;
        this.queue = [];
    }

    /**
     * Ajoute une tâche à la file d'attente
     * @param {Function} taskFunction - Fonction asynchrone à exécuter
     */
    async addTask(taskFunction) {
        return new Promise((resolve, reject) => {
            this.queue.push({ taskFunction, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.activeWorkers >= this.maxWorkers || this.queue.length === 0) {
            return;
        }

        this.activeWorkers++;
        const { taskFunction, resolve, reject } = this.queue.shift();

        try {
            const result = await taskFunction();
            resolve(result);
        } catch (err) {
            reject(err);
        } finally {
            this.activeWorkers--;
            this.processQueue();
        }
    }

    get stats() {
        return {
            active: this.activeWorkers,
            queued: this.queue.length,
            available: this.maxWorkers - this.activeWorkers
        };
    }
}

// Instance unique pour toute l'application
const jobWorkerPool = new WorkerPool(5);

module.exports = { jobWorkerPool };
