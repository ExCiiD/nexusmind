# Stats collectives d'une session d'équipe (spec Front-end)

Décision du 27/11 (`docs/DECISIONS.md`) : des stats **collectives** en plus des
fiches individuelles, en tête de la session d'équipe, calculées depuis les
timelines déjà chargées (zéro requête Riot en plus). Les chiffres viennent du
Back-end (fonctions pures `src/lib/*Core.ts`). Ce document dit où va le bloc,
de quoi il est fait et ses états.

Maquette Penpot : page **« Session d'équipe — Stats collectives »** (frames
listées au § 7). Les chiffres des maquettes sont des exemples.

## 1. Place dans la page

`TeamSessionHistoryView` (session terminée, `/team-session/:calendarEventId`),
dans cet ordre :

1. en-tête, onglets, **filtre par game** (`GameFilter`, inchangé) ;
2. **nouveau bloc « Stats collectives »** ;
3. bloc 1 « Stats d'équipe » (`TeamStatsBlock`) **sans la tuile « Écart d'or
   à 15 min »**, qui passe dans le nouveau bloc (pas de chiffre en double) ;
4. bloc 2 « Stats individuelles », objectifs de la session, notes et reviews
   (inchangés).

Session **en cours** (`TeamSessionPage`) : même bloc, affiché dès la première
game terminée et mis à jour après chaque game (proposition, à confirmer par le
Chief ; rien ne s'affiche pendant une game, promesse du site).

Le bloc suit le filtre par game : « Toute la session » = agrégat, « G2 » = la
game seule (§ 4).

## 2. Lecture en 5 secondes : la bande de tête

Panneau `dark`, contour `border-dim`, rayon 8, padding 16. Titre mono caps or
**« STATS COLLECTIVES »**, à droite en mono `text-dim` : « 4 games · 3 V – 1 D ·
Bleu 2–0 · Rouge 1–1 ».

**Trois tuiles héros** (grille 3 colonnes, gap 12 ; tuile `black/40`, contour
`border-dim`, rayon 8, padding 16) :

| Tuile | Valeur (mono 32 gras) | Pied (mono 11) |
|---|---|---|
| **Contrôle des objectifs** | part des objectifs neutres pris par nous (drakes + grubs + herald + baron + elder) : « 64 % » | « nous 23 · eux 13 » + barre bicolore nous (gold plein) / eux (contour `red`) |
| **Or à 15 min** | écart d'or moyen nous − eux (`goldLead.at15`) : « +1 420 » (vert / rouge, signe toujours écrit) | « **1 / 3 perdue en menant** » (`lostWhileAhead` : avance ≥ 1 500 à 15:00 puis défaite ; en rouge si ≥ 1) |
| **Fights → objectif** | `conversion.rate` : fights gagnés (≥ 2 kills nets en 20 s) suivis d'un objectif en 90 s : « 71 % » | « 10 / 14 fights convertis » |

Couleur des taux : échelle unique de winrate (`DESIGN_STATE.md` § 9). Moins de
5 games dans l'agrégat : valeur en `text-dim` + « échantillon faible ».

Pas de phrase « À retenir » générée : le contrat du Back n'en fournit pas, et
les trois tuiles suffisent pour la lecture en 5 secondes.

## 3. Le détail : sections repliées

Sous la bande, **7 sections en accordéon, toutes fermées par défaut** (retour
de l'utilisateur sur les listes trop longues). Chaque ligne fermée (hauteur 44,
séparateur 1 px `border-dim`) montre : chevron ▸, titre mono caps `text-bright`,
**résumé en une ligne** à droite (mono `text-dim`, chiffres clés colorés). Ainsi
le bloc fermé se lit déjà. Plusieurs sections peuvent être ouvertes ; l'état
ouvert se garde par utilisateur (`localStorage`). Clavier : bouton
`aria-expanded`, Entrée / Espace.

Dans une section ouverte, toute liste montre **5 lignes puis « Afficher tout
(N) »** (outline or, petit).

| # | Section | Résumé fermé | Contenu ouvert |
|---|---|---|---|
| 1 | **Objectifs** / *Objectives* | « Drakes 9–4 · Grubs 8–4 · Baron 3–1 · Tours 31–18 » | tableau miroir : *Objectif · Nous (barre or vers la gauche) · Eux (barre contour rouge vers la droite)*, lignes Drakes, Grubs, Herald, Baron, Elder, Tours ; sous Drakes, puces par type (Infernal `fire`, Ocean `water`, Mountain `earth`, Cloud `air`, Hextech, Chemtech ; types connus seulement avec timeline) avec le compte de chaque côté. Puis rangée **Firsts** : 4 puces *First blood · First tower · First drake · First herald* « nous 3 / 4 » (en une game : « nous » ou « eux », `—` si inconnu). |
| 2 | **Avance en or** / *Gold lead* | « +620 @10 · +1 420 @15 · +2 100 @20 · 1 perdue en menant » | 3 valeurs @10 / @15 / @20 (moyenne, mini-courbe à 3 points), puis une ligne par game (G1…Gn × @10 / @15 / @20, V / D ; 5 lignes puis « Afficher tout »). Les games **perdues en menant** (≥ 1 500 à 15:00 puis défaite) portent la pastille rouge « PERDUE EN MENANT » et un bouton **Revoir** (VOD à 15:00). |
| 3 | **Fights → objectif** / *Fight → objective* | « 10 / 14 convertis · 71 % » | répartition de ce qui suit le fight (Drake 4 · Tour 3 · Baron 2 · Herald 1), puis la liste des fights gagnés (`items`), **non convertis en premier** : horloge, G, « +3 kills », puis « → Drake en 42 s » (vert) ou « rien pris en 90 s » (rouge), Revoir. |
| 4 | **Préparation des objectifs** / *Objective setup* | « 7 / 11 pris · 3,2 wards en moyenne dans les 60 s avant » | une ligne par drake / herald / baron : horloge, G, objectif, **nos wards dans les 60 s avant** (nombre + mini-jauge or), pastille résultat *Pris* (vert) / *Perdu* (rouge) / *Contesté* (or). Pied : « pris avec ≥ 3 wards : 6 / 7 · avec < 3 : 1 / 4 » (calcul Front sur `setup[]`). `setup` nul pour une game ancienne : état « non disponible » (§ 5). |
| 5 | **Morts** / *Deaths* | « 23 morts · 9 isolées · 7 après 25′ » | matrice 3 × 3 : lignes *Isolées · Groupées · Position inconnue* (`text-dim`), colonnes *0–14′ · 14–25′ · 25′+* ; case = nombre, fond `red` à 10 / 20 / 30 % selon le poids (le chiffre est toujours écrit ; la ligne « inconnue » sans fond). Le détail par joueur reste dans la fiche individuelle. |
| 6 | **Kill participation** | « équipe 58 % · plus gros écart : Lumi −14 pts » | 5 lignes (rôle, joueur, barre KP, valeur, **écart à la moyenne de l'équipe** « +6 pts » vert / « −14 pts » rouge). Pas d'« Afficher tout » (5 lignes). |
| 7 | **Winrate par côté et par durée** / *Win rate by side and duration* | « Bleu 2–0 · Rouge 1–1 » | deux groupes de lignes : *Côté bleu · Côté rouge* et *< 25′ · 25–35′ · > 35′* ; colonnes games, V–D, winrate (échelle § 9). |

Couleurs : nous = `gold` plein, eux = contour `red` (jamais la couleur seule :
libellé « nous / eux » ou position gauche / droite). Côtés : point de 8 px +
le mot « Bleu » / « Rouge » ; le bleu est **nouveau** (`#6C9BD2`, le token
`blue` du thème est un brun) : à ajouter comme `--side-blue` (Graphic Design),
le rouge reprend `red`. Jargon LoL en
anglais (first blood, grubs, herald, baron, elder, drake, wards).

## 4. Vue d'une game (`?game=2`)

- Bande de tête : les valeurs de la game ; tuile 1 « 78 % · nous 7 · eux 2 »,
  tuile 2 l'écart à 15′ de la game (+ « perdue en menant » s'il y a lieu),
  tuile 3 « 3 / 4 » (taux en pied) ; à droite : « G2 · Côté rouge ·
  31:12 · Défaite ».
- Section 1 : firsts en « nous » / « eux ».
- Section 2 : les 3 valeurs @10 / @15 / @20 de la game en barres (au-dessus /
  au-dessous de la ligne 0) ; pastille « PERDUE EN MENANT » si c'est le cas. Pas
  de courbe minute par minute (le contrat ne la donne pas ; elle reste dans la
  fiche joueur).
- Sections 3 à 6 : mêmes contenus, filtrés sur la game.
- Section 7 : **masquée** (un taux sur une game ne veut rien dire).

## 5. États

| État | Rendu |
|---|---|
| **Chargement** | 3 tuiles squelette + 7 lignes repliées squelette ; bandeau « Lecture des timelines : 2 / 4 » avec barre (gabarit § 7). |
| **Une seule game** | Le bloc montre la game ; pas de « moyenne », pas de section 7 ; mention « échantillon faible » sur les tuiles. |
| **Préparation non disponible** (`setup` nul : game ancienne) | section 4 : ligne fermée « non disponible pour cette game » ; ouverte : `WhyEmpty` « Les wards ne sont pas lues pour les games anciennes. » sans bouton. En session : ces games sont exclues du compte, note « 2 games sans données de vision ». |
| **Beaucoup de games** (≥ 6, journée de tournoi ou bloc de scrims) | même mise en page ; les listes restent coupées à 5 + « Afficher tout (N) » ; le tableau par game de la section 2 aussi. Le `GameFilter` défile à l'horizontale au-delà de 8 (règle existante). |
| **Sans timeline** (une partie ou toutes les games) | ce qui vient du **match** reste affiché : objectifs pris (match-v5 `teams[].objectives`, firsts compris), KP, winrate par côté et durée. Ce qui demande la **timeline** (types de drakes, or @10/15/20, fights → objectif, préparation, morts) : « — » et `WhyEmpty` « La timeline de cette game n'est pas encore extraite » + **« Extraire la timeline »**. Si seulement certaines games n'en ont pas : bandeau partiel « 2 games sans timeline : exclues des sections Or, Fights, Préparation et Morts ». |
| **Aucune game** | le bloc n'est pas affiché (la page dit déjà « Aucune game enregistrée »). |
| **Erreur** | gabarit d'erreur § 7, cause en clair, « Réessayer » ; le reste de la page reste consultable. |

## 6. Largeur étroite (web app, < 640 px)

- Titre du bloc et ligne méta sur deux lignes.
- Tuiles héros empilées en 1 colonne, compactes (padding 12 / 14, valeur 24) ;
  pied raccourci (« moy. · 1 / 2 perdue en menant »).
- Résumé des sections fermées passé **sous** le titre (2 lignes max, tronqué).
- Section 1 : tableau miroir gardé (barres plus courtes), puces des drakes en
  retour à la ligne. Section 2 : le tableau par game devient une liste de
  cartes (G2 · +1 900 @15). Section 4 : chaque objectif = une carte de 2 lignes.
  Section 5 : la matrice garde 3 colonnes (cases 64 px).
- Aucun défilement horizontal de la page.

Pas de variante claire : l'app n'a que des thèmes sombres (8 thèmes) ; la
maquette est vérifiée sur Hextech Gold.

## 7. Frames Penpot

Page « Session d'équipe — Stats collectives » :

| Frame | Contenu |
|---|---|
| **SC · A** (0, 0) | Page complète, toute la session (4 games), bloc fermé : bande de tête + 7 sections repliées, blocs existants estompés dessous |
| **SC · A2** (1460, 0) | Bloc seul, sections 1 Objectifs, 4 Préparation, 5 Morts ouvertes |
| **SC · A3** (2720, 0) | Bloc seul, sections 2 Or, 3 Fights, 6 KP, 7 Winrate ouvertes |
| **SC · B** (0, 1100) | Page complète, vue G2 (défaite perdue en menant) : sections 1, 2, 4 ouvertes, section 7 absente |
| **SC · C** (1460, 1700) | États : 1 chargement · 2 sans timeline · 3 partiel + préparation non disponible · 4 session d'une seule game · 5 erreur |
| **SC · N** (2720, 1700) | Largeur 375 px : bloc, section 1 ouverte, filtre par game qui défile |

## 8. Textes FR / EN

« Stats collectives » / « Team stats » ; « Contrôle des objectifs » /
« Objective control » ; « Or à 15 min » / « Gold at 15 min » ; « Fights →
objectif » / « Fights → objective » ; « fights convertis » / « fights
converted » ; « perdue en menant » / « lost while ahead » ; « devant à 15′ » /
« ahead at 15′ » ; « Afficher tout (N) » /
« Show all (N) » ; « Objectifs » / « Objectives » ; « Avance en or » /
« Gold lead » ; « Préparation des objectifs » / « Objective setup » ; « wards
dans les 60 s avant » / « wards in the 60 s before » ; « Pris » / « Taken » ;
« Perdu » / « Lost » ; « Contesté » / « Contested » ; « non disponible pour
cette game » / « not available for this game » ; « perdue en menant » (pastille)
/ « lost while ahead » ; « Morts » / « Deaths » ; « Isolées »
/ « Isolated » ; « Groupées » / « Grouped » ; « Kill participation » (identique)
; « écart à l'équipe » / « gap to team » ; « Winrate par côté et par durée » /
« Win rate by side and duration » ; « Côté bleu / rouge » / « Blue / Red
side » ; « nous / eux » / « us / them » ; « échantillon faible » / « small
sample » ; « Extraire la timeline » / « Extract the timeline » ; « 2 games
sans timeline » / « 2 games without a timeline » ; « Revoir » / « Review ».

## 9. Ce que le Front doit lire (contrat du Back, validé par le Chief le 27/11)

Par game : `win`, `durationSec`, `side` (blue / red), `timeline`
(`'ready' | 'no-timeline'`). Session : `games`, `gamesWithTimeline`,
`bySide` {blue, red : {games, wins}}, `byDuration` {lt25, m25to35, gt35 :
{games, wins}}.

| Section | Champ | Sans timeline |
|---|---|---|
| Tuile 1, section 1 | `objectives` : dragons {ours, theirs, byType fire / water / earth / air / hextech / chemtech}, grubs, herald, baron, elder, towers nous / eux ; `firsts` blood / tower / dragon / herald = us · them · null | toujours là (types de drakes : « — ») |
| Tuile 2, section 2 | `goldLead` at10 / at15 / at20, `lostWhileAhead` (session : perdues en menant / games devant) | null → « — » |
| Tuile 3, section 3 | `conversion` fightsWon, converted, rate, items [{atSec, kills, objective · null, delaySec}] | « — » |
| Section 4 | `setup` : nos wards 60 s avant chaque drake / baron / herald, outcome taken · lost · contested | null → « non disponible » |
| Section 5 | `deaths` par phase 0-14 / 14-25 / 25+ {isolated, grouped, unknown} | « — » |
| Section 6 | `kp` par joueur + écart à la moyenne (pts) | toujours là |
| Section 7 | `bySide`, `byDuration` | toujours là |

Une valeur inconnue s'affiche « — », jamais 0.

Points ouverts : (1) bloc aussi sur la session en cours (§ 1) ; (2) seuil de
« pris avec ≥ 3 wards » au pied de la section 4 (proposé, à valider avec le
coach).

---

## Addendum (27/11) : prio, crossmap et duo botlane, chiffres seulement

Source : rapport Engine `docs/moteur/engine-reports/2026-11-27-prio-crossmap-duo.md`
§ 4.1 et § 4.2 (phase 1 : aucun tag, aucune erreur au Labo). Données : `RuleCounts`
(`src/lib/objectiveRuleFigures.ts`), sur `PlayerGameStats.objectiveRules`,
`total.objectiveRules`, `GameCollective.rules`, `SessionCollective.rules`.
`null` sans timeline. Maquettes : page Penpot « Prio, crossmap & duo — chiffres »,
exports dans `docs/design/objective-rules/`.

### A.1 Deux marques de confiance, partout pareilles

| Marque | Sens | Champ | Rendu |
|---|---|---|---|
| (rien) | prio **sûre** : plaque ou tour prise, vis-à-vis mort ou en base, laner près de la tour adverse (P1-P3) | `oursProven` | or plein |
| **≈** | prio **estimée** : positions aux relevés de minute ou CS (P4-P5) | `ours − oursProven` | or à 40 % ; légende « ≈ 1 estimée » |
| **?** | **inconnue** : laner mort, en base ou hors de sa lane, objectif pris trop vite | `unknown` | segment vide en pointillés ; légende « 1 ? inconnue » |

Chaque carte porte la pastille « EN PARTIE ESTIMÉ » dans son en-tête, et une
note de pied qui dit comment la prio est lue : au climax de la dernière wave,
≈ 30 s avant l'objectif, jusqu'à 20:00. La barre de prio a toujours le même
ordre : sûre · estimée · égal · eux · inconnue. « Égal » est en texte gris, « eux »
en rouge contour (même code que nous / eux de la section 1).

Point de vocabulaire à trancher : le rapport appelle « prio probable » ce que le
contrat range en `suggested` (P4-P5). De plus, `oursProven` compte `proven` +
`probable` (P1-P3). Pour éviter « probable » dans deux sens, l'interface dit
**sûre** pour P1-P3 et **estimée (≈)** pour P4-P5.

### A.2 Fiche joueur (stats de session) : une carte « Prio, crossmap & duo »

Place : colonne de droite, **juste sous « Participation aux objectifs »** et
avant « Jeu en isolement & phases ». Même largeur et même style de carte. La
liste d'objectifs de « Participation aux objectifs » gagne deux pastilles par
ligne (§ 4.1 du rapport) : « prio nous / eux / ? » et, pour un objectif pris
par eux, « crossmap ✓ / ✗ ».

Contenu selon le rôle (frame OR · P). Le chiffre mis en avant sort de la case
noire en tête de carte.

| Rôle | Chiffre mis en avant | Dessous |
|---|---|---|
| ADC | prio de ta lane avant les Dragons (`prio.own`, lane BOT) + barre | duo : tableau « tes morts quand ton support est loin », avant / après 14:00 × faute support / ADC / partagée / aucune (`duo.*.adcDeaths`) ; avancées sans support (`advances`, `advancesDied`) ; crossmap de l'équipe pour info, non jugé |
| Top | prio de ta lane avant Grubs, Herald, Baron (`prio.own`, lane TOP) + barre | crossmap de l'équipe pour info, non jugé |
| Mid | prio mid avant les objectifs (`prio.own`, lane MID) + barre | ton crossmap avant / après 14:00 (`crossed / judged`) + ressources |
| Jungle | objectifs engagés avec prio (`sidePrio + midPrioOnly` / `engaged`), détail prio du côté / mid seule / sans prio (et pris quand même) | engagés du côté perdant (`wrongSide`, `wrongSideLost`) ; ton crossmap avant / après 14:00 ; justifiés ; ressources |
| Support | aide à la prio (`support.helped / total`) | duo : morts de ton ADC et les tiennes (`adcDeaths`, `supDeaths`) ; ton crossmap ; ressources |

Couleurs du tableau du duo : la colonne qui désigne le joueur affiché passe en
rouge quand elle est > 0 (faute support pour le support, faute ADC pour l'ADC).
Les autres valeurs restent en texte clair, 0 en gris. Ressources : pastilles
« objectif opposé · plaques · tours · kills · invade · numbers » = nombre
d'objectifs lâchés où on en a pris (pas un total de plaques).

En session d'équipe, le chiffre mis en avant du top et de l'ADC est séparé
soloQ / équipe quand la session mélange les deux (décision 8 du rapport) : deux
valeurs côte à côte, « équipe » en premier.

### A.3 Bloc Stats collectives : section 8 « Prio, crossmap & duo »

Nouvelle section repliée, après « Winrate par côté et par durée », dans le même
accordéon (frame OR · S). Résumé fermé :
« prio du côté 58 % · crossmap 4 / 7 · duo : 3 morts ADC ».

Ouverte, 4 sous-parties :
1. **Prio au climax, par objectif** : tableau Drakes / Grubs / Herald / Baron /
   Elder × (lane du côté, mid). Chaque cellule = barre de prio + « 4 / 6 »
   (`byKind[k].side`, `.mid`, `n`). Légende sous le tableau.
2. **Jungle : objectifs engagés** : avec prio du côté · mid seule · sans prio
   (dont pris) · côté perdant (dont perdus) (`prio.jungle`).
3. **Objectifs pris par eux** : pris par eux · contestés · non contestés →
   crossmap · sans rien · justifiés, en deux colonnes avant / après 14:00
   (`crossmap.before14`, `after14`) + pastilles de ressources.
4. **Duo botlane** : tableau du duo (morts de l'ADC, du support) avant / après
   14:00 × faute, puis avancées de l'ADC sans support.

Vue d'une game (`?game=N`) : mêmes sous-parties, avec les nombres de la game
(`GameCollective.rules`). La sous-partie 1 devient une liste d'objectifs à
l'heure près : « 9:20 Drake · bot : nous · mid : ≈ nous ».

### A.4 États

| Cas | Fiche joueur | Section 8 |
|---|---|---|
| aucune timeline | carte avec WhyEmpty « Ces chiffres demandent la timeline de la game. Aucune game de la session n'en a. » | titre grisé, résumé « timeline nécessaire », ne s'ouvre pas |
| timeline partielle | chiffres + note or « Sur 1 game sur 2 avec timeline (G2 sans). » | idem en pied de section |
| rien à lire (aucun objectif du côté avant 20:00, aucun objectif lâché) | « — » et une phrase qui dit pourquoi | ligne concernée « — » |
| une valeur `null` | « — », jamais 0 | idem |
| 1 game | pas de marque spéciale (ce sont des comptes, pas des taux) ; les % restent affichés | idem |

### A.5 Textes FR / EN

| FR | EN |
|---|---|
| Prio, crossmap & duo | Prio, crossmap & duo |
| EN PARTIE ESTIMÉ | PARTLY ESTIMATED |
| sûre · ≈ estimée · égal · eux · ? inconnue | sure · ≈ estimated · even · theirs · ? unknown |
| Prio de ta lane avant les Dragons | Your lane's prio before Dragons |
| Prio mid avant les objectifs | Mid prio before objectives |
| Objectifs engagés avec prio | Objectives started with prio |
| Engagés du côté perdant | Started on the losing side |
| Aide à la prio avant les objectifs | Helped get prio before objectives |
| Tu as crossé | You crossed |
| Justifiés (on ne pouvait pas jouer) | Justified (we couldn't play it) |
| Duo botlane — tes morts quand ton support est loin | Bot duo — your deaths while your support was away |
| Faute support · Faute ADC · Partagée · Aucune | Support's fault · ADC's fault · Shared · None |
| Avancées sans ton support | Pushed up without your support |
| Prio lue au climax de la dernière wave (≈ 30 s avant), jusqu'à 20:00. | Prio read at the last wave's climax (≈ 30 s before), until 20:00. |

Points ouverts : (A) vocabulaire sûre / estimée (§ A.1) ; (B) split soloQ /
équipe du chiffre mis en avant : le contrat ne le porte pas encore (`RuleCounts`
n'a pas de file de jeu) ; (C) ligne « Late game (après 20:00) » du § 4.1 du
rapport : pas dans `RuleCounts`, non maquettée.

### A.6 Frames Penpot (page « Prio, crossmap & duo — chiffres »)

| Frame | Contenu | Export |
|---|---|---|
| OR · P — Fiche joueur, carte par rôle | ADC, support, jungle, mid, top ; états sans timeline / partielle / rien à lire | `docs/design/objective-rules/P-fiche-joueur-par-role.png` |
| OR · S — Stats collectives, section 8 ouverte | sections 1-7 fermées, section 8 ouverte (prio par objectif, jungle, pris par eux, duo) | `docs/design/objective-rules/S-stats-collectives-section8.png` |
| OR · L — Placement + pastilles de la liste | carte sous « Participation aux objectifs », pastilles « prio » et « crossmap » | `docs/design/objective-rules/L-placement-pastilles.png` |
