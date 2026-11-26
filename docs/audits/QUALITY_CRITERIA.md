# Critères de qualité — Ascend (NexusMind)

> Tenu par la session **Audit** (voir `docs/TEAM_ROLES.md`). Créé le 19/11/2026.
> Chaque critère a : une **règle** précise, une **vérification** (commande,
> fichier, test ou passage dans le harnais) et un **seuil** pour être respecté.
> Une livraison ne part en release que si tous les critères **P1** sont
> respectés ou ont une dérogation écrite de l'utilisateur.
>
> Ce document ne refait pas l'audit : il s'appuie sur `docs/audits/AUDIT_APP_2026-11.md`
> (identifiants E.., UI-.., L.., WSC-.., T.., S.., D..) et, pour la sécurité, sur
> `docs/AUDIT_SECURITE.md` et la session **CyberSecurity**.

## Comment lire les statuts

- ✅ **respecté** · ❌ **non respecté** · ⏳ **non vérifié** (vérification
  impossible en lecture seule, ou qui revient à une autre session).
- **Priorité** : **P1** bloque une release ; **P2** à corriger dans les deux
  prochaines versions ; **P3** dette à résorber au fil de l'eau.
- Première passe : 19/11/2026, `main` à `41f457c` (+ fichiers non commités des
  autres sessions), version `1.0.0-beta.7`. Lecture seule.

### Mesures de référence de la passe du 19/11

| Commande | Résultat |
|---|---|
| `npm run typecheck` | 0 erreur (3 tsconfig) |
| `npm run lint` | 0 erreur, 0 avertissement |
| `npm run check:i18n` | OK — 3 112 clés, en/fr synchronisées |
| `npx vitest run` | 101 fichiers, **1 502 / 1 502** tests verts |
| `out/renderer/assets/index-*.js` | 4 527 ko (non minifié) |

---

## 1. Design UI/UX

| ID | Règle | Vérification | Seuil | Prio | Statut | Preuve |
|---|---|---|---|---|---|---|
| UX-1 | Tout changement visuel est maquetté dans Penpot et validé par l'utilisateur avant le code. | Lien vers la page Penpot dans le compte rendu de la tâche. | 100 % des changements visuels livrés. | P2 | ⏳ | Processus nouveau (19/11) : à contrôler livraison par livraison. |
| UX-2 | Couleurs, rayons et ombres viennent des tokens de thème (`tailwind.config.ts`, CSS des thèmes), pas de valeurs en dur. | `grep -rnoE "#[0-9a-fA-F]{6}\b" src/pages src/components --include=*.tsx \| wc -l` et `grep -rnoE "\[(#\|rgb)[^]]*\]" … \| wc -l` | En baisse à chaque version ; 0 dans tout nouveau fichier. | P3 | ❌ | 385 hex en dur et 223 valeurs arbitraires Tailwind dans `src/pages` + `src/components`. |
| UX-3 | Une même notion a une seule représentation (rôles, échelles de winrate, couleurs de tiers). | Recherche des copies (`ROLES`, échelles de couleur). | Une source par notion. | P2 | ✅ | 19/11 : couleurs de tiers unifiées (#6), `ROLES` depuis `championRoles.ts:249`, une seule échelle de winrate dans `src/lib/winrate.ts` (tâche K). Restent 2 copies mineures de la liste des rôles (`LFT_ROLES`, `SCORE_ROLES`, P3) ; `MistakeStatsPage` garde les noms Riot (`MIDDLE`, `BOTTOM`, `UTILITY`), un autre domaine. |
| UX-4 | Tout écran nouveau ou modifié est vu dans le harnais (`.harness/`, port 5199) en FR et EN, thème clair et sombre, avant livraison. | Capture du harnais dans le compte rendu. | Tous les écrans touchés. | P1 | ⏳ | À contrôler à chaque livraison. `4ffef1d` est marqué « UI not yet checked » ; le handoff dit qu'elle l'a été depuis (deux groupes). |
| UX-5 | Pas d'action morte : chaque bouton visible fait quelque chose. | Revue des props jamais passées. | 0 bouton sans effet. | P2 | ✅ | 19/11 : « Choisir » ajoute l'objectif (`SessionPage.tsx:827`, `onAccept` à l'étape des objectifs) ; E15-B : l'affichage de `tempShareUrl` est retiré (plus aucune occurrence dans `src`). `youtubeUrl` reste affiché, et c'est voulu : liens collés ou envois antérieurs. |
| UX-6 | Les états de chargement longs ont un indicateur. | Revue des téléchargements et calculs > 2 s. | 100 %. | P2 | ❌ | Handoff #5 : téléchargement du modèle de détourage (224 Mo) sans indicateur. |

## 2. Front-end (renderer desktop + web app)

| ID | Règle | Vérification | Seuil | Prio | Statut | Preuve |
|---|---|---|---|---|---|---|
| FE-1 | Typecheck des trois projets sans erreur. | `npm run typecheck` | 0 erreur. | P1 | ✅ | Passe du 19/11 : EXIT 0. |
| FE-2 | ESLint sans erreur ni avertissement non justifié. | `npm run lint` | 0 erreur, 0 avertissement (un `eslint-disable` porte un commentaire). | P1 | ✅ | Passe du 19/11 : 0 / 0. |
| FE-3 | Pas de contournement du typage de l'API IPC. | `grep -rn "window.api as any" src \| wc -l` | 0. | P2 | ✅ | 19/11 (tâche J) : 0 occurrence dans `src` et `web/src` ; types de `ipc.ts` corrigés ; typecheck EXIT 0. |
| FE-4 | L'adaptateur web implémente ce que les pages web appellent. | `web/src/api.ts` typé `satisfies Partial<AscendAPI>` + test de couverture (WSC-16). | Test présent et vert. | P1 | ✅ | 19/11 (#18) : `web/src/apiContract.ts` vérifie par les types, via `npm run typecheck`, le preload contre `AscendAPI` (sans méthode en trop) et `webApi` contre `Partial<AscendAPI>`. `tests/unit/webApiCoverage.test.ts` parcourt le bundle web (166 fichiers) : chaque appel non gardé doit exister. Les 3 types de dérive ont été prouvés détectés (voir « Revues de livraisons »). |
| FE-5 | Pas de requêtes en double ni de polling inutile. | Onglet réseau du harnais au repos, 1 min. | ≤ 3 appels Supabase/min au repos ; 1 seul chargement des groupes au lancement. | P2 | ❌ | UI-11/L02/WSC-07 : ~12 appels/min au repos, 12 requêtes identiques au lancement (`useCollab`). |
| FE-6 | Le code partagé n'est pas dupliqué entre composants (helpers, éditeur de clip, `m:ss`). | Revue de code des livraisons. | Pas de nouvelle copie. | P3 | ❌ | UI-14, UI-16, L17 encore ouverts. |
| FE-7 | DOM valide : pas d'élément interactif dans un autre. | Revue + avertissement React en console du harnais. | 0. | P2 | ✅ | 19/11 (revue #6) : la puce d'adversaire de `ScoutingTab.tsx` est séparée en deux boutons frères ; `jsx-a11y` en erreur depuis #36. Avant : UI-B2. |
| FE-8 | **Toute origine externe ajoutée au renderer (image, fetch, média, iframe) figure dans la CSP du build réel** : desktop (`RENDERER_CSP` de `electron.vite.config.ts`, injectée dans `out/renderer/index.html`) **et** web (`web/public/_headers`, copié dans `web/dist/_headers`). Le harnais n'a **pas** de CSP : il ne peut pas servir de preuve. | 1. Relever les origines utilisées : `grep -rhoE "https://[a-z0-9.-]+\.[a-z]{2,}" src web/src --include=*.ts --include=*.tsx \| sort -u`, et pour chacune la directive concernée (`<img src>` → `img-src`, `fetch` → `connect-src`, `<video>`/`<audio>` → `media-src`, `<iframe>` → `frame-src`). 2. `npm run build` puis lire la balise `<meta http-equiv="Content-Security-Policy">` de `out/renderer/index.html` ; `npm run web:build` puis lire `web/dist/_headers`. 3. Pour une livraison qui ajoute une origine : ouvrir l'écran dans l'app packagée (ou `npm run preview`) et dans la web app, **console sans « Refused to load »**. | 0 origine utilisée absente de la CSP ; vérifié sur un build, pas dans le harnais. | P1 | ✅ | **21/11, beta.12 :** `npm run build` puis `out/renderer/index.html` (meta décodé) : `img-src` contient `https://ascend-cutouts.nexusmind-riot-proxy.workers.dev` et `https://i.ytimg.com`. `npm run web:build` puis `web/dist/_headers` : les deux aussi. Relevé des origines de `src` et `web/src` : aucune autre origine chargée hors CSP (`discord.com` et `youtube.com` ne sont que des placeholders ou des commentaires ; les iframes YouTube sont en `frame-src`). Console de l'app packagée non relue (build lu seulement). **Avant le correctif :** **(a)** `https://ascend-cutouts.nexusmind-riot-proxy.workers.dev` (détourés, #51) est dans la CSP web mais **absent de la CSP desktop** (`electron.vite.config.ts:24`) : détourés bloqués dans la beta.11, correctif attendu en beta.12. **(b)** `https://i.ytimg.com` (vignettes officielles du Codex, `src/lib/microReview/codex.ts:79`, affichées par `CodexCard.tsx:54`) est **absent des deux CSP** : ces vignettes sont bloquées sur desktop et sur le web. Précédent : les logos de groupe le 19/11. |

## 3. Back-end (processus principal Electron et `src/lib/*Core.ts`)

| ID | Règle | Vérification | Seuil | Prio | Statut | Preuve |
|---|---|---|---|---|---|---|
| BE-1 | Toute entrée IPC est validée (zod via `validatedHandle`). | `grep -rn "ipcMain.handle(" electron/main` vs `validatedHandle(`. | 0 `ipcMain.handle` brut hors liste justifiée. | P1 | ⏳ | 130 `ipcMain.handle(` bruts pour 188 `validatedHandle(` : à recouper avec CyberSecurity (S7) avant de conclure. |
| BE-2 | La logique métier vit dans des modules `*Core.ts` testables ; les handlers IPC ne font que câbler. | Taille des `*.ipc.ts`, fonctions pures non testées. | Aucun `*.ipc.ts` > 800 lignes ; toute nouvelle logique dans un Core testé. | P3 | ❌ | E25 : `team.ipc.ts` ~1 650 lignes ; E27 (fonctions atteintes par variables de module). |
| BE-3 | Le flux post-partie rattache la bonne partie. | Test unitaire de l'enrichissement + 2 vraies parties enchaînées. | Test présent ; essai réel OK. | P1 | ❌ | E10 non corrigé (`gameDetector.ts`, `enrichWithMatchApi`) : peut attacher la partie précédente, ne trouve jamais une normale ni une Arena. |
| BE-4 | Les règles du moteur suivent l'horloge de la saison en cours (2026). | `docs/moteur/RAPPORT_MOTEUR.md` + tests des détecteurs. | 0 règle sur l'horloge 2025. | P2 | ❌ | Handoff #4 : plaques, roam mid, tour latérale, M12 encore en 2025. |
| BE-5 | Pas de travail bloquant avant la fenêtre ni de `spawnSync` à l'import. | Lecture de `index.ts`, `recorder.ts` ; temps de démarrage mesuré. | Fenêtre affichée < 2 s après le lancement (machine de dev). | P2 | ⏳ | 19/11 (tâche H) : la sonde ffmpeg est paresseuse (`recorder.ts`, résolution et `spawnSync` au premier usage, plus à l'import) ; triggers et seed allégés au démarrage. **Le seuil (fenêtre en moins de 2 s) n'est pas mesuré** : à chronométrer sur un lancement packagé. |
| BE-6 | Les secrets ne sont jamais inlinés dans le bundle (`MAIN_VITE_*` = public). | `grep -rn "MAIN_VITE_" electron/` ; contrôle de `app.asar`. | 0 secret. | P1 | ❌ | Voir SEC-2 (secret OAuth YouTube). Porté par CyberSecurity. |
| BE-7 | Les erreurs du processus principal sont journalisées dans un fichier lisible par l'utilisateur pour les rapports de bug. | Existence d'un log fichier + lien depuis le rapport de bug. | Présent. | P3 | ⏳ | Non vérifié dans cette passe ; 87 `console.log` dans `src` + `electron` hors tests. |

## 4. Données (Prisma/SQLite, sync, Supabase/RLS)

| ID | Règle | Vérification | Seuil | Prio | Statut | Preuve |
|---|---|---|---|---|---|---|
| DA-1 | Migrations locales écrites à la main dans `prisma/migrations/<date>_<nom>/`, jamais `prisma migrate dev`, pas de `;` dans les commentaires SQL. | Revue de chaque nouvelle migration ; `grep -n "^--.*;" prisma/migrations/*/migration.sql`. | 0 écart. | P1 | ✅ | 19/11 (#19, non commité) : script `prisma:migrate` retiré de `package.json`. Plus aucune mention de `migrate dev` hors des docs, qui l'interdisent. |
| DA-2 | Le runner de migrations ne masque pas une migration cassée. | Lecture de `electron/main/database.ts`. | Une erreur « no such column » inattendue fait échouer la migration. | P2 | ✅ | 19/11, second lot : `UNIQUE constraint failed` n'est **plus toléré du tout** (`isAlreadyAppliedError`). Les copies de reconstruction (`new_Session` ×2, `new_User`, `Recording_v2`) passent en `INSERT OR IGNORE`, pour qu'une reprise après interruption saute seulement les lignes déjà copiées. Le runner n'a pas de somme de contrôle, donc modifier ces anciennes migrations ne touche pas les bases déjà migrées. Tests sur vraie base (`ipcHandlers.test.ts:92-166`) : faute de frappe sur une colonne, donc échec et migration en attente ; reconstruction en échec UNIQUE, donc arrêt, ancienne table gardée, migration en attente ; `CREATE UNIQUE INDEX` sur des doublons, donc échec. Historique — avant ce lot : `no such column` / `no such index` n'étaient déjà plus tolérés que sur `DROP COLUMN` / `DROP INDEX` (`database.ts:64-74`), **mais `UNIQUE constraint failed` restait toléré pour toute instruction.** Dans une reconstruction de table SQLite (`INSERT INTO "new_X" SELECT …`, puis `DROP TABLE`, puis `RENAME` ; utilisée par 2 migrations), un échec UNIQUE sauterait la copie, puis supprimerait l'ancienne table : **perte de données silencieuse**. Un `CREATE UNIQUE INDEX` sur des doublons serait aussi marqué appliqué sans index. Voir la revue du lot J/Q/T/X/A-F. |
| DA-3 | La sync filtre explicitement par uid, jamais par la RLS seule. | `grep -n "eq('user_id'" electron/main/sync/syncService.ts` ; test `syncEngine.test.ts`. | Chaque lecture de `sync_records` filtre l'uid. | P1 | ✅ | `syncService.ts:38` et `:49` filtrent `user_id` ; `syncAudit.ts` détecte les lignes étrangères. |
| DA-4 | La base Supabase de production est recréable depuis le dépôt. | `supabase/migrations/` comparé à la production (lecture seule) ; `supabase/config.toml`. | 100 % des tables, RPC et policies versionnées. | P1 | ✅ | 20/11 : les 15 migrations de production manquantes sont restaurées mot pour mot ; les 21 fichiers portent leur version de production. `node scripts/test-schema-baseline.mjs <pglite 0.3.x>` : 58 migrations de production toutes présentes, rejeu dans l'ordre de la production **et** dans l'ordre des fichiers, **139 objets identiques** à `supabase/baseline/prod_schema_20261120.txt`, contrôle négatif qui détecte une modification. Fichier de référence **recalculé en production** (lecture seule) le 20/11 : même md5 (`8396bb9b…`), 139 objets. Pas de `config.toml` (non nécessaire au rejeu). Avant : WSC-05, 17 tables, 2 RPC et une migration prérequise absentes du dépôt. |
| DA-5 | Écritures en série groupées dans une transaction. | `grep -rn "\$transaction" electron/main \| wc -l` et revue des boucles d'écriture. | Toute boucle de > 10 écritures dans une transaction. | P3 | ❌ | 2 usages de `$transaction` ; E07 liste 5 boucles sans transaction. |
| DA-6 | Les tables de cache ont une politique de taille. | Lecture du schéma + `backupCore.ts`. | Purge ou plafond documenté. | P2 | ❌ | E06 : `MatchCache` grossit sans limite et part dans chaque sauvegarde. |
| DA-7 | Les lectures ne chargent que les colonnes utilisées et filtrent côté serveur. | Revue des `select` Prisma et des requêtes Supabase. | Pas de lecture de table entière côté client. | P2 | ❌ | WSC-06 : `getSharedTeam` lit toute `team_pool_entries` (aussi en rôle service dans le bot) ; WSC-08. |
| DA-8 | Toute écriture en production a l'accord explicite de l'utilisateur. | Compte rendu de la session + migration versionnée. | 100 %. | P1 | ✅ | Les deux migrations du 19/11 ont été faites avec accord et sont versionnées (`supabase/migrations/20261119*`). |

## 5. Sécurité

Ce volet est tenu par la session **CyberSecurity** (`docs/AUDIT_SECURITE.md`,
checklist S1-S8 de `docs/archive/ROADMAP_2026-11-18.md`). L'Audit ne refait pas ses constats : il
reprend les critères pour le verdict de release et se range à ses conclusions.

| ID | Règle | Vérification | Seuil | Prio | Statut | Preuve |
|---|---|---|---|---|---|---|
| SEC-1 | Aucune clé active inutile sur les postes de dev ; les clés exposées sont révoquées. | Noms des variables de `.env` (pas les valeurs). | 0 clé à révoquer. | P1 | ❌ | Handoff #13 : `MAIN_VITE_OPENAI_API_KEY` encore dans `.env`, et `GH_TOKEN` inutilisé. |
| SEC-2 | Aucun secret dans un installeur publié. | `AUDIT_SECURITE.md` § 3bis. | 0. | P1 | ❌ | Secret OAuth YouTube embarqué (`youtube.ipc.ts`). |
| SEC-3 | Fenêtres Electron : `contextIsolation`, `sandbox`, pas de `nodeIntegration`. | `grep -rn "sandbox\|contextIsolation\|nodeIntegration" electron/main`. | Toutes les `BrowserWindow`. | P1 | ✅ | `index.ts:282-287`, `lftPoster.ts:54-56` ; `wgcRecorder.ts:123` à confirmer par CyberSecurity (S7). |
| SEC-4 | Binaires téléchargés au build vérifiés par empreinte. | `grep -n "sha256\|createHash" scripts/download-ffmpeg.mjs`. | Empreinte épinglée. | P1 | ❌ | Aucune vérification (S3). |
| SEC-5 | `npm audit` sans vulnérabilité haute non justifiée. | `npm audit --omit=dev`. | 0 haute sans dérogation écrite. | P2 | ❌ | `zod@3.25.76` (haute) et `react-router-dom@6.30.6` (modérée) toujours en place ; dérogation motivée dans `AUDIT_SECURITE.md` § 1. |
| SEC-6 | CSP stricte sur la web app et le site (pas de `unsafe-eval`, `unsafe-inline` seulement si justifié). | `web/public/_headers`, `site/public/_headers`. | Conforme. | P2 | ⏳ | Web : `style-src 'unsafe-inline'` ; le reste est strict. Gardé pour le site seulement à cause du pipeline mort (WSC-10/13). Verdict à CyberSecurity. |
| SEC-7 | Protection « mot de passe compromis » de Supabase activée. | Tableau de bord Supabase / `get_advisors`. | Activée. | P2 | ⏳ | Action manuelle demandée dans `AUDIT_SECURITE.md` § 2 ; état actuel non relu. |
| SEC-8 | Le consentement porte sur les textes légaux en vigueur. | `src/legal/*.md` vs `site/src/legal`. | Même version. | P1 | ❌ | L'app affiche la v0.1 « brouillon » (`src/legal/privacy.fr.md:3`) ; le site publie la v0.2 (L06). |

## 6. Tests

| ID | Règle | Vérification | Seuil | Prio | Statut | Preuve |
|---|---|---|---|---|---|---|
| TE-1 | Tous les tests unitaires passent. | `npx vitest run` | 100 % verts. | P1 | ✅ | 1 502 / 1 502 (101 fichiers). |
| TE-2 | Les e2e Electron passent sur l'app buildée. | `npm run test:e2e` | 100 % verts. | P1 | ✅ | 19/11 14:00, `41f457c` : **39 / 39** en 1,6 min (voir « Verdict beta.8 »). |
| TE-3 | Tout correctif de bug ajoute un test de non-régression. | Diff de la livraison. | 1 test par bug corrigé (sauf impossibilité justifiée). | P1 | ⏳ | Contrôlé à chaque livraison à partir de maintenant. |
| TE-4 | Les tests testent le code de l'app, pas des copies. | Revue de `tests/unit/recordPage.test.ts`, `recordingMatch.test.ts`. | 0 copie. | P2 | ✅ | 19/11 (tâche Q) : `recordPage.test.ts` importe `src/lib/recordPageCore.ts`, que `RecordPage.tsx` utilise aussi ; `recordingMatch.test.ts` importe `electron/main/recordingMatch`. Plus de copie testée. |
| TE-5 | Les tests sont typecheckés. | Existence d'un `tsconfig.tests.json` appelé par `npm run typecheck`. | Présent, 0 erreur. | P2 | ✅ | 19/11 (tâche D) : `npm run typecheck` inclut `tsc --noEmit -p tsconfig.tests.json` ; EXIT 0. |
| TE-6 | Les modules partagés avec le web, le bot et le site ont une vérification dans la CI. | `.github/workflows/ci.yml`. | Typecheck des workers + `npm run site:build` en CI. | P2 | ✅ | 19/11 (tâche E) : `ci.yml` lance `npm run site:build` et le typecheck des workers `discord-bot` et `riot-proxy` (`npm ci --ignore-scripts` puis `tsc --noEmit`). Les trois passent en local (EXIT 0). |
| TE-7 | Les aides de test ne sont pas copiées entre fichiers. | Revue. | Un module d'aides partagé. | P3 | ❌ | T5/T6 : faux client Supabase dans 14 fichiers. |
| TE-8 | Les tests sont déterministes : pas de seuil de durée en millisecondes dans la suite unitaire. | `grep -rn "performance.now" tests/unit` + suite lancée sur une machine chargée. | 0 échec intermittent. | P2 | ✅ | `anomalyDetectorMathPatterns.test.ts:709` : seuil passé de 5 à 50 ms le 19/11. Le test avait échoué sous charge à 10,4 ms. Un seuil de durée large reste toléré ; un nouveau seuil serré est refusé en revue. |

## 7. Performance

| ID | Règle | Vérification | Seuil | Prio | Statut | Preuve |
|---|---|---|---|---|---|---|
| PE-1 | Bundle renderer de production minifié. | `electron.vite.config.ts` ; taille de `out/renderer/assets/index-*.js`. | Minifié ; < 3 Mo. | P2 | ❌ | 19/11 (tâche F) : `minify: 'esbuild'`, `keepNames: true` (piles d'erreurs lisibles), `sourcemap: false` (`electron.vite.config.ts:75-79`). Renderer : **2 844 ko** (4 527 avant, −37 %). **20/11 : régression à 3 123 ko** (+280 ko, chunk unique) : voir `docs/audits/AUDIT_PERF.md` § 2 n° 1. |
| PE-2 | Routes hors démarrage chargées à la demande. | `grep -c "lazy(" src/App.tsx`. | Routes lourdes (stats, revue vidéo, coaching) en `React.lazy`. | P3 | ❌ | 0 (UI-09, WSC-20 pour le web). |
| PE-3 | Pas de parsing de timeline répété sur le thread principal. | Profil du tableau de bord ; revue de `stats.ipc.ts`. | Une timeline parsée au plus une fois par session. | P2 | ✅ | 19/11 (tâche G) : `electron/main/detailedStatsMemo.ts` (mémo des stats détaillées, lu par `stats.ipc.ts`) ; le flux post-partie fait un seul `getMatch` et un seul parse. Avant : E02 (~40 `JSON.parse` de 0,5-2 Mo par visite du tableau de bord), E09. Gain non mesuré en temps. |
| PE-4 | Application au repos économe (fenêtre réduite incluse). | Réseau du harnais ; `backgroundThrottling`. | Voir FE-5. | P2 | ❌ | `backgroundThrottling: false` (`index.ts:295`) + polling UI-11. |
| PE-5 | Installeur sans poids mort. | `npm run dist:dir` puis taille de `release/win-unpacked`. | < 250 Mo ; pas de runtime ONNX d'autres plateformes, pas de source maps. | P2 | ⏳ | Exclusions de l'audit fusionnées, mais P2 (ONNX, 363 Mo) et D3/D4 en attente ; build de contrôle non fait. |
| PE-6 | Démarrage rapide. | e2e sur l'app compilée (`firstWindow`, puis `main` rempli), 3 essais, copie d'une vraie base. | À chaud : fenêtre < 1,5 s, tableau de bord < 2 s. 1er lancement après mise à jour < 3 s. | P2 | ✅ | 20/11 : à chaud 0,83-0,85 s / 0,97-0,99 s ; 1er lancement 2,95 s / 3,13 s (copie de 494 Mo de la base avant la migration), à la limite. |
| PE-7 | Pages principales rapides. | Même e2e : navigation par hash, attente de la fin des spinners. | < 300 ms par page sur la vraie base. | P2 | ✅ | 20/11 : 43-143 ms (réglages la plus lente). Pages d'équipe (réseau) non mesurées, cloud coupé. |
| PE-8 | Peu de requêtes au repos. | `pg_stat_statements` (lecture), remis à zéro puis relu à J+2 ; réseau du harnais. | ≤ 3 req/min Supabase par client, fenêtre visible ; ≈ 0 fenêtre masquée. | P2 | ❌ | 12-20/11 : 9,6 req/min au total (avant le lot 1) ; 54 % = notifications / annonces / sessions en polling. À remesurer après le lot 1. |
| PE-9 | Bundles initiaux légers. | Taille de `out/renderer/assets/index-*.js` ; gzip du JS initial de `web/dist`. | Desktop : chunk initial < 2,5 Mo. Web : < 600 Ko gzip. | P2 | ❌ | 20/11 : desktop 3 123 ko, web 807 ko gzip, un seul chunk chacun. |
| PE-10 | Stockage local maîtrisé. | Taille de `data/nexusmind.db` et de `data/backups` d'un utilisateur actif. | Base < 300 Mo ; `backups` < 1 Go. | P2 | ❌ | 20/11 : base 494 Mo (timelines 301 Mo), backups 2,1 Go. |

## 8. i18n

| ID | Règle | Vérification | Seuil | Prio | Statut | Preuve |
|---|---|---|---|---|---|---|
| I18N-1 | en et fr ont les mêmes clés ; toute clé littérale utilisée existe. | `npm run check:i18n` | OK. | P1 | ✅ | « i18n OK — 3112 keys ». |
| I18N-2 | Aucun texte visible en dur dans les composants. | Recherche d'accents / phrases dans les `.tsx` hors `t()`. | 0 dans les fichiers livrés. | P2 | ✅ | 19/11, second lot : les ~25 restes sont traduits. Recherche heuristique (toasts `title: '…'`, phrases anglaises entre balises) sur `src/components`, `src/pages` et `web/src` : **0 résultat**. Historique — avant le second lot, il restait environ 25 textes en dur :<br>- `SettingsPage.tsx` : zone « Clear recent data » et « Reset everything », toasts des webhooks, « Setup required » (l. 1063-1140, 1190-1264, 1426-1479, 1747) ;<br>- `ReviewPage.tsx:590-593` ;<br>- `Onboarding/AccountPickerStep.tsx:27,36` ;<br>- `SynergyPlayerCard.tsx:104` ;<br>- `NotificationPrefsCard.tsx:36` ;<br>- `FundamentalPickerDialog.tsx:63,73,267,342`, en français seul. |
| I18N-3 | Pas de clé morte. | `check-i18n.mjs --unused` (à créer, L22). | 0 nouvelle clé morte. | P3 | ❌ | Le script ne détecte pas les clés inutilisées (131 accumulées avant l'audit). |
| I18N-4 | Le jargon LoL reste en anglais dans le texte français. | Relecture des clés FR ajoutées. | 100 % des ajouts. | P2 | ⏳ | À contrôler livraison par livraison ; question ouverte « parties » vs « games » (audit § 5.12). |
| I18N-5 | `<html lang>` suit la langue de l'app. | `src/i18n/config.ts:11`. | Présent. | P2 | ✅ | `document.documentElement.lang` mis à jour. |
| I18N-6 | Les messages sortants (Discord, partage) suivent la langue de l'utilisateur. | Revue de `useShareReview`, `useShareSession`. | Localisés. | P3 | ❌ | L21 : textes Discord en anglais seul (décision attendue). |

## 9. Accessibilité

| ID | Règle | Vérification | Seuil | Prio | Statut | Preuve |
|---|---|---|---|---|---|---|
| A11Y-1 | Règles `eslint-plugin-jsx-a11y` actives. | `grep -c a11y eslint.config.mjs`. | Plugin actif, 0 erreur. | P2 | ✅ | 19/11 (tâche O / #36) : `jsx-a11y` « recommended » en **erreur** sur `src/**/*.tsx` et `web/src/**/*.tsx` (`eslint.config.mjs:43-52`), `npm run lint` à 0. `no-autofocus` est désactivé avec une justification. 19 exceptions ponctuelles, toutes commentées (barrières d'événements, glisser à la souris doublé au clavier, info-bulles focalisables, un faux positif sur la prop `role` de `RoleBadge`). |
| A11Y-2 | Toute image a un `alt` (vide si décorative). | `grep -rn -A3 "<img" src --include=*.tsx \| grep -c "alt="` vs nombre de `<img`. | Égal. | P2 | ✅ | 38 `<img` / 38 `alt=`. |
| A11Y-3 | Pas de `div` cliquable sans rôle ni clavier. | `grep -rn "<div[^>]*onClick" src --include=*.tsx`. | 0 sans `role` + `tabIndex` + `onKeyDown`. | P2 | ✅ | 19/11 : garanti par `jsx-a11y/click-events-have-key-events` et `no-static-element-interactions`, désormais en erreur. Les seules exceptions sont des barrières d'événements ou des gestes de souris doublés au clavier, toutes justifiées sur place. |
| A11Y-4 | Tout contrôle a un nom accessible (texte, `aria-label`, `label` associé) ; un `placeholder` ne suffit pas. | Passage clavier du harnais (voir « Passage clavier du 19/11 »). | 0 contrôle sans nom. | P2 | ✅ | 19/11, après #31 : **0 contrôle sans nom et 0 champ nommé par son seul placeholder** sur 15 écrans (654 éléments focalisables, harnais en français). Avant #31 : 21 contrôles sans nom (curseurs `ui/slider`, interrupteurs des Paramètres, boutons icône, graphiques en secteurs) et **7 champs nommés par leur seul placeholder** (Revue). |
| A11Y-5 | Focus visible sur tout élément interactif, contraste ≥ 3:1 avec le fond. | Passage clavier du harnais, 2 thèmes. | Focus visible partout. | P2 | ✅ | 14 écrans, thèmes hextech et piltover : tous les éléments focalisables ont un indicateur. Contraste de 6,7:1 à 19:1. Réserve : l'anneau de `ui/button`, `ui/input` et `ui/slider` ne fait que 1 px. |
| A11Y-7 | Un lien d'évitement mène au contenu principal. | Première tabulation de chaque page. | Présent. | P3 | ✅ | 19/11 (#31) : `SkipLink.tsx` sur desktop (`AppLayout`) et sur le web (`WebLayout`). C'est la première tabulation ; avec Entrée, le focus va sur `<main id="main">` sans changer l'URL du routeur en `#`. |
| A11Y-6 | Contraste texte / fond ≥ 4,5:1 (3:1 pour le gros texte), dans chaque thème. | Mesure sur les tokens de thème. | Conforme WCAG AA. | P2 | ⏳ | Non mesuré. À faire avec Graphic Design sur les tokens Penpot. |

## 10. Release et ops

| ID | Règle | Vérification | Seuil | Prio | Statut | Preuve |
|---|---|---|---|---|---|---|
| REL-1 | La release refuse de partir si les contrôles échouent. | `scripts/release.ps1`. | Lance `npm run check` (et e2e) et s'arrête en cas d'échec. | P1 | ✅ | 19/11 (#17, non commité) : l'étape 0 de `release.ps1` lance typecheck, lint, check:i18n et `npm run test`, et s'arrête au premier échec avant tout build. Vérifié sur une copie réduite à l'étape 0 (voir « Revues de livraisons »). Réserve : les e2e ne sont pas lancés, ils restent à la charge de la CI. |
| REL-2 | La release est construite depuis un dossier propre. | `git status --porcelain` dans `release.ps1`. | Arrêt si le dossier a des modifications non commitées. | P1 | ✅ | 19/11 (#17) : refus en non-interactif ; en interactif, il faut taper `YES` ; `-AllowDirty` force le build. Vérifié sur une copie. Réserve : `git status` n'est lu qu'au début, rien n'empêche une modification entre les contrôles et le build. |
| REL-3 | CI verte sur `main` avant chaque release. | GitHub Actions `ci.yml` (ou, tant que `main` n'est pas poussé, ses étapes en local hors `npm ci`). | Dernier run de `main` vert. | P1 | ⏳ | Équivalent local vert sur `41f457c` le 19/11 (voir « Verdict beta.8 ») ; le run GitHub reste à constater après le push. |
| REL-4 | Verdict Audit + CyberSecurity rendu au Chief avant chaque release. | Message au Chief. | Présent pour chaque version. | P1 | ⏳ | Commence avec beta.8. |
| REL-5 | Les déploiements web et workers suivent la release qui en dépend. | Date du dernier déploiement vs commits `web/`, `cloudflare/`. | Pas de correctif web livré mais non déployé > 7 jours. | P2 | ❌ | Web app non redéployée : CSP et méthodes de l'adaptateur (`f16efe7`) et page Management en attente (handoff § 1, #9). |
| REL-6 | Les scripts npm ne contiennent pas d'opération destructive ou cassée. | `package.json` `scripts`. | 0. | P2 | ✅ | 19/11 : `prisma:migrate` retiré (#19), puis `seed` et `prisma/seed.ts` supprimés (tâche C). |
| REL-7 | La documentation de pilotage reflète l'état réel. | `ROADMAP.md`, `RAPPORT_FONCTIONNALITES.md`, `PRD.md`. | Une seule liste de tâches de référence ; pas d'affirmation périmée connue. | P3 | ❌ | DOC2-DOC4 ouverts. |

---

## Historique des revues

Première passe, verdict beta.8, tri des P2, passage clavier et revues de livraisons : voir `docs/archive/REVUES_QUALITY_2026-11.md`.

## Procédure de revue avant release

**Registre des décisions :** chaque livraison et chaque maquette sont relues contre `docs/DECISIONS.md` (ordre des
sections, contenu affiché, saison, coût, jargon…). Un écart est une réserve **P1** tant que l'utilisateur ne l'a pas
levé. Une demande que l'utilisateur adresse directement à l'Audit est ajoutée au registre (ligne datée, en haut),
puis signalée au Chief.

**CSP (FE-8) :** pour toute livraison qui ajoute ou change une origine externe (image, fetch, média, iframe), lire
la CSP **du build** (`out/renderer/index.html` après `npm run build`, `web/dist/_headers` après `npm run web:build`) et
ouvrir l'écran dans l'app packagée ou `npm run preview`, et dans la web app. La console ne doit contenir aucun
« Refused to load ». Le harnais, sans CSP, ne prouve rien sur ce point.

**Fins de ligne :** le dépôt stocke en LF avec `core.autocrlf=true`.
L'avertissement de git « LF will be replaced by CRLF » ne prouve rien. On ne
signale un problème que si `git diff --stat` montre le fichier entier
réécrit, ou si le comptage le confirme :
`grep -c $'\r$' fichier` comparé à `wc -l < fichier`.


1. `npm run check` (typecheck, lint, i18n, Vitest) et `npm run test:e2e` sur le
   commit à publier.
2. Relire le diff depuis la version précédente contre chaque critère P1 et
   ceux des catégories touchées ; mettre à jour les statuts ci-dessus.
3. Capture du harnais pour chaque écran touché (UX-4).
4. Verdict au Chief : critères P1 respectés / non respectés, avec preuves.
