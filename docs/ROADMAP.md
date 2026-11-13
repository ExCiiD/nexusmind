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

### W3 — Collaboration multi-joueurs (≈ 3 sem.)
- Modèle : `organizations` (équipe/structure) → `memberships(role: owner | coach | analyst | player)` ; `coach_students` existant devient un cas particulier (coach ↔ joueur sans équipe).
- Visibilité par entité : `private` · `coach` · `team`. Le joueur choisit ce qu'il partage (par défaut : reviews et sessions visibles par son coach, rien de plus).
- RLS Postgres basée sur l'appartenance — toute la sécurité côté base, aucune confiance au client.
- Invitations par lien/code (la policy `invite_claim` existe déjà).
- Fonctionnalités : le coach commente une review (fil de commentaires sur un timestamp), assigne un objectif de session, voit le tableau de bord de ses joueurs ; l'équipe partage drafts, scouting et champion pools.

### W4 — Application web (≈ 3–4 sem.)
Lecture et actions légères pour qui n'a pas son PC :
- Lire les reviews (les siennes, celles du coach), commenter, répondre.
- Tableau de bord progression / analytics (lecture).
- Préparation de scrim : planning (calendrier + disponibilités), draft plans (`DraftPrep`), rapport de scouting adverse, checklist pré-scrim.
- Analyse post-scrim : résumé des games custom (`CustomGame`), points à revoir assignés à chaque joueur.
- PWA installable sur mobile.
- Pas d'enregistrement, pas de détection de partie : ça reste desktop.

### W5 — Notifications (≈ 1–2 sem.)
- Canaux : in-app (Realtime), Web Push (PWA), Discord (webhooks déjà gérés), e-mail en option.
- Événements : review commentée par le coach, nouvel objectif assigné, scrim planifié / rappel J-1 et H-1, analyse de scrim disponible, joueur inactif depuis X jours (côté coach), rapport hebdomadaire prêt.
- Préférences de notification par utilisateur et par type.

---

## Phase A — « Assistant » à règles métier (remplace l'IA payante) ⏳

Objectif : un assistant qui *paraît* intelligent, à coût d'inférence nul, déterministe et explicable. Peut avancer en parallèle de la Phase W (100 % local).

### A1 — Feature store
Calculer et stocker, par game et en fenêtre glissante, des indicateurs normalisés : CS@10/@14, morts avant 14 min, gold diff @10/@15, vision/min, participation, KPI de review, rapport de phase de lane (`lanePhaseAnalyzer`), tags d'erreurs (`mistakeDetector`). Pour chaque indicateur : moyenne personnelle, tendance, écart au baseline personnel (z-score) et au palier de rang.

### A2 — Moteur de règles déclaratif
- Règles stockées comme **données** (pas du code dispersé) : `id`, conditions sur les features, priorité, confiance, message i18n à variables, action suggérée (objectif, drill, clip à revoir).
- Exemples :
  - *3 des 5 dernières games avec ≥ 2 morts avant 10 min* → « Ta phase de lane te coûte des games : objectif "trading safe" + revois ces 3 morts » (liens vers les bookmarks).
  - *Auto-score KPI élevé mais stats objectives en baisse* → alerte de biais (déjà au PRD).
  - *Objectif répété 4 sessions sans progrès* → proposer un objectif voisin.
  - *Tilt* : 3 défaites d'affilée + durée de session > 2 h → suggestion de pause.
- Testable unitairement, versionnable, enrichissable sans redéployer de modèle.

### A3 — Personnalité « assistant »
- Moments clés : brief avant session, rappel d'objectif en début de game, 3 points après la game, bilan hebdomadaire.
- Génération de texte par gabarits variés (plusieurs formulations par règle, ton cohérent, prénom du joueur) — donne une impression de conversation sans LLM.
- Toujours expliquer *pourquoi* (« basé sur tes 10 dernières games ») : c'est l'avantage du déterministe sur l'IA.

### A4 — Un assistant qui « apprend », sans budget IA
- **Feedback 👍/👎** sur chaque conseil → ajustement des poids de règles par joueur (bandit manchot / Thompson sampling) : l'assistant met en avant ce qui aide ce joueur précis.
- **Ce qui compte pour toi** : régression logistique locale (quelques lignes de TS, aucun serveur) entre KPI/features et victoire → classement personnel des fondamentaux qui influencent le plus ses résultats.
- **Agrégats anonymes opt-in** (après Phase W) : benchmarks par rôle/rang calculés côté serveur en SQL, sans IA.
- 💡 Plus tard, en option : LLM local (Ollama) uniquement pour reformuler, jamais pour décider.

### A5 — Retrait de l'IA payante
Décision : pas d'IA. Supprimer `openaiClient.ts`, `ai.ipc.ts`, les panneaux `AIPanel/*`, la dépendance `openai` et leurs tests ; remplacer leurs points d'entrée par les sorties du moteur de règles (A2/A3).

---

## Idées complémentaires 💡

- Clips automatiques à chaque mort / erreur détectée (`eventExtractor` + `mistakeDetector` + bookmarks).
- Export CSV/JSON des reviews et stats.
- Rapport hebdomadaire partageable (Discord / lien web public).
- Télémétrie anonyme opt-in pour mesurer les métriques du PRD §18.

## Phase F — Finalisation (quand l'app est terminée) ⏳

- Signature de code : certificat (Azure Trusted Signing est l'option la moins chère) → plus d'alerte SmartScreen, mises à jour vérifiées. Activer `sign` dans `electron-builder.yml`.
- Passage de `releaseType: prerelease` à `release` pour la 1.0.

## Ordre recommandé

```
Phase 0 ✅ → Phase 1 (sécurité) → Phase 2 (CI/tests)
                                   ├─→ W1 → W2 → W3 → W4 → W5
                                   └─→ A1 → A2 → A3 → A4 (en parallèle, local)
                                                         └─→ Phase F (signature, 1.0)
```
