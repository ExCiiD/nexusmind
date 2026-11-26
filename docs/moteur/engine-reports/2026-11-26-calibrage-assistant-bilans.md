# Phase 5 : assistant, indicateurs des bilans (règles non écrites)

_26/11/2026, Back-end. Script lecture seule `scripts/calibrate-assistant-bilans.ts` sur une copie du cache (483 parties 16.x, tous les joueurs). Aucune écriture, aucun appel Riot._

## Livré

`bilanOf(analysis)` (`src/lib/microReview/bilanSummary.ts`) donne par partie : `roams`, `roamsPaid` (verdict perdant), `roamsGoodTimer` (support), `ganks`, `ganksPaid`, `campsLostPerGank`, `questGapSec` (écart réel, seulement si les ids du patch sont vérifiés). `GameRecord.bilan` / `GameFeatures.bilan` (optionnels) les portent ; `assistant.ipc.ts` les lit dans l'analyse stockée (version 16 et plus). Les indicateurs sont des champs de `GameFeatures`, pas des entrées de `METRICS` : aucune règle, aucun problème, aucun critère d'expérience ne les lit encore.

## Règles et expériences : pas écrites, la distribution ne les justifie pas

Règle du plan : « au moins 1 roam perdant dans 3 des 5 dernières parties » (roams) et « au moins 2 ganks perdants dans 3 des 5 » (jungle). Avec les seuils calibrés (mid 1,25, top 1,5, ADC / support 1,25, ganks 2,5) :

| Rôle | Roams / partie | Parties avec un roam perdant | Fenêtres de 5 parties où « 3 sur 5 » se déclenche |
|---|---|---|---|
| Top | 2,7 | 12,3 % | 1,5 % |
| Mid | 1,9 | 10,7 % | 1,0 % |
| ADC | 0,8 | 6,9 % | 0,3 % |
| Support | 0,5 | 6,4 % | 0,2 % |
| Jungle (ganks) | 4,4 ganks / partie | 12,1 % avec 1 gank perdant au moins, 2,4 % avec 2 au moins | 0,0 % |

Une règle qui se déclenche sur moins de 2 % des fenêtres n'a pas de signal à donner (et les critères d'expérience « 60 % de roams rentables ou neutres » sont trivialement atteints : 98 % des roams sont neutres). Les règles `roam_unpaid_pattern`, `support_roam_bad_timer`, `jungle_gank_unpaid_pattern` et leurs critères sont donc **non écrits**. À rouvrir si les seuils changent après validation des cartes ou si le cache grossit (le palier 16.16+ ne compte que 114 parties-joueur).

## Clés de texte pour le Front

Aucune pour cette phase (aucun texte d'assistant nouveau).
