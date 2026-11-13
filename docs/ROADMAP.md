# NexusMind — Roadmap technique & produit

> Issu de l'audit du 12/11/2026 (v0.2.0-beta.60). Ce document complète le [PRD](../PRD.md).
> Légende : ✅ fait · 🔜 prochain · ⏳ planifié · 💡 idée

---

## Phase 0 — Hygiène immédiate ✅

- ✅ Commit de tout le travail beta.30 → beta.60 (55 fichiers dont 4 migrations).
- ✅ Suppression du code de debug mort (`debugAgentLog`, logs `.cursor/`).
- ✅ Nettoyage des artefacts : 14 `query_engine*.tmp` (283 Mo, embarqués dans l'installeur), anciens installeurs `release/`, `win-unpacked/`.
- ⚠️ **Action manuelle** : régénérer la clé Riot — elle est incluse en clair dans `app.asar` de chaque release publiée (`MAIN_VITE_*` est inliné au build). Tant que la phase 1 n'est pas livrée, toute nouvelle release republiera la nouvelle clé.
- ⚠️ **OpenAI (IA abandonnée)** : *révoquer* la clé existante sans la remplacer (elle reste exploitable à tes frais depuis les anciennes releases), puis retirer `MAIN_VITE_OPENAI_API_KEY` du `.env`.

---

## Phase 1 — Sécurité 🔜 (prérequis de la plateforme web)

| # | Tâche | État | Détail |
|---|-------|------|--------|
| 1.0 | Retrait du code IA | ✅ | `openaiClient`, `ai.ipc`, `AIPanel/*`, dépendance `openai` supprimés. |
| 1.1 | Sortir les secrets du bundle | 🟡 | Riot : **Cloudflare Worker** (`cloudflare/riot-proxy/`, JWT Supabase + rate-limit par joueur, endpoints en liste blanche) — code prêt, à déployer (voir `docs/CLOUD_SETUP.md`). La clé de dev n'est plus jamais incluse dans un build. Reste : Google OAuth en PKCE sans `client_secret` embarqué (YouTube). |
| 1.2 | CSP | ✅ | `<meta>` injectée au build (`electron.vite.config.ts`) ; liens externes → navigateur, navigation hors app bloquée. |
| 1.3 | `sandbox: true` | ✅ | Fenêtre principale + fenêtre WGC. |
| 1.4 | Validation IPC | 🟡 | Helper `validatedHandle` + schémas sur les handlers sensibles (partage Discord/temp/YouTube, URLs, `user:update`, reviews externes, webhooks). Reste : migrer les ~90 autres handlers au fil de l'eau. |
| 1.5 | `nxm://` | ✅ | Seuls les dossiers d'enregistrement + fichiers liés en base sont servis (`mediaAccess.ts`). Chemins persistés depuis le renderer : uniquement issus d'une boîte de dialogue native. |
| 1.6 | Electron | ⏳ | Monter vers une version supportée (33 est EOL) ; vérifier `native-audio-node`, Prisma, WGC. |

## Phase 2 — Qualité 🟡 (prérequis avant la synchro)

- ✅ CI GitHub Actions (`.github/workflows/ci.yml`, Windows) : typecheck web + node, ESLint, i18n, vitest, build, E2E. `npm run check` reproduit la CI en local.
- ✅ ESLint orienté bugs (0 erreur ; 44 avertissements à résorber). Prettier volontairement non appliqué (éviter un reformatage global).
- ✅ i18n : script `check:i18n` ; 50 textes qui n'existaient qu'en anglais dans le code ont été traduits.
- ✅ 27 tests E2E factices remplacés par 20 vrais tests Playwright `_electron` sur données isolées (`NEXUSMIND_DB_PATH`, `NEXUSMIND_USER_DATA`) : onboarding, sécurité (CSP, sandbox, `window.open`, `nxm://`), rendu de toutes les pages principales.
- 🟡 Tests des handlers IPC sur SQLite temporaire : migrations/backup, session, user, partage, reviews externes. Reste : stats, team, review, recording.
- ✅ Backup automatique (`VACUUM INTO`, 5 derniers conservés) avant toute migration ; erreur de démarrage affichée au lieu d'une app sans fenêtre.
- ⏳ Découper les fichiers > 1 400 lignes (`VideoReviewPlayer`, `team.ipc`, `SettingsPage`, `DraftTab`, `SessionPage`, `recording.ipc`) — à faire quand on touche ces fichiers.
- ⏳ Logger structuré (fichier rotatif) + crash reporting opt-in — avec la plateforme web (même backend).

## Phase 3 — Roadmap « Next » du PRD ⏳

Recommandation d'objectif par règles, résumé de review déterministe, patterns récurrents, score de qualité de session, file de reviews, filtres persistants partout. Une partie existe (`coaching.ipc`, `CoachingPatternCard`, `ObjectiveSuggestionPanel`) — à confronter au PRD §15.2. **Fusionnée avec la Phase A ci-dessous.**

---

## Phase W — Plateforme web & synchronisation ⏳

### Choix d'architecture

- **Backend : Supabase** (déjà amorcé : `supabase/schema.sql` avec RLS, `profiles`, `coach_students`, `synced_*`). Postgres + Auth + RLS + Realtime + Storage + Edge Functions, palier gratuit suffisant pour démarrer. Région UE (RGPD).
- **Site web : Vite + React** dans le même dépôt (monorepo `apps/desktop`, `apps/web`, `packages/shared`) pour réutiliser composants UI, i18n, types et règles métier. Hébergement statique gratuit (Cloudflare Pages / Vercel).
- **Principe : local-first conservé.** L'app desktop reste fonctionnelle hors-ligne ; le cloud est une copie synchronisée, pas la source unique.
- **Vidéos : jamais uploadées par défaut** (coût de stockage). On synchronise les métadonnées, bookmarks et timestamps ; partage vidéo via YouTube/lien, ou upload explicite de clips courts avec quota.
- **Bonus Riot** : une clé API *production* exige un produit enregistré avec site public, CGU et politique de confidentialité — le site web débloque cette demande.

### W1 — Compte & sauvegarde cloud 🟡 (code fait, mise en ligne à finir)
- ✅ Compte **obligatoire**, connexion par **code e-mail** (Discord plus tard). Session chiffrée par le trousseau Windows, tokens jamais exposés au renderer.
- ✅ Proxy Riot sur **Cloudflare Worker** (choix : la bande passante Supabase gratuite ne tiendrait pas les JSON de match).
- ✅ Sauvegarde cloud : automatique chaque jour + manuelle, 10 dernières conservées, restauration par fusion. Bucket privé, RLS par utilisateur ; protection au repos par Supabase (pas de chiffrement côté client : le partage coach de W3 en aura besoin).
- ✅ Moteur de sauvegarde unifié (fichier + cloud) : copie toutes les colonnes du schéma courant, inclut erreurs, tags, bookmarks, customs (oubliés avant), exclut le cache Riot du cloud et les webhooks Discord.
- ✅ RGPD : suppression du compte (Edge Function `delete-account`), export via fichier `.nexusmind`, CGU + politique de confidentialité **brouillons** dans l'app (placeholders éditeur/contact à compléter, relecture juridique conseillée).
- ⏳ À faire par toi : modèles d'e-mail avec `{{ .Token }}`, déploiement du Worker, `MAIN_VITE_RIOT_PROXY_URL`, SMTP avant la bêta publique (`docs/CLOUD_SETUP.md`).
- ⏳ Nettoyer les anciennes tables Supabase vides (`synced_*`, `coach_*`) en W3.

### W2 — Synchronisation multi-appareils 🟡 (code fait, test réel sur 2 PC à faire)
- ✅ Serveur : table générique `sync_records` (une ligne JSON par enregistrement, RLS par compte) + RPC `sync_push` (last-write-wins sur l'heure du changement, curseur `seq` serveur). Testée en conditions réelles.
- ✅ Local : triggers SQLite → `_sync_outbox` (capte aussi le SQL brut, aucun handler IPC modifié). Première synchro : tout l'existant est envoyé avec sa vraie date de modification.
- ✅ Fusion : `userId` réécrit vers le profil local, doublons naturels fusionnés via `_sync_idmap` (tag intégré par `slug`, game par `matchId`, compte par `puuid`…), enfants en attente de leur parent dans `_sync_inbox`, suppressions en tombstones (cascade locale).
- ✅ Jamais synchronisé : chemins vidéo/miniatures, cache Riot, stats détaillées, webhooks Discord, clips, réglages du profil `User` (spécifiques au PC).
- ✅ Garde-fous : un compte cloud = un joueur Riot (`_profile`), synchro désactivée avec plusieurs profils locaux.
- ✅ Indicateur dans la sidebar (clic = synchro), synchro 5 s après une modification + toutes les 30 s, toast « Actualiser » quand un autre PC a envoyé des données.
- ⏳ Limites connues : XP / streak / réglages non synchronisés ; une écriture locale pendant l'application d'un lot distant (< 1 s) peut ne pas être détectée ; pas d'écran de résolution manuelle (last-write-wins seulement).

### W3 — Collaboration multi-joueurs 🟡 (code fait, test à deux comptes à faire)
- ✅ Serveur : `groups` (équipe ou groupe de coaching), `group_members` (owner · coach · analyst · player), `group_invites` (codes 10 caractères, 7 j, 10 usages), `group_sharing` (consentement du joueur par groupe : reviews · stats · données d'équipe). Toute la sécurité en RLS ; helpers en schéma `private` non exposé ; seules `create_group`, `create_group_invite`, `join_group` sont appelables.
- ✅ Lecture partagée directement sur `sync_records` (pas de copie) : le staff lit sessions/games/reviews/erreurs et stats si le joueur partage ; les coéquipiers ne voient que les données d'équipe.
- ✅ `review_comments` (fil coach ↔ joueur, horodatage vidéo, résolu) et `assigned_objectives` (1–3 objectifs, note, échéance, statut).
- ✅ RLS testée en conditions réelles avec 4 comptes fictifs (transaction annulée) : 13 cas, dont retrait du partage.
- ✅ App : page **Coaching** (créer/rejoindre/inviter/quitter, rôles, partage), vue coach des joueurs (sessions, reviews, commentaires, assignation), retours du coach sur la page Review, objectifs du coach en un clic à la création de session.
- ✅ Anciennes tables du coaching pré-W1 (`profiles`, `coach_students`, `coach_comments`, `synced_*`) supprimées. Toutes les migrations serveur sont versionnées dans `supabase/migrations/`.
- ⏳ À faire : modification à plusieurs des données d'équipe (aujourd'hui lecture seule pour les autres), notifications (W5).

### W4 — Application web 🟡 (en ligne : https://nexusmind-web.nexusmind-riot-proxy.workers.dev — écrans connectés à tester)
Lecture et actions légères pour qui n'a pas son PC (`web/`, `npm run web:dev` / `web:build`) :
- ✅ Même code que le desktop : les écrans partagés (connexion, Coaching, fils de commentaires, objectifs assignés) tournent tels quels ; `window.api` est fourni par un adaptateur Supabase (`web/src/api.ts`). La logique collab est extraite dans `src/lib/collabCore.ts`, utilisée par les deux.
- ✅ Accueil : retours du coach non lus, objectifs assignés, prochains scrims.
- ✅ Mes reviews : sessions/games/reviews synchronisées (lecture), réponse au coach, lien direct depuis l'accueil.
- ✅ Scrims (`scrims`, `scrim_availability`, RLS testée 9 cas) : planification par le staff, disponibilités de chaque membre, checklist de préparation, drafts d'équipe liées (`DraftPrep` partagées), analyse post-scrim, statut.
- ✅ PWA installable (manifest, icône, service worker « coquille hors ligne »), en-têtes de sécurité (CSP, HSTS, X-Frame-Options), build dans la CI.
- ✅ Déployé sur Cloudflare (Workers static assets, successeur de Pages) : `cd web && npx wrangler deploy` après `npm run web:build` (`web/wrangler.toml`).
- ⏳ Tableau de bord progression / analytics (lecture) ; résumé des games custom (`CustomGame`) dans l'analyse post-scrim ; découpage du bundle (254 Ko gzip).
- Pas d'enregistrement, pas de détection de partie : ça reste desktop.

### W6 — Accès sur invitation & connexion web automatique 🟡 (code fait, à tester)
- ✅ Inscriptions publiques fermées : un nouveau compte n'est créé que par l'Edge Function `redeem-invite` à partir d'un **code d'accès** (`access_invites`, usage unique, 14 j, éventuellement réservé à un e-mail) ou d'un **code d'équipe / coaching** (W3). Limite anti-abus : 10 échecs / IP / heure.
- ✅ Écran de connexion : champ « code d'invitation » demandé seulement à la première connexion ; liens `<web>/#invite=CODE` pré-remplis.
- ✅ Admins (`app_admins`, ajoutés à la main dans Supabase) : carte « Inviter sur NexusMind » dans Réglages (desktop) et Compte (web) — créer, copier, révoquer.
- ✅ Web : session persistante (localStorage, rafraîchie automatiquement) → pas de code à chaque ouverture ; bouton desktop **« Ouvrir l'app web »** (Edge Function `web-handoff` : jeton magic-link à usage unique dans le fragment d'URL, jamais envoyé par e-mail).
- ⏳ Désactiver « Allow new users to sign up » dans Supabase Auth ; test bout en bout avec un compte invité.

### W5 — Notifications (≈ 1–2 sem.)
- Canaux : in-app (Realtime), Web Push (PWA), Discord (webhooks déjà gérés), e-mail en option.
- Événements : review commentée par le coach, nouvel objectif assigné, scrim planifié / rappel J-1 et H-1, analyse de scrim disponible, joueur inactif depuis X jours (côté coach), rapport hebdomadaire prêt.
- Préférences de notification par utilisateur et par type.

---

## Phase A — « Assistant » à règles métier (remplace l'IA payante) 🟡 (A1–A4 codés, à valider sur de vraies parties)

Objectif : un assistant qui *paraît* intelligent, à coût d'inférence nul, déterministe et explicable. 100 % local : tout le code est dans `electron/main/assistant/` (fonctions pures testées) et `src/components/Assistant/`.

### A1 — Feature store ✅
- ✅ `features.ts` : par game, indicateurs normalisés — CS/min, CS@10/@14 et gold diff @10/@14 (rapport `lanePhaseAnalyzer` en cache sur `Game`, sinon recalculé en mémoire depuis `MatchCache`), morts avant 10 et 14 min et participation aux kills (timeline Riot en cache, `timeline.ts`), vision/min, KDA, score de phase de lane, moyenne des KPI de review, objectif respecté, tags d'erreurs.
- ✅ Par indicateur : moyenne personnelle, écart-type, moyenne récente (5 games) vs baseline (games précédentes), z-score, tendance (pente sur 10 games). Indice composite « perf objective » (z-scores des stats non auto-évaluées) pour détecter les biais d'auto-évaluation.
- ✅ Contexte joueur : séries de victoires/défaites, durée de jeu continue de la session active (une pause > 45 min la remet à zéro, une session oubliée ouverte ne compte pas comme 10 h de jeu), taux de review, objectif répété N sessions et sa progression (pente des KPI de l'objectif et du taux « objectif respecté »).
- ⏳ Écart au palier de rang : pas de benchmarks par rang en local, à faire avec les agrégats anonymes (A4, après Phase W).
- Choix : pas de table de features. Tout est recalculé à la demande (40 dernières games, 20 timelines max, cache mémoire des timelines) : rien à migrer quand une règle change, et rien de plus à synchroniser.

### A2 — Moteur de règles déclaratif ✅
- ✅ `rules.ts` : 28 règles stockées comme **données** sérialisables en JSON (`id`, moments, ton, priorité, confiance, groupe, conditions, nombre de formulations, paramètres du message, justification, action). Conditions : `count` (X des N dernières games), `stat` (moyenne récente / z-score / tendance), `context`, `game` et `gameZ` (la game commentée vs la moyenne perso), `role`, `recurringMistake`.
- ✅ Actions suggérées : objectif, objectif voisin (carte de voisinage + fondamental suivant de la même catégorie), clips à revoir (morts précoces ou erreurs taguées, liens `/record/:id?at=` avec enregistrement en priorité, sinon la phase de lane), analyse de phase de lane, pause, drill, reviews en attente.
- ✅ Règles : morts précoces répétées (3/5 games avec ≥ 2 morts avant 10 min), morts élevées, pic de morts sur la game, phase de lane faible (série / game) et forte, CS en baisse / en hausse, CS@10 bas, CS de la game vs moyenne (haut/bas), vision en baisse, vision de la game (haute/basse), KP faible (jungle/support), biais d'auto-évaluation (tendance et game), auto-évaluation trop sévère, reviews en retard, objectif répété ≥ 4 sessions sans progrès → objectif voisin, objectif qui progresse, objectif respecté, erreur récurrente, tilt (3 défaites d'affilée + > 2 h → pause 15 min), série de défaites, session longue, série de victoires.
- ✅ Un seul conseil par groupe (ex. le schéma sur 5 games remplace la règle « cette game »), classement = priorité × confiance × poids appris.

### A3 — Personnalité « assistant » ✅
- ✅ Trois moments, intégrés dans les pages existantes (pas de nouvelle page) : **3 points après la game** (page Review, après l'enregistrement), **brief de session** (page Session, avant de lancer et pendant la session), **bilan hebdomadaire** (Dashboard, à côté des patterns : semaine vs semaine précédente + « ce qui compte pour vous »).
- ✅ 2 à 3 formulations par règle en anglais et en français (vouvoiement), prénom du joueur, intro variée par moment. La formulation change d'un jour à l'autre mais reste stable dans la journée.
- ✅ Chaque conseil affiche son *pourquoi* (« Basé sur vos 5 dernières parties », « Comparé à votre moyenne sur 12 parties »…).
- ⏳ Rappel d'objectif en début de game (overlay / notification) : non fait.

### A4 — Un assistant qui « apprend », sans budget IA 🟡
- ✅ **Feedback 👍/👎** sur chaque conseil, stocké en local (table `AssistantFeedback`, une ligne par conseil, clic à nouveau = retrait du vote) → poids par règle et par joueur via un prior Beta(2, 2). Le classement utilise la moyenne a posteriori (déterministe : un 👍 ne fait jamais descendre un conseil) ; l'échantillonnage de Thompson est implémenté (`weights.ts`) mais pas activé, car le réordonnancement aléatoire nuit à l'explicabilité. Poids bornés (0,4–1,6) et règles de bien-être (`tilt_break`) jamais repondérées.
- ✅ **Ce qui compte pour vous** : régression logistique locale (`regression.ts`, descente de gradient + L2 sur features standardisées) entre CS/min, vision/min, morts, morts précoces, KP, gold diff @10, score de lane, objectif respecté et victoire, à partir de 15 games avec au moins 4 victoires et 4 défaites. Affichée dans le bilan hebdo avec la mention « corrélation, pas garantie ».
- ⏳ `AssistantFeedback` à ajouter à la synchro (`SYNC_TABLES`) et aux sauvegardes (`backupCore` TABLES) — laissé à la session W3 qui gère ces fichiers.
- ⏳ **Agrégats anonymes opt-in** (après Phase W) : benchmarks par rôle/rang calculés côté serveur en SQL, sans IA.
- 💡 Plus tard, en option : LLM local (Ollama) uniquement pour reformuler, jamais pour décider.

### A5 — Retrait de l'IA payante
Décision : pas d'IA. Supprimer `openaiClient.ts`, `ai.ipc.ts`, les panneaux `AIPanel/*`, la dépendance `openai` et leurs tests ; remplacer leurs points d'entrée par les sorties du moteur de règles (A2/A3).

---

## Phase B — Autonomie du joueur ⏳

Objectif : donner au joueur la boucle *hypothèse → pratique → mesure → verdict* et une méthode à chaque étape, pour qu'il apprenne à se diagnostiquer seul. Tout en règles métier, sur l'existant. (Exercices de pratique délibérée volontairement exclus : couverts par Skill Gap.)

| # | Axe | Impact | Effort | S'appuie sur |
|---|-----|--------|--------|--------------|
| B1 | **Objectifs = expériences** : règle concrète + critère mesuré + durée (N games) → verdict automatique (acquis / en progrès / sans effet) ; fondamental « diplômé » puis suggestion du suivant | ⭐⭐⭐ | Moyen | Sessions, KPI, features de l'assistant |
| B2 | **Revue des morts guidée** : saut vidéo 15 s avant chaque mort, 3 questions fixes, cause choisie dans la taxonomie → profil d'erreurs | ⭐⭐⭐ | Moyen | `eventExtractor`, VOD, Mistake Library |
| B3 | **Revue à deux vitesses** : revue rapide 60 s après chaque game (3 questions, part des 3 points de l'assistant), revue complète 1 game sur 3 choisie par l'app (défaite serrée, écart à la moyenne) | ⭐⭐⭐ | Faible | Review, assistant |
| B4 | **« Toi à ton meilleur vs ton pire »** : écarts entre tes 20 % meilleures et 20 % pires games, indicateurs qui pèsent sur tes victoires | ⭐⭐ | Faible | Régression locale (A4), features |
| B5 | **Carnet de matchups** : note par couple champion/adversaire (niveaux clés, objet, plan de lane, ce qui m'a tué), remplie en 2 clics, affichée automatiquement en sélection des champions | ⭐⭐⭐ | Moyen–élevé | Nouveau : API locale du client LoL (LCU) pour la sélection |
| B6 | **Grilles de niveau** : comportements observables par palier pour chaque fondamental, à cocher ; calibre l'auto-évaluation et révèle les biais | ⭐⭐ | Faible (surtout contenu) | Évaluations |
| B8 | **Règles anti-tilt personnelles** : le joueur fixe ses limites, l'app rappelle et mesure respect + effet | ⭐⭐ | Faible | Règles tilt de l'assistant |
| B9 | **Bibliothèque de référence** : clips/bookmarks classés par fondamental, « exemple à suivre » / « à ne plus faire », proposés avant une session | ⭐⭐ | Faible | Clips, bookmarks, reviews externes |
| B10 | **Apprendre en analysant les autres** : revue croisée entre joueurs d'un groupe et étude de pros avec grilles ciblées | ⭐⭐ | Faible–moyen | Reviews externes, groupes W3 |

Ordre conseillé : B1 → B2 + B3 → B4 → B5 → B6 / B8 / B9 / B10.

Plans détaillés liés : [catalogue des règles métier](AUDIT_REGLES_METIER.md), [gestion d'équipe](PLAN_GESTION_EQUIPE.md), [vitrine](PLAN_VITRINE.md).

## Idées complémentaires 💡

- Clips automatiques à chaque mort / erreur détectée (`eventExtractor` + `mistakeDetector` + bookmarks).
- Export CSV/JSON des reviews et stats.
- Rapport hebdomadaire partageable (Discord / lien web public).
- Télémétrie anonyme opt-in pour mesurer les métriques du PRD §18.

## Phase S — Audit de sécurité avant publication du site ⏳

Dernière étape avant la mise en ligne publique complète : un audit de sécurité de **notre propre infrastructure** (app web, vitrine, Supabase, Workers Cloudflare, app desktop), mené sur un environnement de test avec des comptes de test, après sauvegarde. Objectif : vérifier qu'on ne peut pas accéder au compte ou aux données d'un autre utilisateur, et corriger puis retester toute faille critique ou haute avant publication. Peut être confié à un prestataire pentest ou outillé (OWASP ZAP, `supabase` advisors, revue manuelle).

| Axe | Ce qu'on vérifie | Points de contrôle |
|---|---|---|
| S1 Authentification & invitations | Impossible de créer un compte ou de se connecter sans invitation valide ; pas d'énumération d'e-mails | Inscriptions publiques désactivées, `redeem-invite` (expiration, usage unique, e-mail lié, limite d'échecs par IP), réponses génériques, `web-handoff` à usage unique |
| S2 Autorisation / RLS | Un utilisateur ne voit et ne modifie que ses données et celles partagées avec son consentement | Revue de toutes les politiques RLS (sync, backups, collab W3, scrims W4, invitations), helpers `private.*`, tests négatifs à deux comptes, `get_advisors` au vert |
| S3 Isolation des données | Pas de fuite inter-comptes dans le stockage ni la synchro | Bucket `backups` (chemins par utilisateur), `sync_records` / `sync_push`, `access_invite_attempts` service-role only |
| S4 Edge Functions & Worker | Entrées validées, secrets protégés, pas d'accès non authentifié aux fonctions sensibles | Vérification JWT (JWKS ES256 du proxy Riot), `getUser` dans chaque fonction, quotas, secrets hors du code |
| S5 En-têtes & transport | En-têtes de sécurité stricts et HTTPS partout | CSP, HSTS, X-Frame-Options, `connect-src` minimal, pas de secret exposé côté client |
| S6 Entrées & XSS | Pas d'injection via contenu utilisateur (noms, commentaires, feedback) | Échappement React, validation zod, assainissement des diagnostics joints aux rapports |
| S7 App desktop | Durcissement Electron maintenu | `contextIsolation`/`sandbox`, protocole `nxm://` restreint, tokens confinés au main process, CSP au build |
| S8 Dépendances & secrets | Pas de vulnérabilité connue ni de secret versionné | `npm audit`, scan du dépôt, rotation documentée des clés |

Sortie : rapport de constats classés par gravité, corrections, puis re-test. Publication publique conditionnée à la résolution des constats critiques/hauts.

## Phase F — Finalisation (quand l'app est terminée) ⏳

- Signature de code : certificat (Azure Trusted Signing est l'option la moins chère) → plus d'alerte SmartScreen, mises à jour vérifiées. Activer `sign` dans `electron-builder.yml`.
- Passage de `releaseType: prerelease` à `release` pour la 1.0.

## Ordre recommandé

```
Phase 0 ✅ → Phase 1 (sécurité) → Phase 2 (CI/tests)
                                   ├─→ W1 → W2 → W3 → W4 → W5
                                   └─→ A1 ✅ → A2 ✅ → A3 ✅ → A4 🟡 (en parallèle, local)
                                                         └─→ Phase F (signature, 1.0)

Avant la mise en ligne publique du site complet : Phase S (audit de sécurité) → corrections → re-test.
```
