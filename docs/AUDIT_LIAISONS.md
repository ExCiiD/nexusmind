# Audit des liaisons entre sections et des onglets selon le rôle

> Session **Audit**, 21/11/2026, en lecture seule (code du dépôt). Demande de l'utilisateur, via le Chief.
> Décisions appliquées (`docs/DECISIONS.md`, 20/11) :
> - les sections forment un tout, **sans forcer** une liaison inutile (un joueur peut jouer seul) ;
> - onglets selon le rôle : masquer ou fusionner les pages presque vides, **sauf celles qui se remplissent avec le
>   temps** ;
> - dashboard Management d'un joueur limité à ce qu'il peut voir, avec ses dispos dans la page ;
> - « Mon plan » relié à Coaching › Joueurs et au Dashboard.
>
> Rôles du code (`src/lib/permissions.ts`) : `isLegacyStaff` = owner, coach, analyst (rôle principal ou rôle staff
> en plus, #39) ; le **manager n'est pas « staff »** au sens de ce prédicat ; le capitaine est un joueur avec
> `isCaptain`.

## En bref

1. **Six liaisons utiles manquent.** La plus visible est celle déjà connue : le plan de développement
   (Coaching › Joueurs) n'apparaît pas dans « Mon plan ». Il est affiché dans **Management › Vue d'ensemble**, une
   page qu'un joueur ouvre peu. Les objectifs attribués, les verdicts du coach sur les micro-reviews, les tâches et les
   prochains événements restent aussi enfermés dans la section Équipe.
2. **Un joueur sans groupe voit 5 entrées « Équipe & staff »** (Lobby, Management, Coaching, Stats collectives,
   Sessions d'équipe), toutes vides (« Pas de groupe »). C'est le cas le plus net à simplifier : une seule entrée.
3. **Le manager est le rôle le plus mal servi.** S'il ne joue pas, sa Vue d'ensemble Management est presque vide :
   pas de tableau de bord du staff, pas de carte de joueur. Il n'a pas non plus Essais, Joueurs ni Rapports.
4. **Pour un joueur**, Management tient en un seul écran (ce que veut la décision). Scouting, en revanche, est un
   outil de staff qui lui est montré en entier.
5. **À ne pas fusionner, car ces pages se remplissent avec le temps :** Stats collectives (surtout Scrim et Tournoi),
   Sessions d'équipe, Review VOD, Tâches, Bien-être (historique), Lobby.

## 1. Liaisons entre sections

« Utile » : oui si la donnée sert au joueur là où il travaille, sans l'obliger à être en groupe. Quand elle n'existe
pas (pas de groupe, rien d'attribué), la carte ne s'affiche pas.

| # | De (où la donnée naît) | Vers (où elle manque) | Donnée | Aujourd'hui | Utile | Remarque |
|---|---|---|---|---|---|---|
| L1 | Coaching › **Joueurs** (staff) | Pratique › **Mon plan** et **Dashboard** | axe du plan de développement, notes du coach, période | seulement dans Management › Vue d'ensemble (`DevPlanCard` mode joueur, `ManagementPage.tsx:69`) | **Oui** (décision du 20/11) | Carte « Plan de mon coach » en tête de Mon plan, et un rappel compact au Dashboard. Invisible sans groupe. |
| L2 | Coaching › Joueurs / Sessions d'équipe | **Mon plan** et **Dashboard** | objectifs attribués à un joueur | Management › Vue d'ensemble, Pratique › **Session** (`SessionPage.tsx:774`, pré-sélection) et accueil web | **Oui** | La Session les a déjà (bien) ; il manque Mon plan, qui liste les objectifs de la semaine, et le Dashboard. |
| L3 | Coaching (verdicts du staff sur les micro-reviews) | Pratique › **Revue** / Analyse › **Labo d'erreurs** | verdicts du coach sur mes réponses (`MyMicroVerdictsCard`) | seulement Management › Vue d'ensemble | **Oui** | Ce sont des retours sur une partie précise : leur place est sur la revue de cette partie, avec un compteur au Dashboard. |
| L4 | Management › **Tâches** | **Dashboard** (et la cloche) | tâches qui me sont attribuées, à faire | seulement Management › Tâches | **Oui**, si un groupe existe | Une ligne « 2 tâches à faire » au Dashboard. Notifications : à vérifier côté serveur. |
| L5 | Management › **Planning** | **Dashboard** | prochain événement (scrim, réunion), ma réponse de présence | bannière seulement pour une session **en direct** (`TeamSessionBanner`) | **Oui** | « Prochain : Scrim vs KCA mardi 19:00 · Je serai là ? ». Sans groupe : rien. |
| L6 | Coaching › **Review VOD** | **Mon plan** | actions à travailler issues d'une review VOD (`vod_review_action_items`) | seulement dans le détail de la session VOD | **Oui** | Ce sont des objectifs concrets donnés par le coach, à mettre à côté de L1 et L2. |
| L7 | Management › **Bien-être** | Pratique › **Session** (début) | check-in rapide énergie / humeur / sommeil | onglet Bien-être seulement | **Moyen** | Le proposer au lancement d'une session si le joueur a donné son accord bien-être ; jamais obligatoire. |
| L8 | Coaching › **Rapports** (hebdo) | joueur | rapport de la semaine | staff seulement | **Non** pour l'instant | Rapport de staff. Le partager reste une décision de l'utilisateur. |
| L9 | Pratique / Analyse (stats perso, Labo) | Coaching › Joueurs | stats et erreurs du joueur | **existe** (lecture synchronisée selon le partage du joueur) | — | Déjà relié, en respectant le partage. |
| L10 | Profil (récompenses MVP, Grinder, look) | Lobby (cartes) | carte joueur | **existe** | — | Déjà relié. |
| L11 | Stats collectives | Stats perso | comparaison « moi en Flex d'équipe » / « moi en SoloQ » | absent | **Non** (pour l'instant) | Liaison forcée : les stats perso suffisent. À revoir si les joueurs le demandent. |
| L12 | Draft Sim (préparation du coach) | Session d'équipe / panneau du scrim | draft préparée pour ce scrim | **existe** (drafts liées au scrim, #49) | — | Déjà relié. Préparer les sessions à l'avance relève d'une autre décision du 20/11. |

**Priorité :** L1 et L2 (décision), puis L3, L5, L4, L6. L7 est optionnelle, L8 et L11 sont à ne pas faire.

## 2. Onglets visibles selon le rôle, et ce qu'ils contiennent

Légende du contenu :
- **∅** : vide ou simple message ;
- **1-2** : un ou deux blocs ;
- **riche** : contenu complet ;
- **↗** : se remplit avec le temps, à ne pas fusionner.

« Joueur » vaut aussi pour le capitaine ; ses différences sont signalées.

### Management (`/management`)

| Onglet | Owner / coach / analyst | Manager (ne joue pas) | Joueur / capitaine | Sans groupe |
|---|---|---|---|---|
| Vue d'ensemble | **riche** : tableau de bord du staff ; plus les cartes de joueur si `alsoPlays` | **∅ presque** : ni tableau de bord du staff ni cartes de joueur (`isLegacyStaff` faux, `playsInGroup` faux) | **1-2 ↗** : objectifs attribués, verdicts du coach, plan de développement (vides au début) | **∅** : « Pas de groupe » + 2 cartes vides |
| Planning | **riche** | **riche** (il édite le calendrier) | **riche** ; le capitaine édite | caché |
| Bien-être | **riche** (vue d'équipe si `canReadWellbeing`) + mon check-in | **1-2** : mon check-in seulement (rôle principal autre que joueur, mais pas staff) | **1-2 ↗** : check-in et historique | caché |
| Tâches | **riche** (créer, assigner, tout voir) | **1-2 ↗** (tâches reçues) | **1-2 ↗** (tâches reçues, souvent vide au début) | caché |
| Essais | **riche** | caché | caché | caché |
| Groupes | **riche** (membres, rôles, invitations, Discord) | **1-2** (+ Discord pour le manager) | **1-2** (rejoindre, partage) | **1-2** (créer ou rejoindre) |

### Lobby d'équipe (`/team-space`)

| | Owner / coach / analyst | Manager | Joueur / capitaine | Sans groupe |
|---|---|---|---|---|
| Page unique (cartes du roster, look, lien roster, export LFT) | **riche** (publie le roster) | **riche** | **riche** (sa carte, son skin) | **∅** « Pas de groupe » |

### Coaching (`/coaching`)

| Onglet | Owner / coach / analyst | Manager | Joueur / capitaine | Sans groupe |
|---|---|---|---|---|
| Champion Pool | **riche** | **riche** | **riche** (son pool et celui de l'équipe) | caché |
| Draft Sim (+ Journal, #40) | **riche** | **riche** | **riche**, mais c'est un outil de préparation : le Journal est en lecture seule | caché |
| Scouting (+ Dossier) | **riche** | **riche** | **riche** mais **outil de staff** : rien n'empêche un joueur de scouter (copie locale), et les dossiers publiés suffisent au joueur | caché |
| Joueurs | **riche** | caché | caché | caché |
| Review VOD | **riche** (créer, assigner) | **1-2 ↗** | **1-2 ↗** (sessions où il est) | caché |
| Rapports | **riche ↗** | caché | caché | caché |
| *(page sans aucun onglet)* | — | — | — | **∅** : « Pas de groupe », 0 onglet |

### Stats collectives (`/team`)

| Onglet | Tous les membres du groupe | Sans groupe |
|---|---|---|
| Dashboard, Stats Flex | **riche ↗** | **∅** |
| Stats Scrim, Stats Tournoi | **∅ au début, riche ↗** (importations, codes de tournoi plus tard) | **∅** |
| Objectifs (#40) | **riche ↗** (timelines des parties d'équipe) | **∅** |

### Sessions d'équipe (`/team-sessions`)

| | Tous les membres | Sans groupe |
|---|---|---|
| Historique des sessions | **↗** (vide au début, s'enrichit à chaque session) | **∅** |

## 3. Propositions par rôle

Pour chaque élément : **garder**, **masquer** ou **fusionner** (dans le dashboard du rôle).

### Joueur sans groupe

- **Masquer** les 5 entrées « Équipe & staff » de la barre latérale, et n'en garder **qu'une** : « Équipe » ou « Lobby
  d'équipe ». Elle ouvre une page « Rejoindre ou créer un groupe » (le contenu de Management › Groupes) et propose
  l'**annonce LFT** (le joueur cherche une équipe).
- Coaching, Stats collectives, Sessions d'équipe et Management : masqués tant qu'il n'y a pas de groupe. Aujourd'hui,
  on y arrive sur « Pas de groupe », et Coaching n'a même aucun onglet.
- Pratique et Analyse : inchangés. Aucune carte d'équipe (L1-L6) ne s'affiche sans groupe.

### Joueur et capitaine

- **Management** : **fusionner** Vue d'ensemble, Bien-être (mon check-in), Tâches (les miennes) et les annonces en
  **un seul dashboard joueur**, avec **mes dispos dans la page** (décision du 20/11). Garder **Planning** comme onglet
  (riche ; le capitaine l'édite). **Groupes** : le garder, mais le placer en bout de liste ou le réduire à un lien
  (rejoindre, partage).
- **Coaching** :
  - **garder** Champion Pool, Draft Sim (avec le Journal en lecture seule) et Review VOD (↗) ;
  - **masquer Scouting** pour un joueur non staff, ou le réduire aux **dossiers publiés** (§ 12, lecture seule). Un
    joueur qui scoute dans une copie locale ne sert pas l'équipe.
- **Stats collectives** et **Sessions d'équipe** : **garder** (↗). **Ne pas masquer** Stats Scrim ou Tournoi quand
  elles sont vides : un état vide qui explique comment elles se remplissent suffit.
- **Lobby** : garder.
- **Liaisons** : L1, L2, L6 dans Mon plan ; L3 sur la Revue ; L4 et L5 au Dashboard.

### Manager (ne joue pas)

- **Management** : la Vue d'ensemble est presque vide. Lui donner un **dashboard d'organisation** : prochains
  événements et présence (absences à venir), tâches ouvertes du groupe, annonces, remplaçants. C'est son métier, pris
  dans le tableau de bord du staff, **sans** les données de jeu ni le bien-être (qui lui sont fermés). Sinon, ouvrir
  directement sur Planning.
- Bien-être : il n'y a que son propre check-in. **Masquer** l'onglet s'il ne joue pas, ou le fusionner dans son
  dashboard.
- Coaching : **garder** Champion Pool, Draft Sim et Scouting (il complète des adversaires, #49) ; Review VOD (↗).
- Le reste est à garder.

### Coach, owner, analyst

- **Garder tout.** Ce sont eux qui remplissent les pages ; Rapports, Joueurs et Essais sont riches pour eux.
- **Owner qui ne joue pas** : les cartes de joueur sont déjà masquées dans sa Vue d'ensemble (`playsInGroup`).
  Rien à changer.
- **Analyste** : il voit Joueurs et Rapports (`isLegacyStaff`), ce qui est cohérent avec son rôle.

### Pages à ne jamais fusionner ni masquer pour vide

Stats collectives (tous ses onglets), Sessions d'équipe, Review VOD, Tâches, l'historique du Bien-être, Rapports et
Lobby. Toutes se remplissent avec le temps. Elles ont besoin d'un **état vide explicite** (« Ce qui apparaîtra ici,
et comment »), pas d'être cachées.

## 4. Points à confirmer avec l'utilisateur

1. Scouting pour un joueur : **masqué**, ou réduit aux **dossiers publiés** ?
2. Manager : **dashboard d'organisation**, ou ouverture directe sur Planning ?
3. Joueur sans groupe : une seule entrée « Équipe », avec rejoindre ou créer et l'annonce LFT ?
4. L7 (check-in bien-être proposé au lancement d'une session) : oui ou non ?

**Non vérifié :** le rendu réel de chaque rôle dans le harnais. Cette analyse vient du code (conditions `show`,
`isLegacyStaff`, `playsInGroup`, `canReadWellbeing`). Une passe dans le harnais avec chaque rôle est conseillée
avant les maquettes.
