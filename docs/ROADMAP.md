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

## Phase 1 — Sécurité 🔜 (1–2 semaines, prérequis de la plateforme web)

| # | Tâche | Détail |
|---|-------|--------|
| 1.1 | Sortir les secrets du bundle | Riot API via **Edge Function Supabase** (proxy authentifié + rate-limit par utilisateur). Google OAuth : flux PKCE desktop, sans `client_secret` embarqué. Supprimer `MAIN_VITE_*_KEY` de l'app. |
| 1.2 | CSP | `session.defaultSession.webRequest.onHeadersReceived` (promis par le PRD §4, absent). |
| 1.3 | `sandbox: true` | Fenêtre principale + fenêtre WGC ; adapter le preload si besoin. |
| 1.4 | Validation IPC | Schéma `zod` sur chaque `ipcMain.handle` (aujourd'hui 0/20 fichiers), helper `validatedHandle(channel, schema, fn)`. |
| 1.5 | `nxm://` | Servir uniquement les fichiers sous les dossiers d'enregistrement configurés (`realpath` + préfixe). |
| 1.6 | Electron | Monter vers une version supportée (33 est EOL). |
| 1.7 | Signature de code | Certificat (Azure Trusted Signing est l'option la moins chère) → plus d'alerte SmartScreen, mises à jour vérifiées. |

## Phase 2 — Qualité ⏳ (2–3 semaines, prérequis avant la synchro)

- CI GitHub Actions : `typecheck` (web + node), `vitest`, `electron-vite build`, vérification des clés i18n FR/EN.
- ESLint + Prettier.
- Remplacer les 27 tests E2E factices (`expect(true)`) par de vrais tests Playwright `_electron`.
- Tests des handlers IPC sur SQLite temporaire (stats, team, review, recording).
- Découper les fichiers > 1 400 lignes (`VideoReviewPlayer`, `team.ipc`, `SettingsPage`, `DraftTab`, `SessionPage`, `recording.ipc`).
- Logger structuré (fichier rotatif) + crash reporting opt-in.
- Backup automatique de la base avant chaque migration au démarrage.

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

### W1 — Compte & sauvegarde cloud (≈ 1–2 sem.)
- Connexion Supabase Auth (Discord / Google / e-mail) dans l'app, lien compte cloud ↔ `User` local.
- Sauvegarde cloud chiffrée : réutilise `backup:export` → snapshot uploadé dans Storage, restauration sur un autre PC. Livre la promesse « zéro perte » rapidement, avant la vraie synchro.
- Pages légales (CGU, confidentialité), suppression de compte et export des données (RGPD).

### W2 — Synchronisation multi-appareils (≈ 3–4 sem.)
- Schéma : ajouter `updatedAt`, `deletedAt` (tombstones) et `ownerId` aux modèles synchronisés ; les ids `cuid()` actuels sont déjà globalement uniques.
- Table locale `SyncOutbox` (pattern outbox) : chaque écriture IPC enregistre l'opération ; un worker pousse vers Supabase et tire les changements `updated_at > lastPulledAt`.
- Conflits : *last-write-wins* par ligne pour les entités simples ; *append-only* pour notes de timeline, commentaires, bookmarks (pas de conflit possible).
- Périmètre : User, Account, Assessment(+Scores), Session, Game, Review, Bookmark, Clip (métadonnées), Mistake/MistakeTag, ExternalReview, Team, TeamMember, ChampionPoolEntry, DraftPrep, CustomGame. Exclus : MatchCache, GameDetailedStats (re-téléchargeables depuis Riot).
- Indicateur de statut de synchro dans la sidebar + écran de résolution manuelle si besoin.

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

## Ordre recommandé

```
Phase 0 ✅ → Phase 1 (sécurité) → Phase 2 (CI/tests)
                                   ├─→ W1 → W2 → W3 → W4 → W5
                                   └─→ A1 → A2 → A3 → A4 (en parallèle, local)
```
