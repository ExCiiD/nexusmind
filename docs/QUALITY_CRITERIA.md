# Critères de qualité — Ascend (NexusMind)

> Tenu par la session **Audit** (voir `docs/TEAM_ROLES.md`). Créé le 19/11/2026.
> Chaque critère a : une **règle** précise, une **vérification** (commande,
> fichier, test ou passage dans le harnais) et un **seuil** pour être respecté.
> Une livraison ne part en release que si tous les critères **P1** sont
> respectés ou ont une dérogation écrite de l'utilisateur.
>
> Ce document ne refait pas l'audit : il s'appuie sur `docs/AUDIT_APP_2026-11.md`
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
| FE-7 | DOM valide : pas d'élément interactif dans un autre. | Revue + avertissement React en console du harnais. | 0. | P2 | ❌ | UI-B2 : bouton dans un bouton dans `ScoutingTab.tsx`. |

## 3. Back-end (processus principal Electron et `src/lib/*Core.ts`)

| ID | Règle | Vérification | Seuil | Prio | Statut | Preuve |
|---|---|---|---|---|---|---|
| BE-1 | Toute entrée IPC est validée (zod via `validatedHandle`). | `grep -rn "ipcMain.handle(" electron/main` vs `validatedHandle(`. | 0 `ipcMain.handle` brut hors liste justifiée. | P1 | ⏳ | 130 `ipcMain.handle(` bruts pour 188 `validatedHandle(` : à recouper avec CyberSecurity (S7) avant de conclure. |
| BE-2 | La logique métier vit dans des modules `*Core.ts` testables ; les handlers IPC ne font que câbler. | Taille des `*.ipc.ts`, fonctions pures non testées. | Aucun `*.ipc.ts` > 800 lignes ; toute nouvelle logique dans un Core testé. | P3 | ❌ | E25 : `team.ipc.ts` ~1 650 lignes ; E27 (fonctions atteintes par variables de module). |
| BE-3 | Le flux post-partie rattache la bonne partie. | Test unitaire de l'enrichissement + 2 vraies parties enchaînées. | Test présent ; essai réel OK. | P1 | ❌ | E10 non corrigé (`gameDetector.ts`, `enrichWithMatchApi`) : peut attacher la partie précédente, ne trouve jamais une normale ni une Arena. |
| BE-4 | Les règles du moteur suivent l'horloge de la saison en cours (2026). | `docs/RAPPORT_MOTEUR.md` + tests des détecteurs. | 0 règle sur l'horloge 2025. | P2 | ❌ | Handoff #4 : plaques, roam mid, tour latérale, M12 encore en 2025. |
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
checklist S1-S8 de `docs/ROADMAP.md`). L'Audit ne refait pas ses constats : il
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
| PE-1 | Bundle renderer de production minifié. | `electron.vite.config.ts` ; taille de `out/renderer/assets/index-*.js`. | Minifié ; < 3 Mo. | P2 | ✅ | 19/11 (tâche F) : `minify: 'esbuild'`, `keepNames: true` (piles d'erreurs lisibles), `sourcemap: false` (`electron.vite.config.ts:75-79`). Renderer : **2 844 ko** (4 527 avant, −37 %). |
| PE-2 | Routes hors démarrage chargées à la demande. | `grep -c "lazy(" src/App.tsx`. | Routes lourdes (stats, revue vidéo, coaching) en `React.lazy`. | P3 | ❌ | 0 (UI-09, WSC-20 pour le web). |
| PE-3 | Pas de parsing de timeline répété sur le thread principal. | Profil du tableau de bord ; revue de `stats.ipc.ts`. | Une timeline parsée au plus une fois par session. | P2 | ✅ | 19/11 (tâche G) : `electron/main/detailedStatsMemo.ts` (mémo des stats détaillées, lu par `stats.ipc.ts`) ; le flux post-partie fait un seul `getMatch` et un seul parse. Avant : E02 (~40 `JSON.parse` de 0,5-2 Mo par visite du tableau de bord), E09. Gain non mesuré en temps. |
| PE-4 | Application au repos économe (fenêtre réduite incluse). | Réseau du harnais ; `backgroundThrottling`. | Voir FE-5. | P2 | ❌ | `backgroundThrottling: false` (`index.ts:295`) + polling UI-11. |
| PE-5 | Installeur sans poids mort. | `npm run dist:dir` puis taille de `release/win-unpacked`. | < 250 Mo ; pas de runtime ONNX d'autres plateformes, pas de source maps. | P2 | ⏳ | Exclusions de l'audit fusionnées, mais P2 (ONNX, 363 Mo) et D3/D4 en attente ; build de contrôle non fait. |

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

## Synthèse de la première passe (19/11/2026)

| Catégorie | ✅ | ❌ | ⏳ |
|---|---|---|---|
| UI/UX | 2 | 2 | 2 |
| Front-end | 4 | 3 | 0 |
| Back-end | 0 | 4 | 3 |
| Données | 5 | 3 | 0 |
| Sécurité | 1 | 5 | 2 |
| Tests | 6 | 1 | 1 |
| Performance | 2 | 2 | 1 |
| i18n | 3 | 2 | 1 |
| Accessibilité | 6 | 0 | 1 |
| Release et ops | 3 | 2 | 2 |
| **Total** | **32** | **24** | **13** |

(Mises à jour : TE-2 passé à ✅ avec le verdict beta.8 ; A11Y-4 ❌ et A11Y-5 ✅
avec le passage clavier ; A11Y-7 ajouté ; DA-1, REL-1, REL-2 passés à ✅
avec #17 et #19 ; TE-8 ajouté, puis passé à ✅ ; A11Y-4 et A11Y-7 passés à ✅
avec #31 ; FE-4 passé à ✅ avec #18 ; UX-5 et I18N-2 passés à ✅ avec le lot
U/V/L ; A11Y-1 et A11Y-3 passés à ✅ avec #36 ; FE-3, TE-4, TE-5, TE-6, PE-1 et
REL-6 passés à ✅ avec le lot J/Q/T/X/A-F ; DA-2, PE-3 et UX-3 passés à ✅,
BE-5 à ⏳ (corrigé, non mesuré) avec le lot runner/G/H/K.)

### Échecs P1 (bloquent la release publique)

1. **REL-1 / REL-2** — `release.ps1` ne lance aucun contrôle et ne vérifie pas que le dossier est propre (six sessions écrivent dans le même dossier).
2. **SEC-1 / SEC-2 / SEC-4 / SEC-8** — clé OpenAI à révoquer, secret YouTube embarqué, ffmpeg sans empreinte, consentement sur les textes légaux v0.1 (CyberSecurity pour les trois premiers).
3. **BE-3** — post-partie : mauvaise partie rattachée (E10).
4. **FE-4** — adaptateur web non vérifié contre `AscendAPI` (cause des pages web blanches).
5. **DA-4** — production Supabase non recréable depuis le dépôt (WSC-05).
6. **DA-1** — script `prisma:migrate` (`migrate dev`) toujours disponible.

Les P2 et P3 sont listés dans les tableaux ci-dessus.

## Verdict beta.8 (19/11/2026) — **OK**

Périmètre : `origin/main..main` = `4ffef1d` + `41f457c` (section Équipe & staff,
14 fichiers). Les étapes de `.github/workflows/ci.yml` ont été lancées en local
dans le dossier partagé, sur `HEAD` = `41f457c` (le même au début et à la fin).

| Étape CI | Résultat |
|---|---|
| `npm ci`, `prisma generate` | **non lancés**, volontairement : `npm ci` viderait le `node_modules` des autres sessions. Dépendances et client Prisma déjà installés. |
| `npm run typecheck` | EXIT 0 |
| `npm run lint` | EXIT 0, 0 avertissement |
| `npm run check:i18n` | EXIT 0 |
| `npm test` | 101 fichiers, 1 502 / 1 502 |
| `npm run build` | EXIT 0 |
| `npm run web:build` | EXIT 0 |
| `npx playwright test` (e2e Electron) | **39 / 39** en 1,6 min |

**Réserve, travail non commité des autres sessions.** Au départ (13:58), le
dossier n'avait que des documents non commités. À la fin (14:02), 5 fichiers
de code avaient été modifiés pendant le run :
- `src/pages/Team/DraftTab.tsx`, tâche #6 ;
- `src/index.css`, `tailwind.config.ts`, tâche #16 ;
- `src/i18n/locales/en.json`, `fr.json`.

Le run a donc pu inclure une partie de ces modifications. Elles n'ont rien fait
échouer, et aucune ne peut masquer un défaut de `main`. Seules les locales
recoupent `main`.

Conséquence pour la release (REL-2) : il faut mettre ces fichiers de côté avant
le build de `release.ps1`, qui embarque le dossier de travail et pas le commit.
Ensuite, contrôler que `git status` ne montre plus que des documents.

Non couvert :
- le passage dans le harnais des 4 pages de la section, fait par la session
  d'origine avec deux groupes (handoff § 3 #1), non refait ici ;
- le run GitHub Actions, qui viendra après le push ;
- la revue sécurité, rendue par CyberSecurity.

## Tri des P2 pour la vague 2 (19/11/2026)

Demandé par le Chief (plan #12). Pour chaque point : décision proposée, session
cible, effort (**S** ≤ ½ journée · **M** ≈ 1 journée · **L** > 2 jours).
« Utilisateur » = la décision lui revient ; la proposition est celle de l'Audit.
Les points déjà dans `docs/PLAN_CHIEF.md` sont seulement renvoyés.

### Déjà au plan (pas de nouvelle tâche)

| Critère | Constat | Tâche du plan |
|---|---|---|
| UX-3 (tiers) | Couleurs de tiers du Draft Sim | #6 |
| UX-6 | Indicateur du modèle de détourage | #5 |
| FE-7, I18N-2 (partiel) | Bouton imbriqué et textes en dur de `ScoutingTab` | #7 (front) |
| I18N-2 | Textes en dur (UI-B4) | vague 1 frontend-dev, après #7 |
| BE-4 | Horloge 2025 | #4 |
| DA-7 (WSC-06) | `getSharedTeam` lit toute la table | vague 1 backend-dev + revue cybersecurity |
| A11Y-6 | Contrastes | #16 |
| REL-5 | Web app non déployée | #9 |
| SEC-5 / SEC-6 / SEC-7 | Dépendances majeures, CSP, protection des mots de passe | #13 (cybersecurity) |

### Nouvelles tâches proposées, par ordre conseillé

| # | Critère / constat | Décision proposée | Session | Effort | Dépend de |
|---|---|---|---|---|---|
| A | **E11** (bug) — `mistake:auto-detect` ignore la sévérité apprise et les signets auto | Corriger : sortir les 4 fonctions de `registerStatsHandlers` (E27) et appeler `autoDetectMistakesSilently` depuis le handler. Test : sévérité apprise conservée après un clic. | backend-dev | S | — (déjà dans l'ordre proposé par le back) |
| B | **DA-2 / E30** — le runner de migrations avale « no such column » | Ne tolérer l'erreur que sur un `DROP COLUMN` / `DROP INDEX` ; toute autre instruction échoue. Test unitaire avec une migration contenant une faute de frappe. | backend-dev | S | — |
| C | **REL-6 / S1** — `npm run seed` vide des tables avec un client obsolète | Supprimer `prisma/seed.ts` et le script `seed` (les seeds utiles vivent dans `electron/main/seeds/`). | backend-dev | S | Avec #19 (même fichier `package.json`) |
| D | **TE-5 / T8** — tests non typecheckés | Ajouter `tsconfig.tests.json` à `npm run typecheck` ; corriger la fixture de `playerCard.test.ts` (`updatedAt`). | backend-dev | S | — |
| E | **TE-6 / WSC-22 / CI1** — workers et site hors CI | Ajouter à `ci.yml` : typecheck de `cloudflare/*` (au moins le bot), `npm run site:build` ; déclarer `@supabase/supabase-js` dans le bot. | backend-dev | S | D (même script `typecheck`) |
| F | **PE-1 / UI-08** — renderer non minifié (4,5 Mo) | **Utilisateur** ; proposition : minifier avec `keepNames` (piles d'erreurs lisibles), sans source maps dans l'installeur. Vérifier e2e + un lancement packagé. | backend-dev (config de build) | S | Après beta.8 |
| G | **PE-3 / E02 + E09** — timelines parsées à répétition | Cache LRU (~300) de `extractDetailedStats` par `matchId:puuid` ; pipeline post-partie : un seul fetch et un seul parse. Mesure avant / après du montage du tableau de bord. | backend-dev | M | E09 à faire avec E10 (même fonction) |
| H | **BE-5 / E03 + E04** — travail bloquant au démarrage | E03 : sonde ffmpeg au premier usage (S). E04 : lire `sqlite_master` une fois, seed en `createMany` (M). Mesure du temps jusqu'à la fenêtre. | backend-dev | M | — |
| I | **FE-5 / PE-4 / UI-11 / L02 / L15** — polling et requêtes en double | Store partagé pour `useCollab` (une requête en vol), un seul poller de session en direct, uid passé aux Core au lieu de `auth.getUser()`. Pause quand la fenêtre est cachée : **Utilisateur** ; proposition : oui, sauf le poller de fin de partie d'équipe ramené à 60 s. Cible : ≤ 3 appels/min au repos. | backend-dev (`collab.ts`, Core) puis frontend-dev (composants) | M | Fichiers protégés `collabCore.ts` / `collab.ts` à réserver via le Chief |
| J | **FE-3 / UI-17** — 17 `window.api as any` | Retirer et corriger ce que tsc signale. | frontend-dev | S | #18 (types du preload alignés d'abord) |
| K | **UX-3 / UI-15 / L11** — rôles et échelles de winrate copiés | `ROLES` / `Role` depuis `championRoles.ts` partout ; une seule échelle de winrate, choisie par graphic-design. | graphic-design (échelle) → frontend-dev | M | Après #6 et #7 (mêmes écrans) |
| L | **UX-5 / UI-21 + E15-B** — actions mortes | **Utilisateur**. Propositions : brancher « Choisir » sur l'ajout d'objectif (S, front) ; supprimer les canaux et l'affichage des liens de partage de clip jamais enregistrés (S, back + front), sauf si l'utilisateur veut garder ces liens. | frontend-dev (+ backend-dev pour E15-B) | S | — |
| M | **DA-6 / E06** — `MatchCache` sans limite | **Utilisateur** ; proposition : sortir `MatchCache` des exports fichier (le cache se reconstruit depuis Riot), purger les timelines de plus de 90 jours qui ne sont liées à aucune `Game`. | backend-dev | M | — |
| N | **PE-5 / P2 + D3/D4** — poids de l'installeur | Exclure les runtimes ONNX des autres plateformes, passer les libs du renderer et `@prisma/client` en devDependencies. Contrôle : `dist:dir` + une transcription + un détourage dans le build. | backend-dev | M | Après beta.8 ; pas pendant le pack #3 |
| O | **A11Y-1 / A11Y-3** — pas de jsx-a11y, 8 `div` cliquables | Ajouter `eslint-plugin-jsx-a11y` (règles `recommended` en avertissement), corriger les 8 `div` (`button` ou `role` + clavier), puis passer les règles en erreur. | frontend-dev | M | Après UI-B4 (mêmes fichiers) |
| P | **A11Y-4 / A11Y-5** — étiquettes et focus | Passage clavier complet dans le harnais (FR, 2 thèmes), liste des boutons sans nom accessible. | audit | S | — |
| Q | **TE-4 / T1 + T3** — tests de copies | Extraire `getDateKey` et la boucle de scan dans des modules, tester les originaux. | frontend-dev (`recordPage`) + backend-dev (scan) | S | — |
| R | **E12** — biais de revue sur le compte principal seulement | `ensureMatchCache`, puis résoudre le puuid parmi les comptes liés. | backend-dev | S | — |
| S | **L13** — tag « Autre cause » archivé | Désarchiver le tag dans `resolveTag`, comme `mistake:create-tag`. | backend-dev | S | — |
| T | **L07 / UI-13** — Data Dragon et rendu de Draft | Une promesse unique pour la version Data Dragon (`src/lib/ddragon.ts`), `loading="lazy"` sur les ~170 icônes, N+1 `getRecording` de l'Historique remplacé par un appel groupé. | frontend-dev (+ backend-dev pour l'IPC groupé) | M | — |
| U | **L14** — filtre `ranked5` qui agit comme `flex` | **Utilisateur** ; proposition : retirer l'option (S) plutôt que la brancher (M). | frontend-dev | S | — |
| V | **WSC-04** — onglets équipe de Coaching cassés sur le web | **Utilisateur** ; proposition : les masquer sur le web (S) tant que le portage n'est pas planifié. | frontend-dev | S | Avant #9 (déploiement web) |
| W | **WSC-12** — `site/shots.cjs` vise des onglets déplacés | Pointer vers `/coaching` et lier une équipe au groupe démo du harnais. | graphic-design | S | Avant la prochaine capture du site |
| X | **WSC-25** — service worker web | Nom de cache versionné par build, retirer l'icône précachée inutile, renommer « NexusMind ». | frontend-dev | S | Avant #9 |
| Y | **E14** — YouTube en production | **Utilisateur**, avec SEC-2 : si l'envoi YouTube n'est pas voulu en production, le masquer dans le build packagé plutôt que migrer l'OAuth. | cybersecurity → backend-dev | S (masquer) / L (Edge Function) | #13 |

**Vague 2 conseillée** :
- backend-dev : A, B, C, D, E (rapides et sans décision), puis G et H ;
- frontend-dev : J (après #18), V et X avant le déploiement web, puis O ;
- audit : P ;
- décisions de l'utilisateur à demander en une fois : F, I (pause), L, M, U, V, Y.

## Passage clavier du 19/11/2026 (tâche P)

**Conditions :**
- harnais déjà lancé sur le port 5199 par une autre session, et reflétant le
  dossier partagé, donc travail non commité inclus ;
- interface en français ;
- thèmes hextech et piltover ;
- 14 écrans : tableau de bord, Plan, Session, Record, Revue, Historique,
  Statistiques, Mistake Lab, Management, Espace d'équipe, Coaching, Stats
  collectives, Profil, Paramètres et Aide.

**Méthode :** une vraie tabulation pour passer en mode clavier. Ensuite, un
script focalise chaque élément focalisable visible et relève trois choses : le
nom accessible (approché), l'indicateur de focus et le `tabindex` positif.
Les réglages de langue et de thème du navigateur ont été remis à leur valeur
d'origine.

**Respecté :**
- l'indicateur de focus est visible sur tous les éléments des 14 écrans, dans
  les deux thèmes ;
- aucun `tabindex` positif ;
- `<html lang="fr">` est correct ;
- les repères `main`, `nav` et `aside` sont présents ;
- les onglets (`ui/tabs`) ont un anneau de 3 px.

**À corriger :**

| Composant | Écrans | Défaut | Correctif proposé |
|---|---|---|---|
| `src/components/ui/slider.tsx:17` (Thumb) | Revue (×5), Paramètres (×4) | Pas de nom : le lecteur d'écran annonce « curseur » sans dire lequel. | Passer `aria-label` (ou `aria-labelledby` vers le libellé du fondamental) au `Thumb`, via une prop de `Slider`. |
| Interrupteurs maison `src/pages/Settings/SettingsPage.tsx:272`, `:485`, `:613`, `:741` | Paramètres (×4) | `<button>` vide : ni nom, ni `role="switch"`, ni `aria-checked`, donc ni l'état ni la fonction ne sont annoncés. | Utiliser `src/components/ui/switch.tsx` (déjà présent), ou ajouter `role="switch"`, `aria-checked` et `aria-labelledby` vers le titre du réglage. |
| `src/components/ReviewForm/TimelineNoteInput.tsx:131` (`size="icon"`) | Revue (×3) | Bouton de suppression d'une note sans nom. | `aria-label={t('common.delete')}` (ou une clé dédiée). |
| `TimelineNoteInput.tsx:110`, `:123` + note générale de la Revue | Revue (×7) | Champs « M:SS » et notes nommés par leur seul placeholder. | `aria-label` ou `<Label htmlFor>`. |
| `src/components/Share/ShareButton.tsx:100`, `ShareSessionButton.tsx:50` (chevron) | Revue, Session | Bouton du menu de partage sans nom ; le libellé voisin « Share » est en anglais dans l'interface française (UI-B4). | `aria-label` + `aria-haspopup="menu"` ; traduire « Share ». |
| `src/pages/Team/DashboardLayout.tsx:228`, `src/components/Charts/WinrateChart.tsx:31` (`<Pie>` recharts) | Stats collectives (×4) | Groupe SVG focalisable (`tabindex=0`) sans nom. | `rootTabIndex={-1}` si le graphique n'est pas interactif, sinon un `aria-label` résumant les valeurs. |
| Cloche de notifications (barre de titre) | Tous | Nom calculé = le nombre du badge (« 3 ») : le `title` est ignoré parce que le bouton contient du texte. | `aria-label={t('notifications.title') + ', ' + count}`. |
| Mise en page (`src/components/Layout/`) | Tous | Pas de lien d'évitement : 21 tabulations avant le contenu. | Lien « Aller au contenu » visible au focus, vers `<main id="main">`. |
| Anneau de `ui/button`, `ui/input`, `ui/slider` | Tous | 1 px (`focus-visible:ring-1`) : visible et contrasté, mais fin. Le niveau AAA (2.4.13) demande 2 px. | Passer à `ring-2` dans les trois composants ; à valider avec graphic-design (#16). |

**Session cible :** frontend-dev. Effort **S**, environ ½ journée, plus une
clé i18n ou deux. Ces fichiers recoupent UI-B4 et `ScoutingTab` : à faire dans
le même lot que la tâche O (jsx-a11y), qui détectera ensuite toute régression.

**Non couvert :**
- vrai lecteur d'écran (NVDA) ;
- piège du focus dans les dialogues : Radix le gère, non éprouvé ici ;
- ordre de tabulation dans les dialogues et les menus ;
- web app, pages de session d'équipe et sous-onglets de Coaching au-delà du
  premier affiché ;
- thèmes clairs : les 8 thèmes du dépôt sont sombres.

## Revues de livraisons

### #2 — Chargement infini / reconnexion impossible (backend-dev, 19/11) — **OK avec réserves**

**Fichiers relus (non commités) :**
- `src/lib/accessCore.ts` : `authTimeoutFetch`, `signOutThisDevice`,
  `authStorageKey` ;
- `electron/main/cloud/supabase.ts` (trousseau, `forgetLocalSession`) ;
- `electron/main/ipc/cloud.ipc.ts` ;
- `web/src/api.ts` et `web/src/supabase.ts`.

**Tests :**
- `tests/unit/authSignOutFlow.test.ts`, nouveau : le vrai client supabase-js
  contre un faux serveur d'auth, pour la déconnexion puis la reconnexion, avec
  un logout `ok`, `error`, `offline` ou `silent` ;
- `tests/unit/accessCore.test.ts`, 7 cas ajoutés.

| Critère | Statut | Preuve |
|---|---|---|
| TE-1 | ✅ | `npx vitest run` : 102 fichiers, 1 519 / 1 519 (dossier partagé, travail des autres sessions inclus) ; les 2 fichiers de #2 : 24 / 24. |
| TE-3 | ✅ | Le test de non-régression rejoue le bug (déconnexion hors ligne, puis reconnexion) avec la vraie bibliothèque, pas un mock. |
| FE-1 / FE-2 | ✅ | `tsc` des 3 projets EXIT 0 ; `eslint` des 7 fichiers EXIT 0. |
| BE-1 | ✅ | `cloud:sign-out` et la suppression de compte restent derrière `validatedHandle`. |
| BE-6 / SEC | ⏳ | Rendu par CyberSecurity. Voir la réserve 2. |
| DA-3 | ✅ | La sync relit l'uid depuis la session locale à chaque tour (`syncService.ts:100`, `:131`), donc elle s'arrête après `forgetLocalSession`. |

**La logique est juste.** auth-js garde la session quand le logout échoue
autrement qu'en 401, 403 ou 404 ; dans ce cas, `signOutThisDevice` l'oublie
localement. Le trousseau ne relit plus l'ancienne session quand une écriture
a échoué. Le délai de 10 s ne touche que `/auth/v1/`, pas les envois de
sauvegarde.

**Réserves :**
1. **P2 — Le délai de 10 s s'applique aussi à `signInWithOtp`** (`accessCore.ts:142`, envoi du code par e-mail). Un SMTP lent coupe la requête alors que le mail part quand même : l'utilisateur voit une erreur, réessaie, et tombe sur la limite d'un envoi par 60 s de Supabase. Proposition : exclure `/auth/v1/otp` du délai, ou lui donner 30 s.
2. **P2 (CyberSecurity) — Commentaire inexact** dans `signOutThisDevice` : « The token left on the server expires by itself within the hour ». C'est vrai du jeton d'accès, pas du refresh token, qui reste valide côté serveur tant qu'il n'est ni utilisé ni révoqué (sauf réglage de durée de session). La copie locale est bien supprimée : le risque est faible, mais le commentaire doit le dire.
3. **P3 — Une suppression ratée ne vaut que jusqu'au prochain lancement.** Si `unlinkSync` échoue (fichier verrouillé par un antivirus), la déconnexion tient en mémoire, mais l'ancienne session revient au lancement suivant. C'est documenté (« for the rest of the run ») ; il faudrait réessayer la suppression au démarrage.
4. **P3 — `AbortSignal.any` n'est pas polyfillé sur le web.** Il manque avant Safari 17.4, et la cible Vite par défaut va jusqu'à Safari 14. Le code n'est atteint que si l'appelant passe un `signal`, ce qu'auth-js ne fait pas aujourd'hui. Proposition : repli `init.signal ?? timeout` si `AbortSignal.any` est absent.
5. **P3 — Rafraîchissement en vol.** Si un rafraîchissement automatique aboutit juste après `forgetLocally`, auth-js peut réécrire une session. Le cas est rare, puisqu'il faut que le serveur réponde au refresh alors que le logout a échoué. Non testé.
6. ~~Format : fichiers réécrits en LF~~ — **retiré le 19/11, faux positif.** Les fichiers sont 100 % CRLF sur disque et leurs diffs sont petits. L'avertissement de git vient de `core.autocrlf=true`, pas d'une réécriture.

**Non vérifié :**
- la déconnexion et la reconnexion dans l'app réelle, ou contre la
  production. Le critère de fin du plan (#2) demande « harnais ou app » ;
- le démarrage à froid avec un serveur d'auth muet : vérifié à la main par le
  back-end (environ 25 s avant de rendre la main), non rejoué ici ;
- l'état « serveur injoignable » de `CloudGate.tsx` (front), qui sera revu à
  part.

### #2 suite front — `CloudGate.tsx`, écran « serveur injoignable » (frontend-dev, 19/11) — **composant OK ; #2 pas encore complet**

**Composant :** quand `cloudStatus()` rejette, l'écran « Serveur Ascend
injoignable » remplace le spinner.

| Vérification | Résultat |
|---|---|
| Harnais `cloudgate.html?fail=2`, FR | `role="alert"`, titre `h1`, texte « Vérifiez votre connexion internet… Vos données locales ne sont pas touchées. », focus sur « Réessayer ». Un clic relance l'appel : 2ᵉ échec, l'écran revient avec le focus ; 3ᵉ appel réussi, l'app s'affiche. ✅ |
| Spinner | `aria-hidden`, plus un texte `sr-only` « Chargement… ». ✅ |
| i18n | `check:i18n` OK, 3 156 clés. Le vouvoiement est cohérent avec le reste de la section `cloud.*`. ✅ |
| `tsc -p tsconfig.web.json`, `eslint CloudGate.tsx` | EXIT 0. ✅ |

**Réserve bloquante pour fermer #2 (P1, côté back, effort S) : le nouvel
écran n'est pas atteint dans le scénario réel du bug.**

Le harnais simule un `cloudStatus()` qui **rejette**. Or `cloud:status`
(`electron/main/ipc/cloud.ipc.ts:39`) et `webApi.cloudStatus`
(`web/src/api.ts:106`) font `await getSession()` sans regarder `error`.
auth-js 2.100.1 ne lève pas d'erreur par défaut :
- `throwOnError: false`, `GoTrueClient.js:27` ;
- `__loadSession` renvoie `{ session: null, error }` quand le rafraîchissement
  échoue, `:2361-2363`.

Avec une session expirée et un serveur d'auth muet, `cloudStatus()` résout donc
avec `user: null` après environ 25 s. L'utilisateur voit alors l'**écran de
connexion**, comme s'il avait été déconnecté, au lieu de « serveur
injoignable ». Ensuite, l'envoi du code échoue au bout de 10 s. Ce n'est plus
un spinner infini, mais l'objectif de CloudGate n'est pas atteint et le
message est trompeur.

Correctif proposé :
- dans les deux `cloudStatus`, si `getSession()` renvoie une erreur réseau ou
  de délai (`isAuthRetryableFetchError(error)`, ou `error.name` à
  `TimeoutError` ou `AbortError`), lever une erreur `AUTH_UNREACHABLE` au
  lieu de rendre `user: null` ;
- ajouter un test dans `authSignOutFlow.test.ts` : session expirée,
  `refresh: 'silent'`, puis `cloudStatus` rejette. Ce test peut réutiliser
  `fakeAuthServer` avec un délai court.

**Non vérifié :** l'app réelle, côté utilisateur.

### #51 Champion Pool, lobby, détouré hébergé, sélecteur champion / skin (21/11) — **OK**

**Contrôles :**
- 19 / 19 tests propres à #51 (`cardChampion`, `cardChampionView`) ;
- `tsc` du renderer et de la web app EXIT 0 ; `eslint` des 8 fichiers EXIT 0 ; `check:i18n` OK ; `web:build` EXIT 0.
- **Hors #51** : 25 tests en échec (7 fichiers micro-review / anomalyDetector / mistakeRules) et `npm run typecheck`
  en échec **uniquement** dans des tests de ce même chantier (`microReviewSeason2026`, V5-V7, `teamTimelineCore:133`
  sur `atakhan`), dus au retrait de 2025 en cours côté back. **À reverifier avant la release.**

| Point | Verdict | Preuve |
|---|---|---|
| (1) Menu de tier | ✅ | Menu en `fixed` positionné depuis le bouton, à l'intérieur du dialogue : il échappe au rognage de la liste et s'ouvre vers le haut près du bas ; refermé au défilement (`ChampionPoolBoard.tsx`). |
| (2) Lobby d'équipe en tête de section | ✅ | Ordre de la barre latérale changé, sans autre effet (`Sidebar.tsx`). |
| (3) Détouré hébergé | ✅ | `cutoutUrl` (Worker `ascend-cutouts`), avec repli sur l'image d'origine estompée en cas de 404 ou hors ligne (`onError`). |
| (4) Sélecteur champion / skin | ✅ | `CardSkinDialog` : `radiogroup` nommé (« Skins de X »), `radio` + `aria-checked` + `aria-label`, `aria-disabled` pour les skins sans détouré (avec une explication en `title`), **tabindex mobile qui retombe toujours sur un skin sélectionnable** (skin de base au minimum), flèches, images en `loading="lazy"`. Branché sur le web (`cardChampionWeb.ts`, `api.ts`). |
| (5) Back | ✅ | Migration `20261120140000` : `card_champion` et `card_skin_num` avec une contrainte de format, `grant update` limité à ces 2 colonnes (déjà validé par CyberSecurity). API `collabSetMyCardChampion` / `collabListCardSkins`. Manifeste lu une seule fois, état hors ligne, Data Dragon indisponible : couverts par les tests. **Pas appliquée en production.** |

**Non vérifié :** le rendu dans le harnais (revue de code et tests seulement).

### #49 Scrims dans le Planning — revue complète, front branché (20/11) — **OK avec une réserve P2 (ordre de mise en production)**

**Contrôles :**
- `vitest` **1 810 / 1 810** ;
- `typecheck`, `lint`, `web:build` EXIT 0 ; `check:i18n` OK, 3 934 clés.

**Harnais (FR, clavier), conformité à `DESIGN_STATE.md` § 13 :**

| Élément | Résultat |
|---|---|
| **MatchBadge** | Carte « SCRIM BO3 · 19h–21h30 · VS KARMINE ACADEMY · BO3 · 1 ABSENT ». ✅ |
| **Ouverture du créneau** | Au clavier (bouton, Entrée). ✅ |
| **MatchDetailPanel, 8 blocs** | 1. en-tête « SCRIM · Prévu · VS KARMINE ACADEMY (KCA) · mercredi 18 novembre · 19:00–21:30 · BO3 » ; 2. nos joueurs avec présence ; 3. équipe adverse, OP.GG multi, OP.GG par joueur, « Corriger » sur un introuvable ; 4. « Ouvrir dans le Scouting », « Préparer la draft » ; 5. checklist (2 cases) et **Notes de préparation** (sauvegarde vérifiée : `{"prepNotes":"Test audit prep"}`) ; 6. drafts liées, **alerte « 1 brouillon lié est introuvable »** et « Lier une draft » ; 7. **Analyse post-scrim**, « Marquer terminé », « Annuler le scrim », Discussion ; 8. « Modifier », « Supprimer ». ✅ |
| **EventPopup en Scrim** | **640 px** ; radiogroups « Format » (**Bo3 par défaut**) et « Équipe adverse » nommés ; Bo5 donne 20:00, Bo3 18:30 (fin recalculée) ; **« Équipe connue » au clavier** : sélecteur « Choisir une équipe du Scouting » qui pré-remplit nom, tag, Riot ID connus et titre ; 5 champs Riot ID nommés ; `<label>` pour Nom *, Tag, Lien OP.GG multi ; « Titulaires pré-remplis · 5 / 5 dispo » ; pied « L'équipe est ajoutée au Scouting et au Draft Sim. » ; **« Créer le scrim » grisé tant que le nom est vide**. ✅ |
| **Enregistrement** | `calendarSaveMatchEvent` reçoit le type scrim, Bo3, 2 h 30, les 5 titulaires comme participants, l'adversaire (nom, tag, 2 joueurs avec rôle et région). ✅ |
| **Vérification des Riot ID** | À la sortie du champ via le relais ; `aria-invalid` et contour rouge si introuvable ; sans réponse, état neutre (`MatchEventFields.tsx:55-59, 130-133`). ✅ (code) |
| **Officiel** | « Créer le match officiel » (`fr.json:2938`) ; même formulaire. ✅ (code) |
| **Web : page Scrims supprimée** | `web/src/pages/ScrimsPage.tsx` n'existe plus, plus d'entrée de menu. `/scrims` et `/scrims?scrim=<id>` passent par `ScrimsRedirect` vers `/management?tab=planning&event=<id>`, que le Planning ouvre (`PlanningSection.tsx:79`). Les liens de l'accueil web passent par cette redirection. ✅ |
| **Rien de perdu** (tableau § 13.3) | Chaque fonction de l'ancienne page a sa place : grille par semaine, création, présence, checklist, notes, drafts liées et alerte, analyse, terminé, annuler, supprimer, discussion, lien Scouting. Le bot lit toujours `scrims`. ✅ |
| **Sans migration** | Le Planning reste affiché, sans badges (testé côté back). **Mais la création d'un Scrim ou d'un Officiel échoue avec une erreur générique** : voir la réserve P2. |

**Réserve P2 — ordre de mise en production.**
- Sans la migration `20261120120000`, `save_match_event` n'existe pas : un créneau Scrim ou Officiel ne peut plus être
  créé (toast `collabErrorKey` générique, `EventPopup.tsx:272-273`).
- L'ancienne page Scrims étant supprimée sur le web, **on ne pourrait plus créer aucun scrim**, ni sur desktop ni sur
  le web, pendant cet intervalle.
- Il faut :
  1. **appliquer la migration en production avant** de déployer la web app et de publier la version desktop qui
     contient #49 (accord de l'utilisateur), puis rafraîchir la baseline ;
  2. au minimum, afficher un message clair, comme l'état « table absente » de l'analyste (« Arrive avec la prochaine
     mise à jour du serveur »), au lieu d'une erreur générique : détecter `PGRST202` ou « function … does not exist »
     dans `matchErrorKey`.

**Réserves P3 :**
1. À l'ouverture de la pop-up en Scrim, **Bo3 est sélectionné mais la fin reste à +1 h** (16:00-17:00). Il faut
   cliquer un format pour obtenir 18:30. Appliquer la durée Bo3 dès l'ouverture d'un nouveau créneau.
2. Panneau, bloc 3 : le rôle des adversaires est affiché, pas modifiable sur place (spec : « select, éditable par le
   staff »). On le modifie via « Modifier », qui rouvre la pop-up : acceptable, à confirmer avec Graphic Design.
3. Zone de saisie de la discussion (`DiscussionThread.tsx:88-90`) nommée par son seul texte d'exemple : ajouter
   `aria-label`.
4. `ScrimsRedirect` : le spinner est `aria-hidden` sans texte ; ajouter un `sr-only` « Ouverture du Planning… ».

### #49 Scrims dans le Planning — partie back (backend-dev, 20/11) — **OK** (revue complète après le branchement du Front)

**Contrôles :**
- `vitest` **1 810 / 1 810** (138 fichiers) ;
- `typecheck`, `lint` EXIT 0 ; `check:i18n` OK, 3 934 clés ;
- `tsc` du bot EXIT 0.

| Point | Verdict | Preuve |
|---|---|---|
| **Migration `20261120120000`** + `supabase/rollback/20261120120000_rollback.sql` | ✅ | `scripts/test-scrims-in-planning.mjs` (PGlite 0.3.16, PostgreSQL 17) : **58 / 58**, retour arrière compris : les scrims et leurs créneaux sont gardés, et la migration se réapplique après le retour arrière. Les doublons de `team_scouting` reçoivent « (2) », « (3) » **avant** l'index unique `(group_id, opponent_key)`, donc rien n'est perdu. `scrims.calendar_event_id` est unique, en `on delete cascade` (CHOIX 3). Le lien OP.GG est limité à des domaines connus en `https`. **Pas appliquée en production** (accord de l'utilisateur requis). |
| **RPC `save_match_event`** | ✅ | `security definer`, `search_path = ''`. Contrôle `can_edit_calendar` (owner, coach, manager, capitaine), sinon `FORBIDDEN`. `v_may_overwrite = is_group_staff` : manager et capitaine **complètent** un adversaire sans écraser ce qui existe, le staff le modifie (CHOIX 2). Codes d'erreur `INVALID_KIND`, `INVALID_EVENT`, `INVALID_OPPONENT`, `NOT_FOUND`. |
| **`matchEvent.ts` / `matchEventCore.ts`** | ✅ | 28 tests (`matchEvents.test.ts`, `matchEventView.test.ts`) : « Officiel » = `tournament` (CHOIX 1), Riot ID coupé au dernier `#`, liens OP.GG, codes RPC traduits, patch partiel, lecture du créneau, de son scrim et de son adversaire par clé, et **état sans migration** (le Planning reste affiché sans badges). |
| **IPC** | ✅ | `calendar:save-match-event`, `get-match-event`, `update-match-detail`, `list-known-opponents` sous `validatedHandle` (zod). |
| **`publishTeam` par clé** | ✅ | Rapproche les équipes scoutées sur `opponent_key`, garde celles créées depuis un créneau (`source = 'match'`), retire les non publiées ; avant la migration, ancien comportement. Testé (`teamCore.test.ts:69, 104`). |
| **`importGroupOpponents`** | ✅ | Crée un adversaire manquant avec ses joueurs connus ; ne complète que tag et rôles d'un adversaire local ; ne fait pas revenir un adversaire supprimé localement (tests `matchEvents.test.ts:181-200`). |
| **Réserve P2 précédente : épinglage de PGlite** | ✅ **levée** | `supabase/baseline/README.md:15-20` épingle `@electric-sql/pglite@0.3.16`. Le test échoue avec un message clair sur une autre version majeure : « PostgreSQL 18 found (server_version_num 180007), production runs 17: install @electric-sql/pglite@0.3.16… ». Vérifié avec 0.5.17 (refus) et 0.3.16 (tout vert). |

**À noter :**
- deux migrations attendent maintenant la production : `20261119290000_analyst…` et `20261120120000_scrims…`. Le
  test de baseline les liste à part, correctement. Il faudra rafraîchir la baseline après leur application ;
- revue complète (écrans, clavier, droits affichés) quand le Front aura branché le contrat.

### Baseline du schéma de production (WSC-05 / DA-4) (backend-dev, 20/11) — **OK ; DA-4 passe**

| Vérification | Résultat |
|---|---|
| `test-schema-baseline.mjs` avec **PGlite 0.3.16 (PostgreSQL 17)** | **8 / 8 PASS** : 15 restaurées octet pour octet ; 58 migrations de production toutes dans le dépôt ; e8 « lock » repliée mot pour mot ; 57 migrations rejouées dans l'ordre de la prod et dans l'ordre des fichiers ; 139 objets et empreintes identiques ; contrôle négatif (colonne ajoutée, droit retiré) détecté. `20261119290000_analyst…` est correctement exclue (pas encore appliquée en prod). |
| Fichier de référence contre la prod en direct | `scripts/schema-snapshot.sql` rejoué en production (lecture seule) : **md5 `8396bb9b198c2910bc834fdf9f582ded`, 139 objets**, identique au fichier `prod_schema_20261120.txt`. |
| Renommage des 21 fichiers | Fait pendant la revue : les fichiers portent leur version de production (renommages `git mv`, déjà indexés). Le test passe après le renommage. |

**Réserve P2 — la version de PGlite n'est pas épinglée.** Avec **PGlite 0.5.x (PostgreSQL 18)**, le test
échoue sur **toutes** les tables, composante `k` (contraintes). Depuis PostgreSQL 18, chaque `NOT NULL` est une ligne
de `pg_constraint` (`scrims_checklist_not_null NOT NULL checklist`), alors que la production est en **17.6**. Ce n'est
pas un défaut du schéma, mais quelqu'un qui lance le test avec le dernier PGlite conclura à tort que la base a dérivé.

Correctif, au choix :
- épingler `@electric-sql/pglite@0.3` (PostgreSQL 17) dans le README et dans un message d'erreur du script si la
  version de PostgreSQL n'est pas 17 (`select current_setting('server_version_num')`) ;
- ou exclure `contype = 'n'` dans `schema-snapshot.sql`, sans effet en PostgreSQL 17.

**Rappel du README :** ne jamais relancer en production les 15 migrations restaurées (elles y sont déjà) ; rafraîchir
la baseline après chaque migration appliquée en production.

### #40 Fonctionnalités analyste : Objectifs, Journal des drafts, Dossier adverse (back + front, 19/11) — **OK avec une réserve P2 (spec § 11)**

**Contrôles :**
- `vitest` **1 748 / 1 748** ;
- `typecheck`, `lint` et `web:build` EXIT 0 ;
- `check:i18n` OK, 3 857 clés.

**Back-end :**
- **Migration `20261119290000`** :
  - `draft_log` et `opponent_dossiers` en RLS : les membres lisent ; un joueur ne voit qu'un dossier publié ; le staff,
    analyste compris (`is_group_staff`), écrit ;
  - `status` et `published_at` **non accordés en UPDATE**, donc la publication passe forcément par
    `set_opponent_dossier_status`, qui notifie le groupe ;
  - formats contrôlés : `match_id`, picks, 5 bans, ordre de 10, textes de 600 caractères au plus, `snapshot` de 64 ko au
    plus.
- **Tests des modules** (37 cas) :
  - `teamTimelineCore` (9) : côté rouge inversé, exécution, **grubs 3 ou 6 selon le patch** (`grubsAvailableOf`,
    cohérent avec #45), courbe d'or, timings, petit échantillon, `null` plutôt que 0 ;
  - `analystCores` (20) : bans dans l'ordre, custom sans draft (`null`), filtres, synthèse, forme, nouveau pool,
    duos, cartes, vue du dossier, texte Discord, source ;
  - `analystViews` (5) et `analystErrors` (3) : table absente, limite Riot.

**Harnais (FR, clavier) :**

| Écran | Résultat |
|---|---|
| `/team?tab=objectives` | Affiché. 17 éléments, **tous nommés, anneau de focus partout**. Frise doublée d'un texte `sr-only` par partie (« Premier sang · 03:10 · pris par nous ; Larves… »). « Afficher plus » présent. |
| `/coaching?tab=draft&draftView=journal` | Affiché, sous-onglet dans l'URL. 39 éléments, tous nommés et avec anneau. Tuiles de synthèse. **Ligne ouverte au clavier** (bouton `aria-expanded`), panneau avec notes et « Ouvrir dans Préparation ». |
| `DraftManualDialog` | S'ouvre avec Entrée ; champs nommés (« Adversaire », « Date », picks et bans par rôle) ; radiogroups « Côté » et « Résultat » nommés ; Échap ferme. |
| Dossier (Scouting → « Dossier ») | Ouvert au clavier (`?dossier=…`). Retour vers Scouting, badge « Brouillon », Publier, Copier pour Discord, bandeau du mode réduit (20 games), cartes des 5 rôles, Duos, « Contre nous », plan de jeu limité à 600. 19 éléments, tous nommés. |
| `?analystMissing=1` | Sur les 3 écrans : `role="status"`, « Arrive avec la prochaine mise à jour du serveur… », sans erreur brute. |

**Réserve P2 — l'ordre de pick ne peut pas être saisi (spec § 11).**
- Le panneau de détail **affiche** l'ordre ou « inconnu » (`DraftLogView.tsx:225-232`), mais aucune interface ne
  permet de le **saisir**. Ni le panneau ni `DraftManualDialog` ne le proposent.
- Le back-end est prêt : `DraftLogPatch.pickOrder`, zod `max(10)`, colonne `pick_order`.
- Conséquence : la tuile « Notre 1er champion pické » ne se débloquera jamais.
- À faire (frontend-dev) : un éditeur accessible au clavier dans le panneau. Par exemple, 10 cases B1, R1, R2, B2… avec
  un sélecteur de champion parmi les 10 picks de la partie, ou une liste réordonnable avec des boutons « monter » et
  « descendre ». **Pas** de glisser-déposer seul.

**Réserves P3 :**
1. Le bouton de ligne du Journal a pour nom la seule date (« 19 nov. ») : y ajouter l'adversaire et le résultat
   (`aria-label`).
2. `DraftManualDialog` : après Échap, le focus part en haut de la page (même correctif que `ConfirmDialog`). Les
   radios ont toutes `tabindex=0` (pas de tabindex mobile) ; ça marche, mais ce n'est pas le modèle de
   `MyAvailabilityDialog`.
3. i18n : les nouvelles clés françaises disent « **Herald** » (`fr.json:4778, 4801, 4825`), alors que le reste de l'app
   dit « Héraut ».
4. Doublure du harnais : Larves à 05:30 dans les données simulées, alors que les parties 16.x les ont à 8:00 (sans
   effet sur l'app).

### #45 Données de jeu 2026, corrections D1 à D5 (backend-dev, 19/11) — **OK ; fenêtre D2 acceptée**

**Contrôles :**
- `vitest` **1 710 / 1 710** (129 fichiers) ;
- `typecheck` et `lint` EXIT 0 ;
- `ANALYSIS_VERSION` = 10 ;
- **`check:i18n` en échec**, mais pas à cause de #45 : la clé `analyst.objectives.partial` est utilisée sans traduction
  dans `src/components/analyst/ObjectivesView.tsx`, un dossier nouveau, non suivi par git et en cours ailleurs.

| Point | Verdict | Preuve |
|---|---|---|
| **D1 — M8** | ✅ | `baronFrom = (clock === 2025 ? 25 : 20) * MIN` (`mistakeRules.ts:130`), saison lue par `gameClockOf`. Test aux bornes (`mistakeRules.test.ts:103-116`) : 16.x à 10:00 (Larves), 17:00 (Héraut) et 19:54, pas de tag ; à 20:00, tag. 15.x à 24:00, pas de tag ; à 25:00, tag. |
| **D2 — œil du Héraut** | ✅ **fenêtre mesurée acceptée** | 16.x : 15:00-22:00 (`untilSec: 1320`). Sur 128 parties en cache, 108 yeux : 90 % partis à 21:21, 95 % à 21:52, le dernier à 23:09. 15.x : 15:00-25:00 (`CLOCK_2025`, `untilSec: 1500`) ; 79 parties, 74 yeux : 95 % partis à 22:15, le dernier à 25:45, et le Héraut vivait jusqu'à 24:45. **Une fenêtre plus large ne crée pas de faux positif**, car la règle exige un Héraut à nous déjà tué **et** un `ITEM_DESTROYED` de l'œil, par ce jungler, après sa mort. La fenêtre ne sert qu'à borner : plus large, elle rate moins de cas. Les tests suivent (`microReviewV7.test.ts:275-276`, `anomalyDetectorMath`). |
| **D3 — patchs 15.1 à 15.8** | ✅ documenté | `RAPPORT_MOTEUR.md:72` : non séparés, avec les valeurs de l'époque. |
| **D4 — niveaux 19 et 20** | ✅ | Temps du niveau 18, faute de source. Choix raisonnable et commenté. |
| **D5 — `pit`** | ✅ | 16.x : `fromSec: 900` (Héraut à 15:00) ; 15.x : 840 conservé, pour ne pas faire bouger les analyses 2025. |
| **Textes** | ✅ | « Krugs et Gromp à 1:07 » dans les fondamentaux ; `RAPPORT_MOTEUR.md:69` (3 Larves à 8:00 depuis 25.09, avant 6:00 avec réapparition) ; commentaires du détecteur à « 15:00–22:00 (2025 : jusqu'à 25:00) ». |

**Point bloquant hors #45 :** tant que `analyst.objectives.partial` n'a pas sa traduction, `npm run check:i18n`
échoue. Le pré-contrôle de `release.ps1` refusera donc toute release. À signaler à la session qui écrit
`src/components/analyst/`.

### #39 rôles staff cumulables, phase 1 du proxy Riot, R7 (19/11) — **OK avec une réserve P2**

**Contrôles :**
- `vitest` **1 684 / 1 684** (126 fichiers) ;
- `typecheck` (tests compris, de nouveau vert), `lint`, `check:i18n` (3 669 clés) EXIT 0 ;
- `tsc` de `riot-proxy` et `discord-bot` EXIT 0.

| Point | Verdict | Preuve |
|---|---|---|
| **#39 — migration `20261119280000`** | ✅ | `group_members.staff_roles text[]`, contrôlé : sous-ensemble de coach / manager / analyst, sans doublon, sans le rôle principal, vide pour l'owner. `UPDATE (staff_roles)` est révoqué pour les clients, et seule `set_member_staff_roles` écrit (owner seulement, `INVALID_ROLE`, `OWNER_HAS_ALL_ROLES`, `for update`, notification `staff_roles_changed`). Les fonctions RLS passent par `private.has_group_role` (rôle principal **ou** staff). Déjà revue par CyberSecurity. |
| **#39 — `permissions.ts`** | ✅ | `effectiveRoles`, et les prédicats prennent `staffRoles` en option, sans changer le comportement sans lui. **`canReadWellbeing` (client) = `private.can_read_wellbeing` (serveur)** : rôle principal autre que joueur, et owner, coach ou analyst parmi les rôles effectifs ; le serveur impose en plus `share_wellbeing`. Un joueur qui coache ne lit pas le bien-être de ses coéquipiers (décision de l'utilisateur). |
| **#39 — front** | ✅ (code) | Cases « Aussi staff : » dans un `fieldset` avec `legend` en `sr-only` qui nomme le membre ; seulement pour l'owner ; masquées si l'API manque. **Pas vues dans le harnais** : la doublure n'a ni `staffRoles` ni `collabSetMemberStaffRoles`. |
| **Proxy, phase 1** | ✅ | `handler.ts`, dans l'ordre : route, puis login, puis limite par utilisateur (**60/min**, au lieu de 300), puis **cache R2** des matchs et timelines (servi avant le budget, sans coût sur la clé, seulement les 200 JSON non vides de 8 Mo au plus, jamais les listes d'ids ni avec une query), puis **budget global** par hôte dans un Durable Object (`18:1,95:120`, sous les limites Riot, réserve interactive de 30 %), qui répond 429 + `Retry-After` **avant** Riot, laisse passer si le compteur est en panne, et sanctionne l'hôte après un 429 de Riot. Enfin, **métriques** Analytics Engine sans donnée personnelle. 17 tests (`riotProxyPhase1.test.ts`). |
| **R7** | ✅ | Déjà validé (`DEMANDE_CLE_PROD.md`). |

**Réserve P2 — la priorité n'est envoyée par aucun client.** Aucun appel du desktop (`riotClient.ts`, `team.ipc.ts`)
ni du web (`riotWeb.ts`, `teamStatsWeb.ts`) ne pose `x-nxm-priority: background`. Le proxy traite donc **tout** comme
interactif (c'est le comportement voulu pour les anciennes versions), et la réserve de 30 % ne protège pas une fin de
partie contre un scout complet. C'est la moitié de P1-2 / P1-3. Correctif : envoyer `background` pour le scout, la
synergie, l'auto-remplissage et les stats d'équipe web.

**Réserves P3 :**
1. ~~**Stockage R2 sans durée de vie**~~ — tranché par CyberSecurity le 19/11 : **90 jours, bucket privé**,
   ajouté aux § 6 et § 7 de la politique v0.3 et au § 4.8 de `DEMANDE_CLE_PROD.md`. Reste à vérifier, au
   déploiement, que la règle de cycle de vie R2 est bien posée.
2. **Priorité `background`** (réserve P2) : confiée au Back-end (P1-3, desktop) et au Front-end (web).
3. **Déploiement :** il faut créer le bucket R2, le Durable Object (migration `v1-riot-budget`) et le dataset
   Analytics Engine. Accord de l'utilisateur requis.
4. **Doublure du harnais :** ajouter `staffRoles` et `collabSetMemberStaffRoles` pour pouvoir voir les cases.

### Lot runner UNIQUE, G, H, K, codes d'invitation, zod (19/11) — **OK ; DA-2 passe**

**Contrôles :**
- `vitest` **1 656 / 1 656** (124 fichiers) ;
- `typecheck` (tests compris) et `lint` EXIT 0 ;
- `check:i18n` OK.

| Point | Verdict | Preuve |
|---|---|---|
| **Runner (P1 données)** | ✅ | DA-2 passe à ✅. Les échecs bloquent maintenant le démarrage au lieu d'être sautés, ce qui est voulu : mieux vaut une erreur visible qu'une table perdue. |
| **G** | ✅ | PE-3 passe à ✅. |
| **H** | ⏳ | BE-5 : code corrigé, temps de démarrage à mesurer. |
| **K** | ✅ | UX-3 passe à ✅. |
| **Codes d'invitation** (migration `20261119270000`) | ✅ | `private.random_code` utilise `gen_random_bytes` (pgcrypto), alphabet de 31 symboles sans caractère ambigu, **tirage sans biais** (rejet des octets ≥ 248 = 31 × 8), longueur validée de 1 à 64, `search_path = ''`, `revoke` pour `public`, `anon` et `authenticated`. Codes de 10 caractères pour les groupes, 12 pour l'accès. Les contrôles d'autorisation de `create_group_invite` sont conservés. |
| **`redeem-invite`** | ✅ | `CODE = /^[A-Z0-9]{10,16}$/`, plafond global de 5 000 échecs par heure. **Production lue (lecture seule)** : aucune invitation d'accès, 1 invitation de groupe valide de **10** caractères, donc aucun code existant n'est cassé par la nouvelle regex. |
| **zod** | ✅ | `team:remove-member` (`idSchema`), `team:delete-custom-game` (id local ou `group:<uuid>`), `recording:game-ids-with-recording` (tableau d'ids, 1 000 au maximum). |

**Réserves (P3) :**
1. `src/lib/accessCore.ts:23` : `INVITE_CODE` accepte encore `{6,16}`. Un code de 6 à 9 caractères passe le contrôle
   du client, puis l'edge function le refuse en `invalid_request` générique. À aligner sur `{10,16}`.
2. `LFT_ROLES` et `SCORE_ROLES` : dernières copies de la liste des rôles.
3. Gains de G et H à chiffrer : montage du tableau de bord, temps jusqu'à la fenêtre en build packagé.

### Lot 429 web, J, Q, T, X, A-F (front et back, 19/11) — **OK ; redéploiement web débloqué**

**Contrôles :**
- `vitest` **1 645 / 1 645** (121 fichiers) ;
- `typecheck` EXIT 0, **tests compris** ;
- `lint` EXIT 0 ;
- `check:i18n` OK, 3 657 clés ;
- `site:build` et `web:build` EXIT 0 ;
- `tsc` des workers `riot-proxy` et `discord-bot` EXIT 0.

| Point | Verdict | Preuve |
|---|---|---|
| **429 web** (ma réserve P2) | ✅ **levée** | `riotWeb.ts:30-90` : `Retry-After` respecté en entier (secondes ou date HTTP), 3 tentatives au maximum, pause partagée par tout l'onglet (`blockedUntil`), échec immédiat avec un message clair au-delà de 30 s. Le bulk remonte l'erreur de limite au lieu de l'avaler. 5 tests dans `riotWebRateLimit.test.ts`. La pause reste par onglet : la protection entre utilisateurs relève du limiteur global du proxy (P1-2 de `PLAN_CLE_PROD.md`). |
| **J** | ✅ | FE-3 passe à ✅. |
| **Q** | ✅ | TE-4 passe à ✅. |
| **T** | ✅ | `src/lib/ddragon.ts` : une seule promesse de version, avec repli ; `loading="lazy"` dans `DraftTab.tsx`. |
| **X** | ✅ | `public/sw.js` garde un repère ; `web/vite.config.ts` le remplace au build (sinon le build échoue) ; `dist/sw.js` contient `BUILD = '1.0.0-beta.8-…'`. `activate` supprime les caches des builds précédents. |
| **A** | ✅ | `mistakeAutoDetect.ts` est partagé par le bouton manuel (`mistakes.ipc.ts`) et le flux automatique (`stats.ipc.ts`) : sévérité apprise et signets inclus (E11, E27). |
| **B** | ✅ en partie | `no such column` n'est plus avalé que sur `DROP`. Voir la réserve sur `UNIQUE` ci-dessous. |
| **C** | ✅ | REL-6 passe à ✅. |
| **D** | ✅ | TE-5 passe à ✅. |
| **E** | ✅ | TE-6 passe à ✅. |
| **F** | ✅ | PE-1 passe à ✅ (2 844 ko). |

**Avis demandé — faut-il restreindre la tolérance « UNIQUE constraint failed » du runner ? Oui, et en priorité
(P1 sur les données).**

Aujourd'hui, `isAlreadyAppliedError` (`database.ts:64-69`) la tolère pour **toute** instruction. Deux cas réels en
souffriraient :
1. **Reconstruction de table** (motif SQLite déjà utilisé par 2 migrations : `CREATE TABLE "new_X"`,
   `INSERT INTO "new_X" SELECT … FROM "X"`, `DROP TABLE "X"`, `ALTER TABLE "new_X" RENAME`). Si la copie échoue
   sur une contrainte UNIQUE, elle est **sautée**, puis l'ancienne table est supprimée : **toutes les lignes sont
   perdues**, sans erreur, et la migration est marquée appliquée.
2. **`CREATE UNIQUE INDEX`** (15 migrations en contiennent) sur une table qui a des doublons : l'index n'est pas
   créé, la migration est marquée appliquée, et la contrainte manque ensuite.

Proposition, par ordre de préférence :
- (a) **ne plus tolérer UNIQUE du tout**, et écrire les seeds en `INSERT OR IGNORE` (une migration le fait déjà ;
  4 `INSERT INTO` à relire) ;
- (b) à défaut, ne le tolérer que pour un `INSERT INTO … VALUES` (seed), **jamais** pour `INSERT … SELECT`, ni pour
  `CREATE UNIQUE INDEX`, ni pour `UPDATE`.

Dans les deux cas, ajouter un test unitaire pour `isAlreadyAppliedError` : `INSERT … SELECT` + UNIQUE doit faire
échouer.

### #41 (scrims partagés, stats d'équipe web), WSC-19, M (purge MatchCache), #38 front (19/11) — **OK avec une réserve P2**

**Contrôles :**
- `vitest` **1 624 / 1 624** (116 fichiers) ;
- `typecheck`, `lint` et `web:build` EXIT 0 ;
- `check:i18n` OK, 3 645 clés.

| Point | Verdict | Preuve |
|---|---|---|
| **41a — `team_custom_games`** | ✅ | Migration `20261119260000` : RLS en lecture pour tout membre du groupe (`private.group_role`) et en écriture pour le staff ; `on delete set null` sur `created_by` ; `unique (group_id, local_id)` contre les doublons ; contrôles de taille. **Pas appliquée en production** (accord de l'utilisateur requis). Côté app, la publication et la lecture se font « au mieux » (`team.ipc.ts:383-422`) : table absente, hors ligne ou joueur sans droit, l'import local marche toujours. |
| **41b — stats d'équipe sur le web** | ✅ avec réserve | Mêmes fonctions pures que le desktop (`scoutingCore`) ; cache LRU de 600 parties pour la vie de l'onglet, requêtes en vol partagées, listes d'ids gardées 5 min, concurrence 6 ; seules les parties où au moins `minTogether` joueurs ont joué ensemble sont téléchargées. |
| **WSC-19 — Scrims** | ✅ | `listTeamDrafts(group.id)` : drafts du groupe. Les liens vers d'anciens drafts personnels sont signalés « introduits avant… », avec un texte pour le staff et un pour les joueurs. Requête annulée si le composant disparaît. |
| **M — purge de `MatchCache`** | ✅ | `exported: false` dans `backupCore.ts:85`. La timeline est mise à `NULL` après 90 jours si aucune `Game` ne pointe vers la partie ; le corps de la partie est gardé. Lancement 2 min après le démarrage, puis une fois par jour. Test sur vraie base : partie à soi conservée, scout ancien purgé, scout récent conservé, second passage à 0. Toutes les écritures de `MatchCache` passent par Prisma, donc le format de `createdAt` est cohérent avec la comparaison SQL. |
| **#38 — « anciennement X »** | ✅ | `previousRiotId` : migration écrite à la main, zod strict dans `team:update-member`, note avec bouton OK, et note gardée si hors ligne. `GroupTeamGate` met à jour le membre en place (même puuid) au lieu de le supprimer et le recréer. |
| **Rendu web** | ⏳ | Pas de doublure pour la web app. Test de fumée seulement : `web-dev` (port 5180) affiche l'écran de connexion, **0 erreur en console**. La page Team stats n'a **pas** été vue : il faudrait un compte, et je ne me connecte pas à un vrai compte. |

**Réserve P2 — boucle de nouvelles tentatives sur 429 dans `web/src/riotWeb.ts:45-49`** (antérieure à ce
lot, mais 41b la sollicite davantage).
- `proxyFetch` réessaie **sans limite** de tentatives ;
- il **plafonne `Retry-After` à 10 s**, alors que Riot peut demander beaucoup plus sur la fenêtre de 100 requêtes
  par 2 min ;
- la web app n'a pas de limiteur (le desktop a `MultiWindowLimiter`).

Avec une clé partagée par tous les utilisateurs, un onglet Team stats peut relancer Riot toutes les 10 s pendant une
saturation. Des 429 répétés exposent la clé à une liste noire (voir `docs/PLAN_CLE_PROD.md`, F10). Correctif :
respecter `Retry-After` en entier, 3 tentatives au maximum, puis une erreur affichée. Ensuite, le limiteur global du
proxy (P1-2).

**Réserve P3 :** `team:delete-custom-game` et `team:remove-member` restent en `ipcMain.handle` sans validation zod
(BE-1).

### Tâche I (polling) — **OK sur estimation, mesure à refaire**

Verdict envoyé au Chief le 19/11 : environ **2,9 requêtes/min** au repos, fenêtre visible, sur desktop (sync 60 s =
2 requêtes, cloche 2 min, annonces et reviews 10 min). Environ **0,4/min** fenêtre cachée. Sur le web, environ
**1,9/min** visible et **0,2/min** caché. Avant la tâche I : environ 12/min.

C'est une **estimation tirée du code** : la mesure dans le harnais a échoué, parce que les appels passent par un
`Proxy` (`mockApi.ts:138`) que mon compteur n'enveloppait pas. À refaire en enveloppant `window.api`, ou dans
Observability de Supabase après le déploiement.

Réserve P3 : chaque retour de focus relance tous les pollers (environ 5 requêtes) ; prévoir un délai minimal de
30 s.

### #36 Planning au clavier, #37 icônes de profil, #34 déliaison Discord, suites du consentement (frontend-dev, 19/11) — **OK**

**Contrôles :**
- `vitest` **1 582 / 1 582** (110 fichiers) ;
- `typecheck` EXIT 0 ;
- `lint` EXIT 0, **avec jsx-a11y en erreur** ;
- `check:i18n` OK, 3 630 clés.

| Point | Verdict | Preuve (harnais FR, Management → Planning) |
|---|---|---|
| **#36** « Nouvel événement » | ✅ | Focalisable, focus visible ; Entrée ouvre la popup « Nouveau créneau à 20:00 » (`role="dialog"`, nommée), avec le focus sur « Début ». |
| **#36** Jour / Début / Fin | ✅ | Trois `combobox` reliés à leur `<label htmlFor>` (« Jour », « Début », « Fin ») ; l'erreur de fin est annoncée par `aria-describedby`. |
| **#36** Piège du focus | ✅ | 30 tabulations : le focus reste dans la popup. Échap la ferme. |
| **#36** `MyAvailabilityDialog` | ✅ | 7 `radiogroup` nommés (« lundi 16 novembre »…), 3 `radio` chacun, tabindex mobile (0 sur le choix coché, −1 ailleurs) ; → passe de « Habituel » à « Dispo » (`aria-checked` mis à jour, focus suivi et visible). |
| **A11Y-1 / A11Y-3** | ✅ | Voir le tableau Accessibilité. |
| **#37** 27 icônes de profil | ✅ | 27 fichiers `webp` (`import.meta.glob`) ; boutons `aria-pressed`, `aria-label` « Icône n » ou « Icône n, verrouillée jusqu'au palier X », image en `alt=""`, verrou en `aria-hidden`. |
| **#34** `DiscordUnlinkButton` | ✅ | Affiché seulement pour `DISCORD_MANAGER_ROLES` (`GroupsSection.tsx:278`) et dans la carte Discord du web ; passe par `ConfirmDialog` ; FORBIDDEN donne un message qui dit qui peut le faire ; « rien à délier » est distingué d'un vrai déliage. Masqué si l'API manque. |
| **Réserve 1 du consentement** (poids des boutons) | ✅ | Les deux en `variant="outline"` (`WellbeingConsentDialog.tsx:75, 79`). |
| **Réserve 2** (croix « Fermer ») | ✅ | `text-hextech-text-dim` (annoncé 5,18:1), `focus-visible:ring-2` dans `ui/dialog.tsx:48`. Corrige tous les dialogues. |
| **Réserve 3** (focus rendu) | ✅ | `onOpenAutoFocus` / `onCloseAutoFocus` avec `returnTo` (`WellbeingConsentDialog.tsx:30-43`). |
| **Réserve 4** (texte) | ✅ | « …depuis la carte Confidentialité (Paramètres dans l'app, Compte sur le web)… » (`fr.json:3068`). |

**Réserves (P3) :**
1. **Popup d'événement :** à la fermeture par Échap, le focus part en haut de
   la page au lieu de revenir sur « Nouvel événement » ou sur la case de la
   grille. La popup n'a pas `aria-modal="true"`, alors que le focus y est
   bien piégé.
2. **Icônes verrouillées :** en `disabled`, elles ne sont pas focalisables
   au clavier, et le `title` (« Se débloque au palier X ») ne se voit qu'au
   survol. Le nom accessible porte déjà le palier, donc c'est mineur.
   `aria-disabled="true"` les rendrait découvrables au clavier.
3. **Onglets d'édition du profil** (Icône / Bannière / Titres / Bio) : le
   choix actif n'est indiqué que visuellement. Ajouter `aria-pressed` ou
   `role="tab"` / `aria-selected`.

### Consentement au bien-être, partie front (frontend-dev, 19/11) — **OK avec réserves**

**Fichiers relus (non commités) :**
- `useWellbeingConsent.ts`, `WellbeingConsentDialog.tsx`,
  `WellbeingPrivacyCard.tsx` ;
- `WellbeingSection.tsx` (dialogue au premier check-in, règle 5) ;
- `GroupsSection.tsx` (switch de partage) ;
- `useYoutubeUploadAvailable.ts` (lit maintenant `youtubeGetStatus().available`).

**Contrôles :**
- `vitest` **1 577 / 1 577** ;
- `typecheck` et `lint` EXIT 0 ;
- `check:i18n` OK, 3 603 clés.

**Harnais (FR, Management → Bien-être).** La doublure n'expose pas
`wellbeingConsent*` : j'ai injecté en mémoire, dans mon seul onglet, un
`wellbeingConsentGet` qui renvoie `none` et un `Set` / `AddCheckin` qui
journalisent les appels.

| Exigence | Résultat |
|---|---|
| Rien de pré-coché | ✅ 0 case ni interrupteur dans le dialogue ; la décision passe uniquement par les deux boutons. |
| Focus initial neutre | ✅ Sur « En savoir plus (politique de confidentialité, § 3 bis) », pas sur « J'accepte ». |
| Les deux choix aussi visibles | ⚠️ **Même taille** (195 × 36 px, grille à 2 colonnes), mais **pas le même poids** : « J'accepte » est plein (fond or, texte sombre), « Pas maintenant » ou « Refuser et les supprimer » n'a qu'un contour. Le commentaire du composant annonce « same size and weight ». |
| Échap ne décide rien | ✅ Mode « check-ins existants » : Échap ferme, **0 appel** (rien supprimé, rien accordé). Mode « premier check-in » : idem. |
| « Pas maintenant » | ✅ Ferme ; **0 appel** : pas d'accord, pas de check-in enregistré, le formulaire reste tel quel. |
| « J'accepte » au clavier (Tab, Tab, Entrée) | ✅ Appels dans l'ordre : `wellbeingConsentSet(true, 'v0.3')`, puis `wellbeingAddCheckin`. |
| Règle 5 (check-ins existants) | ✅ Le dialogue s'ouvre à l'ouverture de l'onglet avec « Vous avez déjà 8 check-ins enregistrés. Si vous refusez, ils seront supprimés. » ; le bouton de refus dit « Refuser et les supprimer ». |
| Switch de partage du bien-être | ✅ Désactivé sans accord (seulement pour l'activer ; le couper reste toujours possible), avec `aria-describedby` vers l'explication (`GroupsSection.tsx:294-307`). |
| Retrait de l'accord (carte Confidentialité) | ✅ Passe par un `ConfirmDialog` avant de supprimer. |

**Réserves :**
1. **P2 — Égalité visuelle des deux choix.** Mettre les deux boutons en
   `variant="outline"`, ou les deux dans la même variante. C'est ce que
   demandent les lignes directrices européennes sur les interfaces
   trompeuses (EDPB 03/2022), pour un consentement à des données de santé.
2. **P2 — Croix « Fermer » invisible dans tous les dialogues**
   (`src/components/ui/dialog.tsx`). L'icône est calculée **noire**
   (`rgb(0,0,0)`, opacité 0,7) sur le fond du dialogue (≈ `#1C140C`), soit
   un contraste d'environ 1,1:1. La classe
   `data-[state=open]:text-muted-foreground` pointe probablement vers une
   variable non définie. Ce défaut existait avant ce lot, mais il touche
   chaque dialogue de l'app. Correctif : `text-hextech-text-dim` sur
   `DialogPrimitive.Close`.
3. **P3 — Focus perdu à la fermeture** de `WellbeingConsentDialog` (après
   « Pas maintenant » ou Échap, le focus part en haut de la page). Même
   correctif que `ConfirmDialog` : mémoriser l'élément à l'ouverture.
4. **P3 — Libellé.** « Vous pouvez retirer votre accord à tout moment dans
   **Réglages** → Confidentialité » (`fr.json:3041`), alors que l'app dit
   « **Paramètres** », et que le web place cette carte dans la page **Compte**.
   Proposition : un texte par plateforme, ou « dans Paramètres (app) ou
   Compte (web) ».

**Non vérifié :**
- le côté serveur (stockage de l'accord, suppression des check-ins au refus,
  arrêt du partage), qui relève du back-end et de CyberSecurity ;
- la page Compte du web.

### Lot U / V / L, YouTube option A, états de données, Codex 2026, textes, focus, toasts (front + back, 19/11) — **OK**

**Contrôles :**
- `vitest` **1 574 / 1 574** (108 fichiers ; le faux positif de
  `webApiCoverage` sur `isDev` a disparu) ;
- `typecheck`, `lint` et `web:build` EXIT 0 ;
- `check:i18n` OK, 3 568 clés.

| Point | Verdict | Preuve |
|---|---|---|
| **U** — `ranked5` retiré (L14) | ✅ | `TeamSessionPage.tsx:32-33` : filtres `flex`, `scrim`, `all`. Le type `SessionQueueFilter` et `queueBucket` gardent `ranked5` pour lire les anciennes valeurs enregistrées, ce qui est sans effet visible. |
| **V** — WSC-04 | ✅ **à fermer** | Sur le web, Coaching masque Pool, Draft et Scouting (`show: hasGroup && canLinkTeams`, `canLinkTeams = typeof window.api.linkTeamToGroup === 'function'`, faux sur le web, `CoachingPage.tsx:36-43`). Pas de route `/team-space` sur le web (`web/src/main.tsx:45-53`). Le web garde ces outils dans sa page `/team`. |
| **L** — « Choisir » et E15-B | ✅ | UX-5 passe à ✅ (voir le tableau). |
| **YouTube option A** | ✅ (verdict sécurité à CyberSecurity) | `youtubeUploadAvailable()` = `!app.isPackaged && clientId && secret` (`youtube.ipc.ts:86-88`). `youtube:auth-start` et `youtube:upload` lèvent `YOUTUBE_UNAVAILABLE` dans l'app installée (`:147`, `:275`). Les contrôles sont masqués par `useYoutubeUploadAvailable` (faux tant que non confirmé, donc rien ne clignote). Le secret est lu par `process.env` à l'exécution, **pas inliné** : le bundle construit contient le nom de la variable mais 0 occurrence du préfixe des secrets Google. |
| **États de données** | ✅ | `ui/data-state.tsx` : `EmptyState` (`role="status"`), `ErrorState` (`role="alert"`, bouton Réessayer), squelettes (`role="status"` + `aria-label` « Chargement… », blocs en `aria-hidden`). Utilisés dans Historique, Stats (`AnalyticsPage`), Revue et Labo d'erreurs. |
| **Codex 2026** | ✅ | Le conseil « Après 14 min, laisser les T1 à 1 PV » a disparu ; la carte `sideT1` dit « T1 {{lane}} détruite, la 1re tour déjà tombée », sans heure. Réserves de #4 levées. |
| **Textes en dur** | ✅ | I18N-2 passe à ✅. |
| **Focus `ring-2` / `ring-offset-2`** | ✅ | Audit clavier rejoué (FR, 15 écrans, 653 éléments) : **0 contrôle sans nom, 0 champ nommé par son seul placeholder, 0 anneau de 1 px**. `ui/textarea` et `ui/select` inclus (réserve P3 de #31 levée). |
| **Toasts opaques** | ✅ | Fond `color-mix` de la couleur à 10 % sur `--hextech-dark`. Contrastes annoncés par Graphic Design : 5,6 / 4,9 / 6,7 (≥ 4,5). |

**Réserve P3 :** dans `tests/unit/webApiCoverage.test.ts:80-81`, les
commentaires de `computeTeamSynergyStats` et `linkTeamToGroup` disent encore
« WSC-04, to decide ». À mettre à jour maintenant que la décision est prise.
Sur le web, l'actualisation de la synergie dans `/team` → Scouting affiche
toujours une erreur ; c'est assumé, mais un message « disponible sur l'app
desktop » serait plus clair.

### #18 Contrat `AscendAPI` du preload et de l'adaptateur web (FE-4 / L16) (backend-dev, 19/11) — **OK, une réserve sur le test**

| Vérification | Résultat |
|---|---|
| Le contrat détecte vraiment une dérive | Fichier de test hors dépôt, compilé avec la config `web/tsconfig.json` et les mêmes assertions que `apiContract.ts`. **3 erreurs attendues, 3 obtenues** : méthode retirée du preload (TS2322), signature incompatible dans `webApi` (TS2322), méthode en trop dans le preload (TS2344). Les vrais `PreloadApi` et `webApi` passent. ✅ |
| Le contrat est contrôlé | `web/tsconfig.json` inclut `src/**/*`, donc `apiContract.ts` ; `npm run typecheck` EXIT 0. ✅ |
| Angles morts du scanner | Recherche faite sur les 166 fichiers du bundle web : **aucun** appel `(window.api as any).x(`, aucun alias `const api = window.api`, aucune déstructuration. Le scanner ne rate rien aujourd'hui. ✅ |
| Liste des trous justifiés | 9 entrées, chacune avec sa raison (desktop seul, `try/catch` avec repli, décision WSC-04). Un second test oblige à retirer une entrée dès que le web l'implémente. ✅ |
| `collabSetGroupLogo` sur le web | Présent dans `web/src/api.ts:237`. ✅ |
| `typecheck`, `lint`, `check:i18n` (3 557 clés), `web:build` | EXIT 0. ✅ |
| `vitest` | **1 566 / 1 567 : 1 échec**, voir la réserve. |

**Réserve (P2, bloque la suite et donc le pré-contrôle de `release.ps1`) — faux
positif du scanner sur un commentaire.**

`webApiCoverage` signale `isDev (src/hooks/useYoutubeUploadAvailable.ts)`. Ce
nouveau fichier n'est pas encore suivi par git et vient du travail YouTube
« option A » en cours, pas de #18. Le hook est bien protégé
(`typeof isDev !== 'function'`). L'expression `window.api.isDev()` qui
déclenche l'alerte est dans le **commentaire** de documentation.

Correctif proposé : retirer les commentaires (`//…` et `/*…*/`) avant de
chercher les appels dans le test, ou au minimum reformuler le commentaire. À
faire avant la prochaine release.

### #4 Règles recalées sur l'horloge 2026, `ANALYSIS_VERSION` 9 (backend-dev, 19/11) — **OK avec réserve**

**Fichiers relus :**
- `src/lib/microReview/anomalyDetector.ts` : `DETECTOR_SPEC` pour 16.x,
  `CLOCK_2025` pour 15.x ;
- `electron/main/mistakeRules.ts` (M12) ;
- `electron/main/ipc/microReview.ipc.ts` (version 8 → 9) ;
- `docs/RAPPORT_MOTEUR.md` ;
- les 5 fichiers de tests touchés.

| Point | Verdict | Preuve |
|---|---|---|
| Dive 1 pour 1 | ✅ | `dive.untilSec` 840 → 1200 en 16.x ; `CLOCK_2025.dive` garde 840. Tests limites dans `microReviewSeason2026` : `untilSec − 3 s` détecté, `untilSec` non détecté, 15:00 détecté en 16.x mais pas en 15.x. |
| Roam mid payé en plaques | ✅ (constantes) | `midRoam.untilSec` 1200 en 16.x et 840 en 15.x ; la boucle (`anomalyDetector.ts:1576`) lit bien `S.midRoam.untilSec`. Limite annoncée par le back : pas de fixture qui produise un roam réel après 14:00. |
| Tour de side | ✅ | `sideTower.fromSec` 0 en 16.x, 840 en 15.x. L'ancre « une tour est déjà tombée » reste (`e.timestamp > firstTower.timestamp`). Testé : 12:00 détecté en 16.x et pas en 15.x, limite 20:00 incluse. |
| M12 | ✅ | `4 * MIN - early` avec `early = 35 s` en 16.x (`mistakeRules.ts:128`) ; le choix de 3:25 est justifié par la mesure (28,9 % contre 28,5 %) ; tests ajoutés dans `mistakeRules.test.ts`. |
| Non-régression 15.x | ✅ | Les tests V5 et V7 ne sont pas affaiblis : leurs fixtures 15.x passent à `CLOCK_2025` avec les mêmes assertions, et `anomalyDetectorMath` vérifie les deux tables. |
| Version du cache | ✅ | `ANALYSIS_VERSION = 9`, commentaire à jour : les analyses en cache seront recalculées. |
| Contrôles | ✅ | `vitest` **1 560 / 1 560** ; les 3 fichiers de #4 : 130 / 130 ; `typecheck` et `eslint` EXIT 0. Les 6 échecs vus pendant le chantier ont disparu. |
| Documentation | ✅ | `RAPPORT_MOTEUR.md` : saison 2026, fenêtre à 20:00, M12 à 3:25. |

**Réserves :**
1. **P2 — Texte de carte devenu faux.** La carte de la tour de side dit
   « T1 {{lane}} détruite **après 14:00**, la 1re tour déjà tombée »
   (`fr.json:3991`, `en.json:3991`, clé utilisée par `smartQcm.ts:501`). En
   16.x, la règle se déclenche maintenant avant 14:00 : la carte affirmera
   une heure fausse. Proposition : « avant 20:00 » sans heure de début, ou une
   variante par saison (comme `CLOCK_TIMES` dans `gameClock.ts`).
2. **P3 — Conseil du Codex en décalage.** `codex.json:1591-1592` dit
   « Après 14 min, laisser les T1 ennemies à 1 PV ». En 2026, la règle
   s'applique dès qu'une tour est tombée. À reformuler.
3. **Limite acceptée :** le roam mid n'est vérifié qu'au niveau des
   constantes et de la boucle. Une fixture 16.x avec plaques perdues après
   14:00 renforcerait le test.

### UI-B4 (textes en i18n) et #31 (accessibilité clavier) (frontend-dev, 19/11) — **OK avec réserves**

**Contrôles (dossier partagé) :**
- `check:i18n` OK, 3 430 clés ;
- `typecheck` et `lint` EXIT 0 ;
- `vitest` : **1 553 / 1 553**. Les 6 échecs annoncés (anomalyDetectorMath,
  microReviewV5, travail #4) n'apparaissent plus à ce lancement.

**#31, harnais en français, 15 écrans, 654 éléments focalisables :**

| Point du passage clavier | Résultat |
|---|---|
| Curseurs `ui/slider` | `aria-label` transmis au Thumb (par ex. « Conscience de l'état de wave »). ✅ |
| Interrupteurs des Paramètres | `role="switch"`, `aria-checked`, `<label htmlFor>` (par ex. « Lancer Ascend au démarrage de Windows »). ✅ |
| Cloche | « Notifications, 3 non lues ». ✅ |
| Graphiques en secteurs | `tabindex="-1"`, plus focalisables. ✅ |
| Champs de la Revue | Plus aucun champ nommé par son seul placeholder. ✅ |
| Lien d'évitement | Première tabulation ; Entrée donne le focus à `<main id="main">` sans toucher l'URL du `HashRouter`. Présent aussi sur le web (`WebLayout.tsx`). ✅ |
| Contrôles sans nom | **0** (21 avant). ✅ |
| Anneau de 2 px | Appliqué à `ui/button`, `ui/input` et `ui/slider`. **Encore 1 px sur `ui/textarea` et sur le déclencheur de `ui/select`** (sélecteur de groupe, choix du micro dans Paramètres, notes de la Revue). P3. |

**UI-B4 :** l'échantillon de nouvelles clés françaises est correct (jargon
gardé : review, scouter, SoloQ, Flex, clip). Les restes de la revue #6 sont
corrigés : « Add member », l'heure 12 h, « ECONOMY ». **Il reste environ
25 textes en dur** (I18N-2, P2), surtout la zone de réinitialisation et les
webhooks des Paramètres. Le détail est dans le tableau i18n.

**Réserves :**
1. **P2** — environ 25 textes en dur restants (voir I18N-2).
2. **P3** — `ring-2` à étendre à `ui/textarea` et `ui/select`.

### Suites des réserves #2, TE-8, `release.ps1` et `team:link-group` (backend-dev, 19/11) — **OK**

**Contrôles complets (dossier partagé) :**
- `npx vitest run` : 105 fichiers, **1 553 / 1 553** ;
- `npm run typecheck` EXIT 0 ;
- `npm run lint` EXIT 0 ;
- `check:i18n` OK, 3 422 clés.

| Livraison | Verdict | Preuve |
|---|---|---|
| **#2 — `sessionForStatus`** (`accessCore.ts:121-139`), branché dans `cloud:status` (`cloud.ipc.ts:40`) et `webApi.cloudStatus` (`web/src/api.ts:109`) | ✅ | Toute la chaîne est couverte : `getSession()` rend `{ session: null, error: AuthRetryableFetchError }`, puis `isAuthUnreachable` lève `AUTH_UNREACHABLE` (le délai de `authTimeoutFetch` arrive aussi en `AuthRetryableFetchError`). Ensuite, la promesse de `ipcRenderer.invoke('cloud:status')` (preload `:254`) est rejetée, puis le `catch` de `CloudGate` (`:32`) affiche l'écran « injoignable », vérifié dans le harnais. Le `catch` ne filtre pas sur le message : l'enveloppe d'Electron (« Error invoking remote method… ») ne gêne pas. Test `authSignOutFlow.test.ts:87-107` avec le vrai supabase-js : session expirée + refresh hors ligne, donc `AUTH_UNREACHABLE` et session gardée en stockage ; pas de session, donc `null` (pas d'écran d'erreur à tort). |
| **TE-8** | ✅ | Seuil à 50 ms (`anomalyDetectorMathPatterns.test.ts:709`). |
| **`release.ps1` — empreinte du dossier** | ✅ | `Get-WorkingTreeFingerprint` (l. 39-49) calcule le SHA-256 de `HEAD`, de `git diff HEAD --binary` et du contenu des fichiers non suivis. L'empreinte est prise à l'étape 0 (l. 70) et revérifiée juste avant `electron-builder` (l. 117) : en cas d'écart, arrêt avec la liste des fichiers. Fonction testée hors script, `$ErrorActionPreference = 'Stop'` compris : deux calculs de suite identiques (5 à 6 s chacun), et une valeur qui a changé entre deux runs pendant qu'une autre session écrivait. Les avertissements de git sur la sortie d'erreur ne cassent rien. |
| **`teamLinkGroupIpc.test.ts`** | ✅ | 6 cas sur une vraie base SQLite et le vrai handler : une seule équipe propre par groupe, adversaires partagés, non classés sur demande, refus de l'équipe d'un autre profil sans aucune modification, **rollback** (le `team.update` échoue dans la transaction et le `updateMany` est annulé : l'ancienne équipe garde le groupe), validation des entrées. Réserve n° 3 de #7 levée. |

**Réserves restantes (P3) :**
- L'empreinte ne couvre pas les fichiers ignorés par git (`.env` notamment,
  dont Vite inline les `MAIN_VITE_*` au build). Une modification de `.env`
  pendant la release passe inaperçue.
- Il reste une petite fenêtre entre la seconde empreinte et la lecture des
  fichiers par `electron-builder`.

**#2 n'attend plus que le test de l'utilisateur dans l'app réelle :**
1. déconnexion, puis reconnexion ;
2. si possible, démarrage hors ligne avec une session expirée, qui doit
   afficher « Serveur Ascend injoignable » puis « Réessayer ».

### #7 Scouting par groupe, back et front (19/11) — **OK**

**Fichiers relus (non commités) :**
- `src/lib/scoutingCore.ts` (`teamListWhere`, `teamLinkReleaseWhere`) ;
- `electron/main/ipc/team.ipc.ts` : `team:list`, `team:create` et
  `team:link-group` passent sous `validatedHandle` (zod strict, `groupId` en
  uuid), et le lien se fait dans une transaction ;
- `web/src/api.ts` (`listTeams` et `createTeam` avec `groupId`) ;
- `ScoutingTab.tsx` (prop `groupId`, bloc « non classés »),
  `CoachingPage.tsx`, `web/src/pages/TeamPage.tsx` ;
- `confirm-dialog.tsx` et `dialog.tsx` (« Fermer » traduit) ;
- `.harness/mockPages.ts` (`?scout2`).

**Critère de fin, vérifié dans le harnais (`/?scout2`, FR, deux groupes) :**

| Étape | Groupe Ascend Esport | Groupe Ascend Academy |
|---|---|---|
| Départ | Aegis Academy + bloc « 1 adversaire non classé » (Old Rivals) | Nova Rising + Old Rivals non classé |
| « Rattacher à ce groupe » sur Old Rivals, depuis Academy | — | Nova Rising, Old Rivals ; plus de bloc « non classé » |
| Retour sur Esport | **Aegis Academy seul** | — |

Chaque groupe ne voit que ses adversaires, plus les non classés. ✅

| Critère | Statut | Preuve |
|---|---|---|
| TE-1 / TE-3 | ✅ | `scoutingCore.test.ts` + `teamCore.test.ts` : 28 / 28. `teamListWhere` (portée utilisateur, groupe, non classés) et `teamLinkReleaseWhere` (rôle exclusif seulement pour sa propre équipe) sont testés. |
| BE-1 | ✅ (progrès) | 3 handlers `ipcMain.handle` bruts passent sous `validatedHandle`. `team:create` n'étale plus l'objet du renderer dans Prisma (liste blanche). Les appelants existants (`GroupTeamGate`, `ScoutingTab`) passent le schéma strict. |
| DA (portée) | ✅ | `team:link-group` vérifie maintenant que l'équipe appartient à l'utilisateur local (`findFirst` sur `userId`). Avant, `update` par id seul. |
| FE-1 / FE-2 / I18N-1 | ✅ | `npm run typecheck` EXIT 0 (le `TeamPage.tsx:137` qui cassait le typecheck est réglé) ; `eslint` des 8 fichiers EXIT 0 ; `check:i18n` OK, 3 156 clés. |
| Réserve n° 1 de #6 (focus) | ✅ | Suppression ouverte au clavier, puis Échap : le focus revient sur « Supprimer Aegis Academy ». |

**Réserves :**
1. **P2 — Le Draft Sim liste encore les adversaires de tous les groupes.**
   `DraftTab.tsx:241` appelle `listTeams({ isOpponent: true })` sans
   `groupId` : le sélecteur d'adversaire d'une draft garde le défaut que #7
   corrige dans le Scouting. Même correctif (prop `groupId` depuis
   `CoachingPage`).
2. **P3 — Focus perdu après « Rattacher à ce groupe ».** Le bouton disparaît
   avec le bloc et le focus part en haut de la page. Proposition : le placer
   sur la puce de l'adversaire rattaché.
3. **P3 — Le handler IPC n'est testé qu'à travers les fonctions pures.** La
   transaction et la vérification du propriétaire de `team:link-group` ne sont
   pas couvertes ; un test avec le harnais IPC SQLite existant (T6) le
   ferait.
4. **Rappel :** « Add member » est toujours en anglais (UI-B4).

**Non vérifié :**
- l'app desktop réelle avec de vrais groupes (les ids du harnais, `g1`, ne
  sont pas des uuid : la doublure ne passe pas par zod) ;
- la web app en ligne.

### #6 Draft Sim et ScoutingTab, partie front (frontend-dev, 19/11) — **OK avec réserves**

**Fichiers relus (non commités) :**
- `src/pages/Team/DraftTab.tsx` ;
- `src/pages/Team/ScoutingTab.tsx` ;
- `src/components/ui/confirm-dialog.tsx`, nouveau ;
- `src/i18n/locales/{en,fr}.json`.

| Critère | Statut | Preuve |
|---|---|---|
| UX-3 (tiers) | ✅ | Draft Sim dans le harnais : 26 icônes, bordures exactement aux couleurs de `TIER_COLOR` (`poolView.ts`) : `#E0B054`, `#5BC8AF`, `#6FA0D8`, `#B99AE0`. `TIER_BG` est supprimé. |
| FE-7 | ✅ | Le bouton imbriqué de la puce d'adversaire est remplacé par deux boutons frères. La puce porte `aria-pressed` ; le bouton de suppression porte `aria-label` et devient visible au focus clavier (`focus-visible:opacity-100`, opacité 1 mesurée après la transition). |
| `confirm()` natifs | ✅ | `grep` : plus aucun `confirm(` natif dans `src`. Le dialogue de suppression s'ouvre à la touche Entrée, garde le focus à l'intérieur, place le focus sur « Annuler » (choix sûr), se ferme avec Échap sans rien supprimer, et a un titre et une description reliés. |
| I18N-1 | ✅ | `npm run check:i18n` : 3 143 clés, en/fr synchronisées. Les 68 clés de `ScoutingTab` et les 39 de `DraftTab` existent dans `fr.json` (script de recoupement). |
| I18N-4 | ✅ | Jargon gardé en anglais : pool, draft, games, scout, flex, main role. |
| A11Y-4 | ✅ (sur ces écrans) | Champs du formulaire d'ajout, sélecteurs région et rôle, boutons scout et retirer : tous ont un nom. |
| FE-1 / FE-2 | ✅ | `tsc -p tsconfig.web.json` EXIT 0 ; `eslint` des 3 fichiers EXIT 0. |

**Réserves :**
1. **P2 — Le focus n'est pas rendu au déclencheur après fermeture** de `ConfirmDialog`. Après Échap, le focus part en haut de la page au lieu de revenir sur le bouton de suppression : le dialogue est contrôlé, sans `DialogTrigger`, donc Radix ne sait pas où revenir. Correctif dans le composant partagé : mémoriser `document.activeElement` à l'ouverture et le refocaliser dans `onCloseAutoFocus`. Ça vaut pour tous les futurs usages.
2. **P2 — Textes encore en anglais dans le Scouting en français :**
   - « Add member » (`ScoutingTab.tsx:434`) ;
   - l'heure de « Mis à jour » en format anglais 12 h (`toLocaleTimeString()` sans la langue de l'app, `:735`) ;
   - l'en-tête « ECONOMY » de la table de stats (`DashboardLayout.tsx:55`).
   À joindre à UI-B4.
3. **P3 — Spinner du bouton scout sans `aria-hidden`** ; le libellé de l'erreur `PanelErrorBoundary label="Opponent synergy"` est en anglais (interne, à vérifier s'il s'affiche).

**Non vérifié :**
- le filtre des adversaires par groupe : c'est la partie back de #7 ;
- la suppression effective, que je n'ai pas confirmée pour ne pas modifier les
  données de démonstration du harnais ;
- la web app.

### #17 `release.ps1` et #19 `prisma:migrate` (backend-dev, 19/11) — **OK avec réserves**

**#19 :** la ligne `"prisma:migrate": "prisma migrate dev"` est retirée de
`package.json`. Aucune autre référence hors des docs, qui interdisent la
commande. DA-1 ✅.

**#17, méthode :** le classifieur de sécurité a refusé d'exécuter le vrai
script, même avec `-NoPublish`. J'ai donc testé une **copie réduite à
l'étape 0**, coupée avant la récupération du token GitHub, avec le build
remplacé par un message et `$repoRoot` pointé sur le dépôt. Aucun build ni
publication n'était possible.

| Cas | Résultat |
|---|---|
| Dossier modifié, non interactif | Liste des 30 premiers fichiers modifiés, puis « Working folder not clean… », EXIT 1. ✅ |
| `-AllowDirty`, lint remplacé par un script inexistant | typecheck, puis lint en échec : « Check failed: lint. Nothing was built. », EXIT 1. i18n et tests ne sont pas lancés. ✅ |
| `-AllowDirty`, vrais contrôles (1ᵉʳ essai) | typecheck, lint et i18n OK ; tests : 1 échec (voir TE-8), donc « Check failed: unit tests », EXIT 1. ✅ (le script fait ce qu'il doit) |
| `-AllowDirty`, vrais contrôles (2ᵉ essai) | typecheck en échec à cause du travail en cours d'une autre session (`web/src/pages/TeamPage.tsx:137`, `groupId` manquant, lié à #7), EXIT 1. ✅ |
| `-AllowDirty`, 4 contrôles remplacés par `check:i18n` | « All checks passed. », puis l'étape de build est atteinte, EXIT 0. ✅ |

Le texte de `[release]` sur la sortie d'erreur (stderr) de npm ne casse pas le
script : avec `$ErrorActionPreference = 'Stop'`, PowerShell 5.1 ne transforme
pas la sortie d'erreur d'une commande native en erreur bloquante tant qu'elle
n'est pas redirigée.

**Réserves :**
1. **Non testé :** la question interactive `YES` (la session n'a pas de
   console) et le vrai script de bout en bout. La première release (`beta.8`)
   doit être suivie à l'écran.
2. **P3 — Contrôle au départ seulement.** Une autre session peut modifier le
   dossier pendant les contrôles (environ 2 min) ou le build. Proposition :
   relire `git status --porcelain` juste avant `electron-builder` et
   s'arrêter s'il a changé.
3. **P3 — Les e2e ne sont pas dans le pré-contrôle.** Ils restent à la charge
   de la CI (REL-3). Acceptable si la règle « CI verte avant release » est
   tenue.
4. **P2 — Test instable (TE-8).** Un test de durée bloque la release au hasard
   sur une machine chargée. À corriger, sinon le réflexe sera de passer
   outre.
5. **Information — état actuel du dossier :** le typecheck échoue sur
   `web/src/pages/TeamPage.tsx:137` (travail #7 en cours). Une release lancée
   maintenant serait refusée, ce qui est le comportement voulu.

## Procédure de revue avant release

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
