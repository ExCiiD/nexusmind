# Revue QA croisée indépendante — Lot « scout progressif » (27/11/2026)

- **Sujet** : Revue QA croisée indépendante du lot « scout d'équipe progressif » (desktop + web + interface + tests + captures visuelles), sans lecture de `docs/audits/AUDIT_SCOUT_PROGRESSIF_2026-11-27.md`.
- **Auteur** : AG-QA (Gemini Pro, tier B).
- **Verdict global** : **Ne pas livrer en l'état** — 3 constats **bloquants** (pacing web bloqué par CORS du proxy, `isWebApp()` toujours `false` sur la vraie web app, pause `proxy-global` d'un scout qui gèle les appels `gameEnd` / `interactive`), 7 constats **importants**, 8 constats **mineurs**.
- **Tests unitaires exécutés** : `npx vitest run tests/unit/scoutEngine.test.ts tests/unit/riotProxyPacing.test.ts tests/unit/riotWebPacing.test.ts tests/unit/scoutLive.test.ts tests/unit/scoutResumeStore.test.ts tests/unit/scoutLimits.test.ts tests/unit/riotRetry.test.ts` → **7 fichiers, 53 tests passés**.

## Fichiers lus

- Règles & contrat : `docs/notes/antigravity/README.md`, `docs/DECISIONS.md`, `docs/notes/antigravity/2026-11-27_brief-qa-scout-progressif.md`, `docs/contracts/scouting-progressive.md`.
- Moteur & limites partagés : `src/lib/scoutEngine.ts`, `src/lib/riotLimits.ts`, `src/lib/scoutingCore.ts`, `src/lib/riotRegionCore.ts`, `src/lib/riotErrors.ts`, `src/lib/theme.ts`.
- Desktop : `electron/main/ipc/team.ipc.ts` (+ `git diff` complet), `electron/main/riotClient.ts` (+ `git diff`), `electron/main/riotPriority.ts`, `electron/main/riotTransport.ts`, `electron/preload/index.ts` (`git diff`), `src/lib/ipc.ts` (`git diff`).
- Proxy Cloudflare (vérification des en-têtes réels) : `cloudflare/riot-proxy/src/handler.ts`, `cloudflare/riot-proxy/src/budget.ts`, `cloudflare/riot-proxy/src/routing.ts`.
- Web : `web/src/riotWeb.ts`, `web/src/scoutingWeb.ts`, `web/src/api.ts` (+ `git diff`), `web/src/main.tsx`, `web/src/WebLayout.tsx`.
- Interface, stores & i18n : `src/pages/Team/ScoutingTab.tsx`, `src/components/team/ScoutProgressBanner.tsx`, `src/components/team/ScopeDialog.tsx`, `src/components/BackgroundJobsIndicator.tsx`, `src/store/scoutLive.ts`, `src/store/useBackgroundJobsStore.ts`, `src/App.tsx`, `src/i18n/locales/fr.json` et `en.json` (`git diff` + sections `team.scouting` / `jobs`).
- Tests & harnais : `tests/unit/scoutEngine.test.ts`, `tests/unit/riotProxyPacing.test.ts`, `tests/unit/riotWebPacing.test.ts`, `tests/unit/scoutLive.test.ts`, `tests/unit/scoutResumeStore.test.ts`, `tests/unit/scoutLimits.test.ts`, `.harness/scoutMock.ts`, `.harness/scoutshot.mjs`.
- Captures inspectées dans `docs/audits/scout-front-captures/` : 27 captures couvrant l'ensemble des 15 états sur `fr-dark`, `fr-alt` (Piltover), `en-dark`, `en-alt`, `web-fr` et `web-en`.

---

## Constats

### Bloquants

#### B1 — Web app : CORS du proxy masque `Retry-After` et `X-Rate-Limit-Type` (pacing web inopérant en navigateur réel)
- **Critères** : #3 (priorité), #5 (web survit aux limites du proxy)
- **Fichiers** : `cloudflare/riot-proxy/src/handler.ts:57-62`, `web/src/riotWeb.ts:135-148`
- **Scénario** : `CORS_HEADERS` dans le worker Cloudflare ne contient pas `access-control-expose-headers`. Or `retry-after` et `x-rate-limit-type` ne sont pas des en-têtes CORS-safelisted. Dans un vrai navigateur (`https://app.asc3nd.app` → origine du proxy), `res.headers.get('retry-after')` et `res.headers.get('x-rate-limit-type')` renvoient **toujours `null`** :
  1. `ownShare` (`type === 'proxy-user-share' || type === 'proxy-user-background'`) est toujours `false` ;
  2. la fenêtre `18 / 2 min` (`shareSeenAt`) n'est jamais activée ;
  3. tout 429 `proxy-user-share` / `proxy-user-background` tombe dans la branche globale (`blockedUntil`, qui bloque aussi les appels interactifs), ne fait que `MAX_RIOT_TRIES = 3` essais au lieu de 12, attend `1 s` (`retryAfterSeconds(null)`) au lieu du vrai `Retry-After`, et interrompt le scout en ~2 s avec `RIOT_RATE_LIMITED`.
  - Le défaut passe inaperçu dans `tests/unit/riotWebPacing.test.ts` car le mock `fetch` en Node ne filtre pas les en-têtes CORS.
- **Proposition** : Ajouter `'access-control-expose-headers': 'retry-after, x-rate-limit-type'` à `CORS_HEADERS` dans `cloudflare/riot-proxy/src/handler.ts` (revue CyberSecurity + déploiement worker).

#### B2 — Web app : `isWebApp()` renvoie toujours `false` sur la vraie web app (promesses de cache local + mauvais bouton « Se reconnecter »)
- **Critères** : #4 (session expirée), #5 (aucun texte web ne promet une reprise avec cache)
- **Fichiers** : `src/components/team/ScoutProgressBanner.tsx:33-35, 94, 98, 138, 141`, `web/src/api.ts:507-508`, `.harness/scoutMock.ts:17`
- **Scénario** : `isWebApp()` détecte le web par `typeof window.api.computeTeamSynergyStats !== 'function'`. Or `web/src/api.ts:507` implémente `computeTeamSynergyStats` (ajouté en `#41b`). Sur la vraie web app, `isWebApp()` vaut donc **`false`** en permanence :
  1. sur annulation et limite Riot, la bannière affiche les libellés desktop (`cancelledDetail`, `resumeHint`, bouton « Reprendre ») qui promettent que *« Les parties déjà lues restent en cache »* ;
  2. sur session expirée (`ScoutProgressBanner.tsx:138`), le bouton « Se reconnecter » fait `navigate('/settings')` (route desktop absente de `web/src/main.tsx`, donc redirigée vers `/`) au lieu de `navigate('/account')`.
  - Le défaut a été masqué dans les captures `web-*` parce que `.harness/scoutMock.ts:17` force artificiellement `computeTeamSynergyStats` à `undefined` sous `?web=1` (ce qui explique aussi l'encart « LA SYNERGIE ADVERSE EST SUR L'APP DESKTOP » sur `web-fr-5-cancelled.png`).
- **Proposition** : Utiliser un marqueur réellement absent du web (ex. `typeof window.api.linkTeamToGroup !== 'function'`, déjà utilisé dans `ScoutingTab.tsx:122` et `CoachingPage.tsx:37`, ou un booléen dédié sur `window.api`), et aligner `.harness/scoutMock.ts` dessus.

#### B3 — Appels urgents (`gameEnd`, `interactive`) retenus par une pause d'un scout (Desktop + Web)
- **Critère** : #3 (appels urgents jamais retenus par une pause du scout)
- **Fichiers** : `electron/main/riotClient.ts:339, 368-375`, `web/src/riotWeb.ts:138-148, 180`, `cloudflare/riot-proxy/src/budget.ts:95-110`, `cloudflare/riot-proxy/src/handler.ts:142-145`
- **Scénario A (Desktop + Web — `proxy-global` reçu en `background`)** : Dans le proxy (`budget.ts:97`), les appels `background` sont plafonnés à `70 %` du budget (`DEFAULT_RESERVE = 0.3`) précisément pour laisser 30 % libres aux appels `gameEnd` et `interactive`. Quand un scout `background` atteint ces 70 %, le proxy répond 429 avec `x-rate-limit-type: proxy-global` (`handler.ts:144` utilise `proxy-global` autant pour `reason: 'window'` que pour `riot_backoff`). Or `riotClient.ts:370-372` (et `riotWeb.ts:139-145`) classe `proxy-global` hors `ownShare` et pose **`proxyPause.global`** (desktop) / **`blockedUntil`** (web) jusqu'à 120 s. Dès lors, un appel `gameEnd` (enrichissement post-partie, enregistrement, micro-review) ou `interactive` (écran ouvert) est gelé jusqu'à 120 s sur desktop (ou échoue immédiatement sur web si `Retry-After > 30 s`) alors que la réserve de 30 % du proxy est disponible.
- **Scénario B (Web — `regionResolver.detect` forcé en `BACKGROUND`)** : Dans `web/src/riotWeb.ts:180`, la détection de région active passe systématiquement `BACKGROUND`. Tout appel interactif (`getLeagueEntriesByPuuid`, `getChampionMasteries`, `getRankedSoloMatchIds`, etc., sans `BACKGROUND`) pour un `puuid` dont la région n'est pas en cache appelle `platformFor` → `regionResolver.detect` → `proxyFetch(..., BACKGROUND)`, qui attend `backgroundBlockedUntil` (jusqu'à 120 s) et le seau `16 / min` du scout en cours.
- **Proposition** :
  1. Sur un 429 `proxy-global` reçu par un appel `priority === 'background'`, ne pauser que `proxyPause.background` / `backgroundBlockedUntil` (ou faire renvoyer par le worker `proxy-background-reserve` distinct de `proxy-riot-backoff`), afin que `gameEnd` / `interactive` puissent toujours consommer leur réserve de 30 %.
  2. Dans `web/src/riotWeb.ts`, propager `opts` (ou ne pas forcer `BACKGROUND`) dans `regionResolver.detect` lorsque la résolution est déclenchée par un appel interactif.

---

### Importants

#### I1 — Un joueur avec 1 ou 2 parties toutes illisibles peut écraser son pool existant et apparaître « terminé »
- **Critères** : #1 (aucune donnée perdue), #4 (un pool partiel n'écrase jamais un pool complet)
- **Fichier** : `src/lib/scoutEngine.ts:420-424`
- **Scénario** : `const limit = Math.max(2, Math.ceil(st.ids.length * 0.02))` puis `if (st.unreadable > limit) fail(...)`. Si un joueur n'a que `1` ou `2` parties de saison (`st.ids.length <= 2`) et que 100 % échouent (erreur réseau / proxy 502), `st.unreadable <= 2` passe sous le seuil : `finalizeMember` est exécuté avec `entries = []` (avec `roleOnly: true` les entrées existantes sont supprimées, et `saveScoutCache` est écrit) puis `member-done` (`upserted: 0`) est émis.
- **Proposition** : Bloquer l'écriture si `st.unreadable > limit || (st.ids.length > 0 && st.unreadable >= st.ids.length)`.

#### I2 — Desktop : le cache des 404 (`missingMatches`) saute la re-vérification après 30 min au lieu de l'imposer
- **Critère** : #1 (aucune donnée perdue)
- **Fichier** : `electron/main/ipc/team.ipc.ts:110-111, 123-128`
- **Scénario** : Une partie juste terminée renvoie un 404 transitoire à `t = 0` (`firstAt = 0, checkedAt = 0`). Si un nouveau scout a lieu à `t = 60 min` (alors que Riot a fini de publier la partie), `Date.now() - missed.firstAt >= 30min` (`60 >= 30`) ET `Date.now() - missed.checkedAt < 6h` (`60 < 360`) sont toutes deux **vraies** : `fetchMatchShared` retourne `null` pendant 6 h sans jamais avoir re-testé la partie après la fenêtre de 30 min. De plus, si une partie en attente réussit avant 30 min, `missingMatches.delete(id)` n'est jamais appelé.
- **Proposition** : Tester `missed.checkedAt - missed.firstAt >= MISSING_SETTLE_MS` (404 confirmé deux fois à ≥ 30 min d'écart) et faire `missingMatches.delete(id)` sur une lecture 200.

#### I3 — Web : course à l'annulation en phase 1 (`earlyCancels` absent) + `scoutMember` web hors moteur
- **Critères** : #2 (annulation même pendant la première phase), #5 (parité web)
- **Fichiers** : `web/src/api.ts:546-555`, `web/src/scoutingWeb.ts:171-193`
- **Scénario A** : `web/src/api.ts:552` attend `Promise.all(memberIds.map((id) => team.getRosterMember(sb, id)))` (appels réseau Supabase) **avant** d'appeler `scoutTeamWeb` et donc avant `registerScout(activeScouts, scoutId)`. Contrairement au desktop (`team.ipc.ts:789, 803, 914`), `scoutingWeb.ts` n'a pas de `earlyCancels`. Cliquer sur « Annuler » pendant ces requêtes initiales renvoie `{ ok: true, found: false }` et est ignoré : le scout démarre et continue en fond sans pouvoir s'arrêter.
- **Scénario B** : `web/src/api.ts:546` appelle encore l'ancien `scoutMemberWeb` (`scoutingWeb.ts:39-93`) qui n'utilise pas `scoutEngine`, ignore `scoutId` et passe par `getMatchesBulk` (erreurs non-429 avalées sans seuil d'illisibles).
- **Proposition** : Ajouter `earlyCancels` dans `web/src/scoutingWeb.ts` (enregistrer avant `getRosterMember` ou consommer `earlyCancels` dans `registerScout`), et faire passer `scoutMember` web par `scoutTeamWeb` (comme le desktop).

#### I4 — Engine : une erreur transitoire pendant un arrêt (`stop()`) est comptée `unreadable` et peut finaliser un membre
- **Critères** : #2 (annulation), #4 (erreurs)
- **Fichier** : `src/lib/scoutEngine.ts:491-499`
- **Scénario** : Si un worker `fetchMatch` reçoit une erreur transitoire (réseau / 502) au moment où `stop()` est déjà passé à `true` (annulation, `rateLimited` ou `fatal` sur un autre worker), `if (attempt < retries && !stop())` est faux : le code incrémente `stats.failed` / `stats.unreadable` et appelle `deliver(id, null, true)`. Si c'était la dernière partie du joueur (`remaining === 1`), cela appelle `finish(st)`, écrit en base et émet `member-done` malgré l'annulation ou la session expirée.
- **Proposition** : Ajouter `if (stop()) return` juste après les gardes `isRateLimit(err)` et `isFatal(err)`.

#### I5 — Toasts de succès « Scout terminé » affichés à tort sur échec global (`TOO_MANY_SCOUTS`, validation) ou échec `runScoutOne` ; `live.failure` 401 mal classé
- **Critère** : #4 (l'écran ne doit jamais dire « terminé » à tort)
- **Fichiers** : `src/pages/Team/ScoutingTab.tsx:200-212, 257-265`, `src/store/useBackgroundJobsStore.ts:173-182`, `src/store/scoutLive.ts:191-198`
- **Scénarios** :
  1. `runScoutAll` : si `scoutTeam` rejette immédiatement (ex. `TOO_MANY_SCOUTS`, > 20 membres, erreur IPC), aucun événement `member-error` n'a été émis → tous les membres restent à `status: 'waiting'` → `failedMembers` est vide (`[]`). `ScoutingTab.tsx:257` entre dans `if (failed.length === 0)` et affiche le toast de succès *« 0 membre(s) scouté(s) · 0 entrées »* en parallèle de la bannière d'erreur rouge.
  2. `runScoutOne` (`ScoutingTab.tsx:200-212`) : si le scout échoue sans être `cancelled` ni `rateLimited` (session expirée, liste en échec, trop d'illisibles, `TOO_MANY_SCOUTS`), il affiche le toast de succès *« Scouting terminé — `0 champion entries.` »* (texte anglais en dur en plus).
  3. `scoutOutcome` (`scoutLive.ts:193`) : `if (live.failure) return 'error'` précède le test `isSessionExpiredMessage` : si `scoutTeam` échoue en 401 avant `runScout` (ex. `getRosterMember` sur le web), la bannière affiche « Le scout a échoué » avec un bouton « Reprendre » au lieu de « Session expirée » + « Se reconnecter ».
- **Proposition** : Propager `failed` / `failure` dans le retour de `runProgressive` (en considérant `live.failure` ou les membres non-`done` comme en échec), ne jamais afficher le toast de succès sur erreur dans `runScoutOne` et `runScoutAll`, et tester `isSessionExpiredMessage(live.failure)` avant `return 'error'` dans `scoutOutcome`.

#### I6 — Web app : promesses de cache local restantes dans `ScopeDialog` et `err.rateLimited`, et absence de `BackgroundJobsIndicator` sur le web
- **Critères** : #5 (aucun texte web ne promet un cache local), #6 (visuel / textes)
- **Fichiers** : `src/components/team/ScopeDialog.tsx:112-127`, `src/i18n/locales/fr.json:2387` (`team.scouting.live.err.rateLimited`), `src/i18n/locales/en.json:2387`, `web/src/main.tsx`, `web/src/WebLayout.tsx`
- **Scénario** :
  1. Confirmé sur `web-fr-scope.png` et `web-en-scope.png` : `ScopeDialog` affiche sur le web *« Les matchs déjà analysés sont en cache local — toute récupération suivante est quasi-instantanée. »* (`Previously-scanned matches are cached on disk`). De plus, la modale met toujours **« Rapide (recommandé) »** en premier et l'avertissement de « Saison complète » dit encore que *« les nouvelles requêtes Riot (autres scouts, refresh dashboard) seront en attente derrière celle-ci »*, ce qui contredit la priorité interactive du lot.
  2. `team.scouting.live.err.rateLimited` promet *« Les parties déjà lues sont conservées »* sans variante web.
  3. `BackgroundJobsIndicator` est monté dans `src/App.tsx:125` (desktop) mais **absent** de `web/src/main.tsx` et `web/src/WebLayout.tsx` : sur le web, changer d'onglet pendant un scout fait disparaître tout indicateur et tout accès au bouton Annuler, alors que la bannière annonce *« Vous pouvez changer d'onglet : le scout continue »*.
- **Proposition** : Adapter `ScopeDialog` (note de cache desktop vs web, avertissement priorité, mise en avant de la profondeur selon la décision du 24/11), ajouter une variante web pour `err.rateLimited`, et monter `BackgroundJobsIndicator` dans `WebLayout.tsx` (ou `web/src/main.tsx`).

#### I7 — Web app : écarts de résilience dans `riotWeb.ts` (503 avec `Retry-After`, `proxy-global`, `waitForCooldown`, priorité 401 sur `getSeasonMatchIds`)
- **Critères** : #4 (erreurs), #5 (survie du scout complet web aux limites du proxy)
- **Fichier** : `web/src/riotWeb.ts:78-86, 134-149, 232`
- **Scénarios** :
  1. Contrairement au desktop (`riotClient.ts:362`), un `503` avec `Retry-After` (budget proxy indisponible, `handler.ts:151`) n'est pas traité dans la boucle backoff (`riotWeb.ts:134`) : il lève `Riot API error 503` et fait compter les parties en `unreadable` après 2 retries de 1,5–3 s.
  2. Un 429 `proxy-global` en `background` sur le web n'a droit qu'à `MAX_RIOT_TRIES = 3` et `MAX_WAIT_SEC = 30 s` (vs 12 essais et 120 s sur desktop) : dès que plusieurs utilisateurs partagent la clé, un `Retry-After: 35` tue le scout web.
  3. `waitForCooldown` (`riotWeb.ts:78-86`) attend une seule fois au lieu de boucler comme `waitForProxyPause` sur desktop : si un autre worker étend `backgroundBlockedUntil` pendant l'attente, ce worker repart avant la fin de la pause.
  4. `getSeasonMatchIds` (`riotWeb.ts:232`) privilégie `rate-limited` dans `failures` mais pas `status === 401` (contrairement au desktop `riotClient.ts:701`).
- **Proposition** : Aligner `riotWeb.ts` sur `riotClient.ts` (gérer 503 + `Retry-After`, autoriser le pacing jusqu'à 120 s / 12 essais en `background` pour les 429 `proxy-*`, boucler dans `waitForCooldown`, prioriser `status === 401` dans `getSeasonMatchIds`).

---

### Mineurs

#### M1 — Faute d'accord FR dans la bannière, formatage de nombres anglais en FR, et mélange vouvoiement/tutoiement (vu dans les captures)
- **Critère** : #6 (textes FR)
- **Fichiers** : `src/i18n/locales/fr.json` (`team.scouting.live.shared_other`), `src/components/team/ScoutProgressBanner.tsx:82, 85, 125`, `src/components/BackgroundJobsIndicator.tsx:77`
- **Constat visuel** (`fr-dark-3-partial.png`, `fr-dark-5-cancelled.png`, `fr-alt-3-partial.png`, `web-fr-5-cancelled.png`, `fr-dark-7-ratelimit.png`) :
  - `240 parties communes aux joueurs, téléchargée une seule fois` → faute d'accord : **téléchargées**.
  - `480 / 1,500 parties` et `1,260 parties distinctes` : `toLocaleString()` sans `i18n.language` utilise la virgule anglaise en FR quand l'environnement est en anglais.
  - `fr-dark-7-ratelimit.png` mélange « Réessaie dans environ 30 secondes » (`riotErrors.rateLimited`, tutoiement) et « Votre session… Reconnectez-vous… Vous pouvez… » (`team.scouting.live.*`, vouvoiement).

#### M2 — Joueur avec maîtrise mais 0 partie cette saison : pool maîtrise affiché comme définitif au-dessus de « Aucune partie »
- **Critères** : #4, #6
- **Fichiers** : `src/store/scoutLive.ts:126-129`, `src/pages/Team/ScoutingTab.tsx:703`
- **Scénario** : Si un joueur reçoit `mastery` (`poolSource: 'mastery'`) puis `member-done` avec `totalMatches: 0, upserted: 0` (aucune partie cette saison), `reduceScoutEvent` passe `poolSource` à `'final'` en gardant le `pool` de maîtrise. La carte affiche donc les champions de maîtrise sans mention « d'après la maîtrise » au-dessus de « Aucune partie », alors que rien n'a été enregistré en base.
- **Proposition** : Si `ev.totalMatches === 0 && ev.upserted === 0`, remettre `pool: [], poolSource: 'none'`.

#### M3 — Reprise (`resumeScout`) : affichage 100 % pendant la lecture des listes + total « parties analysées » partiel dans « Terminé »
- **Critère** : #6
- **Fichier** : `src/components/team/ScoutProgressBanner.tsx:78, 85`
- **Scénario** : Lors d'une reprise de 1 joueur sur 5 (4 déjà `done` avec 300 parties chacun), `total = 1200` et `processed = 1200` tant que le 5e n'a pas encore son `ids` : `starting` (`total === 0 && !known`) vaut `false`, la bannière affiche `1 200 / 1 200 (100 %)` avant de redescendre à `80 %`. Une fois terminé, `stats.fromCache + stats.downloaded` ne reflète que la reprise (1 joueur) à côté de « 5 joueurs sur 5 scoutés ».

#### M4 — `scoutEngine.ts` : événement `mastery` vide ou post-annulation, et `chunk` vide avant `member-error`
- **Critère** : #2
- **Fichier** : `src/lib/scoutEngine.ts:371-376, 507`
- **Scénario** :
  1. Si `ms.length > 0` mais aucun champion ne joue le rôle du joueur, `masteryPool(ms, member.role)` renvoie `[]` mais l'événement `mastery` est tout de même émis (contrairement au contrat : « Absent si la maîtrise est vide ») ; `stop()` n'est pas vérifié avant cet `emit`.
  2. En ligne 507, `emitChunk(st, true)` émet un `chunk` avec `processed: 0, pool: []` juste avant `member-error` pour un joueur qui n'avait encore aucune partie traitée (efface son pool maîtrise en live).

#### M5 — `scoutErrorKind` : motifs regex décalés des messages réels du backend
- **Critères** : #4, #6
- **Fichiers** : `src/store/scoutLive.ts:217-220`, `src/lib/scoutEngine.ts:547`, `electron/main/riotClient.ts:397`, `web/src/riotWeb.ts:154`
- **Scénario** : Aucun texte brut ne fuit à l'écran (bien), mais :
  - `err.list` (`/match list|season list|list could not/i`) ne correspond à aucun message réel de `getSeasonMatchIds` (code mort hors tests/mocks) ;
  - sur le web, `assertScoutMemberCount` lève `A scout takes 1 to 20 members (got 21).`, qui ne matche pas `tooMany` (`/too many members|too[_ ]big|at most 20|max(imum)? 20/i`) ;
  - un 502 desktop (`Ascend Riot service is temporarily unavailable. Please try again later.`) ne matche pas `network` et tombe en `generic`.

#### M6 — Captures `3b-elsewhere-pill.png` rognées avant la pastille + petits défauts visuels dans les captures
- **Critère** : #6
- **Fichiers** : `.harness/scoutshot.mjs:18, 36`, `src/pages/Team/ScoutingTab.tsx:752, 766, 1025`, `src/components/team/ScoutProgressBanner.tsx:140`
- **Constats** :
  - Dans `.harness/scoutshot.mjs`, le viewport fait `1500×1000` mais `shot` rogne à `height: 760` : la pastille `BackgroundJobsIndicator` (`fixed bottom-4 right-4`) est **coupée** et n'apparaît dans aucune des 6 captures `*-3b-elsewhere-pill.png`.
  - `ScoutingTab.tsx:766` : double ponctuation `TOP 3 : · partiel` / `TOP 2 : · d'après la maîtrise`.
  - `ScoutingTab.tsx:1025` (`fr-dark-2-mastery.png`) : les badges de points de maîtrise (`624k`, `233k`) dépassent légèrement à gauche sur les icônes 28×28 voisines.
  - `ScoutingTab.tsx:752` (`fr-dark-12-resume-one.png`) : un joueur avec un ancien pool en attente de reprise (`status === 'waiting'`) n'affiche aucun indicateur sur sa carte.
  - `ScoutProgressBanner.tsx:140` (`fr-dark-8-error.png`) : le bouton « Reprendre » s'affiche même sur une erreur de validation permanente (`tooMany`, > 20 joueurs).

#### M7 — `memberIds` en doublon non dédupliqués
- **Critère** : #1
- **Fichiers** : `electron/main/ipc/team.ipc.ts:808`, `web/src/api.ts:552`, `web/src/scoutingWeb.ts:233`
- **Scénario** : Si `memberIds` contient deux fois le même identifiant, `runScout` lance deux résolutions/états concurrents sur la même clé `states.get(id)`. Un `Array.from(new Set(memberIds))` en entrée l'évite.

#### M8 — Chaîne anglaise en dur dans `runScoutOne` + infobulle `scoutAllHint` obsolète
- **Critère** : #6
- **Fichiers** : `src/pages/Team/ScoutingTab.tsx:209`, `src/i18n/locales/fr.json:2297`, `src/i18n/locales/en.json:2297`
- **Constat** : `ScoutingTab.tsx:209` affiche `${upserted} champion entries.` en anglais en dur. `scoutAllHint` indique encore « ~60 dernières games » alors que `ScopeDialog` propose 100 ou saison complète.

---

## Points vérifiés conformes

- **Aucune donnée perdue entre ancien et nouveau chemin `team.ipc.ts`** (hors I1 et I2) : même normalisation de rôle, même `roleOnly` par défaut à `false`, même calcul `history` (avant filtre de rôle), même attachement de la maîtrise (`MAX_MASTERY_COUNT`), même nettoyage des rôles bruts (`MIDDLE`/`BOTTOM`/`UTILITY`) et des entrées `roleOnly` obsolètes, même `writeTieredPool` et `saveScoutCache`, même déduplication inter-joueurs des parties communes.
- **Fuites d'écouteurs** : `onScoutProgress` dans `electron/preload/index.ts:555-559` et `web/src/scoutingWeb.ts:173-176` retourne bien une fonction de désabonnement exacte, appelée dans le bloc `finally` de `useBackgroundJobsStore.ts:167-169`.
- **Aucune fuite de texte brut d'erreur** dans `ScoutProgressBanner` ni dans les cartes membres (vérifié dans le code et dans toutes les captures FR/EN).
- **Contraste et lisibilité** : bons sur les deux thèmes capturés (`hextech` sombre et `piltover` sombre — Ascend ne propose pas de thème clair, voir `src/lib/theme.ts:14, 48`). Jargon LoL en anglais respecté en FR (« Scout », « Pool », « tiers », « games flex », « Riot ID »).
- **Direct key (dev) + priorité `MultiWindowLimiter`** : `appLimiter` et `methodLimiter` servent bien `gameEnd` puis `interactive` avant `background`, et `proxyBackgroundLimiter` / `proxyPause` ne s'activent pas en mode `direct`.

---

## Ce qui n'a pas pu être vérifié

1. **Appels Riot réels / proxy Cloudflare déployé / SQLite Electron en conditions réelles** : aucun scout réseau réel ni build Electron n'a été lancé dans cette revue.
2. **Rendu visuel effectif de la pastille flottante `BackgroundJobsIndicator`** : le harnais `ui-harness` n'a pas été démarré en direct et les captures existantes `*-3b-elsewhere-pill.png` rognent les 240 px du bas où se trouve la pastille (cf. M6).
3. **Thème clair** : le brief mentionne « clair / sombre », mais l'application n'a que des thèmes sombres (`hextech` et `piltover` = `alt`, cf. `src/lib/theme.ts`).
4. **Concurrence multi-onglets / multi-fenêtres réels** avec `MAX_ACTIVE_SCOUTS = 3` en IPC réel (vérifié par lecture de code et `scoutLimits.test.ts` uniquement).
