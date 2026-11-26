# Phase 3 : bilan des ganks du jungler (calibrage, livraison silencieuse)

_26/11/2026, Back-end. Script lecture seule `scripts/calibrate-gank.ts` sur une copie du cache (483 parties 16.x, 966 junglers des deux équipes). Aucune écriture, aucun appel Riot._

## État de livraison

`DETECTOR_SPEC.gankLedger.enabled = false`. Le ledger (`gankLedger.ts`) tourne pour chaque jungler et est stocké dans `GameAnalysis.ganks` (champ interne, `ANALYSIS_VERSION` 16). Tant que le drapeau est à `false`, `jungle-camps-up-gank` fonctionne comme avant. Drapeau à `true` : `jungle-gank-unpaid` le remplace (la règle d'origine est coupée : un gank ne produit jamais les deux), 2 cartes par partie au plus, une mort du jungler déjà lue par la carte de mort critique ne double pas.

## Réglages (`GANK_THRESHOLDS`)

- Présence en lane prouvée de 4 façons : position toutes les 5 s dans la lane avec un laner ennemi de cette lane à moins de 2 500 (10 s au moins), kill / assist / mort du jungler dans la lane **impliquant un laner ennemi de cette lane**, plaque, ou hausse de `minionsKilled` du jungler sur une minute où un relevé le montre en lane (vérifié présent sur 100 % des relevés jungler, rapport 0a). Fusion à 45 s, 180 s au plus.
- Fenêtre : de 1:50 à **14:00** et à la chute de la première tour extérieure de la lane (le plan disait 20:00 : à 20:00 le jungler « gankait » 659 fois pour 100 parties, ce sont des fights d'équipe lus par d'autres détecteurs).
- **Valeur d'un camp sans revenu passif** (régression sur 3 721 minutes de farm pur) : 92 g et 210 XP par camp de 4 CS ; passif de 142 g/min. Retenu : 90 g, 200 XP.
- Coût : camps perdus contre le jungler ennemi (÷ 4), camps volés en territoire allié, mort. Gain : kills / assists, back forcé du laner (sous 35 % PV avant, achat pendant : valeur d'une wave, 100 g), plaques, objectif enchaîné dans les 60 s avec le jungler présent, avance de la lane gankée si kill, assist ou back forcé. Suite : kills du jungler ennemi sur notre équipe, objectifs pris avec lui, écart qui continue de se creuser. Verdict perdant : `net ≤ −2,5` **et** au moins 2 camps perdus ou une mort.
- Timers (explicatifs) : camps pris dans les 135 s avant, fenêtre 1:50-2:25 / 2:40-3:50, laner ennemi bas, jungler ennemi loin (> 8 000) = bons ; camps prêts, jungler ennemi à moins de 3 000 = mauvais.

## Résultats (seuil 2,5)

- **428 ganks pour 100 parties de jungler** (dont 2 208 prouvés par la position, 2 139 par un événement, 371 par les sbires seuls ; mid 2 345, bot 1 047, top 743) ; 718 avec une mort du jungler. Net : p5 −2,49, médiane −0,65, p95 0,99 (biais négatif : le gain n'est vu que par les événements).
- Balayage : s = 2 → 28,6 perdants / 100, victoires 32,8 % contre 54,4 % ; **2,5 → 15,0 / 100, 26,3 % contre 53,2 %** ; 3 → 7,0 / 100, 17,5 %. Par verdict : rentable 7 ganks (57 % de victoires), neutre 3 983 (51 %), perdant 145 (24 %).
- Par timer (part de perdants) : fenêtre 3,3 %, jungler ennemi proche 4,2 %, camps pris 2,9 %, ennemi loin 2,6 %, laner bas 5,0 % (4 cas « camps prêts » seulement : la quasi-totalité des ganks a eu un camp pris dans les 135 s, le timer « camps prêts » est donc presque inobservable avec des relevés d'une minute).
- Par palier de patch (perdants / 100) : < 16.9 : 13,8 ; 16.9-16.15 : 16,0 ; 16.16+ : 14,0.
- Relecture des 20 cas (données seules, pas de vidéo) : 16 sur 20 contiennent une mort du jungler (déjà lue par la mort critique : règle de non-doublon ajoutée). La suite adverse est large (4 à 7 takedowns du jungler ennemi en 3 minutes, souvent un fight d'équipe sans lien causal avec le gank) : **environ 8 cas douteux sur 20**. Plus de 3 : le seuil a été monté de 1,25 à 2,5, mais la suite adverse mériterait d'être limitée aux takedowns hors de la lane gankée, ce qui ne se décide pas sans relecture vidéo.

## Décisions de seuil attendues

1. Seuil 2,5 (15 cartes pour 100 parties de jungler, 2 par partie au plus) ?
2. Limiter la suite adverse (takedowns hors lane gankée seulement, ou 120 s) : à trancher après une relecture vidéo.

## Clés de texte demandées au Front (phase 3F, `microReview.*`, fr + en)

- `pattern.jungle-gank-unpaid`
- `summary.gankUnpaid` (params `lane` top|mid|bot, `from`, `back`), `gankCamps` (`lost`), `gankGap` (`goldBefore`, `goldAfter`, `xpBefore`, `xpAfter`), `gankForcedBack`, `gankTimerCampsUp`, `gankTimerEnemyClose`
- réutilisées : `roamGain`, `roamGainObjective`, `roamNoGain`, et les diagnostics de `jgl-gank-camps-up` (`campsUpGank`, `gankExecution`, `gankTrade` en sortie justifiée « échange assumé »).
