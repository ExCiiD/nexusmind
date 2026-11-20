# Données de jeu figées dans le code — vérification 2026 (#45)

> Session **Audit**, 19/11/2026, en lecture seule ; aucune correction. Le Back-end corrigera ensuite.
>
> **20/11/2026 :** le moteur n'analyse plus que la saison en cours (16.x) ; les parties 15.x ne sont plus analysées
> (`seasonOf`, `ANALYSIS_VERSION` 11). Les comparaisons avec 2025 sont retirées de ce rapport, et D3 est sans objet.
>
> **Code relu :**
> - `src/lib/microReview/anomalyDetector.ts` (`DETECTOR_SPEC`) ;
> - `src/lib/microReview/gameClock.ts` (`CLOCK_TIMES`, réapparition) ;
> - `electron/main/mistakeRules.ts` ;
> - `electron/main/eventExtractor.ts`, `riotClient.ts` ;
> - `src/lib/microReview/codex.json`, `src/lib/constants/fundamentals*.ts`, `src/i18n/locales/*.json` ;
> - `docs/RAPPORT_MOTEUR.md`.
>
> **Sources, consultées le 19/11/2026 :**
> - **[PN 26.1]** patch notes officielles 26.1 (janvier 2026),
>   <https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/> ;
> - **[Wiki Voidgrub]** <https://wiki.leagueoflegends.com/en-us/Voidgrub> (wiki officiel, historique des versions) ;
> - **[Wiki Herald]** <https://wiki.leagueoflegends.com/en-us/Rift_Herald> ;
> - **[Wiki Dragon]** <https://wiki.leagueoflegends.com/en-us/Dragon> (article « Dragon pit ») ;
> - **[Wiki Minion]** <https://wiki.leagueoflegends.com/en-us/Minion_(League_of_Legends)>.
>
> **Saison :** comme dans le code, **2026 = version de jeu 16.x** (`DETECTOR_SPEC`), la seule analysée.

## En bref

1. **Grubs : le code est juste.** Depuis le patch 25.09, il y a **3 Larves, une seule fois, à 8:00**, sans
   réapparition, et elles disparaissent à 14:45 [Wiki Voidgrub, V25.09]. « 6 Larves » correspond à une **ancienne**
   règle.
2. **Héraut : 15:00 → 19:45** en 2026 [Wiki Herald]. Le détecteur (`heraldEye`) part encore de **14:00**, une valeur
   ancienne. Le Codex dit déjà 15:00-19:45.
3. **Baron 20:00, Feats of Strength et Blood Roses supprimés** [PN 26.1].
   **M8 `solo-baron-died`** compte comme « Baron » toute mort près de la fosse du haut dès **8:00**, donc aussi les
   morts aux Larves et au Héraut.
4. **Sbires, camps, Carapateur, plaques, Smite, dragons : conformes** (0:30 / 0:55 / 2:55 ; premier canon en vague
   3 à 1:30 ; plaques à 120 g, −10 g par minute dès 11:00 et au plus −40, permanentes ; Smite 1000 / 1400 ; dragons
   à 5:00 + 5:00, âme au 4e, Ancestral avec 6 min de réapparition).
5. Écarts mineurs : Krug et Gromp à **1:07** (et non 0:55) en 2026, niveau maximal 20 avec la quête top.

## 1. Tableau des valeurs

Légende : ✅ conforme · ❌ à corriger · ⚠️ imprécis ou incomplet · ⏳ non vérifiable ici.

### Objectifs épiques

| Donnée | Valeur dans le code | Valeur correcte | Source | Fichiers / règles | Saison | État |
|---|---|---|---|---|---|---|
| Larves : nombre et apparition | `spawns.grubsSec: 480`, commentaire « one Voidgrub camp at 8:00 » (`anomalyDetector.ts:197`) | **3 Larves, 1 fois, à 8:00**, sans réapparition, disparition à 14:45 (14:55 en combat) | Wiki Voidgrub (V25.09 ; aucun changement en V26.01) | `tradeRecall` (retour 0-35 s avant une apparition) | 16.x | ✅ |
| Larves : récompenses | non codé | 30 g locaux et 65 XP par Larve (avant : 20 locaux + 50 globaux) ; Touch / Hunger of the Void conservés | PN 26.1 | — | 16.x | ✅ (n/a) |
| Héraut : apparition | `heraldEye.fromSec: 840` (14:00) | **15:00** | Wiki Herald (V25.09 : 16:00 → 15:00 ; V25.S1.1 : 14:00 → 16:00) | `jungle-herald-unused-death` (`anomalyDetector.ts:241, 959-966`), commentaire « 14:00–19:30 » | 16.x | ❌ (sans effet en pratique : la règle exige un Héraut déjà tué) |
| Héraut : fin de fenêtre | `heraldEye.untilSec: 1170` (19:30) | 2026 : disparition à **19:45** (19:55 en combat), l'œil pouvant servir un peu après | Wiki Herald | idem | 16.x | ⚠️ (rate les morts 19:30 → ~20:30) |
| Héraut : récompenses | non codé | 100 g au tueur ; 240 XP ; recharge de l'œil 6 s | PN 26.1 | — | 16.x | ✅ (n/a) |
| Dragon : 1er et réapparition | `firstDragonSec: 300`, `dragonRespawnSec: 300` | **5:00**, puis **5:00** après chaque kill | Wiki Dragon (aucun changement en V25/V26) | `tradeRecall`, `dragonTank` (5:00-12:00) | 16.x | ✅ |
| Âme / Ancestral | non codé (types `dragon` / `elder` séparés) | âme au **4e** dragon ; Ancestral ensuite, **6 min** de réapparition | Wiki Dragon | `eventExtractor.ts`, `winProbability.ts` | 16.x | ✅ |
| Baron | textes : « Baron disponible depuis 20:00 » (Codex l. 265, 2200) ; `RAPPORT_MOTEUR` : 20:00 | **20:00** | PN 26.1 | Codex, `RAPPORT_MOTEUR`, **M8** (voir § 2) | 16.x | ✅ textes ; ❌ M8 |
| Feats of Strength, Blood Roses | non codés | **supprimés** en 2026 | PN 26.1 | — | — | ✅ (n/a) |
| Premier sang | `firstBloodParticipation` (stat, aucun montant) | +100 g au tueur en 2026 | PN 26.1 | radar `fb` | — | ✅ |

### Tours et plaques

| Donnée | Code | Correct | Source | Fichiers | Saison | État |
|---|---|---|---|---|---|---|
| Chute des plaques | permanentes (`midRoam`/`dive` jusqu'à 20:00, `sideTower` sans début) | **permanentes** | PN 26.1 | `anomalyDetector.ts` | 16.x | ✅ |
| Or d'une plaque | Codex l. 134 : « 120 g (80 g plus tard) » | 2026 : **120 g**, −10 g/min dès 11:00, au plus −40 (donc 80 g) | PN 26.1 | Codex | 16.x | ✅ |
| Plaques intérieures et inhibiteurs | non codé | 5 plaques, 600 g au total par tour | PN 26.1 | — | 16.x | ✅ (n/a) |
| Plaques à 15:00 (stat) | `turretPlates15` (`riotClient.ts:768`) | mesure toujours valable | — | stats de lane | — | ✅ |

### Sbires et vagues

| Donnée | Code | Correct | Source | Fichiers | Saison | État |
|---|---|---|---|---|---|---|
| 1re vague | 0:30 (`gameClock.ts`) | **0:30** | PN 26.1, Wiki Minion | tout le début de partie | 16.x | ✅ |
| Intervalle | non codé | 30 s, puis **25 s à 14:00**, puis **20 s à 30:00** | Wiki Minion, PN 26.1 | — | 16.x | ✅ (n/a) |
| Vagues canon | Codex l. 134 : « 3e wave (la wave canon, 1:30 en 2026) » ; l. 2032 et 2284 : canons à 1:30, 3:00, 4:30, 6:00, 7:30 | 2026 : **1er canon en vague 3 (1:30)**, puis **1 vague sur 3** jusqu'à 14:00, 1 sur 2 jusqu'à 25:00, chaque vague ensuite | PN 26.1, Wiki Minion | Codex | 16.x | ✅ |
| Niveaux en bot lane | Codex l. 2389-2390 : niveau 2 sur le 9e sbire vers 1:45-1:55, niveau 3 sur le 2e mêlée de la vague 4 | cohérent avec les médianes mesurées (`gameClock.ts:6-7`) | données en cache | Codex | 16.x | ✅ |
| Super-sbires | non codé | 1 par lane et par inhibiteur détruit, 2 si tous sont tombés ; AD 210 → 180 | Wiki Minion, PN 26.1 | — | — | ✅ (n/a) |

### Jungle

| Donnée | Code | Correct | Source | Fichiers | Saison | État |
|---|---|---|---|---|---|---|
| Camps | « camps à 0:55 » (`fundamentals*.ts:394/421`, `gameClock.ts:4`) | Loups, Sentinelle bleue, Ronce rouge, Raptors : **0:55** ; **Krugs et Gromp : 1:07** | PN 26.1 | textes des fondamentaux | 16.x | ⚠️ (texte) |
| Carapateur | 2:55 ; `supportScuttle` 2:50-3:15 | **2:55** ; évolution après 15 kills | PN 26.1 | `supportScuttle`, Codex l. 1432 | 16.x | ✅ |
| Petits camps | « de retour 2:15 après le kill » | 135 s = 2:15 (valeur Swiftplay citée en « 135 s → 120 s », donc 135 s sur la Faille normale) | PN 26.1 (Swiftplay) | fondamentaux | 16.x | ✅ (déduit) |
| Smite | Codex l. 1690 : « 1000/1400 depuis 2026 » ; l. 1561, 1613 : 1000 | **600 / 1000 / 1400** | PN 26.1 | Codex | 16.x | ✅ |
| Quête de jungle | non codé | 35 cumuls (au lieu de 40) | PN 26.1 | — | 16.x | ✅ (n/a) |

### Système

| Donnée | Code | Correct | Source | Fichiers | Saison | État |
|---|---|---|---|---|---|---|
| Début de partie | repères précoces sur les sbires à 0:30 | « Most early systems start 35 seconds faster » ; or passif à 65 s ; remake à 0:55-2:25 | PN 26.1 | `CLOCK_TIMES`, `DETECTOR_SPEC` | 16.x | ✅ |
| Réapparition | table 2026 issue du wiki ; niveaux **limités à 1-18** (`gameClock.ts:57`) | La quête top permet le **niveau 20** en 2026 | PN 26.1 | `deathTimerSec`, gravité M-rules (« 71,5 s ») | 16.x | ⚠️ (niveaux 19-20 lus comme 18) |
| Objets de départ | aucun identifiant figé trouvé (seulement `earlyBoots` = 1001) | non relu | — | `earlyBoots` | — | ⏳ |

## 2. Règles et calculs à revoir

Par ordre de priorité ; tout est pour **backend-dev**.

| # | Règle | Problème | Correctif proposé | Prio |
|---|---|---|---|---|
| D1 | **M8 `solo-baron-died`** (`mistakeRules.ts:222-230`) | Toute mort à 1 800 de la fosse du haut **dès 8:00** est étiquetée « Baron ». En 2026, la fosse abrite les Larves (8:00-14:45) puis le Héraut (15:00-19:45) ; le Baron n'apparaît qu'à **20:00**. Une mort aux Larves devient « mort seul au Baron ». | Seuil : `ts >= 20 * MIN`. Optionnel : une variante « mort seul à la fosse » pour Larves et Héraut, avec un autre tag. | P2 |
| D2 | **`heraldEye`** (`anomalyDetector.ts:241`) | `fromSec` 840 (14:00) au lieu de 900 (15:00) ; `untilSec` 1170 (19:30) coupe les morts jusqu'à la fin de vie de l'œil. | 16.x : `fromSec: 900`, `untilSec` ≈ 1 215-1 260 (disparition à 19:45 + délai de prise de 20 s + marge d'usage, à mesurer sur les parties en cache). Corriger le commentaire « 14:00–19:30 » et la clé i18n si elle cite une heure. | P3 |
| D3 | ~~`spawns` des patchs 15.1 à 15.8~~ | Sans objet depuis le 20/11/2026 : les parties 15.x ne sont plus analysées. | — | — |
| D4 | **`deathTimerSec`** (`gameClock.ts:57-61`) | Niveaux 19 et 20 (quête top, 2026) ramenés à 18. | Prolonger la table 2026 si le wiki donne les valeurs 19-20 ; sinon garder le niveau 18 et le commenter. | P3 |
| D5 | **`pit`** (`anomalyDetector.ts:150`, `fromSec: 840`) | Les combats de fosse comptent dès 14:00. Ce n'est pas faux (combats de milieu de partie), mais c'est un héritage du Héraut à 14:00. | Garder 14:00, ou passer à 15:00 (Héraut) avec un commentaire. Pas d'impact mesuré. | P3 |

**Analyses en cache :** D1 et D2 changent la sortie du détecteur ou des règles. Monter `ANALYSIS_VERSION`
(`microReview.ipc.ts:33`) avec D2, et vérifier que M8 se recalcule (les règles M sont rejouées à l'analyse de la
partie).

## 3. Textes à corriger

| Fichier | Ligne | Texte | Correctif | Prio |
|---|---|---|---|---|
| `src/lib/constants/fundamentals.fr.ts` / `fundamentals.ts` | 394 / 421 | « 2026 : camps à 0:55 » | « camps à 0:55 (Krugs et Gromp à 1:07) » | P3 |
| `src/lib/microReview/anomalyDetector.ts` | 241, 959 | commentaire « 14:00–19:30 » (Héraut) | « 15:00–19:45 » (avec D2) | P3 |
| i18n `microReview.*.heraldUnused` | `fr.json:4245`, `:4350` | pas d'heure citée | — | ✅ |
| Codex « Héraut de 15:00 à 19:45 depuis 2026 » | `codex.json:1587-1588` | conforme | — | ✅ |
| Codex « Baron disponible depuis 20:00 » | `codex.json:265-266`, `2200-2201` | conforme pour 2026 | — | ✅ |
| `docs/RAPPORT_MOTEUR.md` | 69 | « Larves du Néant : un camp à 8:00 » | ajouter « 3 Larves, sans réapparition » | P3 |

**Aucun texte de l'app ne parle de « 6 Larves » ni de deux vagues de Larves** : la recherche par motif
(`6 larves`, `deux vagues`, `grubs at 6`, `Herald at 14`, `Baron at 25`, `125 g`, `wave 4`…) ne trouve que des
passages conformes ou propres à la bot lane.

## 4. Non vérifié

- **Objets de départ** et quêtes de rôle en détail : les patch notes 26.1 lues ne donnent pas les valeurs de la Faille
  normale. Aucun identifiant d'objet de départ n'est figé dans les règles ; seul `earlyBoots` (1001) l'est.
- **Durée de l'œil du Héraut une fois ramassé** : non donnée par le wiki, d'où la marge à mesurer pour D2.
- **Patchs 26.2 et suivants** : seules les notes 26.1 et l'historique du wiki (jusqu'en V26.05 sur les pages
  relues) ont été lus. Le wiki ne liste aucun changement de timer d'objectif après 26.01.
