# Carte « hésitation » : lecture erronée de la tour et de la position

_20/11/2026, session Engine. Retour de l'utilisateur (capture) : « 16:00 · Lane mid — l'ennemi prend le Dragon pendant
que tu finis une tour en side lane, aucun cross-map en contrepartie ». Ses mots : « pas assez précis, je suis en midlane
et tu dis que je finis une tour en sidelane. Sur la séquence, je finis la tour alors que le drake n'est même pas encore
apparu, et à 16:00, je suis mid en train de contest la wave mid. Ta lecture est erronée ici. »
`docs/DECISIONS.md` relu. Lecture seule ; partie relue sur une copie de la base locale, supprimée après lecture._

## 1. Ce qui s'est passé (timeline Riot de la partie `EUW1_8052023818`, 16.23, soloQ)

| Heure | Événement |
|---|---|
| 10:35 | Dragon précédent → le suivant apparaît à **15:35** |
| 13:04, 14:51 | plaques top prises par le joueur (Jayce) |
| **15:14** | le joueur détruit la **T1 top**, soit **21 s avant l'apparition du Dragon** |
| 15:00 → 16:00 | il traverse la carte : relevé de 16:00 en **mid lane** (8 137, 6 754), à 3 426 de la fosse du Dragon |
| **16:25** | l'ennemi prend le Dragon, 50 s après son apparition |

**L'utilisateur a raison.** Le moteur a mal lu la séquence.

## 2. Les trois erreurs du détecteur (`tempo-hesitation`, `anomalyDetector.ts` § 2)

1. **Une tour d'avant l'apparition comptée comme de la greed.** La règle prend toute plaque ou tour du joueur dans les
   **75 s avant la chute** de l'objectif (`hesitation.towerGreedSec`), sans regarder **quand l'objectif est apparu**. Ici,
   la tour de 15:14 tombe dans la fenêtre 15:10-16:25, alors que le Dragon n'existait pas encore. Prendre une tour avant
   l'apparition puis tourner mid, c'est du **bon tempo**, pas un retard.
2. **Tenir la wave mid compté comme une absence.** Le joueur est jugé « loin » dès qu'il est à plus de 2 800 de la fosse
   30 s avant (`OBJECTIVE_RADIUS`). À 3 426, en mid lane, il fait exactement le setup attendu : **prio mid avant le
   Dragon**, à environ 9 s de marche de la fosse. Le moteur l'a lu comme une hésitation.
3. **Texte imprécis.**
   - L'heure affichée (16:00) est celle du moment (chute − 25 s), pas celle de la tour : le texte laisse croire que la
     tour est prise à 16:00.
   - « En side lane » est générique, alors que la lane est connue : la T1 **top**.
   - Ni l'heure d'apparition du Dragon ni la position du joueur (« en mid lane, à 3 400 de la fosse ») ne sont citées.

**Sur les analyses en cache** : 2 cartes « hésitation » au total dans la base locale, toutes deux avec une tour. Celle-ci
a sa tour **entièrement avant l'apparition**. L'autre est la carte des Larves de 8:01, déjà couverte par la règle
« pas de cross-map en soloQ avant 14:00 ». L'échantillon est trop petit pour un taux, mais **les deux cartes de ce
schéma vues par l'utilisateur sont fausses**. Le schéma est à revoir entièrement.

## 3. Correctifs proposés

| # | Règle | Correctif |
|---|---|---|
| A | Tour ou plaque « greed » | Ne compte que si elle est prise **après l'apparition** de l'objectif. Apparition calculée par le moteur : Dragon à 5:00 puis chute précédente + 5:00, Ancien + 6:00, Larves à 8:00, Héraut à 15:00, Baron à 20:00 puis chute précédente + 6:00 (valeurs 2026 de `DETECTOR_SPEC.spawns`, à compléter pour le Baron). Avant l'apparition, une tour prise est une **contrepartie** (gold, plaques, quête). |
| B | « En position » | Un joueur vivant dans la **mid lane** ou la **rivière du côté de l'objectif**, à moins de **4 500** de la fosse à T−30 s, est **en setup** : ni « absent » ni « hésitation ». Seuil à vérifier sur le cache : distance à la fosse des joueurs qui participent à un objectif de leur équipe, 30 s avant. |
| C | Heure de la carte | La carte d'un objectif montre **l'heure de la chute** (16:25) et cite **l'apparition** (15:35). Le lecteur vidéo garde son ancrage, mais le texte ne présente plus l'heure d'ancrage comme celle des faits. |
| D | Texte précis | Chaque fait est cité avec son heure et son lieu exact : « Tu as pris la T1 top à 15:14 (avant l'apparition du Dragon à 15:35), puis tu tenais la wave mid à 3 400 de la fosse ; l'ennemi prend le Dragon à 16:25. » Lane d'une tour = `laneType` de l'événement (TOP/MID/BOT), jamais « side lane » par défaut. |
| E | Quand la carte reste | Seulement si, **après l'apparition**, le joueur prend une tour ou une plaque **loin** de l'objectif (plus de 4 500) pendant que son équipe se bat à la fosse ; ou s'il marche 1 200 unités vers la fosse et arrive après la chute. Le mot « cross-map » suit la règle soloQ du 20/11 : jamais pour un laner en soloQ avant 14:00. |

Le cas de la capture n'aurait **aucune carte** : la tour est d'avant l'apparition et le joueur est en position mid. Un
objectif ennemi pris 50 s après l'apparition, avec le joueur en setup, relève plutôt d'un fight ou d'un setup d'équipe
perdu. Le moteur ne peut pas l'attribuer à ce joueur.

## 4. Mise en œuvre

**Back-end :**
- `spawnOf(objective, events)` dans `anomalyDetector.ts` ;
- A, B et E dans la lecture `tempo-hesitation` et dans le déclencheur « objectif absent » ;
- nouveaux faits (`towerAtSec`, `towerLane`, `spawnSec`, `killSec`, `playerZoneAtT30`) ;
- `ANALYSIS_VERSION` + 1.

**Front-end :** textes de la carte (fr + en) avec ces faits, sans « side lane » générique.

**Tests :**
- cette partie (aucune carte) ;
- tour prise après l'apparition, joueur loin → carte ;
- joueur en mid lane à 3 500 → pas de carte ;
- joueur parti trop tard → carte « parti trop tard » ;
- Baron et Ancien, avec leur réapparition ;
- textes : la lane de la tour et les trois heures sont citées.

**Effort :** Back-end ≈ 0,5 jour (à grouper avec la règle soloQ du 20/11, même code), Front-end ≈ 0,1 jour.

**Risque :** quelques vraies hésitations ne seront plus vues, par exemple un joueur à 4 000 en mid qui ne bouge pas
pendant le fight. C'est le côté sûr : une carte fausse coûte plus de confiance qu'une carte manquée.

## 5. Ajout : ce que le moteur appelle « la fosse », et comment le rendre vérifiable

Question de l'utilisateur : « c'est quoi la fosse pour toi ? Si tu parles du pit drake ou nashor, comment je peux être
sûr que tu ne te trompes pas, vu que tu dis juste "fosse" ? »

**Ce que le moteur utilise** (`src/lib/microReview/geometry.ts`, carte de 15 000 × 15 000, base bleue en bas à gauche) :

| Fosse | Centre | Monstres en 2026 |
|---|---|---|
| **Fosse du Dragon** (rivière bot) | (9 866, 4 414) | Dragons dès 5:00, Ancien |
| **Fosse du Nashor** (rivière top) | (5 007, 10 471) | Larves 8:00-14:45, Héraut 15:00-19:45, Baron dès 20:00 |

Pour un objectif tué, la distance se mesure jusqu'à **la position de l'événement Riot** (ici, le Dragon tué en
(9 837, 4 397), soit le centre de la fosse du Dragon à 30 unités près). Les rayons utilisés sont « près de l'objectif »
2 800, « fight de fosse » 3 000, « dans la fosse » 900. Ils sont déjà dessinés sur la mini-carte de la micro-review
(`MiniMap.tsx`).

**Vérification sur la partie de la capture.** À 16:25, le moteur n'a pas de relevé : il **interpole** entre le relevé de
16:00 (8 137, 6 754) et celui de 17:00 (6 714, 7 205). Cela donne ≈ (7 540, 6 943), soit 3 426 du Dragon tué. Le chiffre
est juste en géométrie, mais c'est **une position estimée** : Riot ne donne la position qu'une fois par minute, et la
carte ne le disait pas.

**Ce qui ne va pas dans l'affichage :**
1. « La fosse » sans nom : le joueur ne sait pas laquelle.
2. Une distance en **unités de jeu**, qui ne parle à personne.
3. Une position interpolée présentée comme un fait.
4. Tout est comparé au centre d'une fosse, alors que le jeu se lit en zones (mid lane côté bot, entrée de la rivière,
   jungle).

**Correctifs (à ajouter à ceux du § 3) :**

| # | Correctif |
|---|---|
| F | **Toujours nommer la fosse par l'objectif du moment** : « fosse du Dragon », « fosse des Larves », « fosse du Héraut », « fosse du Baron ». Plus jamais « la fosse » seule (textes `microReview.*` : `lateMove`, `chokePoint`, `outsmited`…) |
| G | **Remplacé le 20/11 par la décision « aucune unité de distance dans les cartes »** (voir `2026-11-20-lieux-et-extraits-video-des-cartes.md`). Ancienne proposition : **Distance en secondes de marche**, et non en unités : distance ÷ vitesse de déplacement du champion à ce moment (vitesse de base Data Dragon + bottes lues dans les achats). Exemple : « à environ 9 s de marche de la fosse du Dragon ». Les seuils des règles passent aussi en secondes : « en position » = au plus 12 s de marche, au lieu de 4 500 unités, à calibrer. Un champion lent et un rapide ne sont plus jugés pareil |
| H | **Lieu en mots** : la zone du joueur (`zoneOf` : mid lane, rivière bot, ta jungle…), plus le côté (« mid lane, côté bot »), avant tout chiffre |
| I | **Dire quand une position est estimée** : « position estimée (entre les relevés de 16:00 et 17:00) » contre « position exacte » quand elle vient d'un événement (kill, mort, tour, ward). Le moteur ne fonde plus un reproche **uniquement** sur une position estimée prise loin d'un relevé (plus de 20 s d'écart) |
| J | **Mini-carte de preuve sur la carte** : le point du joueur à T−30 s et à la chute, la fosse nommée et son rayon, la tour prise avec son heure. Le joueur voit ce que le moteur a lu et peut le contester. Le composant existe : il faut lui passer ces points, maquette Penpot d'abord |

**Effort en plus :** Back-end ≈ 0,5 jour (vitesse de déplacement, faits « estimée / exacte », seuils en secondes),
Front-end ≈ 0,5 jour (textes, mini-carte de preuve après maquette).
