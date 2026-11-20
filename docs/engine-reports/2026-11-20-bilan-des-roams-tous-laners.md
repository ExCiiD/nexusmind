# Bilan des roams pour tous les laners (top, mid, ADC, support)

> **Saison en cours seulement (règle du 20/11/2026)** : ce rapport ne contient que des valeurs 16.x. Les règles générales sans timer restent, les valeurs et timers 2025 sont retirés (voir [`2026-11-20-inventaire-regles-avant-2026.md`](2026-11-20-inventaire-regles-avant-2026.md)).

> **Complété** par [`2026-11-20-quetes-de-role-dans-le-bilan-des-roams.md`](2026-11-20-quetes-de-role-dans-le-bilan-des-roams.md)
> (écart de quête de rôle avec le vis-à-vis dans le bilan ; l'or réel des kills, `bounty` / `shutdownBounty`, est
> présent dans les timelines en cache).

_20/11/2026, session Engine. Suite de [`2026-11-20-bilan-des-roams-mid.md`](2026-11-20-bilan-des-roams-mid.md), qui
décrit le calcul de base (repérage du roam, coût, gain, suite adverse, verdict). Demande de l'utilisateur : appliquer ce
calcul à tous les laners. Pour le support, il faut compter ce que l'ADC a perdu pendant l'absence (farm, PV et mana,
gold et XP contre l'ADC adverse) et vérifier que le roam est parti sur un bon timer : wave crash, après un recall, après
1 ou 2 kills sur la botlane adverse. Lecture seule du code : rien n'est implémenté._

## 1. La connaissance et ses sources

| Fait | 16.x (2026) | Source |
|---|---|---|
| Valeur d'une wave | ≈ 102 g (152 g avec le canon) ; une wave ratée ≈ 1/3 de niveau en solo lane | notes de recherche `02-top-mid` G6, [S7] [S12] |
| XP en bot | duo : chacun prend 65 % de l'XP d'un sbire ; un ADC **seul** prend toute l'XP | wiki Experience, notes 26.1 |
| Budget de roam (quête) | **depuis 26.09** : 2 min en lane donnent 1 min de roam sans pénalité, sinon −75 % des points de quête hors lane ; un recall coupe les points 12 s. Avant 26.09 (16.1-16.8) : pas de budget | wiki Role Quests (V26.09) |
| Taxe du support hors bot | **16.16 et après** : −33 % d'or et d'XP sur les sbires hors bot lane jusqu'au **niveau 5** ; **16.1-16.15** : −25 % jusqu'au niveau 3 | wiki Role Quests (V26.01, V26.16) |
| TP du top | TP d'invocateur ; TP de quête (Unleashed) vers ~14:25, recharge 390 s depuis 26.19 | wiki Role Quests, Teleport |
| Fenêtres gratuites du support | ADC en recall ou mort ; duo ennemi en recall ou disparu ; sortie de base après un recall ; après le niveau 5 (16.16+) | fiche `codex_support_roam_free_windows_level5`, guides support saison 16 ([V10] Skill Capped 24/04/2026, [V09]) |
| Plaques | 120 g, permanentes | notes 26.1 |

**Nouveau pour le moteur : trois paliers à l'intérieur de 16.x** (16.1-16.8, 16.9-16.15, 16.16+), pour la quête et la
taxe du support. `gameClockOf` ne lit que la saison. Il faut une petite fonction `patchOf(match)` (majeur.mineur lus dans
`info.gameVersion`) dans `gameClock.ts`, qui ne sert qu'à ces deux règles.

## 2. Un seul calcul, réglé par rôle

Le bilan du rapport mid (`roamLedger`) reste le même : **repérer le roam → coût → gain → suite adverse → verdict sur
l'échelle de `winProbability`**. Ce qui change selon le rôle, c'est **qui paie** l'absence et **quelle lane** est laissée.

| Rôle | Roam repéré quand… | Qui paie (le coût) | Fenêtre |
|---|---|---|---|
| **Top** | sorti de la top lane (règle `laneOf`), vivant, au moins 20 s ; ou kill / assist positionné loin de la top lane | lui-même contre le top adverse : CS, XP (le top est XP-dépendant), plaques et T1 top | jusqu'à la chute d'une T1 top ou 20:00 |
| **Mid** | comme dans le rapport mid | lui-même contre le mid adverse | T1 mid ou 20:00 |
| **ADC** | sorti de la bot lane sans son support | **le duo** contre le duo adverse : CS et gold de l'ADC, XP des deux, PV du support resté seul, mort du support | T1 bot ou 20:00 |
| **Support** | sorti de la bot lane sans son ADC, au moins 20 s | **l'ADC** contre l'ADC adverse (détail § 3) + l'XP du support contre le support adverse + la taxe de 16.16+ | T1 bot ou 20:00 |

Les **gains** sont comptés de la même façon pour tous : seulement les événements où le roamer est impliqué (kill ou
assist, objectif avec lui à moins de 2 800, fight à au moins 3 kills, avantage de la lane visitée s'il y a eu un kill ou
un assist du roamer). Même chose pour la **suite adverse** : 3 minutes après le retour, ce que le ou les vis-à-vis
convertissent (plaques, tour, counter-roam, objectif avec eux présents, écart qui continue de se creuser).

**TP du top.** Riot ne journalise pas les sorts. Match-V5 ne donne que le nombre total de casts
(`summoner1Casts`/`summoner2Casts`). Un roam du top se lit par la position. Un **TP probable** se lit par un déplacement
impossible à pied : une distance entre deux positions prouvées (relevé, kill, mort) supérieure à ce qu'il peut marcher
dans le temps écoulé, avec Teleport dans les sorts. Le TP probable sert seulement au texte (« TP bot ») et compte pour
« sans retour à pied ». Le coût en CS se mesure de la même façon.

## 3. Le support : ce que son ADC a payé

Fenêtre de coût : comme pour les autres rôles, du relevé juste avant le départ (minute `a`) au premier relevé au moins
60 s après le retour (minute `b`).

### 3.1 Ce qu'a perdu l'ADC face à l'ADC adverse

| Mesure | Calcul | Remarque |
|---|---|---|
| **Gold** | `goldGap(ADC, ADC adverse)` de `a` à `b` | gold des relevés (`totalGold`) ; les kills sont séparés dans les gains et la suite |
| **CS** | `csGap` de `a` à `b` | — |
| **XP** | `xpGap` de `a` à `b`, **affiché** comme demandé, **mais** le coût du verdict utilise l'XP **du duo** contre le duo adverse | un ADC seul prend toute l'XP de la wave : son XP **monte** quand le support part. Cet effet est réel, mais compter seulement l'ADC ferait passer chaque roam pour un gain d'XP |
| **A-t-il pu farm normalement ?** | rythme de CS de l'ADC pendant l'absence, comparé à son propre rythme des 3 minutes d'avant et à l'ADC adverse sur la même fenêtre | « normal » : au moins 80 % de son rythme et pas plus de 3 CS sous l'ADC adverse (seuils à calibrer) |
| **PV et mana** | PV % et mana % de l'ADC aux relevés de l'absence (`championStats.health/healthMax`, `power/powerMax`), comparés au relevé d'avant et à l'ADC adverse | la mana n'est lue que pour une vraie réserve, comme `resetTrap.manaPoolMin` (pas d'énergie ni de rage) |
| **Back forcé** | l'ADC fait un achat vivant (preuve d'un passage en base) pendant l'absence, alors qu'il était sous 35 % PV au relevé d'avant | même lecture que `back-timer-missed` (V5) |
| **Mort de l'ADC** | l'ADC meurt pendant l'absence, contre au moins 2 ennemis (2v1 ou gank) | or donné + CS et XP manqués pendant le respawn (`deathTimerSec`) |
| **Lane** | plaques bot perdues, T1 bot | événements |

Ces mesures s'ajoutent au coût du support lui-même :
- son XP contre le support adverse ;
- en **16.16 et après**, s'il part **avant le niveau 5**, la taxe (−33 % d'or et d'XP sur les sbires pris hors bot).
  Elle ne se mesure pas directement : on la signale en texte.
- en **16.1-16.15**, même signalement avant le niveau 3 (taxe de −25 %).

### 3.2 Le timer de départ

Le timer ne change pas le chiffre du bilan. Il **explique** le verdict et sert aux statistiques (« roams sur un bon
timer »). On le lit au moment du départ (`tOut`, de −15 s à +5 s).

| Timer | Comment le moteur le voit | Fiabilité |
|---|---|---|
| **Après 1 ou 2 kills sur la botlane adverse** | l'ADC ou le support adverse est mort en bot dans les 30 s avant le départ et encore en respawn (`deathTimerSec`) | **sûre** (événements + formule du respawn) |
| **Après un recall** | achat vivant du support, puis premier trajet hors de la base vers mid, la rivière ou la jungle, sans repasser par la bot lane | **sûre** |
| **ADC en recall ou mort** | ADC dans sa base (`inBaseBox`) ou mort à `tOut` | **sûre** au relevé, interpolée entre deux relevés |
| **Duo adverse en recall** | ADC et support adverses dans leur base au relevé, ou achats des deux dans la même fenêtre | **sûre** au relevé |
| **Après un crash de wave** | Riot ne donne pas les waves. Indice : ADC et support dans la moitié adverse de la bot lane, à moins de 1 500 de la T1 adverse, dans les 15 s avant le départ, ou une plaque bot prise par l'équipe juste avant | **probable** seulement : texte au conditionnel |
| **Mauvais timer** | aucun des timers ci-dessus, et au moins une de ces conditions : ADC sous 50 % PV au départ ; duo adverse vivant en lane avec au moins autant de niveaux ; jungler adverse vu côté bot dans la minute d'avant | **sûre** pour les PV et les niveaux, approximative pour le jungler (relevés) |
| **Fenêtre payante (16.16+)** | avant le niveau 5 et hors fenêtre gratuite | **sûre** (niveau lu sur les `LEVEL_UP`) |

### 3.3 Exemple (partie 16.20)

À 4:10, le support part mid au niveau 4, ADC à 60 % PV, duo adverse vivant. Il revient à 5:20, sans kill. De 4:00 à
6:00, l'ADC prend 11 CS contre 19 pour l'ADC adverse et perd 280 g sur lui. Il passe de 60 % à 25 % PV, puis fait un
back forcé à 5:05. Côté XP, l'ADC affiche +90 XP sur l'ADC adverse (il était seul), mais le duo perd 340 XP sur le duo
adverse. Ensuite, le duo adverse prend 2 plaques.

→ **Roam perdant**, timer « fenêtre payante avant le niveau 5 ». La carte dit : « Ton ADC pendant ton absence : −8 CS,
−280 g face à l'ADC adverse, back forcé à 25 % PV ».

Même roam lancé à 3:45, juste après un kill sur l'ADC adverse (encore 12 s de respawn), avec un assist au mid : timer
« après un kill sur la botlane adverse », coût presque nul pour l'ADC → **rentable**.

## 4. Ce que le moteur en fera dans l'app

| Écran | Ce que le joueur voit |
|---|---|
| **Micro-review** | Un roam perdant devient un moment `early-deficit`, avec un schéma par rôle : `mid-roam-unpaid`, `top-roam-unpaid`, `adc-roam-unpaid`, `support-roam-unpaid`. Ils remplacent `mid-roam-plates` et `bad-rotation`, qui couvrent aujourd'hui les laners sans juger le gain. Résumé support : « 4:10 · Roam mid — ton ADC : −8 CS, −280 g face à l'ADC adverse, back forcé à 25 % PV ; gagné : rien ; ensuite : 2 plaques bot perdues ». |
| **Options du QCM, top / mid / ADC** | « Wave pas poussée avant de partir » (`bad-wave-sync`) ; « Roam sans cible claire » (`cs-deficit`) ; sortie justifiée « Le roam valait le coup » |
| **Options du QCM, support** | « Parti hors fenêtre gratuite » (`overstay`, fiche roam du support) ; « ADC laissé seul, wave sous leur tour » (`bad-wave-sync`) ; sortie justifiée « Fenêtre gratuite, ADC en sécurité » |
| **Retard à 10:00** | un retard qui s'explique surtout par un roam **rentable** ne produit plus de carte, ou propose d'abord la sortie justifiée |
| **Codex** | Mid : `codex_mid_roam_budget_next_wave_numbers`. Support : `codex_support_roam_free_windows_level5`, qui décrit déjà les fenêtres gratuites et payantes. Pour ces deux fiches, il faut ajouter `bad-wave-sync` aux `mistakeSlugs`. Top : `codex_top_teleport_2026_summoner_vs_quest` pour un TP, sinon `cs-top-early`. **Il manque une fiche** « roam de l'ADC en lane » (laisser son support seul) : à écrire, rôle BOTTOM, phase début. |
| **Review** | Notes pré-remplies, une par roam : « 4:10 Roam mid du support : perdant (ADC −8 CS, back forcé) ». Ensuite, un encart « Bilan des roams » avec une ligne par roam : timer, coût, gain, suite, et pour le support, la ligne de l'ADC. Il faut une maquette Penpot d'abord. |
| **Coaching (staff)** | Plus tard : le même bilan vu des deux côtés du duo bot (le support qui part, l'ADC qui paie), utile en review d'équipe. |
| **Assistant / Mon plan** | Indicateurs par partie : `roams`, `roamsPaid`, `roamCostCs`, `roamsGoodTimer`. Règles : `roam_unpaid_pattern` (tous rôles : au moins 1 roam perdant dans 3 des 5 dernières parties) et `support_roam_bad_timer` (support : moins de la moitié de ses roams sur un bon timer, sur 5 parties). Critères d'expérience : « au moins 60 % de roams rentables ou neutres » et, pour le support, « au moins 70 % de roams sur un bon timer ». Le cas inverse, le support qui ne quitte jamais son ADC, est déjà couvert par `support-botlane-leech`. |

## 5. Mise en œuvre

**Back-end :**

1. `roamLedger.ts` avec un réglage par rôle (`ROAM_ROLE_SPEC` : qui paie, lane laissée, fenêtre) ;
2. `patchOf()` dans `gameClock.ts` (paliers 16.9 et 16.16) ;
3. lecture des PV et de la mana aux relevés (le code le fait déjà : `hpPct`, `resetTrap`) ;
4. timers du support (§ 3.2) ;
5. TP probable du top ;
6. 4 schémas dans `MOMENT_PATTERNS` et leur place dans l'ordre (avant `bad-rotation`, qu'ils remplacent pour un roam
   repéré) ;
7. contextes et options dans `smartQcm.ts` ;
8. `codex.json` : `mistakeSlugs` des deux fiches, plus la nouvelle fiche ADC (texte fr + en, relu par le Front-end) ;
9. `ANALYSIS_VERSION` 10 → 11 ;
10. ensuite, l'assistant (`features.ts`, `rules.ts`, `problems.ts`, critères dans `experiments.ts`).

**Front-end :**
- textes `microReview.*` des 4 rôles et des timers ;
- notes de review ;
- plus tard l'encart « Bilan des roams », après une maquette Graphic Design ;
- la vue staff, plus tard encore.

**Tests** (`tests/unit/microReviewRoam.test.ts`) : les cas du rapport mid, plus :

- support parti avant le niveau 5, en 16.20 puis en 16.10 (taxe différente) ;
- support parti après un kill sur l'ADC adverse (rentable) ;
- support parti après un recall ;
- ADC qui farm normalement pendant l'absence (coût faible, pas de reproche) ;
- ADC en back forcé ;
- ADC tué en 2v1 ;
- XP de l'ADC en hausse mais XP du duo en baisse (le verdict suit le duo) ;
- TP probable du top ;
- roam de l'ADC qui laisse son support mourir ;
- un roam ne produit jamais aussi `bad-rotation` ni la carte de 10:00.

**Calibrage** (cache en lecture seule, par rôle, 16.x, avec les trois paliers de 16.x pour le support) :

- roams pour 100 parties ;
- répartition du bilan ;
- winrate selon le verdict et selon le timer ;
- 20 roams « perdants » relus à la main par rôle.

**Effort.** Back-end ≈ 3,5 jours au total (calcul commun 1,5 j, réglages par rôle et support 1 j, tests 0,5 j,
calibrage 0,5 j), puis l'assistant ≈ 0,5 à 1 j. Front-end ≈ 1 jour de textes (4 rôles), plus l'encart s'il est validé.
Cela remplace l'estimation du rapport mid seul.

## 6. Risques et limites

- **XP de l'ADC seul** : elle monte quand le support part. Le verdict compte l'XP du duo, sinon chaque roam du support
  aurait l'air de rapporter de l'XP à l'ADC. L'XP de l'ADC seul est montrée parce qu'elle est demandée, avec cette
  explication.
- **PV et mana aux relevés seulement** : un trade perdu puis un retour en PV entre deux minutes ne se voit pas. Le back
  forcé est la preuve la plus solide.
- **Vision du support** : une ward n'a pas de position chez Riot. Un roam du support pour warder la rivière ou le mid
  ne compte donc aucun gain. Règle de prudence : un roam du support sans kill, avec des wards posées pendant le roam et
  un coût faible pour l'ADC, est **neutre**, jamais perdant.
- **Gank du jungler adverse sur l'ADC seul** : il aurait pu arriver même avec le support. On ne le compte dans le coût
  que si l'ADC meurt à au moins 2 contre 1 pendant l'absence, et le texte dit « pendant ton absence », pas « à cause de
  toi ».
- **Crash de wave** : invisible, seulement un indice de position. Le texte reste au conditionnel.
- **TP du top** : déduit de la vitesse de déplacement, donc incertain. Il ne sert qu'au texte, pas au chiffre.
- **Lane swap et rôles mal déclarés** (`teamPosition`) : le calcul s'appuie sur le vis-à-vis direct déjà utilisé par le
  détecteur. Sans vis-à-vis fiable, il ne s'exécute pas.
- **Paliers de patch** : la taxe et le budget de quête viennent du wiki (V26.01, V26.09, V26.16). Il faut les relire
  avant l'implémentation, au cas où un patch les aurait changés depuis.
