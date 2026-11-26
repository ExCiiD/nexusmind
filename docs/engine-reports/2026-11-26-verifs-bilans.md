# Phase 0a : vérifications avant les bilans (roams, ganks, quêtes)

_26/11/2026, Back-end. Lecture seule sur une **copie** du cache (`MatchCache` de `%APPDATA%/nexusmind/data/nexusmind.db`, copiée dans un dossier temporaire, ouverte avec `readOnly`). Aucune écriture, aucun appel Riot. Échantillon : 483 parties 16.x (966 mid, 966 jungler…), patchs 16.1 à 16.23. Script : `scripts/verify-bilans-0a.ts` (relançable)._

| # | Question | Réponse | Repli retenu |
|---|---|---|---|
| 1 | `CHAMPION_KILL` porte-t-il `bounty` / `shutdownBounty` ? | **Oui.** 28 058 kills : `bounty` présent sur 100 % (médiane 321, min 99, max 420), `shutdownBounty` présent sur 100 % (non nul sur 4 592, soit 16 %). | Le ledger lit l'or réel (`bounty + shutdownBounty`). `bountyGold(streak)` n'est plus nécessaire ; 300 g seulement si un payload n'a aucun des deux champs (fixtures). |
| 2 | Ids des objets de quête par palier 16.x (`ITEM_DESTROYED`) | **Oui, stables de 16.1 à 16.23 : aucun changement d'id aux paliers 16.9 et 16.16.** Top 1200 (1222 en variante), mid 1201, ADC 1202, support 1203, jungle 1204. Fin de quête médiane : top 12:25-12:40, mid 11:55-13:30 selon le patch, ADC 12:30-13:00, support 1203 : 13:10-13:15 (16.1, 16.7-16.10) mais 9:50-12:10 de 16.11 à 16.23 (plusieurs destructions par joueur, à trier). Étape suivante : 1207 (ADC, ~12:40), 1208 (support, ~20:00), 1209 (jungle, ~20:30). | `roleQuest.ts` (phase 4) : table d'ids unique pour 16.x ; le support se lit par la **dernière** destruction de 1203/1208. Le sens exact de chaque id reste à confirmer sur Data Dragon (non fait ici, aucune requête réseau). |
| 3 | `minionsKilled` du jungler (preuve de présence en lane) | **Oui.** Présent sur 100 % des 29 060 relevés de junglers, > 0 sur 74 % ; 1 841 paires de minutes (2:00-12:00) avec un gain de CS de lane. Le compteur monte donc quand le jungler last-hit en lane. | Utilisable tel quel en phase 3 : gain de `minionsKilled` entre deux relevés pendant un passage en lane = présence ; sinon la présence reste « non prouvée » et le verdict penche vers neutre. |
| 4 | Temps de recalcul d'une analyse (`analyzeGame`) | **Négligeable : médiane 1 ms, moyenne 1 ms, max 5 ms** sur 20 parties de 17 à 41 minutes (timelines déjà parsées). Avec le ledger du mid : voir `2026-11-26-calibrage-roam-mid.md` (calibrage complet des 966 mid en environ 5 s, ledger compris). Le coût d'un `ANALYSIS_VERSION` est donc dominé par la lecture / décompression des timelines, pas par le détecteur. | Un seul cran par release (15 pour la phase 1). |

Points à noter :

- Les paliers 16.9 / 16.16 sont lus par `patchOf()` (`gameClock.ts`) : `tier` ∈ `pre-16.9`, `16.9`, `16.16`, `unknown`.
- Patchs peu représentés : 16.2, 16.3, 16.6 (1 partie chacun), 16.16 (16 parties) et 16.15 (17) : le calibrage par palier 16.16 sera fragile jusqu'à ce que le cache grossisse.
- Un participant du cache a un `teamPosition` « Invalid » (1 sur 4 829) : ignoré par le ledger.
