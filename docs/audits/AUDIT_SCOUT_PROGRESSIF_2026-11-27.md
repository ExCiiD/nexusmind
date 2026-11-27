# Audit — lot « scout progressif » (27/11/2026)

Session Audit, lecture seule. Lot non commité du Back-end (moteur, IPC, pacing) et du Front-End (onglet Scouting, store, bannière), vu dans le dossier partagé sur `19512c0` + fichiers non commités. Contrat : `docs/contracts/scouting-progressive.md`. Décision de référence : 24/11 « vitesse, pas données ».

## Verdict global

**Aucun constat bloquant.** Prêt pour la QA croisée Gemini. **Cinq constats importants** sont à corriger avant la release (le I1 en priorité : petit correctif, et il touche l'enregistrement et le post-game). Le moteur, la déduplication, l'ordre et la profondeur par défaut sont corrects.

Contrôles lancés : `npm run typecheck` → 0 erreur (4 projets) ; `eslint` sur les 8 fichiers du lot → 0 ; `npm run check:i18n` → OK (4 985 clés, en/fr synchronisées) ; `npx vitest run` → 204 / 208 fichiers verts, les 4 échecs sont ceux des délais `initDatabase()` (§ 6). Les 3 nouveaux fichiers de test passent.

## Verdict par critère

| # | Critère | Verdict |
|---|---|---|
| 1 | Données : saison complète par défaut, rien perdu | ✅ respecté, sous réserve de I2 et I3 |
| 2 | Justesse du moteur | ⚠️ partiel : dédup, ordre, borne, cache OK ; annulation et erreurs à corriger (I2, M1, M2) |
| 3 | Pacing sans effet sur les appels non background | ❌ non respecté en mode proxy (I1) ; mode clé directe ✅ |
| 4 | Front : états, survie à l'onglet, i18n, web | ✅ respecté, avec réserves (I4, M3, M7) |
| 5 | Tests | ⚠️ le moteur est bien couvert, le reste ne l'est pas (§ 5) |
| 6 | Tests lents | ✅ constat du Chief confirmé (§ 6) |

### 1. Données — respecté
- Profondeur : le défaut du scout reste « quick » = 100 (`riotLimits.ts` `QUICK_SCOUT_MATCH_COUNT`) et le choix « Complete » envoie -1 (`scopeToMatchCount`, `riotLimits.ts:65-67`) ; le moteur traite `count <= 0` comme « toute la saison » (`scoutEngine.ts:326`, `:360`). Même comportement qu'avant, la décision du 24/11 est tenue : aucune réduction de profondeur ni de parties.
- Comptage identique à l'ancien code : `PoolAccumulator.add` (`scoutEngine.ts:130-162`) reprend ligne à ligne le calcul de l'ancien `team:scout-member` (historique avant le filtre de rôle, `roleOnly`, clé `champion|rôle`, KDA). Mastery : mêmes 5 champs, `masteryPoints || null` à l'écriture (`team.ipc.ts` `finalizeMember`).
- `autoFillPool` n'est pas touché ; `team:scout-member` garde sa signature et passe par le moteur (`team.ipc.ts:894-899`). Les deux appelants (`ScoutingTab.tsx:675`, `useBackgroundJobsStore.ts:273/312`) ont un `try/catch`. Changement de comportement à connaître : sur limite Riot ou annulation, `scoutMember` **rejette** maintenant (avant : il écrivait un pool partiel sans bruit). C'est voulu par le contrat, mais le brief disait « inchangé » : à dire clairement au Chief.
- Les parties communes sont comptées pour chaque joueur concerné (`deliver`, `scoutEngine.ts:422-432`). Une partie 404 n'est plus redemandée 6 h : voir M5.

### 2. Justesse du moteur
- ✅ Déduplication : `planTeamMatches` (`:78-96`) dédoublonne dans une liste et entre membres ; `remaining = new Set(ids).size`. Testé.
- ✅ Ordre : tri décroissant sur le numéro de l'id (`matchIdRank`, `:69-72`), le cache local est lu d'abord (`:437-445`), puis les manquantes dans l'ordre (`runBounded` démarre dans l'ordre).
- ✅ Parallélisme borné : `runBounded` (10 en vol, `MATCH_FETCH_CONCURRENCY`), testé. Écriture des membres sérialisée (`writes`, `:391-407`).
- ✅ Pas de fuite d'écouteurs : `onScoutProgress` retourne le désabonnement (`preload/index.ts` `removeListener`) et le store l'appelle dans `finally` (`useBackgroundJobsStore.ts`, après `scoutTeam`). Le main n'émet pas vers une fenêtre détruite (`team.ipc.ts` `emit`).
- ⚠️ Annulation : rien ne démarre après `scoutCancel` **à partir de la phase 3** ; avant, voir M1 et M2.
- ⚠️ Reprise : correcte sur desktop (cache `MatchCache` lu d'abord). Sur web, il n'y a pas de cache local (I4).
- ❌ Erreurs : I2 (échecs transitoires), I3 (listes vides sur échec).

## Constats

### Bloquants
Aucun.

### Importants

**I1 — La pause du proxy retient aussi les appels non background (critère 3)**
`electron/main/riotClient.ts:301` (`await waitForProxyPause()`, sans condition de priorité ni de type) et `:325-337` (la pause est posée pour tout 429 `proxy-*`).
Scénario : un scout complet tourne. Au tout début, le client envoie jusqu'à 16 / min alors que le proxy ne laisse passer que 18 / 2 min au scout : premier 429 `proxy-user-share`, `Retry-After` de l'ordre de la minute. `proxyPausedUntil` est posé pour **tout le processus**. Si la partie du joueur se termine à ce moment, l'enrichissement post-game (priorité `gameEnd`), l'enregistrement, la micro-review ou l'écran ouvert (`interactive`) attendent la fin de la pause, alors que le proxy leur donne un budget séparé et plus large (`budget.ts` `userCapFor`, `capFor` : l'interactif garde sa réserve ; c'est exactement le défaut décrit à `budget.ts:28`). Le test `riotProxyPacing.test.ts:36` vérifie cette attente, mais seulement avec deux appels `background` ; aucun test n'a un appel non background.
Le mode clé directe n'est pas touché (`proxyPausedUntil` n'est posé qu'en mode proxy, la limiteuse `proxyBackgroundLimiter` n'est acquise qu'en proxy + background : ✅).
Correctif (Back-end) : garder deux échéances, `background` et `global`. Un 429 `proxy-user-share` ou `proxy-user-background` reçu par un appel background ne pause que le background ; `proxy-global`, `proxy-user` et tout 429 reçu par un appel interactif pausent tout le monde. `waitForProxyPause(priority)` lit la bonne échéance. Ajouter le test : un appel `gameEnd` part immédiatement pendant une pause background.

**I2 — Les échecs autres que 404 et limite sont comptés comme « partie manquante », le joueur est écrit et marqué terminé**
`scoutEngine.ts:458-462` (tout `catch` non limite → `deliver(id, null)`), `team.ipc.ts:105-118` (`fetchMatchShared` ne renvoie `null` que pour 404, relance le reste), `finalizeMember` (`team.ipc.ts`, écrit si `snap.failed > 0`, simple `console.warn`), `saveScoutCache`.
Scénarios : (a) session Ascend expirée : `RiotAuthError LOGIN_REQUIRED` sur chaque partie, 1 500 échecs instantanés, bannière « Scout terminé · 5 joueurs sur 5 · 0 partie analysée » ; (b) panne du proxy (502) en milieu de scout : la moitié des parties échoue, le pool partiel **écrase** `playRate` / `winRate` du pool complet de la veille (le contrat dit pourtant qu'un pool incomplet n'écrase pas l'ancien, mais seulement pour la limite et l'annulation). `stats.failed` n'est pas affiché à l'écran. Le comportement existait (échec silencieux) mais le nouvel écran affiche « terminé ».
Correctif (Back-end) : distinguer « Riot n'a pas la partie » (404, ok) d'un échec transitoire ; pour ce dernier, soit nouvelle tentative, soit `member-error FAILED` sans écriture dès que `failed` non-404 dépasse un seuil ; erreur d'authentification = arrêt de tout le scout (comme la limite). Le Front affiche `failed` dans « Terminé ».

**I3 — Une liste d'ids qui échoue devient « aucune partie »**
`electron/main/riotClient.ts:644-657` (`getSeasonMatchIds`, `.catch(() => [])` sur chaque file) et `web/src/riotWeb.ts:179-181`. Le moteur reçoit `[]` → `member-done` avec `upserted 0` (`scoutEngine.ts:374-380`), et le Front affiche « Aucune partie trouvée… Vérifiez le Riot ID et la région » (`scoutLive.ts` `scoutOutcome` = `noGames`, `ScoutProgressBanner.tsx`).
Scénarios : (a) limite Riot ou panne pendant la lecture de la liste : message faux et pas de bouton « Reprendre » ; (b) échec d'une seule file (flex) : `saveScoutCache` enregistre une liste sans flex avec `lastScoutedAt = maintenant`, le scout incrémental suivant ne redemande jamais les parties flex de l'intervalle, seul « Complete » les retrouve.
Une liste vide légitime n'est, elle, jamais mise en cache 6 h (le seul cache de 6 h est celui des parties 404) : ✅ sur ce point précis.
Correctif (Back-end) : laisser remonter l'erreur (au moins la limite) depuis `getSeasonMatchIds`, ou renvoyer un indicateur « liste incomplète » ; ne pas appeler `saveScoutCache` si une file a échoué.

**I4 — Web : aucun pacing, 3 essais, et « Reprendre » promet un cache qui n'existe pas**
`web/src/riotWeb.ts:32` (`MAX_RIOT_TRIES = 3`), `:34` (`MAX_WAIT_SEC = 30`), `:98-103` (un `Retry-After` > 30 s lève `RiotWebError rate-limited` tout de suite), `web/src/scoutingWeb.ts` (`loadCached: async () => new Map()`).
Scénario : un scout « Complete » sur la web app. Le proxy limite un joueur à 18 appels / 2 min en arrière-plan ; le premier 429 `proxy-user-share` arrive avec un `Retry-After` > 30 s, l'erreur est levée, tout le scout s'arrête (`rateLimited`). La bannière dit « les parties déjà lues sont gardées : relancer reprend où ça s'est arrêté » : faux sur web, sauf pour les parties déjà lues par quelqu'un d'autre (magasin R2), et chaque relance relit les 25 listes d'ids. Le gain « même moteur » est donc réel sur l'ordre, le partage et l'affichage progressif, pas sur la complétion d'un scout complet.
Correctif : Back-end — porter le pacing (limiteuse de 16 / min + 18 / 2 min, pause commune, plus d'essais pour les 429 de pacing) dans `riotWeb.ts` ; Front — texte web de la bannière sans promesse de reprise tant qu'il n'y a pas de cache.

**I5 — Tests manquants sur les points qui cassent (voir § 5)** : l'absence de test pour I1 et I2 explique que le lot soit passé vert.

### Mineurs

- **M1 — Annulation avant l'enregistrement du scout** : `team.ipc.ts` (`scoutMembersDesktop`) fait `await findMany` et `await getChampionIdToKey()` **avant** `activeScouts.set(scoutId, …)`. Un `scoutCancel` reçu dans cette fenêtre renvoie `found: false`, le scout continue, la bannière reste « Arrêt en cours » jusqu'à la fin. Aussi : deux scouts de même `scoutId` s'écrasent et le `finally` du premier supprime le drapeau du second. Enregistrer le drapeau en premier ; si `found: false`, le store garde le drapeau annulé et le transmet au démarrage.
- **M2 — L'annulation n'est pas vérifiée pendant la phase 1** (`scoutEngine.ts:345-371`) : compte Riot ID, maîtrise et listes d'ids (≈ 25 appels, plus d'une minute au rythme de 16 / min) ne s'interrompent pas. L'utilisateur voit « Arrêt en cours » pendant ce temps. Vérifier `deps.isCancelled()` entre les étapes et avant chaque page de liste.
- **M3 — « Reprendre »** : `lastScope` est un `useRef` du composant (`ScoutingTab.tsx:77`) : changer d'onglet puis revenir fait disparaître le bouton sur un scout interrompu qui, lui, survit dans le store. Et après l'échec d'**un seul** joueur (`runScoutOne`), « Reprendre » relance un scout d'**équipe** (`onResumeLive` = `runScoutAll`). Mettre le périmètre et les membres dans `scoutLive` (store).
- **M4 — Pacing** : `riotClient.ts:337` passe la limiteuse en 2 fenêtres pour toute la vie du processus (jamais revenue à 1 fenêtre) : tout travail background tombe à 9 / min même quand le proxy aura relevé la part ; le log `:344` affiche « try n/3 » alors que le plafond est 12 ; `proxyPausedUntil` n'a pas de plafond si `Retry-After` est énorme (borner à 120 s).
- **M5 — Cache des 404** (`team.ipc.ts:95-118`) : en mémoire, sans taille maximale, clé sur l'id seul. Une partie 404 juste après sa fin (délai de Riot) est ignorée 6 h. Risque faible (les ids viennent de Riot), à limiter aux parties anciennes.
- **M6 — Maîtrise en priorité `interactive` côté client** (`team.ipc.ts` `getMasteries`) : le proxy la classe `background` (`routing.ts:100`), donc ces 5 appels échappent à la limiteuse du client alors qu'ils comptent dans le budget du proxy. Écart de 5 appels, sans conséquence ; à connaître. Le web utilise `BACKGROUND` pour la maîtrise, désaccord avec le contrat.
- **M7 — Captures** (`docs/audits/scout-front-captures/`) : 12 captures, toutes en **français et thème sombre**. UX-4 demande FR et EN, thèmes clair et sombre. Pas de capture web (`web/`) du même composant. Les états chargement, partiel, annulation, limite Riot, erreur, aucune partie, terminé sont tous présents et lisibles (vu : `fr-3-partial`, `fr-7-ratelimit`). Jargon LoL laissé en anglais là où il apparaît (pool, tiers, « Scout » reste un terme d'usage) ; pas de clé manquante.
- **M8 — Divers** : l'auto-scout après import (`ScoutingTab.tsx:675`) reste un `scoutMember` séquentiel, sans partage des parties communes ni bannière ; le commentaire de `maxIds` (`scoutEngine.ts:259-260`, « Hard ceiling ») est faux : il ne sert qu'à décider « sans plafond » ; `team:scout-member` est un `handleInBackground` sans validation zod (`scoutId` seulement tronqué ; `scoutId` de 0 à 3 caractères accepté), BE-1 reste ❌ pour ce canal comme avant.

## 4. Front — contrôle des états
Chargement (`starting`), pools de maîtrise (`byMastery`), partiel avec barre et ETA (`estimateRemainingMs`, muet avant 10 s / 10 parties), terminé, annulé, limite Riot, erreur, aucune partie : tous présents dans `scoutLive.ts` (`scoutOutcome`) et `ScoutProgressBanner.tsx`. Le job vit dans le store (`runProgressive`), pas dans l'onglet : un changement d'onglet ne l'arrête pas (capture `fr-3b`/`fr-3c`) ; la pastille globale compte les parties (`BackgroundJobsIndicator.tsx`). Garde contre deux scouts simultanés : les boutons sont désactivés tant qu'un job existe, car `currentName` du job progressif est le libellé de l'équipe, donc non nul (`ScoutingTab.tsx:63-65, 566, 598`) : fonctionne, mais par couplage fragile. La web app utilise le même composant (`web/src/api.ts` expose `scoutTeam`, `scoutCancel`, `onScoutProgress`, donc `canScoutProgressively()` est vrai).

## 5. Tests — ce qui est couvert et ce qui manque
Couvert (`scoutEngine.test.ts`, 279 lignes ; `scoutLive.test.ts` ; `riotProxyPacing.test.ts`) : plan et dédoublonnage, `runBounded` (borne, ordre, arrêt), cumul par champion, pool de maîtrise, ordre « maîtrise avant parties », chunks puis `member-done`, partie 404 non bloquante, limite Riot, annulation, `count` par membre, échec de résolution d'un membre, comptage de requêtes pour 5 joueurs, réducteur du store, un cas de pacing.
Manque :
1. Appel `gameEnd` / `interactive` non retenu par une pause background, et mode direct inchangé (I1).
2. Échec non 404 et non limite : erreur d'authentification, 502, réseau, avec la règle d'écriture choisie (I2) ; `getSeasonMatchIds` quand une file échoue (I3).
3. `fetchMatchShared` : TTL de 6 h, partage de la partie en vol avec `getMatchesBulkCached`, 404 vs autre erreur.
4. IPC : `team:scout-team` / `team:scout-cancel` (validation zod, 20 membres, annulation avant enregistrement, fenêtre détruite), `team:scout-member` qui rejette sur limite.
5. Annulation pendant la phase 1 et reprise (deuxième `runScout` qui lit le cache et ne télécharge rien).
6. Web : `scoutTeamWeb` (404 par `status`, limite par `code`), `onScoutProgressWeb` (désabonnement).
7. Store : `runProgressive` (désabonnement en `finally`, annulation, `done` perdu, `failure`), bannière (états). La suite est en environnement `node` : un test du store est possible, le composant passe par le harnais.

## 6. Tests lents — constat du Chief confirmé
Mesuré sur la machine de l'audit (16 cœurs) :
- `npx vitest run` : **4 fichiers en échec** sur 208, exactement `coachingExperimentsIpc`, `microReviewIpc`, `postGameAutomation`, `teamLinkGroupIpc`, tous par `Error: Hook timed out in 10000ms` dans `await initDatabase()`. 2 285 tests passent, 74 sautés (ceux des 4 fichiers). Durée 22,9 s en horloge, 220 s cumulées.
- Les 4 fichiers lancés **ensemble** échouent encore (4 / 4) ; `teamLinkGroupIpc` **seul** passe en 4,5 s (≈ 3 s d'`initDatabase`).
- `npx vitest run --maxWorkers=4` : 1 échec sur 208. Le seuil dépend donc de la charge parallèle, pas du code.
Cause : 13 fichiers appellent `initDatabase()` (`electron/main/database.ts:218-248`) sur une base vide, ce qui rejoue 51 migrations instruction par instruction (`runMigrations`, `:192-198`, une écriture SQLite avec synchronisation disque par instruction) ; les fichiers tournent en parallèle sur tous les cœurs et se disputent le disque. Le crochet `beforeAll` a la limite par défaut de 10 s (`vitest.config.ts` n'a ni `hookTimeout` ni `testTimeout`). **Aucun rapport avec le lot** : les 4 fichiers ne testent pas le moteur de scout, et le Chief a reproduit les échecs sur `19512c0`.
Recommandation, à attribuer au **Back-end** (je n'y touche pas) :
1. Immédiat, une ligne : `test: { hookTimeout: 60_000 }` dans `vitest.config.ts` (global : 13 fichiers sont exposés, pas seulement ces 4 ; ils passeraient tous en < 15 s même chargés).
2. Durable : créer **une fois** la base migrée dans un `globalSetup` de vitest et la **copier** pour chaque fichier (`NEXUSMIND_DB_PATH` est déjà surchargeable, `database.ts:31-38`) ; ou pragma `journal_mode=MEMORY` / `synchronous=OFF` pendant les tests. Gain attendu : de 3 s à quelques dizaines de ms par fichier, et fin de la dépendance à la vitesse du disque (TE-8).
3. Ne pas limiter `maxWorkers` : cela ralentit toute la suite pour un seul poste de coût.

## Ce qui n'a pas pu être vérifié
- Aucun appel Riot réel et aucun scout complet de bout en bout (les mesures du contrat sont calculées, pas mesurées) ; le comportement réel du `Retry-After` du proxy en rafale (I1, I4) vient de la lecture du worker (`cloudflare/riot-proxy/src/budget.ts`, `handler.ts`), pas d'un essai.
- Pas de passage dans l'app Electron buildée ni dans le harnais en direct : seules les captures du Front ont été relues, pas rejouées.
- Le comportement de la web app contre le vrai proxy (I4) est déduit du code.
- Sécurité (nouveaux canaux IPC, port du pacing) : à revoir par CyberSecurity ; le worker n'est pas modifié, donc pas de revue de worker requise pour ce lot.


---

## Contre-vérification de la QA Gemini (27/11/2026)

Source : `docs/notes/antigravity/2026-11-27_qa-scout-progressif.md`. Chaque constat est relu dans le code à la date du jour (pas de lancement de l'app ni de proxy réel). Verdicts : **confirmé** / **faux** / **à nuancer**. « Rôle » = qui corrige.

**Bilan sur 18 constats : 16 confirmés (dont I1, I2, I4 avec une gravité à revoir à la baisse, I3-B et B3-B nuancés), 1 en partie déjà corrigé (M1), 1 non vérifié (M3), 0 faux.** Les trois bloquants tiennent. B1 et B2 ne touchent que le web, B3 touche aussi le desktop (c'est mon constat I1 ci-dessus, vu depuis la QA).

### Bloquants

| # | Verdict | Preuve | Rôle |
|---|---|---|---|
| B1 | **Confirmé** | `cloudflare/riot-proxy/src/handler.ts:57-62` : `CORS_HEADERS` sans `access-control-expose-headers`. `retry-after` et `x-rate-limit-type` ne sont pas des en-têtes CORS-safelisted : `riotWeb.ts:135` et `:138` lisent `null` dans un vrai navigateur. Conséquence : `ownShare` toujours faux (`:139`), fenêtre 2 min jamais activée (`:143`), 3 essais au lieu de 12 (`:147`), attente de 1 s. Le desktop n'est pas touché (fetch du process main, pas de CORS). Les tests Node ne voient rien (le mock ne filtre pas les en-têtes). | **Worker** (ajouter `'access-control-expose-headers': 'retry-after, x-rate-limit-type, x-nxm-cache'`, revue CyberSecurity, déploiement) ; **Front-End** : un test qui simule un `Response` sans ces en-têtes. |
| B2 | **Confirmé** | `ScoutProgressBanner.tsx:33-34` : `isWebApp()` = absence de `computeTeamSynergyStats`, or `web/src/api.ts:507` l'implémente. Sur la vraie web app `isWebApp()` vaut `false` : textes desktop (« parties en cache », « Reprendre ») et bouton « Se reconnecter » vers `/settings`. Le harnais masque le défaut (`.harness/scoutMock.ts:17` la met à `undefined` sous `?web=1`). | **Front-End** : marqueur réellement absent du web (`linkTeamToGroup`, déjà utilisé `ScoutingTab.tsx:122`, ou booléen dédié), puis aligner le mock. |
| B3 | **Confirmé** (scénario A et B) | A : `handler.ts:142-145` renvoie `proxy-global` pour `reason: 'window'` (le plafond de 70 % du background, `budget.ts:97`) comme pour `riot_backoff`. `riotClient.ts:370-372` (hors `ownShare`) pose `proxyPause.global`, et `waitForProxyPause` s'applique à toutes les priorités (`:339`) : un `gameEnd` ou un `interactive` attend jusqu'à 120 s alors que la réserve de 30 % est libre. Web : `riotWeb.ts:145` pose `blockedUntil`, lu par tous (`:79-80`). B : `riotWeb.ts:180` force `BACKGROUND` dans `regionResolver.detect`, donc un appel interactif dont le puuid n'a pas de région en cache (cache 10 min) attend le seau background. **Nuance** : B ne joue qu'à la première résolution d'un puuid. | **Worker** (type distinct, ex. `proxy-background-reserve`, `proxy-global` réservé à `riot_backoff`) + **Back-end** (`riotClient.ts` : un 429 reçu en background ne pose que `proxyPause.background`) + **Front-End** (`riotWeb.ts` : même règle, et ne pas forcer `BACKGROUND` en B). |

### Importants

| # | Verdict | Preuve | Rôle |
|---|---|---|---|
| I1 | **Confirmé**, gravité à nuancer | `scoutEngine.ts:420-421` : `limit = max(2, ceil(ids×0.02))`. Avec 1 ou 2 parties de saison toutes illisibles, `unreadable ≤ 2`, donc écriture d'un pool vide (et suppression des entrées avec `roleOnly`) puis `member-done`. Rare (joueur à 1-2 parties) mais c'est de la perte de données. Correctif : `unreadable > limit \|\| (ids.length > 0 && unreadable >= ids.length)`. | **Back-end** |
| I2 | **Confirmé**, gravité à nuancer | `team.ipc.ts:111` : la condition « réglé » se mesure sur `firstAt`, pas sur deux 404 espacés. 404 à t=0, scout à t=60 min : `60 ≥ 30` et `60 < 360`, donc `null` sans nouvelle demande pendant 6 h. Pas de `missingMatches.delete(id)` sur une lecture 200 (`:121`). Effet limité : la partie est comptée « absente » (`failed`), pas « illisible ». | **Back-end** (`checkedAt - firstAt >= MISSING_SETTLE_MS`, delete sur succès) |
| I3 | **Confirmé** (A et B), B à nuancer | A : `web/src/api.ts:552` attend `getRosterMember` avant `scoutTeamWeb` et donc avant `registerScout` (`scoutingWeb.ts:192`). Pas d'équivalent de `earlyCancels` (`team.ipc.ts:789`) : un « Annuler » pendant ce délai renvoie `found:false` et le scout part quand même. B : `api.ts:546-548` appelle encore `scoutMemberWeb` (`scoutingWeb.ts:39`), hors moteur, avec `getMatchesBulk` qui avale les erreurs non 429 (`riotWeb.ts:303`). **Nuance** : la bannière passe par `scoutTeam` (`useBackgroundJobsStore.ts:257, 305`), seul le bouton `ScoutingTab.tsx:673` utilise encore le chemin legacy. | **Front-End** (web : `earlyCancels` + `scoutMember` via `scoutTeamWeb`) |
| I4 | **Confirmé**, gravité à nuancer | `scoutEngine.ts:495-499` : une erreur transitoire pendant `stop()` est comptée `unreadable` puis `deliver(...,true)`. Si c'était la dernière partie (`remaining === 0`), `finish` écrit et émet `member-done` malgré l'annulation. **Nuance** : toutes les autres parties du joueur ont déjà été livrées, et `unreadable ≤ limit` reste respecté, donc le pool écrit est complet à la tolérance de 2 % près. Incohérence d'état plus que perte de données. Correctif : `if (stop()) return` avant le comptage. | **Back-end** |
| I5 | **Confirmé** (1, 2, 3) | 1 : `ScoutingTab.tsx:257` `failed.length === 0` se déclenche aussi quand `scoutTeam` rejette avant tout événement (membres restés `waiting`, `useBackgroundJobsStore.ts:174` ne les compte pas). 2 : `ScoutingTab.tsx:207-210` toast de succès sans condition d'échec, texte anglais en dur. 3 : `scoutLive.ts:193` `failure` testé avant `isSessionExpiredMessage`. | **Front-End** |
| I6 | **Confirmé** (1 partiel, 2, 3) | 1 : `ScopeDialog.tsx:112-127` promet un cache disque et dit que les requêtes « seront en attente derrière celle-ci », faux sur le web et contraire à la priorité interactive (le tri « Rapide en premier » n'est pas relu). 2 : `fr.json:2371` « Les parties déjà lues sont conservées », sans variante web. 3 : `BackgroundJobsIndicator` monté seulement dans `src/App.tsx:125`, absent de `web/src`. | **Front-End** (+ textes i18n) |
| I7 | **Confirmé** (1 à 4) | 1 : `riotWeb.ts:134` ne traite que 429, un 503 avec `Retry-After` (`handler.ts:151`) lève `Riot API error 503` (`:155`). 2 : un 429 `proxy-global` en background reste à 3 essais et 30 s (`:147`). 3 : `waitForCooldown` (`:78-86`) attend une seule fois, sans reboucler. 4 : `:232` privilégie `rate-limited` mais pas le 401. Le point 2 se règle en même temps que B3. | **Front-End** (`riotWeb.ts`, aligner sur `riotClient.ts`) |

### Mineurs

| # | Verdict | Preuve | Rôle |
|---|---|---|---|
| M1 | **Déjà corrigé** (accord) / **à nuancer** (reste) | `fr.json:2324` dit déjà « téléchargées ». `toLocaleString()` sans langue : confirmé (`ScoutProgressBanner.tsx:82, 85, 125`, `BackgroundJobsIndicator.tsx:77`), mais il suit la locale de l'OS, donc le défaut ne joue que si OS et langue de l'app diffèrent. Mélange tu/vous : non tranché (convention à confirmer). | **Front-End** |
| M2 | **Confirmé** | `scoutLive.ts:126-129` : `member-done` avec 0 partie garde le pool de maîtrise en `'final'`. | **Front-End** (réinitialiser le pool si `totalMatches === 0 && upserted === 0`) |
| M3 | **Non vérifié** | Plausible (`totalGames` / `totalProcessed` cumulent les membres déjà `done` en reprise), mais `createScoutLive` avec `previous` n'a pas été relu. | **Front-End** : à vérifier avant de corriger |
| M4 | **Confirmé** (1 et 2) | 1 : `scoutEngine.ts:373-375` émet `mastery` si `ms.length > 0` même quand `masteryPool(...)` est vide, sans test de `stop()`. 2 : `:507` force un `chunk` à 0 partie avant `member-error`, et le reducer (`scoutLive.ts:119`) remplace le pool de maîtrise par ce pool vide. | **Back-end** (moteur) ou **Front-End** (garde dans le reducer) |
| M5 | **Confirmé** en partie | Un 502 desktop (`riotClient.ts:397`) ne passe pas la regex `network` (`scoutLive.ts:220`, ni « 502 » ni « network » dans le texte) : tombe en `generic`. Idem le 502 web (`riotWeb.ts:154`). Les motifs `list` et `tooMany` web ne sont pas confrontés aux messages réels. | **Front-End** |
| M6 | **Confirmé** (pastille rognée) | `.harness/scoutshot.mjs:18, 36` : viewport 1000 de haut, découpe à 760, la pastille `fixed bottom-4` est donc coupée. Les défauts visuels des cartes (ponctuation, badges) ne sont pas vérifiés. | **Graphic** (captures) / **Front-End** |
| M7 | **Confirmé** | `team.ipc.ts:808` filtre sans dédupliquer, et `web/src/api.ts:552` aussi : un id en double donne deux membres identiques. Le plus simple : dédupliquer dans `runScout`. | **Back-end** |
| M8 | **Confirmé** | `ScoutingTab.tsx:209` chaîne anglaise en dur, `fr.json:2297` « ~60 dernières games » périmé. | **Front-End** |

### Ce qui reste hors de portée de cette contre-vérification

- Le comportement réel de B1 en navigateur (lu dans le code, pas rejoué contre le worker déployé).
- Les points purement visuels (M1 tutoiement, M6 ponctuation et badges), qui demandent les captures.
- M3 et les motifs `list` / `tooMany` de M5.

### Ordre de correction suggéré

1. **Worker** : B1 et le type de 429 de B3 (un seul déploiement, revue CyberSecurity).
2. **Back-end** : B3 côté `riotClient.ts`, puis I1, I4, I2, M4, M7 (moteur et ipc).
3. **Front-End** : B2, I3, I5, I6, I7, puis les mineurs.
