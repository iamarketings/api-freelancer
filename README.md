# Bounty Hunter API

Bounty Hunter est une API Node.js qui interroge régulièrement la plateforme GitHub pour des "issues" rémunérées (Bounties). Elle trie, score et évalue ces opportunités de travail via une analyse par Intelligence Artificielle (DeepSeek) pour détecter le niveau d'intérêt et les arnaques potentielles.

## 🚀 Fonctionnalités Clés
- **Collecte par CRON** : Synchronise automatiquement les Bounties GitHub via l'API GraphQL toutes les 3 heures.
- **Pagination Intelligente** : Capable de traiter jusqu'à 1000 suggestions de missions simultanément.
- **Scoring System** : Pèse l'intérêt d'une mission en fonction des assignations et du nombre de commentaires concurrents.
- **Analyse IA (DeepSeek)** : Intégration de l'API DeepSeek pour vérifier que l'offre de projet est légitime et en générer un résumé universel.
- **Déploiement Super-Léger** : Utilise le système de base de données JSON `LowDB`. Zéro configuration, aucune compilation C++ n'est requise.

---

## 💻 Installation

1. **Cloner / Télécharger le projet**.
2. **Installer les dépendances** : 
   *(Il est recommandé d'utiliser `pnpm` mais `npm` fonctionne)*
   ```bash
   pnpm install
   ```

3. **Variables d'environnement** :
   Renommez `api/.env.example` en `api/.env` et renseignez-y deux clés obligatoires :
   ```env
   # Le port d'écoute du serveur
   PORT=3000
   
   # Votre token personnel GitHub (utilisé par GraphQL)
   GITHUB_TOKEN=ghp_votreetokengithub
   
   # Votre clé d'API DeepSeek
   DEEPSEEK_API_KEY=sk-votreclefdeepseek
   ```

4. **Lancer le serveur API** :
   ```bash
   node index.js
   ```

---

## 📚 Endpoints (Routes API)

L'API fonctionnera par défaut sur `http://localhost:3000`.

### `GET /api/projet`
Renvoie la liste des Bounties actuels triés par Score (de ceux recommandés en priorité aux moins vitaux).

**Paramètres Query disponibles :**
- `?page=X` (Optionnel) : Le numéro de la page à consulter (Ex: `page=2`).
- `?limit=Y` (Optionnel) : Le nombre de résultats par page (`10`, `50` ou `100` maximum).

### `POST /api/projet/refresh`
Force la synchronisation avec GitHub et lance l'analyse IA des nouveaux projets. _Attention : Ce processus fonctionne en arrière-plan (Batch de 1 par 1 pour sécuriser vos Quotas)._

---

## 🔮 Rapport d'Audit & Améliorations Futures

L'API actuelle est totalement fonctionnelle. Cependant, en cas de déploiement en production massive, voici les goulots d'étranglements ou considérations futures :

### 1. Limites de `LowDB` et Sécurité Concurrentielle (Concurrence DB)
Actuellement, tout est stocké dans un unique fichier `dev.json`. Si le backend doit gérer plusieurs requêtes simultanées de modifications lourdes, un fichier JSON peut casser.
* **Solution future** : Restaurer la base `SQLite3` ou passer sur PostgreSQL lorsque l'environnement d'hébergement supportera les binaires natifs en Node.

### 2. Le Coût et Rate Limit de "DeepSeek"
Si l'application scanne et ajoute subitement 10 000 issues d'un coup, le compte DeepSeek risque d'être plafonné ou de déclencher une facturation importante. La limite d'une seconde introduite couvre la limite de Token/Minutes MAIS ne protège pas du coût.
* **Solution future** : Filtrer agressivement les labels de bases AVANT l'étape DeepSeek.

### 3. Expiration d'Issues Orphelines
Aujourd'hui, si une Issue n'apparaît plus DU TOUT sur GraphQL, elle reste marquée "OPEN" éternellement dans le JSON local.
* **Solution future** : Ajouter un CRON de nettoyage (`Cleanup`) qui passe sur tous les `state: 'OPEN'` existants de `dev.json` afin de valider individuellement si le tracker GitHub les a fermés.
