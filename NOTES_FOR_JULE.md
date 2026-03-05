# 🚨 NOTES IMPORTANTES POUR JULE (Refactoring & Clean Code)

Salut Jule,

Ce document vise à récapituler toutes les **optimisations critiques et corrections de bugs** qui viennent d'être appliquées sur l'API après que tu aies travaillé dessus. Le code était instable, très coûteux en API IA, et l'architecture n'avait pas été proprement nettoyée après le passage à Supabase.

**Ton objectif principal maintenant est de factoriser tout le code sur la base propre que nous venons d'établir**, en gardant en tête les points ci-dessous.

---

## 1. 💸 Gestion catastrophique de l'IA (Coûts & Rate Limits)

**Ce qui n'allait pas :**
- Ton calcul de `max_tokens` dans `aiQualifier.js` était démesuré (`Math.min(4000, 2000 + Math.floor(length / 4))`). Tu réservais entre 2000 et 4000 tokens pour une sortie JSON qui n'en utilise que 400. Cela faisait exploser la facturation sur OpenRouter pour rien.
- L'utilisation de modèles gratuits (comme `google/gemma-3-27b-it:free`) déclenchait constamment des erreurs **429 (Too Many Requests)** qui bloquaient le processus.
- Le prompt était beaucoup trop long, rempli de règles redondantes et d'informations inutiles, ce qui coûtait très cher en "Input Tokens".
- Les résumés ("summary") demandés à l'IA étaient trop courts (2 phrases max), ce qui nuisait fortement au marketing et à la rétention des utilisateurs sur le site web.

**Ce qui a été corrigé :**
- Passage sur le modèle **DeepSeek (`deepseek/deepseek-chat`)** en modèle primaire via OpenRouter, avec un fallback de secours sur l'API directe DeepSeek (`deepseekClient`). Les modèles "cheap" ou gratuits buggués ont été virés.
- Le `max_tokens` a été fixé en dur à **1500**.
- Le prompt a été largement allégé, optimisé, et l'IA a désormais pour consigne stricte de générer des **résumés détaillés et ultra-engageants (3-4 paragraphes)** dans le nouvel objet "enriched" du payload généré, pour augmenter la conversion du site.

---

## 2. 🐢 Lenteur extrême du Worker (Queue)

**Ce qui n'allait pas :**
- Le worker ne tournait qu'une fois toutes les 10 minutes, et ne sélectionnait que 50 leads `limit(50)`.
- Bien pire : la boucle `for...of` dans `aiWorker.js` traitait les leads **un par un de manière totalement synchrone**, avec des pauses inutiles (`sleep(15000)`). Un lot de 50 leads mettait une éternité à être qualifié.

**Ce qui a été corrigé :**
- Le cron tourne désormais toutes les 20 minutes et tire jusqu'à **500 leads** par lot.
- Le traitement a été massivement parallélisé ! Le script traite la queue par chunks avec **25 workers simultanés en `Promise.all()`**. Ca va infiniment plus vite.
- Ajout d'une boucle `while (hasMoreLeads)` pour que le worker **vide complètement** toute la Queue tant qu'il reste des éléments non qualifiés avant de s'arrêter. 
- La Queue entière a d'ailleurs été purgée.

---

## 3. 🗑️ Architecture polluée (Code mort & Refactoring)

**Ce qui n'allait pas :**
- Tu avais gardé des scripts obsolètes qui dataient de l'ancienne version avec les fichiers JSON locaux (`scripts/cleanJobsDB.js`, `scripts/cleanRemoteOK.js`, `scripts/migrateToSupabase.js`). 
- L'ancien algorithme de scoring (`src/utils/scoringAlgo.js`) traînait encore alors que la nouvelle logique centralisée (`src/jobs/leadScoringAlgo.js`) était en place.
- Le dossier `utils` ne servait littéralement plus à rien.
- Le fichier `schema.sql` traînait dans le dossier `scripts`.

**Ce qui a été corrigé :**
- Les anciens scripts json et migrations ont été **supprimés**.
- Le dossier `src/utils/` a été **banni et supprimé**.
- Le fichier `schema.sql` a été rangé proprement à sa place logique : `src/db/schema.sql`.
- Le repository a été mis à jour (`git commit` + `push`) et le `README.md` modifié pour refléter la bonne arborescence.

---

## 4. 🧮 Nouveau script : estimateAICosts.js

Pour éviter les mauvaises surprises financières, un tout nouveau script a été créé : `scripts/estimateAICosts.js`.
Il simule le token usage de tous les projets qui patientent dans Supabase (`queue`) et sort le coût exact en dollars USD avant même que le Worker IA ne soit lancé. 

---

### 👉 TA MISSION (Jule) :

1. **Ne touche plus** aux timeouts ni aux calculs algorithmiques pétés de `max_tokens` dans `aiQualifier.js`.
2. Applique-toi à **factoriser le code** (extrêmement verbeux dans les Fetchers notamment).
3. Essaie d'isoler les appels réseaux dans des services dédiés pour rendre tout cela un peu plus lisible.
4. Tout le système (Supabase, Fallback OpenAI, Cron) est sain et performant. **Ne le casse pas.**

Bon courage pour le refactoring.
