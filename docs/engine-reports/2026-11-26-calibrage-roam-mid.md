# Calibrage du bilan des roams du mid (phase 1, livraison silencieuse)

_26/11/2026, Back-end. Script lecture seule `scripts/calibrate-roam-mid.ts` sur une copie du cache (`--list` pour les 20 cas). Échantillon : 483 parties 16.x du cache, **tous les mid des deux équipes** = 966 parties-joueur (le verdict porte sur le roam, pas sur le propriétaire de l'app). Aucune écriture, aucun appel Riot._

## État de livraison

**`DETECTOR_SPEC.roam.enabled = false`.** Le ledger tourne à chaque analyse d'un mid et son résultat est écrit dans `GameAnalysis.roams` (champ interne, `ANALYSIS_VERSION` 15), mais aucune carte n'en sort : `mid-roam-plates`, `bad-rotation` et la carte de 10:00 fonctionnent comme avant. Le schéma `mid-roam-unpaid` et ses textes ne s'activent qu'après validation du seuil par l'utilisateur et la phase 1F (textes Front).

## Réglages retenus (`ROAM_THRESHOLDS`, `roamLedger.ts`)

`netThreshold` **1,25** (échelle Δz de `winProbability`), `minCsLost` 6, suite adverse 180 s, `maxAwaySec` 180 (au-delà, rotation d'équipe, pas un roam), fenêtre de 2:00 à 20:00 **ou la chute de notre T1 mid**, `minionGold` 20 (régression sur 5 218 minutes de mid : 18,6 g par CS), `driftShare` 1, 2 cartes par partie au plus.

## Résultats (seuil 1,25)

- **185 roams pour 100 parties-joueur** (dont 481 prouvés seulement par un kill hors lane, 706 terminés par un back, 584 avec une mort, 902 « croisés »). Verdicts : 1,9 rentable, 171,3 neutre, **11,8 perdant** pour 100 parties-joueur.
- Répartition du `net` : p5 −1,71, p25 −0,89, médiane −0,39, p75 0,11, p95 0,75. **Le net est biaisé vers le négatif** : le coût (CS, XP) est mesuré en entier, le gain n'est vu que par les kills, objectifs et fights où le mid est impliqué (la pression sans kill est invisible). D'où si peu de roams « rentables » au même seuil (1,9 / 100) : le verdict rentable n'a de sens qu'en cas net.
- **Winrate par verdict** (par partie-joueur) : sans roam 47,9 % (140), neutres seulement 52,9 % (707), rentables seulement 88,9 % (18), **au moins un roam perdant 25,7 % (101)**. Par roam : rentable 88,9 %, neutre 51,1 %, perdant 24,6 %. Le verdict sépare bien les parties gagnées des perdues (au prix d'une corrélation évidente : un roam raté est souvent un mauvais état de partie).
- Balayage du seuil (suite 180 s, dérive 1) : 0,15 → 35 perdants / 100, winrate 42 % ; 0,5 → 28 / 100, 36 % ; 1,0 → 17 / 100, 30 % ; **1,25 → 12 / 100, 26 %** ; 1,5 → 8 / 100, 27 %. Durée de la suite : 120 s → 80 parties avec un perdant (24 % de victoires), 180 s → 101 (26 %), 240 s → 126 (27 %) : 180 s retenu.
- Par palier de patch (perdants / 100) : < 16.9 : 12,5 ; 16.9-16.15 : 12,2 ; 16.16+ : 7,9 (114 parties-joueur seulement, fragile).
- Le temps de calcul du ledger est négligeable (966 mid en quelques secondes, sans la lecture du cache).

## Relecture des 20 cas perdants (au seuil 1,25, un cas sur 5,7 de la liste)

Relecture **sur les données** (coûts, gains, suite), pas à la vidéo : je ne peux pas rejouer les parties. Constats :

- **17 des 20 incluent une mort du mid pendant le roam** : le coût dominant est alors la mort (330-660 g) et elle est déjà lue par la carte de mort critique. Règle ajoutée : un roam perdant qui finit en mort n'a pas sa propre carte si une carte de mort critique le couvre (« un événement, une lecture »). Le verdict reste stocké.
- Cas francs (aucun gain, CS et XP perdus, plaques ou tour ensuite) : environ 12 sur 20 (ex. n° 1 Ahri 11:55, n° 2 Kassadin 9:15, n° 10 Xerath 13:08).
- Cas douteux (≈ 5-6 sur 20) : roams de plus d'une minute en milieu de partie (15:40-18:20, 16:15) qui ressemblent à une rotation d'équipe ; fights perdus attribués au roam (terme `fightGold` négatif) ; un roam à 2:15 (niveau 2-3) dont le coût de 6 CS vient surtout de la mort. **Plus de 3 douteux sur 20 : la règle du plan voudrait que le seuil monte.** Je l'ai déjà monté de 0,15 à 1,25 et plafonné la durée (180 s) ; monter encore (1,5 donne 8 / 100) ou borner la fenêtre à 14:00 (la phase de lane) réduirait les douteux mais ne peut pas se mesurer sans vidéo.

## Décisions attendues de l'utilisateur

1. Le seuil 1,25 (12 cartes de roam pour 100 parties de mid, au plus 2 par partie) convient-il, ou faut-il un seuil plus haut / une fenêtre limitée à 14:00 ? Tant que ce n'est pas tranché, `enabled` reste `false`.
2. Le biais négatif du net est assumé (le moteur ne voit pas la pression sans kill) : le verdict « rentable » est rare par construction ; il ne sert qu'à supprimer la carte de 10:00 quand un roam rentable explique l'écart.

## Clés de texte demandées au Front (phase 1F, `microReview.*`, fr + en)

- `pattern.mid-roam-unpaid`
- `reason.roamTradeOk` (sortie justifiée : « échange assumé »)
- `summary.roamUnpaid` (params `side` top|bot, `from`, `back` en m:ss), `roamCost` (`cs`, `xp`), `roamGain` (`kills`, `assists`), `roamGainObjective` (`objective`), `roamNoGain`, `roamFollow` (`kills`, `plates`), `roamFollowTower`, `roamFreeze`
- Réutilisées : `reason.roamCheck`, `reason.waveState`.
- Le test `microReviewI18n.test.ts` échoue tant que ces clés manquent (4 tests : label du pattern et clés de résumé).
