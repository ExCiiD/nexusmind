# Saison en cours seulement, et préparation de la saison 2027

_20/11/2026, session Engine. Demande de l'utilisateur : « aucune data de 2025, toutes les infos doivent être à jour.
Nouvelle saison dans 2 mois, il va aussi falloir s'y préparer. » Lecture seule du code. Les sources web ont été lues
le 20/11/2026._

## 1. La règle : le moteur ne travaille que sur la saison en cours

### 1.1 Ce qui existe aujourd'hui pour 2025

Le moteur garde volontairement une deuxième horloge pour les parties 15.x. On la trouve dans 13 endroits du code, hors
tests :

| Où | Quoi |
|---|---|
| `src/lib/microReview/gameClock.ts` | `gameClockOf` (15.x → 2025), `CLOCK_TIMES[2025]`, `BASE_RESPAWN_SEC[2025]` |
| `src/lib/microReview/anomalyDetector.ts` | `CLOCK_2025` (les fenêtres du début de partie 35 s plus tard, plaques à 14:00, Héraut jusqu'à 25:00…), `detectorSpecFor` |
| `electron/main/mistakeRules.ts` | M8 (Baron à 25:00), M12 (mort avant 4:00), M15 (table de respawn 2025), M19 (fenêtre 1:30-4:30) |
| `smartQcm.ts` | les cartes citent les heures 2025 d'une partie 15.x ; les analyses d'avant `ANALYSIS_VERSION` 8 sont lues comme 2025 |
| tests | `anomalyDetectorMath`, `microReviewSeason2026`, `microReviewV5/V6/V7` épinglent les deux saisons |
| docs | `RAPPORT_MOTEUR.md`, `DONNEES_JEU_2026.md`, `RECHERCHE_CONNAISSANCES.md` comparent 2026 à 2025 |

Le cache local contient 73 timelines 15.x (contre 431 en 16.x). Les textes visibles par le joueur n'en parlent pas :
aucune mention de « 2025 » dans `codex.json`, les fondamentaux ni `fr.json`.

### 1.2 Proposition

1. **Les parties 15.x ne sont plus analysées.** Ni micro-review, ni règles M\*, ni note de lane. Elles sortent aussi de
   tous les calculs de coaching : tendances de l'assistant, régression des facteurs de victoire, radar, Labo, bilans,
   calibrages. Dans l'historique, la partie reste visible avec la mention « Saison précédente : pas d'analyse ». **Aucune
   donnée n'est supprimée** (la vidéo, les notes et la review du joueur restent).
2. **Le code 2025 est retiré** : `CLOCK_2025`, les tables 2025, les branches 2025 des règles M\*, les tests 15.x.
   `gameClockOf` devient `seasonOf(match)`, qui renvoie `'current'` ou `'unsupported'`. Le moteur y gagne en
   simplicité.
3. **Les calibrages ne se font que sur la saison en cours, et de préférence sur les patchs récents.** Les seuils de
   l'assistant de novembre ont été calibrés sur 16.1-16.10. Il faut les recalculer sur toute la saison, en vérifiant
   qu'ils tiennent sur les derniers patchs. Pour les règles qui dépendent d'un changement en cours de saison, on part de
   ce patch : support à partir de 16.16, top TP à partir de 16.19.
4. **Mes rapports suivent la même règle.** Les trois rapports sur les roams du 20/11 portent un avertissement : leurs
   colonnes et mentions 15.x ne s'appliquent plus. Les seuils 2026 et les paliers de patch internes à 2026 (16.9, 16.16,
   16.19) restent valables.
5. **Mise à jour au dernier patch.** Le patch 26.23 est sorti le 18/11/2026. D'après le résumé de presse, il ne change
   pas les quêtes de rôle. Avant d'implémenter quoi que ce soit, il faut relire les notes complètes de 26.20 à 26.23 sur
   les points qui touchent le moteur : quêtes, plaques, objectifs, waves.

`ANALYSIS_VERSION` monte d'un cran avec ce changement : les analyses 15.x en cache disparaissent au lieu d'être
recalculées.

## 2. La saison 2027 (janvier 2027)

### 2.1 Ce qui est annoncé (dev update du 16/11/2026)

| Annonce | Effet sur le moteur et l'app |
|---|---|
| Retour de **Kleptomancy**, nouvelle keystone **Titanborn** | fiche `bad-rune-choice` à revoir à la sortie |
| **Refonte des objets on-hit** | fiches ADC qui citent des objets et leurs prix (par exemple l'achat à 1 300 g) à revoir |
| **Faelights supprimées** | fiche `codex_enemy_ward_clock_path_around` (la seule qui les cite) à retirer ou réécrire, avec `codexRetired.json` |
| **Ranked Rush** : tout le monde repart en Fer IV, avec de gros gains de LP | les écrans qui lisent le rang (`RankSnapshot`, progression, export LFT, comparaisons par rang) seront trompeurs pendant plusieurs semaines. Ce n'est pas le moteur de coaching, mais à signaler au Chief |
| **« New Dawn »** : grosse refonte, révélée début janvier 2027, sans date de sortie | rien à préparer de précis tant qu'elle n'est pas détaillée. Si elle touche la carte, la géométrie (`geometry.ts`) serait concernée |

**Pas encore connu :** les timers d'objectifs, des waves, des plaques, les quêtes de rôle, le respawn, l'horloge du début
de partie. Ils arrivent en général avec les notes de patch 27.1 et l'aperçu de saison (décembre-janvier).

### 2.2 Le risque immédiat

Aujourd'hui, `gameClockOf` traite **toute version 16 ou plus comme 2026**. Dès le premier patch 2027 (version 17.x
attendue), le moteur analyserait donc les parties avec les timers 2026, **sans le signaler**. Si Riot change l'horloge
comme en 2026 (35 s plus tôt), une bonne partie des détecteurs se déclencherait à tort.

**À changer avant janvier :** une version de jeu inconnue passe en **mode prudent**.
- Les détecteurs qui reposent sur un timer s'arrêtent : fenêtres de gank, Carapateur, premier back, niveau 2/3, plaques,
  fosses, respawn, M8, M12, M15, M19.
- Les règles sans timer continuent : or non dépensé, dive, back tardif, pris seul, mauvais trade, placement, CS et XP à
  10:00 contre le vis-à-vis.
- Les cartes ne citent aucune heure de référence.
- Un bandeau dit « Saison 2027 : analyse partielle, en cours de vérification ».

### 2.3 À préparer maintenant (avant décembre)

1. **Une seule table par saison.** Toutes les valeurs de jeu vont dans `SEASON_DATA[16]` : horloge du début, spawns,
   waves, plaques, respawn, ids d'objets de quête, taxe du support, budget de roam, paliers de patch. Aujourd'hui elles
   sont réparties entre `DETECTOR_SPEC`, `gameClock.ts` et `mistakeRules.ts`. Passer à 2027 revient alors à écrire
   `SEASON_DATA[17]`. `DONNEES_JEU_2026.md` sert de liste de contrôle, valeur par valeur.
2. **Un script de vérification automatique**, en lecture seule sur le cache. À partir des premières parties d'une
   nouvelle saison, il recalcule ce qui a été mesuré à la main en novembre 2026 :
   - premiers CS de lane et de jungle (horloge du début) ;
   - kills d'objectifs les plus tôt (Dragon, Larves, Héraut, Baron, et tout nouveau monstre) ;
   - plaques après 14:00 ;
   - objets de quête détruits et médianes de fin ;
   - médianes des niveaux 2 et 3 et du premier back ;
   - temps entre une mort et la position suivante (respawn).

   Il sort un tableau d'écarts avec `SEASON_DATA[16]`. C'est ce qui permettra de remplir `SEASON_DATA[17]` à partir de
   données mesurées.
3. **Le mode prudent** du § 2.2.

### 2.4 Calendrier proposé

| Quand | Qui | Quoi |
|---|---|---|
| Maintenant → mi-décembre | Back-end | règle « saison en cours » (§ 1.2), `SEASON_DATA`, mode prudent, script de vérification |
| Notes PBE et aperçu de saison (décembre) | Engine | rapport « Saison 2027 : ce qui change pour le moteur », valeur par valeur |
| Sortie de 27.1 (janvier) | automatique | mode prudent dès la première partie 17.x |
| Après ~100 parties 17.x en cache | Back-end + Engine | script de vérification → `SEASON_DATA[17]` → fin du mode prudent ; recalibrage des seuils de l'assistant ; relecture du Codex (fiches avec des chiffres 2026, runes, objets on-hit, Faelights) ; `ANALYSIS_VERSION` + 1 |
| Ensuite | — | les parties 16.x deviennent « saison précédente » et suivent la règle du § 1.2, si l'utilisateur le confirme |

**Effort :** Back-end ≈ 3 jours avant janvier (règle saison en cours et retrait du 2025 : 1 j ; `SEASON_DATA` : 1 j ;
script : 1 j). Front-end ≈ 0,5 jour (mention « Saison précédente », bandeau « analyse partielle », textes). Puis, en
janvier, ≈ 1 à 2 jours de recalibrage et de relecture du Codex.

## 3. Risques

- **Volume au début de la saison** : un recalibrage sérieux demande des centaines de parties 17.x. Les premières
  semaines, l'assistant n'aura que les règles sans seuil appris, ou les seuils 2026 marqués « provisoires ». Ce choix
  est à faire en janvier.
- **Exclure 15.x des tendances** : un joueur qui avait surtout des parties 2025 récentes verra moins de parties dans ses
  statistiques. C'est voulu, et la mention « saison précédente » l'explique.
- **Sources de presse** : le dev update est résumé par la presse. Les noms (Kleptomancy, Titanborn, Faelights, Ranked
  Rush) sont recoupés par plusieurs articles. Les détails (valeurs, dates) attendent les notes officielles.

## Sources (lues le 20/11/2026)

- Riot, « TL;DW: Season 1 2027 Dev Update » : https://leagueoflegends.com/en-us/news/dev/tldw-season-1-2027-dev-update---lol-website-article-lollol27-s1225r001
- Inven Global, résumé du dev update : https://www.invenglobal.com/articles/28651/league-of-legends-season-1-2027-dev-update-brings-back-kleptomancy-and-adds-ranked-rush
  et https://www.invenglobal.com/articles/28675/league-of-legends-2027-season-to-start-all-players-in-iron-iv
- Riot, notes du patch 26.23 : https://leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-23-notes ;
  Dot Esports : https://dotesports.com/league-of-legends/guides/lol-patch-26-23-notes
