# Cartes de micro-review : lieux en mots, extraits vidéo autour de l'objectif

_20/11/2026, session Engine. Deux décisions de l'utilisateur, à la suite du rapport
[`2026-11-20-hesitation-lecture-erronee.md`](2026-11-20-hesitation-lecture-erronee.md). Elles **remplacent** son
correctif G (distances en secondes de marche) : aucune distance n'est plus affichée. `docs/DECISIONS.md` relu. Lecture
seule du code._

## 1. Les décisions

1. **Aucune unité de distance dans les cartes.** « Aucun user ne pourra se situer avec ça. Dis juste top, river top,
   fosse, mid, river bot, bot, et si c'est dans la jungle, dis "près du / des [red, blue, gromp, loups, wraiths, krugs]
   blue / red side". »
2. **Extraits vidéo autour de l'objectif** : « prends entre 45 s et 1 min avant et/ou après l'objectif, pour que le user
   puisse bien voir le process (erreur > conséquence > conclusion) ».

## 2. Les lieux, en mots

### 2.1 Le vocabulaire affiché (textes fr et en identiques, jargon LoL)

| Lieu | Texte de la carte |
|---|---|
| Lane top, mid, bot | **top**, **mid**, **bot** |
| Rivière haute ou basse | **river top**, **river bot** |
| Fosse | **fosse du Dragon**, **fosse des Larves**, **fosse du Héraut** ou **fosse du Baron**, selon l'objectif du moment (jamais « la fosse » seule) |
| Jungle | **près du blue / red / gromp**, **près des loups / wraiths / krugs**, suivi de **blue side** ou **red side** : le côté de la carte, et non « ta jungle » |
| Base | **base blue side** / **base red side** (non cité par l'utilisateur, proposé pour couvrir les morts en base) |

Exemple de la carte du 16:00 réécrite : « Tu as pris la T1 top à 15:14 (avant l'apparition du Dragon à 15:35), puis tu
étais **mid** ; l'ennemi prend le Dragon à 16:25 dans la **fosse du Dragon**. » Aucun chiffre de distance.

### 2.2 Ce qu'il faut ajouter au moteur

- **Les camps de jungle** ne sont pas dans `geometry.ts` aujourd'hui (seulement les fosses, les tours, les lanes et les
  zones). Il faut une table de 12 camps : blue, gromp, loups, wraiths, red, krugs, pour chaque côté.
  - Les coordonnées viennent de la carte officielle (wiki, « World Atlas » ou données de carte).
  - Elles sont **vérifiées sur nos parties** : les positions des junglers aux relevés de 1:00 et 2:00 se regroupent sur
    leurs premiers camps.
  - Le côté rouge est le miroir du côté bleu.
- **`placeOf(point, time)`** remplace l'usage de `zoneOf` dans les textes. Dans l'ordre :
  1. **dans une fosse** (rayon `PIT_INSIDE_RADIUS`, élargi à l'entrée de fosse), nommée par l'objectif vivant à cette
     heure ;
  2. **lane** : top, mid ou bot ;
  3. **rivière** : river top ou river bot ;
  4. **jungle** : le camp le plus proche, avec son côté de carte ;
  5. **base**.
- **Les seuils des règles ne changent pas.** Le moteur calcule toujours en unités de jeu (2 800, 900…) pour décider. On
  ne retire que l'**affichage** des distances.
- **Position estimée** (correctif I du rapport précédent, gardé) : en mots aussi. « vers le mid (position estimée entre
  16:00 et 17:00) » ou rien. Le moteur ne fonde plus de reproche seulement sur une position estimée.

**Textes à changer** (`microReview.*` dans `fr.json` et `en.json`) :
- `lateMove` (« {{distance}} unités parcourues vers la fosse ») ;
- `chokePoint`, `outsmited` (« la fosse » sans nom) ;
- **toute clé qui affiche `{{distance}}`** ou un nombre d'unités : à recenser avec un test qui échoue si une clé
  `microReview.*` contient « unités » ou `{{distance}}`.

## 3. Les extraits vidéo autour de l'objectif

**Aujourd'hui** (`src/lib/microReview/vodTiming.ts`) : la vidéo démarre **12 s** avant le moment et l'extrait dure **15 s**.
Le moment d'un objectif est calé 20 à 25 s avant sa chute. Le joueur voit donc à peine l'objectif tomber, et rien de la
suite. Les signets automatiques du Labo (MX5) démarrent 15 s avant l'erreur.

**Proposé** pour les cartes liées à un objectif (objectif absent, hésitation, smite volé, recall avant objectif, mort
avant un objectif perdu) :

| Étape | Début | Ce qu'on voit |
|---|---|---|
| **Erreur** | **objectif − 60 s** (au plus tôt 45 s avant si la partie commence) | la décision : la tour prise, le recall, la position |
| **Conséquence** | **heure de l'objectif** | l'objectif tombe |
| **Conclusion** | jusqu'à **objectif + 45 à 60 s** | ce qui suit : regroupement ennemi, tour perdue, reset |

- L'extrait va donc de **T − 60 s à T + 45 s** (≈ 1 min 45), au lieu de 15 s.
- La carte affiche **trois repères cliquables** qui font sauter la vidéo : « Erreur 15:35 · Conséquence 16:25 ·
  Conclusion 17:10 ».
- L'en-tête de la carte montre **l'heure de l'objectif** (16:25), pas celle de l'ancrage interne.
- Si l'erreur est datée plus tôt que T − 60 s (par exemple une tour prise 75 s avant), l'extrait commence 10 s avant
  elle, dans la limite de T − 90 s.
- **Signets du Labo** sur une erreur liée à un objectif : même fenêtre, objectif − 60 s.
- **Cartes de mort et de retard** (sans objectif) : **de mort − 45 s à mort + 30 s**, même principe erreur, conséquence,
  conclusion. **Validé par l'utilisateur le 20/11** (« Oui, 45 s / 30 s »).

## 4. Mise en œuvre

**Back-end :**
- table des camps dans `geometry.ts` (sources + vérification sur le cache) ;
- `placeOf` ;
- faits de lieu (`placeAtError`, `placeAtObjective`) et heures des trois étapes (`errorSec`, `objectiveSec`,
  `conclusionSec`) dans les faits du détecteur ;
- `ANALYSIS_VERSION` + 1 (à grouper avec les autres correctifs du 20/11).

**Front-end :**
- `vodTiming.ts` : fenêtre par type de moment au lieu de `PRE_ROLL_SEC` et `EXCERPT_SEC` fixes ;
- trois repères cliquables et en-tête à l'heure de l'objectif ;
- textes `microReview.*` sans distances.

**Graphic Design :** les trois repères et la mini-carte de preuve sur la carte, maquette Penpot d'abord.

**Tests :**
- aucune clé `microReview.*` ne contient « unités » ou `{{distance}}` ;
- `placeOf` sur un point de chaque lieu (les 12 camps, les 2 fosses à chaque heure, les lanes, les rivières, les
  bases) ;
- fenêtre d'extrait d'une mort à 12:00 → 11:15 à 12:30 ;
- fenêtre d'extrait : objectif à 16:25 → 15:25 à 17:10 ; objectif à 5:30 → début au plus tôt à 4:30 ; erreur à
  T − 75 s → début à T − 85 s.

**Effort :** Back-end ≈ 0,5 jour, Front-end ≈ 0,5 jour, Graphic Design ≈ 0,25 jour.

## 5. Risques

- **Coordonnées des camps** : à vérifier sur nos parties. Une erreur de camp rendrait la carte fausse, ce qui est pire
  qu'une distance.
- **Extraits plus longs** : une carte demande plus de temps à regarder. La micro-review était pensée en 45 s, mais elle
  garde 3 moments au plus, et les repères permettent de sauter directement à l'étape voulue.
- **Vidéo manquante** au début ou à la fin de l'enregistrement : l'extrait est rogné à ce qui existe.

## 6. Ajout : la fenêtre de 45 s pour toutes les morts, partout dans l'app

Décision de l'utilisateur (20/11) : « la règle des 45 s devrait se faire pour les morts tout court, pas uniquement avant
l'objectif. J'ai des erreurs bad trades, mais les timers montrent uniquement les morts : on ne voit pas les trades
effectués, juste la conclusion de l'erreur. »

**Constat dans le code (lecture seule) :**
- **Lecteur vidéo** (`VideoReviewPlayer.tsx`) : un clic sur une erreur saute **à la seconde de l'erreur**, sans recul.
  Pour une erreur datée de la mort (mauvais trade, pris seul, dive…), on voit donc la mort, pas le trade qui l'a causée.
- **Signets automatiques** (`mistakeBookmarks.ts`, `LEAD_SEC = 15`) : 15 s avant l'erreur seulement.
- **Micro-review** (`vodTiming.ts`) : 12 s avant, extrait de 15 s. La fenêtre 45 s / 30 s validée plus tôt ne concernait
  que les cartes de micro-review.

**Règle proposée : toute erreur datée d'une mort se regarde de mort − 45 s à mort + 30 s, quel que soit l'écran.**

| Écran | Changement |
|---|---|
| Lecteur vidéo (Review, page d'enregistrement) | le repère de l'erreur reste **sur la mort** dans la barre de temps, mais le clic lance la vidéo **45 s avant** ; un second repère discret marque la mort |
| Labo d'erreurs, « Revoir » | ouvre la vidéo 45 s avant la mort |
| Signets automatiques (gravité 3) | posés à mort − 45 s au lieu de − 15 s |
| Notes de review pré-remplies | le lien horodaté pointe sur mort − 45 s |
| Micro-review | déjà décidé : 45 s / 30 s pour les morts, T − 60 s / T + 45 s pour les objectifs |

**Erreurs concernées** (datées sur une mort) : `unused-gold` (M1), `dove-tower` (M2), `overstay` (M4),
`death-before-objective` (M5), `solo-baron-died` (M8), `caught-out` (M9), **`bad-trade` (M10)**, `bad-positioning`
(M11), `dead-during-objective` (M15), `behind-on-levels-death` (M19), et les réponses de micro-review sur un moment
« mort critique ».

**Erreurs non concernées :**
- celles datées sur autre chose gardent leur repère : pas de ward avant un objectif (M6, fenêtre de l'objectif), trinket
  oublié (M7), ouverture de lane à 5:00 (M12), retard à 10:00 (M13, M14), back tardif (M3, arrivée en base) ;
- les **tags manuels** gardent la seconde choisie par le joueur.

**Mise en œuvre :**
- l'heure enregistrée de l'erreur **ne change pas** : la déduplication à ±3 s et ±20 s en dépend. On ajoute seulement une
  règle de lecture, `playbackWindowOf(tag, source)` → `{ before: 45, after: 30 }` pour les erreurs de mort, dans un
  module partagé (`src/lib/`), utilisé par le lecteur, le Labo, les signets et la review ;
- Back-end : `mistakeBookmarks.ts` (recul de 45 s pour les erreurs de mort) et le module partagé ;
- Front-end : `VideoReviewPlayer.tsx` (clic → début de fenêtre, double repère), Labo et notes de review ;
- tests :
  - un `bad-trade` à 6:12 → lecture à 5:27 ;
  - un tag manuel → sa seconde exacte ;
  - un M13 → 10:00 inchangé ;
  - le début est borné à 0:00 et au début de l'enregistrement.

**Effort :** Back-end ≈ 0,25 jour, Front-end ≈ 0,5 jour.

**Limite :** 45 s couvrent un trade de lane et sa suite. Un trade parti de plus loin (un all-in préparé sur deux waves)
peut commencer avant. Le joueur peut toujours reculer dans la vidéo.
