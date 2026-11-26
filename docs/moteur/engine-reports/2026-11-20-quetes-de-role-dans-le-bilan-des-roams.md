# Les quêtes de rôle dans le bilan des roams

> **Saison en cours seulement (règle du 20/11/2026)** : ce rapport ne contient que des valeurs 16.x. Les règles générales sans timer restent, les valeurs et timers 2025 sont retirés (voir [`2026-11-20-inventaire-regles-avant-2026.md`](2026-11-20-inventaire-regles-avant-2026.md)).

_20/11/2026, session Engine. Suite de [`2026-11-20-bilan-des-roams.md`](2026-11-20-bilan-des-roams.md).
Demande de l'utilisateur : compter les quêtes de rôle dans l'impact d'un roam, en mesurant la **différence entre le
joueur et son vis-à-vis direct**. Lecture seule du code. Les données ont été lues sur une **copie** de la base locale
(`MatchCache`, 431 parties classées 16.x avec timeline), sans rien modifier._

## 1. La connaissance

### 1.1 Les règles (wiki Role Quests, lu le 19/11/2026 ; notes `08-wiki-role-quests-death-timers.md`)

| Rôle | Points pour finir | Sources de points | Fin « au passif seul, en lane » | Récompense |
|---|---|---|---|---|
| Top | 1 200 | passif 7,5 pts / 5 s en lane (90 / min) ; sbire 2 (en lane) ; takedown 15 ; plaque 40 ; tour 50 ; monstre épique 30 | ~14:25 | Unleashed Teleport (recharge 390 s depuis 26.19), +600 XP, +11 % d'XP, +80 XP par takedown, niveau max 20 |
| Mid | 1 350 | passif ; sbire 2 ; takedown 25 ; plaque 40 ; tour 50 ; épique 30 ; part des dégâts aux champions | ~16:05 | +8 % AD et AP (26.11), bottes tier 3 gratuites |
| ADC | 1 350 | passif ; sbire 3 ; takedown 15 ; plaque 40 ; tour 50 ; épique 30 | ~16:05 | +300 g, +2 g par sbire, +40 g par takedown, emplacement de bottes |
| Support | 800 | or gagné par l'objet de support (charges Shared Riches) | — | amélioration gratuite de l'objet de support + un objet gratuit ; pink à 40 g, rangée dans l'emplacement de quête |

**Règles communes (V26.09) :**
- hors de la lane, les points de quête sont réduits de −75 %, et cette pénalité diminue jusqu'à 0 % au fil de la quête ;
- un recall coupe le passif pendant 12 s ;
- **2 minutes en lane donnent 1 minute de roam sans pénalité**.

**Taxe du support hors bot :** −33 % d'or et d'XP sur les sbires jusqu'au niveau 5 depuis V26.16 (−25 % jusqu'au
niveau 3 de V26.01 à 26.15).

**Saisons et patchs :**
- **16.1-16.8** : quêtes, mais ni budget de roam ni pénalité de −75 % documentés. Il faut relire l'historique du wiki
  avant d'écrire le modèle de ces patchs.
- **16.9 et après** : règles ci-dessus.

### 1.2 Ce que nos données montrent (vérifié aujourd'hui sur le cache)

- **Pas d'événement de quête dans la timeline.** En revanche, chaque laner porte un **objet de quête** qu'un
  `ITEM_DESTROYED` retire **à la fin de la quête** :

| Rôle | Objet (id) | Joueurs concernés | Fin de quête : p10 / médiane / p90 |
|---|---|---|---|
| Top | 1200 ou 1222 (deux variantes) | 835 sur 862 tops | 11:20 / 12:25 / 14:16 (1200) ; 11:27 / 12:32 / 13:41 (1222) |
| Mid | 1201 | 835 sur 862 | 11:02 / 12:31 / 14:27 |
| ADC | 1202 | 834 sur 862 | 11:26 / 12:40 / 14:07 |
| Support | 1203 | — (plusieurs événements par joueur, à trier) | médiane 12:32 |

- Les fins réelles tombent **vers 12:30**, soit 2 à 3,5 minutes plus tôt que « le passif seul » du wiki : les CS, les
  takedowns et les plaques accélèrent la quête. Le modèle de points du § 2 doit retrouver ces heures.
- Match-V5 donne aussi `roleBoundItem` (la récompense gardée : 1220/1221 top, bottes 3006, 3158… pour l'ADC, 2055 pink
  et 1208 pour le support). Pour le support, il y a les défis `challenges.completeSupportQuestInTime` (0/1) et
  `fasterSupportQuestCompletion`.
- **À confirmer avant l'implémentation** : le sens exact de chaque id (Data Dragon `item.json` du patch), et pourquoi
  1207 (ADC) et 1208 (support) sont détruits plus tard, peut-être une deuxième étape.
- Au passage, `CHAMPION_KILL` contient bien **`bounty`** et **`shutdownBounty`**. L'or réel d'un kill est donc
  disponible pour le bilan des roams, et l'estimation `bountyGold` n'est plus nécessaire.

## 2. Le calcul

### 2.1 Progression de quête estimée, minute par minute

Nouvelle fonction pure `questProgress(match, timeline, pid)` dans un nouveau fichier
`src/lib/microReview/roleQuest.ts`. Elle rejoue les règles du § 1.1 sur la timeline :

| Source de points | Comment on la lit |
|---|---|
| Passif en lane | temps en lane avec les positions interpolées (`posAt` toutes les 5 s, règle `laneOf` de la lane du rôle), moins 12 s par recall (achat vivant) |
| Sbires | hausse de `minionsKilled` entre deux relevés, comptée pour les minutes passées en lane |
| Takedowns, plaques, tours, épiques | `CHAMPION_KILL` (tueur ou assistant), `TURRET_PLATE_DESTROYED`, `BUILDING_KILL`, `ELITE_MONSTER_KILL` (présent ou assistant) |
| Pénalité hors lane (16.9+) | −75 % sur les points gagnés hors lane quand le budget de roam est vide, la pénalité baissant avec la progression (la forme exacte de cette baisse est **à relire** sur le wiki) |
| Budget de roam (16.9+) | +1 min de budget pour 2 min passées en lane ; le temps hors lane le consomme |
| Support | or gagné par l'objet de support : non séparé chez Riot. Approximation : hausse de `totalGold` du support moins l'or des kills et des assists, comparée au support adverse |

**Ancrage sur la vraie fin.** Quand l'objet de quête est détruit (§ 1.2), la progression vaut 100 % à cet instant. On
remet la courbe estimée à l'échelle pour qu'elle passe par ce point. L'écart réel entre le joueur et son vis-à-vis est
donc **mesuré**. Seul le partage de cet écart entre les moments de la partie est **estimé**.

### 2.2 Le terme quête dans le bilan d'un roam

Comme le reste du bilan, on mesure de la minute `a` (avant le départ) à la minute `b` (au moins 60 s après le retour) :

```
retardQuête(roam) = [points(vis-à-vis) − points(joueur)] en b  −  même écart en a
                  → converti en secondes : ÷ 90 points / min (rythme du passif)
```

- **Top, mid, ADC** : le joueur contre son vis-à-vis direct.
- **Support** : le support contre le support adverse. C'est le support qui paie sa propre quête quand il part ; le
  coût pour l'ADC est déjà compté dans le rapport précédent.
- **Suite adverse** : on prolonge la mesure jusqu'à `b + 3 min`, comme le reste du bilan, puis jusqu'à la fin des deux
  quêtes. Si le vis-à-vis finit sa quête avant le joueur alors qu'il était derrière avant le roam, le roam a **inversé**
  l'ordre des quêtes, et la carte le dit.

### 2.3 Combien vaut une avance de quête (pour le verdict)

Le bilan additionne tout sur l'échelle de `winProbability.ts`. Il faut donc un poids `β_quête` (en z par seconde
d'avance), **mesuré sur le cache** :

- régression logistique de la victoire sur l'écart de fin de quête avec le vis-à-vis (en secondes), par rôle,
  **avec l'écart de gold et d'XP à la fin de la quête comme covariables**. Une partie de la récompense est déjà dans le
  gold et l'XP (ADC +300 g, top +600 XP) : sans ces covariables, on la compterait deux fois ;
- `β_quête` mesure donc ce que le gold ne voit pas : Unleashed TP, +11 % d'XP, +8 % AD/AP, emplacement de bottes,
  objet de support gratuit, et l'avance dans le temps ;
- si `β_quête` n'est pas significatif pour un rôle (intervalle qui contient 0), le terme vaut 0 pour ce rôle. On
  **n'invente pas** de valeur.

Le bilan devient alors :

```
net = Δz(gains) − Δz(coût) − Δz(suite adverse) − β_quête × retardQuête
```

Un roam **pendant le budget gratuit** (16.9+) ne coûte presque pas de quête : seul le passif manqué compte. Le texte le
dira (« roam dans ton budget de quête »).

### 2.4 Exemple (partie 16.20, mid)

À 7:40, le mid part bot pour 70 s alors que son budget de roam n'est que de 40 s. De 7:00 à 10:00 : −9 CS, aucune plaque.
- **Quête** : −18 points de sbires, −105 points de passif, pénalité de −75 % sur l'assist au-delà du budget (25 → 6
  points). Le mid adverse prend 2 plaques (+80). L'écart de quête passe de +20 à −180 points : environ 2:15 de retard
  gagné pendant le roam.
- **Fins réelles** : 12:58 pour le mid adverse, 14:10 pour le joueur.

La carte ajoutera : « Quête : ton vis-à-vis l'a finie 1:12 avant toi ; le roam t'a coûté environ 2 minutes de quête ».

## 3. Ce que le moteur en fera dans l'app

| Écran | Changement |
|---|---|
| **Carte de micro-review d'un roam** | une ligne de plus : « Quête : −2:15 sur ton vis-à-vis pendant le roam (fin : 14:10 contre 12:58) ». Si le roam est resté dans le budget : « roam dans ton budget de quête ». Si le roam a inversé l'ordre des quêtes, cette raison peut faire passer un roam neutre en perdant. |
| **Verdict** | le terme `β_quête × retardQuête` entre dans le bilan net (§ 2.3), une fois calibré |
| **Codex** | la fiche mid (`codex_mid_roam_budget_next_wave_numbers`) parle déjà du budget de quête ; la fiche support (`codex_support_roam_free_windows_level5`) de la taxe. Rien à ajouter, sauf une phrase sur le budget de quête dans la future fiche « roam de l'ADC en lane » |
| **Review** | une ligne « Quête de rôle : finie à 14:10, vis-à-vis à 12:58 (−1:12) », utile même sans roam |
| **Assistant / Mon plan** | indicateur par partie `questGapSec` (fin de quête contre le vis-à-vis). Règle possible : « quête finie après ton vis-à-vis dans 4 des 5 dernières parties », mais seulement si la régression du § 2.3 montre un effet sur la victoire |

## 4. Mise en œuvre

**Back-end :**
1. `roleQuest.ts` : `questCompletion` (lecture des `ITEM_DESTROYED` des objets de quête, une table d'ids par patch),
   `questProgress` et `questGap` ;
2. `patchOf()` dans `gameClock.ts` (déjà prévu dans le rapport précédent) ;
3. branchement du terme quête dans `roamLedger` ;
4. lecture de `bounty` / `shutdownBounty` au lieu de `bountyGold` pour les kills du bilan ;
5. calibrage de `β_quête` par rôle (script en lecture seule sur le cache, résultat figé dans `DETECTOR_SPEC.roam.questWeight`
   avec la date et l'échantillon) ;
6. `features.ts` : `questGapSec` ;
7. `ANALYSIS_VERSION` monte une seule fois avec le bilan des roams.

**Front-end :** les textes de la ligne « Quête » (fr + en) sur la carte et dans la review.

**Tests :**
- fin de quête lue sur l'objet détruit (top 1200 et 1222, mid, ADC, support) ;
- partie sans objet de quête → terme 0 ;
- roam dans le budget contre roam au-delà du budget (16.9+) ;
- partie 16.5, avec les règles d'avant 26.09 ;
- la courbe estimée repasse par la fin réelle ;
- ordre des quêtes inversé par le roam ;
- `β_quête` nul → aucun effet sur le verdict.

**Validation du modèle :** sur le cache, l'heure de fin estimée sans ancrage doit tomber à moins d'environ 45 s de la
fin réelle pour la plupart des joueurs. Sinon, le partage de l'écart entre les moments n'est pas fiable, et la carte ne
montre que l'écart **réel** de fin de quête, sans « coût du roam en quête ».

**Effort :** Back-end +1,5 jour sur l'estimation précédente (lecture des fins 0,25 j, modèle de points 0,75 j,
calibrage 0,5 j) ; Front-end +0,25 jour.

## 5. Risques

- **Ids d'objets propres à chaque patch** : une table d'ids par palier de patch, et un test qui échoue si une partie 16.x
  du cache n'a aucun objet de quête reconnu pour un laner.
- **Pénalité hors lane et budget** : les règles exactes (comment la pénalité baisse, comptage du budget) viennent d'une
  seule source, le wiki. Le modèle de points est approximatif. C'est l'ancrage sur la vraie fin qui le rend utilisable.
- **Support** : sa quête dépend de l'or de l'objet de support, que Riot ne sépare pas. Son retard de quête est
  l'estimation la plus fragile, et il ne pèsera dans le verdict que si la calibration le justifie.
- **Double compte** : une partie de la récompense est déjà dans le gold et l'XP. On l'évite avec les covariables du
  § 2.3 et en ne comptant le terme quête que pour ce que le gold ne mesure pas.
- **Lien de cause** : finir sa quête plus tôt va avec une bonne lane. La régression ne donne qu'une corrélation. Le
  texte reste factuel (« ton vis-à-vis l'a finie 1:12 avant toi »), sans dire « tu as perdu à cause de la quête ».
