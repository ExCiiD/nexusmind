# Phase 2 : bilan des roams du top, de l'ADC et du support (calibrage, livraison silencieuse)

_26/11/2026, Back-end. Script lecture seule `scripts/calibrate-roam-roles.ts` sur une copie du cache (483 parties 16.x, 966 parties-joueur par rôle, les deux équipes). Aucune écriture, aucun appel Riot. Le mid est inchangé (11,8 perdants pour 100, vérifié)._

## État de livraison

`DETECTOR_SPEC.roam.enabledRoles = { TOP: false, BOTTOM: false, UTILITY: false }` : le ledger tourne pour les trois rôles et est stocké dans `GameAnalysis.roams`, aucune carte n'en sort tant que le drapeau du rôle est à `false`. `enabled` (mid) reste à `false` aussi. Schémas : `top-roam-unpaid`, `adc-roam-unpaid`, `support-roam-unpaid` (avec `mid-roam-unpaid`, 4 au total).

## Réglages (`ROAM_ROLE_SPEC`, `ROAM_THRESHOLDS`)

- **Top** : sorti de la top lane (`laneOf`), payeur = lui-même contre le top adverse, plaques et T1 top ; **TP probable** = déplacement plus rapide que 345 u/s sur le temps écoulé jusqu'à un kill, avec Teleport parmi les sorts (texte seulement).
- **ADC** : sorti de la bot lane **sans son support** (un duo qui part ensemble n'est pas un roam : ensemble plus de la moitié du temps), payeur = le duo (CS de l'ADC, XP des deux). La mort du support pendant l'absence à 2 contre 1 au moins compte dans le coût.
- **Support** : sorti de la bot lane sans son ADC, payeur = l'ADC (CS) et le duo (XP). PV et mana de l'ADC aux relevés, back forcé (sous 35 % PV avant, achat pendant), mort de l'ADC à 2 contre 1 au moins. Timers : après kills sur la botlane adverse (30 s), après recall (40 s), ADC en base ou mort, duo adverse en base ou mort, wave crash **probable** (position + plaque bot), « fenêtre payante » avant le niveau 5 (16.16+) ou 3 (avant). Taxe lue par `patchOf` (16.16 : niveau 5, avant : niveau 3). Un support qui a posé des wards, sans kill et avec moins de 12 CS perdus par son ADC n'est jamais perdant.
- Seuils par rôle : **top 1,5**, **ADC 1,25**, **support 1,25**, mid 1,25 (`minCsLost` 6).

## Résultats

| Rôle | Roams / 100 | Perdants / 100 (seuil retenu) | Victoires des parties avec un roam perdant | sans |
|---|---|---|---|---|
| Top (1,5) | 263 | 13,8 | 26,7 % (116 parties) | 53,2 % |
| ADC (1,25) | 75 | 7,1 | 27,7 % (65) | 51,6 % |
| Support (1,25) | 53 | 6,7 | 25,0 % (60) | 51,7 % |

- Le top sort beaucoup (263 roams pour 100 parties : tout passage hors du couloir top, rivière et objectifs inclus) : seuil plus haut qu'ailleurs. Rentables : 0 à 0,4 pour 100 pour les trois rôles (le net est biaisé vers le négatif : le gain n'est vu que par les kills et objectifs).
- Par palier de patch (roams / perdants pour 100) : top 260/23,4 (< 16.9), 262/18,2 (16.9-16.15), 272/14,0 (16.16+) à 1,25 ; ADC 2,8 / 8,6 / 12,3 ; support 6,6 / 6,8 / 7,0. Le palier 16.16+ ne compte que 114 parties-joueur : fragile.
- **Support par timer** (parties de 510 roams) : bon timer 37,8 % des roams ; après kills : 6 % de perdants, après recall : 11 %, fenêtre payante : 4 % (mais 48 % de victoires), `adc-away` : 27 % de perdants (30 roams), mauvais timer : 16 %, sans timer : 14 %, wave crash probable : 14 roams (0 perdant, 21 % de victoires). Avant 16.16 la taxe signalée touche 69 roams. L'ADC meurt à 2 contre 1 pendant 172 des 510 roams du support (34 %), et un back forcé arrive 43 fois.
- **Relecture des 20 cas par rôle (données seules, pas de vidéo)** : la mort pendant le roam domine encore (environ 60 % des cas perdants du top, 70 % de l'ADC, 40 % du support) et ces cas sont déjà lus par la carte de mort critique (règle « une lecture »). Douteux : roams du support après 12:00 (rotations d'équipe, timer « none »), ADC « roams » de 15:00 qui ressemblent à des regroupements. Moins de 20 % du lot, mais non vérifié à la vidéo.

## Décisions de seuil attendues

1. Top 1,5 / ADC 1,25 / support 1,25 : à valider (ou relever), rôle par rôle (`enabledRoles`).
2. Limiter les ledgers de l'ADC et du support à la phase de lane (avant 14:00) ? Les cas douteux sont tous au-delà.

## Clés de texte demandées au Front (phase 2F, `microReview.*`, fr + en)

- `pattern.top-roam-unpaid`, `pattern.adc-roam-unpaid`, `pattern.support-roam-unpaid`
- `reason.roamOutsideWindow` (support : parti hors fenêtre gratuite), `reason.adcLeftAlone` (ADC laissé seul, wave sous leur tour), `reason.freeWindow` (sortie justifiée : fenêtre gratuite, ADC en sécurité), `reason.adcLeftSupport` (ADC : support laissé seul), `reason.adcWaveLeft` (ADC : wave pas poussée avant de partir)
- `summary.roamUnpaidTop`, `roamUnpaidAdc`, `roamUnpaidSupport` (params `from`, `back`)
- `summary.roamTp` (top : TP probable), `roamSupportDied` (ADC : support mort pendant l'absence)
- `summary.roamAdcCost` (`cs`, `gold`), `roamAdcBack` (`pct`), `roamAdcDied`
- timers du support : `roamTimerAfterKills`, `roamTimerAfterRecall`, `roamTimerAdcAway`, `roamTimerEnemyRecall`, `roamTimerCrash` (conditionnel), `roamTimerPaid` (taxe avant le niveau 5), `roamTimerBad`, `roamTimerNone`
- réutilisées de la phase 1 : `roamCost`, `roamGain`, `roamGainObjective`, `roamNoGain`, `roamFollow`, `roamFollowTower`.
- Nouvelle fiche Codex `codex_adc_roam_leave_support_alone_in_lane` (fr + en déjà écrits, à relire par le Front) ; `bad-wave-sync` ajouté à la fiche support.
