# Phase 4 : quêtes de rôle (validation du modèle, décision sur le verdict)

_26/11/2026, Back-end. Script lecture seule `scripts/validate-role-quest.ts` sur une copie du cache (483 parties 16.x). Aucune écriture, aucun appel Riot._

## Ce qui est livré

`roleQuest.ts` : `questCompletion` (fin réelle de la quête lue sur l'`ITEM_DESTROYED` de l'objet, ids 1200/1222 top, 1201 mid, 1202 ADC, 1203 support, 1204 jungle ; le support prend la **dernière** destruction), `questGap` (écart réel en secondes avec le vis-à-vis direct du même rôle, positif = en retard) et `GameAnalysis.quest`. Les ids n'ont pas bougé de 16.1 à 16.23 (rapport 0a) : `verified: false` au-delà de 16.23, l'écart reste calculé (mode prudent). La quête a fini dans 95 à 97 % des parties selon le rôle.

## Validation du modèle de points (« fin estimée à environ 45 s de la réelle »)

Modèle testé : régression linéaire de la fin réelle sur CS, takedowns, plaques et XP à 10:00 (en échantillon, sans validation croisée : optimiste).

| Rôle | Fin réelle médiane | Erreur médiane | p80 | Dans les 45 s | (réponse constante) |
|---|---|---|---|---|---|
| Top | 12:28 | 27 s | 49 s | **77 %** | 59 % |
| Mid | 12:27 | 40 s | 83 s | 54 % | 45 % |
| ADC | 12:39 | 25 s | 50 s | **75 %** | 54 % |
| Support | 12:57 | 41 s | 98 s | 54 % | 54 % |
| Jungle | 13:48 | 32 s | 72 s | 61 % | 47 % |

Critère « à moins de 45 s pour la plupart des joueurs » : atteint seulement pour le top et l'ADC (et en échantillon). **Pas validé** pour le mid, le support (le modèle n'apporte rien) ni le jungle. **Repli retenu : aucun modèle ; on affiche l'écart réel.**

## Terme de quête dans le verdict : non

Écart de quête avec le vis-à-vis et victoire : corrélation −0,27 (top, mid, ADC), −0,18 (jungle), −0,05 (support). Après contrôle de l'écart de CS, d'XP et d'or à 10:00 (corrélation partielle) : −0,12 (top), −0,12 (mid), −0,16 (ADC), −0,12 (jungle), −0,004 (support). L'écart de quête (fin vers 12:30) résume surtout ce que les CS et l'XP des 10 à 12 premières minutes disent déjà, et le ledger compte déjà ces CS et cette XP : ajouter un terme `questWeight` compterait deux fois la même perte. **Le verdict des roams et des ganks n'en dépend pas** (test : le ledger est identique quel que soit l'écart). L'écart réel est stocké dans l'analyse pour l'affichage et pour l'assistant (`questGapSec`).

## Clés de texte demandées au Front (phase 4F, `microReview.*`, fr + en)

- `summary.questGap` (params `sec` en valeur absolue, `ahead` booléen) : ligne « Quête » de la carte et de la review, par exemple « quête finie 1:10 plus tôt / plus tard que ton vis-à-vis ». À afficher seulement quand `GameAnalysis.quest` existe et `verified` est vrai.
