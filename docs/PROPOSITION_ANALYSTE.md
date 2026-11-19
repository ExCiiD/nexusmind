# Proposition — fonctionnalités pour l'analyste esport (#40)

Rédigé le 19/11/2026 par la session Graphic Design, à la demande du Chief, à
partir d'une lecture du code (lecture seule). **À choisir par l'utilisateur
avant toute maquette.**

## Point de départ

- **Rôle.** `analyst` existe déjà (`src/lib/permissions.ts`) : il compte
  comme staff (`is_group_staff`) et voit donc ce que les joueurs partagent
  avec le groupe. Il pourra être cumulé avec `player` (#39, en analyse au
  Back-end) : chaque fonctionnalité ci-dessous doit rester utile à un joueur
  qui analyse sa propre équipe.
- **Données déjà là.**
  - Match-v5 et **timelines** passent déjà par le relais Riot
    (`cloudflare/riot-proxy/src/routing.ts` autorise
    `/lol/match/v5/matches/{id}/timeline`).
  - Stats par game et duels : `teamSessionStatsCore.ts`.
  - Stats collectives flex / scrim / tournoi : `aggregateMatchLike`, onglets
    de `src/pages/Team/`.
  - Scouting et tiers de menace : `scoutingCore.ts`, `threatCore.ts`,
    `ScoutingTab`, `DraftTab`.
  - Reviews de VOD collaboratives : `vodReviewCore.ts`.
  - Reviews de session : `teamSessionReviewsCore.ts`.
  - Micro-reviews : `microReviewCloudCore.ts`.
  - Rapports hebdo et tournoi : `reportCore.ts`.
  - Tableau de bord staff : `staffDashboardCore.ts`.
- **Ce qui manque partout.** L'app ne lit aujourd'hui dans la timeline que
  les morts et la participation du joueur (`electron/main/assistant/timeline.ts`).
  Rien n'exploite encore les objectifs (drakes, Herald, grubs, Baron, tours),
  les courbes d'or ni les positions des kills **à l'échelle de l'équipe**.
- **Clé Riot.** Avec la clé personnelle (20 requêtes/s, 100 par 2 min,
  partagées), analyser **nos** games est faisable. Analyser **des
  adversaires** en volume (5 joueurs × des dizaines de games + timelines)
  est lent : la clé de production (#42) le rend confortable.

Légende effort : **S** ≤ 2 jours, **M** ≈ 1 semaine, **L** > 1 semaine
(Back-end + Front-end + Design).

---

## 1. Journal des drafts

- **Problème.** Les drafts de scrim et de tournoi se perdent : impossible de
  dire « on perd 70 % de nos games côté rouge quand on first-pick » ou
  « telle équipe ban toujours notre jungler ».
- **Ce qu'il voit et fait.** Onglet *Draft* de Coaching & Management →
  sous-onglet « Historique ». Chaque game d'équipe y apparaît avec côté,
  ordre de picks, bans, adversaire et résultat. Filtres (adversaire, patch,
  côté, champion) et tableau de synthèse : winrate par côté, par first-pick,
  bans les plus subis, combos qui gagnent. Un clic renvoie vers la VOD ou la
  review de la session.
- **Données.** Picks, côté et résultat : dans match-v5, déjà récupérés pour
  les stats scrim / tournoi. Les bans sont dans `teams[].bans` pour les
  games avec draft (tournois à code, lobby en mode draft). **À vérifier** pour
  les customs sans draft. Manque : une table `draft_log` (ou un calcul à la
  volée depuis les matches en cache) et l'ordre de pick, absent de match-v5
  (saisie manuelle facultative par l'analyste).
- **Clé de production.** Non : on ne lit que nos propres games.
- **Effort / priorité.** M · **P1**.

## 2. Objectifs et rythme de jeu (timelines)

- **Problème.** L'analyste veut savoir *quand* l'équipe prend ou concède
  les objectifs. Par exemple : « on perd le 2e drake 3 fois sur 4 », « nos
  grubs arrivent 1 min plus tard que l'adversaire ».
- **Ce qu'il voit et fait.** *Stats collectives* → nouvel onglet
  « Objectifs », sur une période ou un bloc de scrims :
  - frise par game (drakes, Herald, grubs, Baron, tours) avec les timings ;
  - taux de contrôle par objectif ;
  - écart d'or de l'équipe à 10 / 15 / 20 min ;
  - premier sang, première tour ;
  - comparaison côté bleu / rouge.
- **Données.** Timelines déjà accessibles via le relais. Manque :
  l'extraction côté équipe des événements `ELITE_MONSTER_KILL`,
  `BUILDING_KILL`, des frames d'or par participant, et un cache par match.
- **Clé de production.** Non pour nos games (1 timeline par game).
- **Effort / priorité.** M · **P1**.

## 3. Dossier adverse

- **Problème.** Préparer un match contre une équipe demande d'ouvrir 5
  profils, de noter les pools, de deviner les habitudes.
- **Ce qu'il voit et fait.** *Scouting* → « Dossier » d'une équipe
  adverse, une page :
  - pool et confort de chaque joueur (tiers de menace existants) ;
  - forme récente en ranked ;
  - champions joués ensemble ;
  - et, s'il y a des games contre eux, les drafts (§ 1) et les objectifs
    (§ 2).
  L'analyste ajoute ses notes (« ban Nidalee, ils la jouent en 1er pick »)
  et publie le dossier au roster (§ 9). Export texte pour Discord.
- **Données.** Pools, tiers et menaces : `scoutingCore`, `threatCore`,
  `ScoutingTab` (existant). Manque : la page de synthèse, la mémoire des
  notes, la jonction avec les games joués contre cette équipe.
- **Clé de production.** **Fortement conseillée** : 5 joueurs × 20-50
  games, c'est lent avec la clé personnelle. Le dossier fonctionne en mode
  réduit (moins de games) sans elle.
- **Effort / priorité.** M · **P1**.

## 4. Carte des morts et des kills

- **Problème.** « Où mourons-nous ? » est la première question d'une review
  de macro, et aujourd'hui elle se répond à l'œil, game par game.
- **Ce qu'il voit et fait.** *Review VOD* et *Stats collectives* → carte de
  la Faille avec les kills et morts de l'équipe, filtrables par phase
  (0-14, 14-25, 25+), par joueur, par côté. Un point renvoie au moment de la
  VOD s'il y en a une.
- **Données.** `CHAMPION_KILL` de la timeline porte une position. Les
  `WARD_PLACED` n'ont **pas** de position dans match-v5 : pas de carte des
  wards possible depuis l'API. Manque : l'extraction, le fond de carte, le
  rendu.
- **Clé de production.** Non.
- **Effort / priorité.** M · **P2**.

## 5. Rapport de bloc de scrims / post-tournoi

- **Problème.** Le rapport post-tournoi est le reste d'E9 non livré, et
  l'analyste refait ce bilan à la main après chaque bloc.
- **Ce qu'il voit et fait.** *Rapport hebdo* → « Rapport de période »
  (choix des dates ou d'un tournoi). Il contient :
  - résultats et stats collectives ;
  - erreurs récurrentes ;
  - drafts (§ 1) et objectifs (§ 2) quand ils existent ;
  - un champ « conclusions de l'analyste ».
  Export texte / PDF, envoi au roster.
- **Données.** `reportCore.ts` gère déjà une fenêtre « tournoi » avec
  comparaison à la période précédente. Manque : la section analyste et
  l'export.
- **Clé de production.** Non.
- **Effort / priorité.** S · **P1** (gain rapide, réutilise l'existant).

## 6. Bibliothèque de situations (tags d'analyse)

- **Problème.** Les commentaires de review VOD restent dans leur session :
  impossible de retrouver « tous nos setups de Baron ratés ce mois-ci ».
- **Ce qu'il voit et fait.** Dans la review VOD, chaque commentaire reçoit un
  tag de situation (setup d'objectif, teamfight, rotation, invade, wave
  management, vision…), plus bon / mauvais. Une page « Situations » regroupe
  tous les moments taggés, toutes sessions confondues, avec filtres et lien
  vers le timestamp. L'analyste en fait des playlists à montrer en réunion.
- **Données.** Commentaires horodatés : `vodReviewCore.ts`. Manque : la
  colonne de tag, la page transversale, les playlists.
- **Clé de production.** Non.
- **Effort / priorité.** S-M · **P2**.

## 7. Benchmarks de lane (duels à 10 / 15 min)

- **Problème.** Savoir si un joueur gagne ou perd sa lane, et de combien,
  avec des chiffres comparables d'une game à l'autre.
- **Ce qu'il voit et fait.** Dans *Stats par game* et la fiche joueur
  (*Joueurs*) : écart de CS, d'or et d'XP face au vis-à-vis à 10 et 15 min,
  moyenné sur les scrims, avec la tendance. Les duels existants
  (`buildDuelRows`) gagnent ces colonnes.
- **Données.** Duels de fin de partie : `teamSessionStatsCore.ts`. Manque :
  les frames de timeline à 10 / 15 min.
- **Clé de production.** Non pour nos games.
- **Effort / priorité.** S-M · **P2** (réutilise l'extraction du § 2).

## 8. Objectifs d'équipe mesurés automatiquement

- **Problème.** Le staff fixe des objectifs de session (« vision du drake à
  -1:00 », « pas de mort avant 4:00 ») mais leur respect se juge à
  l'impression.
- **Ce qu'il voit et fait.** À la création d'un objectif de session d'équipe,
  l'analyste choisit un indicateur mesurable dans une liste (premier drake
  pris, morts avant X:00, écart d'or à 15, contrôle des grubs…). En fin de
  game, la session affiche « respecté / non respecté » game par game, et la
  tendance sur le bloc.
- **Données.** Objectifs de session : `teamSessionsCore.ts`. Mesures : les
  extractions des § 2 et § 7. Manque : le catalogue d'indicateurs et
  l'évaluation automatique.
- **Clé de production.** Non.
- **Effort / priorité.** M · **P2** (après le § 2).

## 9. Fiches de match publiées au roster

- **Problème.** Le game plan d'avant-match circule en messages Discord
  épars et se perd.
- **Ce qu'il voit et fait.** Depuis un événement du *Planning* (scrim,
  tournoi), l'analyste attache une fiche : game plan, bans conseillés, rôles
  clés, extrait du dossier adverse (§ 3). Les joueurs la lisent dans l'app,
  sur le web, et le bot Discord la poste dans le salon d'équipe 1 h avant.
- **Données.** Événements du planning, annonces, bot Discord : existants.
  Manque : la fiche liée à un événement et le message du bot.
- **Clé de production.** Non.
- **Effort / priorité.** S-M · **P2**.

## 10. Veille méta et patch

- **Problème.** Suivre ce qui monte en high elo et dans la région à chaque
  patch.
- **Ce qu'il voit et fait.** Page « Méta » : taux de pick, ban et victoire
  par rôle sur les games high elo récentes, écarts avec le patch précédent,
  champions des pools de l'équipe qui montent ou baissent.
- **Données.** Aucune agrégation de ce type aujourd'hui. Il faut récupérer
  en continu des milliers de games (league-v4 challenger / grandmaster,
  route non autorisée dans le relais à ce jour).
- **Clé de production.** **Indispensable**, avec un worker de collecte
  planifié.
- **Effort / priorité.** L · **P3** : beaucoup d'effort pour une info que
  des sites spécialisés donnent déjà ; à garder pour plus tard.

---

## Tableau récapitulatif

| # | Fonctionnalité | Où (Équipe & staff) | Données | Clé prod. | Effort | Priorité |
|---|---|---|---|---|---|---|
| 1 | Journal des drafts | Coaching → Draft | match-v5 en cache + table à créer | Non | M | P1 |
| 2 | Objectifs et rythme | Stats collectives → Objectifs | timelines (relais OK), extraction à écrire | Non | M | P1 |
| 3 | Dossier adverse | Coaching → Scouting | scouting + menaces existants | Conseillée | M | P1 |
| 4 | Carte des morts / kills | Review VOD, Stats collectives | positions des kills (timeline) | Non | M | P2 |
| 5 | Rapport de période | Coaching → Rapport hebdo | `reportCore` (tournoi déjà géré) | Non | S | P1 |
| 6 | Bibliothèque de situations | Coaching → Review VOD | commentaires VOD + tag à ajouter | Non | S-M | P2 |
| 7 | Benchmarks de lane 10 / 15 | Stats par game, Joueurs | duels + frames de timeline | Non | S-M | P2 |
| 8 | Objectifs mesurés | Sessions d'équipe | objectifs + § 2 / § 7 | Non | M | P2 |
| 9 | Fiches de match | Planning + bot Discord | planning, annonces, bot | Non | S-M | P2 |
| 10 | Veille méta | nouvelle page | collecte massive à créer | Indispensable | L | P3 |

Plusieurs fonctionnalités partagent la même brique : **l'extraction
d'équipe des timelines** (objectifs, frames d'or, positions des kills). Elle
sert aux § 2, 4, 7 et 8 ; la construire une fois rend les suivantes moins
chères.

## Top 3 recommandé

1. **Objectifs et rythme de jeu (§ 2).** C'est la question n° 1 d'un
   analyste. Les données sont déjà accessibles via le relais, et la brique
   d'extraction des timelines débloque ensuite les § 4, 7 et 8.
2. **Journal des drafts (§ 1).** Ce que les équipes notent aujourd'hui dans
   des tableurs. Peu de dépendances, valeur immédiate en scrim et en
   tournoi.
3. **Dossier adverse (§ 3).** Il assemble le scouting existant en un
   livrable concret avant chaque match. Il fonctionne en mode réduit avec la
   clé personnelle et devient complet avec la clé de production (#42).

**Gain rapide** à glisser à côté : le rapport de période (§ 5, effort S).
Il termine E9 et sert de vitrine aux trois autres.
