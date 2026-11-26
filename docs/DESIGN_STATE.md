# État du design — Ascend (session Graphic Design)

Note du 19/11/2026. Inventaire en lecture seule : tokens du code, notes des
sessions design du 18/11, fichier Penpot. Aucune modification du code ni de
Penpot.

> **Penpot non vérifié aujourd'hui.** Le plugin MCP répond « onglet suspendu
> par le navigateur (pas de signal depuis 45 s) ». Ce qui suit sur Penpot vient
> des notes du 18/11 (dernière sauvegarde serveur connue : revn 74). À
> confirmer dès que l'onglet Penpot est au premier plan et connecté
> (Fichier → MCP Server → Connect).

## 1. Tokens dans le code (source de vérité)

- **Couleurs** : 17 variables `--hextech-*` dans `src/index.css`, lues par
  `tailwind.config.ts` via `color-mix` (les modificateurs `/20` marchent).
  Thème par défaut « Hextech Gold » = palette du site depuis le 18/11 :
  black #0D0A06 · dark #1C140C · elevated/panel #2A1D11 · border #6B5330 ·
  border-dim #3A2C18 · cyan (or pâle) #E4C285 · teal #6B5330 · gold #D4A24C ·
  gold-bright #F5E3BE · red #E24C3A · green #6FA84A · text #B5A68C ·
  text-bright #F5E3BE · text-dim #978769 · blue #241A10 · blue-bright #E8B86B.
  7 autres thèmes : piltover, noxus, ionia, shurima, freljord, zaun, void.
- **Polices** : Inter (texte), Big Shoulders Display 800 en capitales (tous
  les titres h1-h3 et `.font-display`), JetBrains Mono (chiffres, kickers).
  « Beaufort for LOL » n'est plus utilisée.
- **Rayons** : 8 px pour toutes les boîtes (`lg`…`3xl` = 0.5rem), 4 px pour
  les petites puces, `rounded-full` pour pilules et avatars.
- **Animations** : fade-in, slide-in, glow-pulse, xp-fill, animations des
  cartes joueurs (coupées par `prefers-reduced-motion`).
- **Assets** : `src/assets/brand/` (logo « A d'éclats »), `backgrounds/`
  (4 fonds), `cards/` (8 motifs SVG), `frames/`, `profile/`, `roles/`.
- **Composants de base** (`src/components/ui`) : button, badge, card, dialog,
  input, label, progress, select, slider, switch, tabs, textarea, toast,
  tooltip.

## 2. Ce qui est dans Penpot (notes du 18/11)

Fichier « Nouveau fichier 1 » :

| Page | Contenu |
|---|---|
| Design System | 17 couleurs hextech/*, 12 typographies ascend/*, composants Button ×4, Badge ×6, Tab, Tabs list, Input, Card, Panel, Stat tile ×3, Sidebar item ×2, 14 Icon/* |
| Dashboard (référence) | Dashboard 1440×1024 en instances, logo mis à jour |
| Vitrine — Accueil (FR) | Ancienne page d'accueil du site convertie du DOM |
| Vitrine v2 — Accueil / Entraînement solo / Environnement d'équipe | Maquettes du site actuel (visuels de l'app en placeholders) |
| Vitrine — Composants | Navbar (3 variantes), CTA final, Pied de page |
| Logo — propositions 1, 2 (incomplète), 3 · Logo — Ascend | Recherches et composants du logo retenu |

### Mise à jour du 19/11 (#15, revn 110)

- **Tokens Penpot** : set `ascend/core` (rayons chip 4 / box 8 / pill,
  espacements 4→48, taille des contrôles 36, sidebar 256, polices) et 8 sets
  `theme/*` (18 couleurs chacun, valeurs de `src/index.css` après #16).
  Groupe de thèmes « Thème » : Hextech Gold, Piltover, Noxus, Ionia,
  Shurima, Freljord, Zaun, Void — basculer de thème recolore les maquettes.
- **Liés aux tokens** : pages Design System, Dashboard (référence) et
  Équipe — Champion Pool v2 (fonds, contours, rayons 8 px). Les fonds
  translucides (badges, puces d'icône, toasts) gardent une valeur fixe :
  un token Penpot ne porte pas d'opacité, ils ne changent donc pas de thème.
- **Couleurs et typographies de bibliothèque** à jour (dont `border-field`) ;
  titres (Page title, Card title, Section title, Panel heading) en Big
  Shoulders 800 capitales ; boutons et sidebar restent en Inter.
- **Nouvelle section « Contrôles et états »** : boutons primaire / outline /
  destructif × défaut, survol, focus (anneau or 2 px décalé de 2 px),
  désactivé, chargement ; Input défaut / rempli / focus / erreur + message /
  désactivé ; Textarea ; Select fermé et ouvert ; Switch on / off / focus /
  désactivé (off avec contour `border-field`) ; Progress ; Slider ; Tooltip ;
  Toasts défaut / succès / erreur / info ; Dialog de confirmation.
- **Écart volontaire avec le code, à transmettre au Front-end** : les toasts
  succès / erreur / info ont une base opaque `dark` sous la teinte à 10 %
  (en translucide pur, ils deviennent illisibles sur un contenu clair).
  Ratios sur cette base : vert 5.6, rouge 4.9, or 6.7.

## 3. Ce qui manque ou a dérivé

1. ~~Design System en retard sur le code~~ — fait le 19/11 (#15).
2. ~~Pas de tokens Penpot~~ — fait le 19/11 (#15).
3. ~~États vides, squelettes, tableaux~~ — fait le 19/11 : section « États
   des données » du Design System (vide avec action suivante, erreur avec
   cause et « Réessayer », squelette des tuiles KPI, bandeau de
   synchronisation partielle, tableau Historique avec en-tête, survol, tri,
   chiffres en mono alignés à droite, troncature avec points de suspension).
   La carte Progression du Dashboard (référence) est masquée. Reste : les
   contrôles sont des maquettes, pas encore des composants Penpot à
   variantes.
4. **Fonds de cartes v2** (#8 relancé) : 21 propositions sur la page
   « Cartes joueurs — fonds » et planche de comparaison
   https://claude.ai/artifact/FT4WnKKyNbRhjV3XJKt5cA — en attente du choix
   de l'utilisateur (une lettre par famille).
4. **Écrans non maquettés** (19 pages dans `src/pages`) : seul le Dashboard
   existe. Manquent notamment Record, Review / micro-review, Stats,
   Coaching & Management (13 onglets), Stats collectives, Planning, Profil,
   Settings, Onboarding, Team Session.
5. ~~Tâche #8, page des fonds de cartes~~ — fait le 19/11 : page Penpot
   « Cartes joueurs — fonds » (7 motifs rendus comme la vignette du
   sélecteur, à partir des vrais SVG de `src/assets/cards/`, et les 6
   teintes du filtre couleur sur Topographie).
6. **Logo — propositions 2** incomplète (abandonnée volontairement).

## 4. Contrastes mesurés (WCAG 2.2, ratios sur `dark` / `elevated`)

| Thème | text-dim | gold | texte noir sur bouton gold | red sur elevated |
|---|---|---|---|---|
| défaut | 5.18 / 4.67 ✔ | 7.86 ✔ | 8.53 ✔ | 4.16 ✘ petit texte |
| piltover, ionia, shurima, freljord, zaun | 2.4 – 2.9 ✘ | ✔ | ✔ | ≈ 4.1 ✘ |
| noxus | 2.26 / 2.04 ✘ | 3.56 ✘ | 3.79 ✘ | 4.28 ✘ |
| void | 2.25 / 2.06 ✘ | 4.08 ✘ | 4.32 ✘ | 4.41 ✘ |

Bordures : `border-dim` ≈ 1.4 et `border` ≈ 2.5 sur `dark` (thème par
défaut) — sous les 3:1 demandés pour délimiter un champ ou un bouton.
Conclusion : `text-dim` est à remonter dans les 7 thèmes secondaires, le gold
de noxus et void à éclaircir, les champs de saisie doivent utiliser `border`
(ou plus clair), pas `border-dim`. Script : relancer un calcul de ratio sur
`src/index.css` après chaque changement de palette.

## 5. Règles UI/UX que j'applique

- **Contraste** : texte ≥ 4.5:1 (≥ 3:1 au-delà de 18 px gras / 24 px) ;
  contours de contrôles et icônes porteuses de sens ≥ 3:1 ; vérifié sur les
  8 thèmes, pas seulement le défaut. Jamais la couleur seule pour un état
  (victoire/défaite, erreur) : icône ou texte en plus.
- **Espacements** : grille de 4 px ; marges internes des boîtes 16 / 24 ;
  écarts entre sections 24 / 32 ; rayons 8 (boîtes) / 4 (puces) / plein
  (pilules). Hauteur des contrôles 36 px, cible cliquable ≥ 24 px (32 px
  visés pour les icônes seules).
- **États** : chaque composant interactif est maquetté en défaut, survol,
  focus clavier (anneau `ring` gold 2 px, visible sur tous les thèmes),
  actif, désactivé, chargement ; chaque écran de données en chargement,
  vide (avec action suivante), erreur (avec « Réessayer »), données partielles.
- **Responsive** : desktop Electron de 1280×720 à 2560 px (cible 1440) ;
  web app jusqu'à 375 px ; la sidebar (256 px) se replie sous 1024 px ;
  tableaux larges défilent dans leur boîte, jamais la page.
- **Longueur des textes FR / EN** : le français est ~20-30 % plus long ;
  chaque maquette est faite en FR (langue la plus longue), avec un test du
  libellé le plus long ; boutons sans largeur fixe, troncature avec info-bulle
  plutôt que retour à la ligne dans les tableaux. Titres condensés en
  capitales : au plus ~40 caractères.
- **Jargon LoL en anglais** dans les textes FR (shotcalling, spacing, trades,
  wave, gank, roam, cooldowns…).
- **Mouvement** : animations ≤ 300 ms pour l'interface, toutes coupées par
  `prefers-reduced-motion`.
- **Méthode** : composants Penpot liés aux tokens, écrans assemblés en
  instances, export vérifié côté serveur (`export_shape`) et `revn` contrôlé
  après chaque lot ; la spécification remise au Front-end liste tokens,
  tailles, états et textes FR/EN.

## 6. Spec Front-end — choix du skin de la carte (page Profil, #3)

Maquette Penpot : page « Profil — choix du skin » (Profil en mode édition).
Données : pack de détourage (`cutout-pack/manifest.json`, statut `ok` /
`refused` / `missing` par skin, `name` du skin) ; hébergement et IPC à
définir par le Back-end.

**Placement.** Nouveau panneau « Champion de la carte » en tête de la colonne
de réglages du Profil, visible en mode édition. La carte joueur de la colonne
de gauche (280 × 490) se met à jour en direct, légende « Aperçu en direct ·
<skin> ». Rien n'est envoyé avant « Enregistrer » ; « Annuler » revient au
choix précédent.

**Choix du champion.** Champ de recherche (contrôle Input, contour
`border-field`, 220 px) + puces des 4 champions les plus joués (pilules ;
active = fond or 12 % + contour or + texte or). Par défaut : le main
actuel de la carte.

**Grille des skins.** Ligne de méta en `Label caps` : « SKINS D'AHRI · 23 »
à gauche, « 22 détourés · 1 en attente » à droite (mono). Tuiles
142 × 190 (3:4), écart 12 px, retour à la ligne (5 par ligne à 1440 px,
`grid-cols-[repeat(auto-fill,minmax(132px,1fr))]`). Tuile : rayon 8,
fond dégradé radial violet `#3A2552 → #140D1E`, skin détouré posé sur le bas,
dégradé noir en pied sous le nom (`text-sm` 600, une ligne, troncature +
`title` au survol). Le skin classique s'appelle « <Champion> (classique) ».

| État | Rendu |
|---|---|
| Défaut | contour 1 px `border-dim` |
| Survol | contour 1 px `border-field`, ombre portée, l'aperçu de gauche montre le skin (sans valider) |
| Focus clavier | anneau or 2 px décalé de 2 px (même règle que les boutons) |
| Sélectionné | contour 2 px or, pastille or ✓ en haut à droite, nom en `gold-bright` ; `aria-pressed="true"` |
| Pas encore détouré (`refused`/`missing`, ou pas encore calculé) | contour pointillé `border-field`, skin à 35 % flouté, badge « EN ATTENTE » en haut à gauche (texte complet « Pas encore détouré » en info-bulle : la version longue déborde d'une tuile de 142 px) ; **non choisissable** : la carte n'affiche que des détourés (décision du 20/11) — sans détouré, premier skin détouré du champion, sinon halo neutre |
| Chargement | tuiles squelette (silhouette 70 × 120 + barre de nom), autant que de skins connus, pas de spinner plein écran |

**Navigation clavier.** La grille est un groupe radio (`role="radiogroup"`,
flèches pour se déplacer, Espace/Entrée pour choisir).

**Textes FR/EN** (i18n, Front-end) : « Champion de la carte » / « Card
champion » ; « Choisis le champion et le skin affichés sur ta carte joueur.
Tes coéquipiers voient ce choix dans l'Espace d'équipe. » ; « Les plus
joués : » / « Most played: » ; « Pas encore détouré » / « Not cut out
yet » ; « Aperçu en direct » / « Live preview ». Noms de skins : ceux de
Data Dragon dans la langue de l'app.

## 7. Spec Front-end — états des données (modèles, pas de nouveaux écrans)

Maquette Penpot : page « Design System », section « États des données ». Ce
sont des **modèles** à appliquer aux états qui existent déjà dans l'app ; les
textes de la maquette (« Aucune partie enregistrée », « Configurer
l'enregistrement », « Importer une vidéo », « Stats indisponibles ») sont des
exemples, pas des clés à créer.

- **Vide** : panneau `dark` + contour `border-dim`, padding 32, centré :
  puce d'icône (teinte à 10 %, contour à 25 %), titre de carte, une phrase qui
  dit quoi faire ensuite, puis l'action principale (+ éventuellement une
  secondaire en outline). Avec deux boutons, largeur ≥ 460 px ; en dessous,
  boutons empilés pleine largeur (les libellés FR débordent à 380 px).
- **Erreur** : même gabarit, puce rouge, la cause en clair (« Le serveur Riot
  ne répond pas (erreur 503) ») et ce qui reste possible, bouton
  « Réessayer » en outline.
- **Chargement** : squelettes `elevated` rayon 4 à la forme du contenu
  (tuile KPI : libellé 80×10, puce 28×28, valeur 96×22, pied 120×8), pas de
  spinner plein écran.
- **Partiel** : bandeau or 10 % sur base `dark`, contour `border`, point or,
  titre en or 600, sous-titre `text` ; le contenu reste utilisable dessous.
- **Tableau** : en-tête `black` en `Label caps` `text-dim` (colonne triée en or
  avec ▾), lignes de 44 px séparées par 1 px `border-dim`, survol `elevated`,
  chiffres en mono alignés à droite, texte long tronqué avec « … » et
  infobulle.

Où l'appliquer en premier : les états vides et d'erreur existants des pages
Historique, Statistiques, Revue et Labo d'erreurs (à repérer dans le code par
le Front-end) ; ne pas créer d'état là où l'app n'en a pas besoin.

## 8. Spec Front-end — Planning au clavier (#36)

Maquette Penpot : page « Planning — accès clavier ». Le glisser à la souris
reste ; ces deux chemins s'ajoutent et aboutissent aux mêmes dialogues.

**1. « Nouvel événement » (staff, `canEditCalendar`).** Bouton principal
« + Nouvel événement » dans l'en-tête du Planning, à droite de « Export .ics »
(ordre : « Mes dispos », « Export .ics », « + Nouvel événement »). Il ouvre
`EventPopup` sans `initialRange`, pré-rempli sur le prochain créneau libre
commun des titulaires de la semaine affichée, sinon aujourd'hui 20:00–21:00.

**2. Dialogue d'événement : jour, début, fin explicites.** En haut du
dialogue, avant « Type », trois selects sur une ligne : **Jour** (les 7 jours
de la semaine affichée, libellé « Jeudi 20 nov. », 200 px), **Début** et
**Fin** (pas de 15 min, mono, 120 px). Ils remplacent les deux
`datetime-local` cachés derrière « Heures personnalisées ». Le glisser dans la
grille pré-remplit les mêmes champs. Sous la ligne, une aide en vert quand la
plage tombe dans un créneau libre commun (« Libre pour les 5 titulaires de
20:00 à 23:00 · durée 1 h 30 ») ; sinon rien. Erreur : fin ≤ début → contour
rouge sur Fin, message « La fin doit être après le début (20:00). »
(`aria-describedby`), bouton « Créer l'événement » désactivé. Le focus
initial va sur **Début** quand le dialogue est ouvert par le bouton, sur
**Type** quand il est ouvert par un glisser.

**3. « Mes dispos » (tous les membres).** Bouton outline dans l'en-tête ; ouvre
un dialogue de 760 px avec une ligne par jour de la semaine affichée :
libellé du jour (72 px) · contrôle segmenté **Habituel / Dispo / Indispo**
(`role="radiogroup"`, flèches gauche/droite pour changer) · détail :
- Habituel : pas d'exception ; rappel de la règle (« Habituellement
  19:00–23:00 » ou « Pas de dispo habituelle ») en `text-dim` ;
- Dispo : selects Début → Fin (pas de 15 min) + lien « + créneau » pour une
  2e plage (au plus 2 par jour) ;
- Indispo : champ note facultatif (« Note : examen »).
État sélectionné : Dispo = vert 18 % + texte vert ; Indispo = rouge 18 % +
texte rouge ; Habituel = `elevated` + `text-bright`. Pied : « Entrée
enregistre · Échap ferme sans enregistrer » + Annuler / « Enregistrer mes
dispos ». Enregistrer = une exception de disponibilité par plage
(`availabilitySetException`), suppression des exceptions des jours repassés
en « Habituel ». À vérifier par le Back-end : plusieurs exceptions le même
jour pour la 2e plage.

**Focus et lecteurs d'écran.** Anneau or 2 px sur chaque contrôle ; chaque
ligne de jour est un `fieldset` avec le jour en `legend` ; l'annonce après
enregistrement passe par le toast existant (« Dispos enregistrées »).
Textes FR/EN : « Nouvel événement » / « New event », « Mes dispos » / « My
availability », « Habituel / Dispo / Indispo » / « Usual / Available /
Unavailable », « + créneau » / « + slot ».

## 9. Spec Front-end — échelle unique de winrate (K, UX-3)

Aujourd'hui, quatre échelles coexistent :
- quatre paliers en hex dans `poolView.wrTone` ;
- quatre paliers en Tailwind `emerald/yellow/orange/red-300` dans
  `DashboardLayout.wrColor`, `PlayerCard.wrTone` et `SynergyPlayerCard` ;
- trois paliers dans `ScoutingTab:888` ;
- un vert / rouge à 50 % dans `DashboardPage:185`, `StatsInsightsTab:189` et
  `HistoryPage:916`.

**Une seule échelle, quatre paliers, fixes sur tous les thèmes** (comme
`red` / `green` : c'est une information, pas une couleur de thème).

| Palier | Seuil | Couleur | Token proposé | Contraste mini* |
|---|---|---|---|---|
| Fort | ≥ 60 % | `#7CC47F` | `--wr-high` | 5.8 |
| Positif | 50 – 59 % | `#E8D27A` | `--wr-mid` | 8.1 |
| Sous 50 | 40 – 49 % | `#E3A35B` | `--wr-low` | 5.6 |
| Faible | < 40 % | `#F08273` | `--wr-bad` | 4.7 |

\* Ratio le plus bas mesuré sur `dark` et `elevated` des 8 thèmes **et** sur
le halo violet des cartes joueurs (`#432A5E` en haut, `#1F1430`). Tout est
≥ 4.5:1. Le rouge du palier « Faible » est un cran plus clair que
`--hextech-red` (`#E66556`), qui ne faisait que 3.7 sur le haut des cartes.

**Règles d'usage.**
1. Toute valeur de **winrate** (pourcentage agrégé) utilise ces quatre
   paliers : texte, barre de pool, pastille (fond = couleur à 15 % + texte de
   la même couleur).
2. **Petit échantillon** (< `MIN_GAMES` = 3 games, ou `lowSample`) :
   `text-hextech-text-dim`, sans couleur de palier.
3. Le résultat **d'une seule game** (victoire / défaite) garde
   `hextech-green` / `hextech-red` : c'est un résultat, pas un taux.
4. Le pourcentage est toujours écrit à côté : la couleur ne porte jamais
   l'information seule (daltonisme vert / orange).
5. Les embeds Discord (`useShareSession`) prennent les mêmes seuils : vert
   ≥ 60, rouge < 40, neutre entre les deux. C'est une palette Discord à part,
   seuls les seuils s'alignent.

**Mise en œuvre.**
- Une source unique : `src/lib/winrate.ts` avec `WR_THRESHOLDS = [60, 50, 40]`,
  `wrLevel(wr, games?) → 'high' | 'mid' | 'low' | 'bad' | 'sample'`, et les
  classes Tailwind associées.
- Tokens `--wr-*` dans `src/index.css` et `colors.wr.*` dans
  `tailwind.config.ts` : je les ajoute (fichiers Graphic Design) sur le feu
  vert du Chief.
- Le Front-end remplace ensuite les huit copies listées plus haut. Dans
  `DashboardPage`, `StatsInsightsTab` et `HistoryPage`, le vert / rouge à 50 %
  devient l'échelle à quatre paliers, car ce sont des winrates.

## 10. Spec Front-end — Objectifs et rythme de jeu (#40 · 1/3)

Maquette Penpot : page « Stats collectives — Objectifs » (faite le 19/11 : écran principal + planche d'états à droite). Source :
docs/PROPOSITION_ANALYSTE.md § 2. Visible par tout le groupe (staff,
analyste, joueurs) : ce sont des stats d'équipe.

**Place.** *Stats collectives* (`/team`) → nouvel onglet **« Objectifs »**,
après « Stats Tournoi ». Même sélecteur de groupe que les autres onglets.

**Barre de filtres** (une ligne, sticky sous les onglets) :
- **Période** : segmenté « 7 jours · 30 jours · Saison · Personnalisée »
  (Personnalisée ouvre deux dates).
- **Source** : puces Flex / Scrim / Tournoi (cumulables, par défaut
  Scrim + Tournoi).
- **Côté** : segmenté « Les deux · Bleu · Rouge ».
- À droite, en mono `text-dim` : « 18 games · patch 25.23 ».

**1. Tuiles de contrôle** (rangée de 6 tuiles KPI du Design System) :

| Tuile | Valeur | Pied de tuile |
|---|---|---|
| Drakes | % des drakes tués par nous | « 1er drake : 61 % · âme : 4 / 9 » |
| Grubs | moyenne prise sur le nombre disponible, `grubs.available` (« 2.4 / 3 » : un seul camp de 3 en 2026 ; saison en cours seulement, aucune game 2025 / 15.x) | « camp complet : 52 % » |
| Herald | % pris | timing moyen « 14:20 » |
| Baron | % pris | « Baron → victoire : 83 % » |
| Premier sang | % | timing moyen |
| Première tour | % | timing moyen et voie la plus fréquente |

Valeur colorée avec l'échelle de winrate (§ 9) : ce sont des taux de
contrôle. Moins de 5 games : `text-dim` + mention « échantillon faible ».

**2. Courbe d'écart d'or** (carte pleine largeur) : écart d'or moyen de
l'équipe (nous − eux) de 0 à 30 min, une courbe `gold` (les deux côtés
confondus) + deux courbes fines « Bleu » et « Rouge » si le filtre Côté =
« Les deux ». Ligne 0 en `border`. Valeurs écrites à 10 / 15 / 20 min sous
le graphique (mono, signe +/−, colorées vert / rouge). Survol : infobulle
avec la valeur à la minute.

**3. Frise des games** (carte, une ligne par game, la plus récente en haut) :
- à gauche (220 px) : date, adversaire, côté (pastille bleu / rouge), badge
  Victoire / Défaite, durée ;
- à droite : une frise 0 → durée de la game, graduée toutes les 5 min, avec
  un marqueur par événement : drake (losange), grubs (petit rond, 3 par game),
  Herald (triangle), Baron (carré), tours (barre fine) — pas d'Atakhan : il
  n'existe plus en 2026 et seule la saison en cours est montrée,
  premier sang (étoile). **Nous** = marqueur plein `gold`, **eux** =
  contour `wr-bad`. Survol d'un marqueur : « Drake infernal · 08:42 · pris
  par nous » ; clic sur la ligne : ouvre la game (stats par game / VOD).
- 10 lignes, puis « Afficher plus ». Légende des formes au-dessus de la frise.

**4. Timings moyens** (petit tableau sous la frise) : pour chaque objectif,
timing moyen chez nous / chez eux et l'écart (« 1er drake : 07:40 vs 08:55 ·
−1:15 », « Grubs : 05:42 vs 06:10 »). Mono, aligné à droite.

**États.**
- *Chargement* : squelettes des 6 tuiles + bandeau « Lecture des timelines :
  12 / 18 games » avec barre de progression (les timelines se chargent une à
  une via le relais, puis sont mises en cache).
- *Vide* : « Aucune game d'équipe sur la période » + phrase « Les scrims et
  tournois enregistrés en session d'équipe apparaîtront ici. » + bouton
  outline « Élargir à 30 jours » (ou « Ouvrir le Planning »).
- *Partiel* : bandeau « 3 timelines indisponibles (game trop ancienne ou
  custom sans timeline) : ces games sont exclues des moyennes. »
- *Erreur* : gabarit d'erreur (§ 7), cause en clair (« Le relais Riot ne
  répond pas (429) : limite de requêtes atteinte. Réessaie dans une minute. »)
  + « Réessayer ».

**Données (pour le Back-end).** Par game de l'équipe (même sélection que
`aggregateMatchLike`) : la timeline match-v5 (déjà autorisée par le relais),
mise en cache. L'extraction des `ELITE_MONSTER_KILL` existe déjà dans
`electron/main/eventExtractor.ts` (drakes, Baron, Herald, grubs),
mais seulement pour le joueur : il faut une variante **équipe** (killerTeamId
comparé à notre côté), plus `BUILDING_KILL` (tours), le premier
`CHAMPION_KILL`, et l'or total par équipe à chaque frame
(`participantFrames[].totalGold`). Calcul pur partagé desktop / web, comme
`teamSessionStatsCore`.

**Accessibilité.** Les marqueurs ne reposent pas que sur la couleur
(nous = plein, eux = contour, forme par objectif). La frise a une version
texte (liste des événements) pour les lecteurs d'écran (`sr-only`).

## 11. Spec Front-end — Journal des drafts (#40 · 2/3)

Maquette Penpot : page « Coaching — Journal des drafts » (faite le 19/11 : écran principal + planche d'états à droite). Source :
docs/PROPOSITION_ANALYSTE.md § 1. Visible par le staff et l'analyste ;
lecture seule pour les joueurs (même règle que le Draft Sim).

**Place.** *Coaching & Management* → onglet *Draft Sim*, qui reçoit deux
sous-onglets : **« Préparation »** (le Draft Sim actuel, inchangé) et
**« Journal »** (nouveau). Le sous-onglet est mémorisé dans l'URL.

**Barre de filtres** : adversaire (select, « Tous »), source (Scrim /
Tournoi), côté (Les deux · Bleu · Rouge), patch, champion (recherche : garde
les drafts où il est pické ou banni, chez nous ou chez eux), résultat. À
droite, en mono : « 24 drafts · 15 V – 9 D ».

**1. Synthèse** (rangée de 4 tuiles) :
- *Côté bleu (1er pick)* / *Côté rouge* : winrate et nombre de games
  (échelle § 9). Le côté bleu pick toujours en premier : pas de tuile
  « first pick » séparée ;
- *Notre 1er champion pické* : winrate de notre premier champion pické (B1
  côté bleu, R1 côté rouge), seulement sur les drafts dont l'ordre est saisi ;
  pied « 11 drafts avec ordre saisi ». Sans ordre saisi : « — » et « Saisis
  l'ordre de pick dans le détail d'une draft » ;
- *Bans subis* : les 3 champions les plus bannis contre nous (icônes + nombre).

**2. Tableau des drafts** (une ligne par game, la plus récente en haut) :

| Colonne | Contenu |
|---|---|
| Date | « 18 nov. », mono |
| Adversaire | nom + tag, lien vers son dossier (§ 12) |
| Côté | pastille Bleu / Rouge |
| Nos bans | 5 icônes 24 px, grisées, barrées en diagonale |
| Nos picks | 5 icônes 28 px dans l'ordre top → support, rôle en exposant |
| Leurs picks | idem, à droite |
| Leurs bans | 5 icônes grisées |
| Résultat | badge Victoire / Défaite + durée |

Survol : fond `elevated`. Clic : panneau de détail à droite (360 px) avec
l'ordre de pick s'il est connu (B1 R1 R2 B2…), les notes de l'analyste
(texte libre, éditable par le staff), les liens « Stats par game » et
« Review VOD », et le bouton « Ouvrir dans Préparation » qui recopie la
draft dans le Draft Sim.

**3. Champions** (carte sous le tableau, deux colonnes) : *nos picks*
(champion, games, winrate, rôle) et *ce que les adversaires nous pickent*
(champion, nombre, winrate contre nous). Tri par nombre de games ; moins de
3 games en `text-dim` (§ 9).

**Ordre de pick.** Match-v5 ne le donne pas. Le tableau l'omet par défaut ;
l'analyste peut le saisir dans le panneau de détail (glisser les 10 picks
dans l'ordre, ou rien). Saisi, il débloque la tuile « Notre 1er champion
pické ».

**États.**
- *Chargement* : 6 lignes squelettes (icônes rondes grises).
- *Vide* : « Aucune draft enregistrée » + « Les drafts des scrims et
  tournois joués en session d'équipe s'ajoutent toutes seules. » + bouton
  outline « Ajouter une draft à la main » (formulaire : adversaire, côté,
  picks / bans, résultat).
- *Filtre sans résultat* : « Aucune draft ne correspond » + « Effacer les
  filtres ».
- *Bans manquants* (custom sans draft) : les cases de bans affichent un tiret
  et une infobulle « Pas de bans dans cette game ».
- *Erreur* : gabarit § 7.

**Données (pour le Back-end).** Picks, côtés, résultat et `teams[].bans` :
dans les match-v5 déjà chargés pour les stats scrim / tournoi. À stocker par
groupe (`draft_log` : match, adversaire, côté, picks, bans, résultat, ordre
de pick facultatif, notes) pour garder les notes et les saisies manuelles.
À vérifier : présence des bans dans les customs sans mode draft.

## 12. Spec Front-end — Dossier adverse (#40 · 3/3)

Maquette Penpot : page « Coaching — Dossier adverse » (faite le 19/11 : écran principal + planche d'états à droite). Source :
docs/PROPOSITION_ANALYSTE.md § 3. Rédaction par le staff et l'analyste ;
lecture par les joueurs une fois publié.

**Place.** *Coaching & Management* → *Scouting* : chaque équipe adverse de
la liste reçoit un bouton **« Dossier »**. Il ouvre une page pleine largeur
(retour « ← Scouting »).

**En-tête** : logo ou tag, nom, région, « mis à jour il y a 2 h » ;
boutons outline « Actualiser les données », « Copier pour Discord », bouton
principal « Publier au roster ». Statut : badge « Brouillon » (gris) ou
« Publié le 19 nov. » (vert).

**1. Résumé de l'analyste** (carte en tête) : 3 champs courts, éditables par
le staff :
- *Comment ils jouent* (ex. « Compo scaling, peu de pression avant 15 min ») ;
- *Bans conseillés* (5 cases champion) ;
- *Plan de jeu* (texte libre, 600 caractères).
Le texte existant du scouting (`notes` de l'équipe) pré-remplit le premier
champ.

**2. Les 5 joueurs** (grille de 5 cartes, une par rôle, dans l'ordre top →
support) :
- en-tête : rôle, pseudo, rang actuel ;
- top 3 champions avec tier (icônes des tiers v2 de `threatCore`), games et
  winrate (§ 9) ;
- badge de menace (Dominant / Menace / Confort) repris du Draft Sim ;
- forme récente : 10 dernières ranked en barres V / D ;
- dernier changement de pool notable (« Nouveau : Zeri, 7 games cette
  semaine »).

**3. Contre nous** (carte, n'apparaît que si on a joué cette équipe) : bilan
(« 2 V – 1 D »), leurs drafts contre nous (lignes du Journal, § 11) et leurs
objectifs (tuiles réduites du § 10).

**4. Duos** (petite carte) : paires de joueurs qui jouent ensemble en ranked
(ex. jungle + mid), avec nombre de games et winrate.

**Publication.** « Publier au roster » envoie le dossier au groupe : les
joueurs le lisent en lecture seule (même page sans boutons d'édition),
une notification « Dossier publié : Aegis Gaming » part, et le bot Discord
peut le poster (§ 9 de la proposition, plus tard). « Copier pour Discord »
copie un résumé texte (résumé + bans conseillés + top 3 de chaque joueur).

**États.**
- *Chargement* : 5 cartes squelettes + bandeau « Analyse de 5 joueurs :
  3 / 5 » avec progression (le scouting interroge Riot joueur par joueur).
- *Mode réduit* (clé personnelle) : bandeau or « Analyse limitée à 20
  games par joueur avec la clé Riot actuelle. » Le dossier reste complet
  dans sa forme.
- *Vide* (équipe sans joueurs) : « Ajoute les 5 joueurs de l'équipe pour
  générer le dossier » + bouton « Ajouter des joueurs » (le formulaire du
  scouting existant).
- *Joueur introuvable* : sa carte affiche « Riot ID introuvable » et
  « Corriger », les 4 autres restent.
- *Erreur* : gabarit § 7.

**Données (pour le Back-end).** Pools, tiers, menaces, rang et games par
joueur : `scoutingCore`, `threatCore` et le scouting existant
(`team.ipc.ts`). Manque : la table du dossier (résumé, bans conseillés,
plan, statut, date de publication), la jonction avec le Journal (§ 11) et
les Objectifs (§ 10) quand on a joué l'équipe, et le calcul des duos (games
communes entre membres). Volume Riot : 5 joueurs × 20 games en clé
personnelle, 50 avec la clé de production (#42).

## 13. Spec Front-end — Scrims intégrés au Planning (#49)

Maquette Penpot : page « Planning — scrims (#49) » (faite le 20/11 : pop-up
en type Scrim à gauche, panneau de détail à droite). Demande de l'utilisateur :
la planification des scrims se fait dans le Planning ; la page Scrims (web,
`web/src/pages/ScrimsPage.tsx`) disparaît.

**Principe.** Un scrim reste une ligne `scrims` (Bot Discord, liens OP.GG,
cases de préparation), mais on ne le crée plus à part : créer un événement
de type **Scrim** ou **Officiel** dans le Planning crée en même temps la ligne
`scrims` liée (`calendar_events.linked_scrim_id`, qui existe déjà) et l'équipe
adverse (`team_scouting`). Le sélecteur « Lier à un scrim existant » du
pop-up disparaît.

### 1. Pop-up « Nouvel événement » en type Scrim ou Officiel

Les champs actuels restent (type, jour / début / fin du § 8, personnes
concernées, notes). Quand le type est **Scrim** ou **Officiel**, le pop-up
s'élargit à 640 px et ajoute, dans cet ordre :

- **Format** : segmenté Bo1 / Bo3 / Bo5 (Bo3 par défaut), sur la ligne des
  heures. La fin se recalcule à la sélection (Bo1 1 h, Bo3 2 h 30, Bo5 4 h),
  modifiable ensuite.
- **Bloc « Équipe adverse »** (fond `black`, contour `border-dim`) :
  - segmenté **Équipe connue / Nouvelle équipe**. « Équipe connue » = un
    select des adversaires du Scouting du groupe (nom + tag, dernier scrim
    contre eux) ; il pré-remplit tout le bloc ;
  - **Nom** (obligatoire) et **Tag** (facultatif, 2 à 5 caractères) ;
  - **Lien OP.GG multi** (facultatif). Coller un lien OP.GG, Blitz, etc.
    remplit les 5 Riot ID (`src/lib/multiGgParser.ts` existe déjà) ;
  - **Les 5 adversaires** : une ligne par joueur = select de rôle (TOP, JGL,
    MID, ADC, SUP, pré-rempli dans l'ordre et modifiable) + Riot ID
    (`Nom#TAG`) + statut à droite : « ✓ trouvé » vert, « Introuvable » rouge
    (contour rouge du champ), « — » si vide. Vérification du Riot ID à la
    sortie du champ, via le relais (account-v1). Les lignes vides sont
    permises : un scrim peut se créer avec 0 à 5 joueurs connus.
- **Notre roster et nos rôles** : 5 cases (TOP → SUP), pré-remplies avec les
  titulaires publiés ; chaque case = rôle + joueur, menu pour mettre un
  remplaçant. Point vert / rouge = dispo du joueur sur ce créneau (règles
  et exceptions existantes). En-tête : « Titulaires pré-remplis · 5 / 5
  dispo ». Ces 5 joueurs deviennent les personnes concernées de l'événement.
- Pied : à gauche, en or, « L'équipe est ajoutée au Scouting et au Draft
  Sim. » ; bouton principal **« Créer le scrim »** (ou « Créer le match
  officiel »).

Validation : Nom obligatoire ; un Riot ID introuvable n'empêche pas la
création (on peut corriger plus tard), mais garde son contour rouge.

### 2. Panneau de détail d'un scrim (clic dans le Planning)

Le clic sur une carte Scrim / Officiel de la grille ouvre l'inspecteur de
droite actuel (360 px), avec ces blocs :

1. **En-tête** : tag `SCRIM` ou `OFFICIEL`, « vs Karmine Academy (KCA) »,
   jour et heures, Bo3, statut (Prévu / Joué / Annulé).
2. **Nos joueurs** : 5 lignes rôle + pseudo + réponse de présence
   (« Je serai là / Je ne peux pas », mécanisme existant).
3. **Adversaire** : bouton outline « OP.GG multi ↗ », puis les 5 adversaires
   (rôle en select, éditable par le staff ; Riot ID ; lien « OP.GG ↗ » par
   joueur). Un joueur introuvable affiche « Corriger ».
4. **Liens** : « Ouvrir dans le Scouting » (le dossier de l'équipe, § 12),
   « Préparer la draft » (Draft Sim, adversaire pré-sélectionné).
5. **Préparation** : la checklist (cases à cocher) et les notes de
   préparation, reprises de la page Scrims.
6. **Drafts liées** : la liste des drafts du groupe liées au scrim, avec
   « Lier une draft » ; l'alerte « drafts manquantes » de l'ancienne page
   est gardée.
7. **Après le match** : review du scrim (texte), « Marquer joué »,
   « Annuler », puis le fil de discussion (DiscussionThread, sujet `scrim`).
8. Pied : « Modifier » (rouvre le pop-up du § 1) et « Supprimer ».

Lecture seule pour les joueurs (comme aujourd'hui : écriture réservée au
staff).

### 3. Ce que deviennent les fonctions de la page Scrims

| Fonction de ScrimsPage | Nouvelle place |
|---|---|
| Liste des scrims à venir, « afficher les passés » | Grille du Planning (semaine) ; les scrims passés restent visibles en naviguant dans les semaines. Le Journal des drafts (§ 11) garde l'historique. |
| Création (titre, adversaire, date, durée, Bo, lien Scouting) | Pop-up du Planning, § 1 |
| Disponibilité par scrim + commentaire | Réponse de présence de l'événement (existante) ; le commentaire devient la raison d'absence |
| Checklist de préparation | Panneau de détail, bloc 5 |
| Notes de préparation | Panneau de détail, bloc 5 |
| Drafts liées + alerte drafts manquantes | Panneau de détail, bloc 6 |
| Review du scrim, Marquer joué, Annuler, Supprimer | Panneau de détail, blocs 7 et 8 |
| Fil de discussion | Panneau de détail, bloc 7 |
| Lien vers l'équipe scoutée | Créé automatiquement (§ 1) ; liens du bloc 4 |
| Bot Discord (`/scrims`, OP.GG) | Inchangé : il lit toujours la table `scrims` |

L'entrée de menu « Scrims » du web disparaît ; l'URL `/scrims?scrim=<id>`
redirige vers le Planning, sur la semaine du scrim, panneau ouvert.

**Scouting et Draft Sim.** Une équipe créée par un scrim apparaît dans
Coaching → Scouting (avec ses 5 joueurs et leurs rôles) et dans la liste
des adversaires du Draft Sim, sans autre action. Si l'équipe existait déjà
(« Équipe connue »), les nouveaux Riot ID complètent sa fiche.

**Scrims existants.** Les scrims déjà créés sans événement de planning
reçoivent leur événement (migration Back-end), pour apparaître dans la grille.

**Textes FR/EN** : « Équipe adverse » / « Opposing team », « Équipe connue /
Nouvelle équipe » / « Known team / New team », « Lien OP.GG multi » /
« OP.GG multi link », « Les 5 adversaires » / « The 5 opponents »,
« Notre roster et nos rôles » / « Our roster and roles », « Créer le scrim »
/ « Create scrim », « Ouvrir dans le Scouting » / « Open in Scouting »,
« Préparer la draft » / « Prepare the draft ».

## 14. Spec Front-end — champion et skin de sa carte, depuis le Lobby d'équipe

Pas de maquette Penpot (onglet non connecté) : spécification écrite, revue
avec l'utilisateur le 20/11/2026. Elle reprend les tuiles de skin du § 6
(choix du skin sur Profil). C'est **le même choix**, stocké une fois par
joueur et partagé avec le groupe : on peut le faire depuis Profil ou depuis
sa carte du Lobby, et les deux restent alignés.

**Qui.** Seul le joueur lié à la carte (le membre dont l'utilisateur est le
compte) peut changer. Sur les cartes des autres membres, staff compris, rien
n'est cliquable : on y voit seulement le résultat.

**Où ça s'ouvre : les 5 icônes du dos de la carte.** Pas de bouton en plus.
Au dos de la carte, dans la section « Top 5 » (ChampionsSection) :

- **Sur sa propre carte**, chaque icône de champion devient un bouton :
  - survol et focus clavier : l'icône **grossit** (`scale-[1.15]`, 150 ms,
    origine au centre, au-dessus de ses voisines) avec un contour or 1 px et
    `cursor-pointer` ; `prefers-reduced-motion` : pas de zoom, contour seul ;
  - le champion actuellement affiché sur la face avant porte une petite
    pastille or ✓ en coin, pour qu'on sache ce qui est choisi ;
  - nom accessible : « Afficher Ahri sur ma carte » ;
  - clic : ouvre le pop-up de ce champion (plus bas) ; le clic ne retourne
    **pas** la carte (`stopPropagation`).
  - sous la grille, une ligne `text-dim` en petit : « Clique un champion
    pour l'afficher sur ta carte ».
- **Sur la carte d'un autre membre** : icônes inchangées (pas de zoom, pas de
  curseur main, pas de rôle bouton, pas de pastille ✓ cliquable, pas de ligne
  d'aide). Le clic garde son comportement actuel (retourner la carte).
- Cases vides en pointillé (moins de 5 champions) : jamais cliquables.

**Le pop-up — les skins du champion cliqué uniquement.** Même allure que le
choix de skin du Profil (§ 6) : Dialog du Design System, 880 px, deux
colonnes.

- **Titre** : « AHRI » en condensé, sous-titre « Choisis le skin affiché sur
  ta carte ».
- **Gauche, 260 px : aperçu en direct.** La face avant réelle de la carte
  (PlayerCard : motif, halo, nom vertical, cadre MVP / Grinder s'il y en a),
  à 240 × 420, avec ce champion. Elle suit le survol et la sélection.
  Légende dessous, `Small text-dim` : « Aperçu · K/DA Ahri ».
- **Droite : la grille des skins de ce champion seulement.** Pas de rangée
  de champions, pas de recherche : pour changer de champion, on ferme et on
  clique une autre icône du dos.
  - En-tête : « SKINS D'AHRI » à gauche, « 18 avec détouré » en mono à droite.
  - Grille de tuiles 3:4 de 112 × 150, écart 10 px, retour à la ligne (5 par
    ligne dans 600 px), même rendu que le § 6 (fond violet radial, skin
    détouré posé en bas, nom en pied).
  - **Skin de base** en premier, puis les skins qui **ont** un détouré
    hébergé, dans l'ordre de Data Dragon.
  - **Skins sans détouré** : regroupés à la fin derrière une ligne repliée
    « 5 skins sans détouré ▸ ». Dépliés : tuiles grisées (illustration à 35 %
    + flou), contour pointillé `border-field`, badge « PAS DE DÉTOURÉ » en
    haut, **non sélectionnables** (`aria-disabled`, infobulle « Ce skin n'a
    pas encore de détouré : il ne peut pas être affiché sur la carte. »).
  - États des tuiles : défaut, survol (aperçu mis à jour sans valider), focus
    clavier (anneau or), sélectionné (contour or 2 px + pastille ✓).
- **Pied** :
  - à gauche : « Visible par tout le groupe » (`Small text-dim`) et, si ce
    champion est déjà celui de la carte, le lien `gold` **« Revenir en
    automatique »** (la carte reprend le champion le plus joué, skin de
    base) ;
  - à droite : « Annuler » (outline) et **« Afficher sur ma carte »**
    (principal). Valider ferme le pop-up, met la carte à jour (face avant) et
    affiche le toast « Carte mise à jour ». Annuler ou Échap : rien ne change.

**États.**
- *Chargement des skins* : 10 tuiles squelette 112 × 150 (§ 7).
- *Champion sans aucun détouré* (tous refusés dans le pack) : à la place de
  la grille, la ligne « Aucun skin d'Ahri n'a encore de détouré : la carte
  affichera un halo neutre. » ; rien n'est sélectionnable. La carte n'affiche
  **jamais** l'art d'origine (décision du 20/11, `docs/DECISIONS.md`) : skin
  choisi sans détouré → premier skin détouré du champion, sinon halo neutre.
- *Pas de champion au dos* (Riot ID manquant, stats non récupérées) : rien
  de cliquable ; le message actuel du dos reste.
- *Erreur d'enregistrement* : toast d'erreur, pop-up gardé ouvert.
- *Choix devenu invalide* (le champion choisi sort du top 5) : la carte
  repasse en automatique, sans message ; la pastille ✓ suit.

**Clavier et accessibilité.** Au dos de sa carte, Tab atteint les 5 icônes
(boutons). Dans le pop-up, la grille est un `radiogroup` (flèches, Espace /
Entrée) ; Tab passe de la grille au pied. Chaque tuile a un nom accessible
complet (« K/DA Ahri, avec détouré, sélectionné »).

**Données (pour le Back-end).** Deux champs par joueur, partagés avec ses
groupes comme l'icône et la bannière de profil (`useShareProfileLook`) :
`cardChampion` (clé du champion ou `null` = automatique) et `cardSkin`
(numéro de skin, 0 par défaut). La liste « avec détouré » vient du manifest
hébergé du pack (statut `ok`, après la relecture : 1 608 découpes). Le Front
lit le détouré du skin choisi à la place de `useChampionCutout(champion, 0)`.

**Textes FR / EN.** « Clique un champion pour l'afficher sur ta carte » /
« Click a champion to show it on your card » ; « Afficher Ahri sur ma carte »
/ « Show Ahri on my card » ; « Choisis le skin affiché sur ta carte » /
« Pick the skin shown on your card » ; « Skins d'Ahri » / « Ahri skins » ;
« N avec détouré » / « N with cut-out » ; « N skins sans détouré » / « N skins
without cut-out » ; « Pas de détouré » / « No cut-out » ; « Revenir en
automatique » / « Back to automatic » ; « Afficher sur ma carte » / « Show on
my card » ; « Visible par tout le groupe » / « Visible to the whole group » ;
« Carte mise à jour » / « Card updated ».

## 15. Spec Front-end — historique des sessions d'équipe

Demande directe de l'utilisateur (20/11/2026) : une page d'historique des
sessions d'équipe filtrable par type, chaque session ouvrant sa page avec les
stats d'équipe et individuelles, un filtre par game, les notes et reviews.
Maquette Penpot : page « Sessions d'équipe — historique » (faite le 20/11 : la liste en haut, la page d'une session dessous).

### 1. Page « Sessions d'équipe » (liste)

**Place.** Nouvelle entrée de la sidebar, section *Équipe & staff*, sous
« Stats collectives » : **« Sessions d'équipe »**, route `/team-sessions`.
Ordre de la section (décision du 20/11, `docs/DECISIONS.md`) : **Lobby
d'équipe**, Management, Coaching, Stats collectives, Sessions d'équipe.
Même sélecteur de groupe que les autres pages de la section. Visible par tout
le groupe ; chacun voit les sessions dont il fait partie, le staff les voit
toutes.

**Filtres** (barre sous l'en-tête) : **Type** segmenté *Toutes · Flex ·
Scrim · Tournoi* ; **Période** *30 jours · Saison · Tout*. À droite, en
mono : « 14 sessions · 41 games · 25 V – 16 D ». Le type se garde dans l'URL
(`?type=scrim`).

**Synthèse** (4 tuiles KPI) : *Sessions* (« dont 6 scrims, 2 tournois ») ;
*Winrate* (échelle § 9) ; *Objectifs tenus* (« 27 sur 40 ») ; *Reviews
faites* (« 11 / 14 · 3 sessions sans review »).

**Liste**, groupée par semaine (« CETTE SEMAINE · 17 – 23 NOV. », plus récent
en haut). Une ligne par session, entièrement cliquable :
- liseré gauche 3 px à la couleur du type (`KIND_STYLE` : scrim / flex
  orange, tournoi rouge) ;
- badge du type + titre (« vs Karmine Academy », « Soirée flex à 5 ») ;
  dessous, en mono : jour, heures, format (« Jeu. 20 nov. · 20:00 – 22:40 ·
  Bo3 ») ;
- résultat : une pastille V / D par game (vert / rouge 20 %), puis « 2 – 1 ·
  1 h 34 de jeu » ;
- objectifs : « 2 / 3 tenus », coloré avec l'échelle § 9 ;
- contenus : badges « NOTES » et « REVIEW ✓ » (vert) ou « REVIEW À FAIRE »
  (or) ;
- chevron « › » à droite.
Survol : fond `elevated`, contour `border`, ombre ; focus clavier : anneau or.
Clic ou Entrée : ouvre la page de la session (§ 2). 20 sessions, puis
« Afficher les sessions plus anciennes ».

**États.** Chargement : 5 lignes squelette. Vide : « Aucune session d'équipe
sur la période » + « Les sessions se lancent depuis un événement du
Planning. » + bouton « Ouvrir le Planning ». Filtre sans résultat : « Aucune
session de ce type » + « Voir toutes les sessions ». Erreur : gabarit § 7.

### 2. Page d'une session terminée

On garde la route actuelle `/team-session/:calendarEventId`. Une session
**terminée** s'affiche en mode historique (la page actuelle reste telle quelle
pour une session prévue ou en cours). Fil d'Ariane « ← Sessions d'équipe ».

**En-tête.** Badge du type, titre, date et heures, format, résultat en grand
(« 2 – 1 »), responsables. Boutons outline à droite : « Revoir dans le
Planning », « Exporter le résumé » (texte, comme le rapport hebdo).

**Filtre par game** (segmenté, sticky sous l'en-tête) : *Toute la session ·
G1 V · G2 V · G3 D*. Chaque pastille montre le résultat. Tout ce qui suit
(stats d'équipe, stats individuelles, duels, timeline) se recalcule pour la
sélection ; les notes et reviews restent visibles, celles de la game choisie
en premier. Le choix se garde dans l'URL (`?game=2`).

**Bloc 1 — Stats d'équipe** (rangée de tuiles, nous contre eux) : K / D / A
d'équipe, or total et écart d'or à 15 min, dégâts, vision, durée moyenne ;
chaque tuile donne « nous » en grand et « eux » en `text-dim`, l'écart coloré
vert / rouge. Source : `SessionPerformance` et les timelines (§ 10). Pour une
game seule : la mini-frise d'objectifs de la game (§ 10).

**Bloc 2 — Stats individuelles** (tableau, gabarit du § 7) : une ligne par
joueur de l'équipe (rôle, joueur, champion), colonnes KDA, CS/min, or/min,
dégâts/min, vision, part des dégâts, kill participation ; en vue « Toute la
session », moyennes avec le nombre de games. Chaque ligne se déplie pour
montrer le **duel** contre le vis-à-vis (`buildDuelRows` existant).

**Bloc 3 — Objectifs de la session** : les objectifs fixés au lancement, avec
« tenu / pas tenu » par game (§ 8 de la proposition analyste) ou, à défaut,
la case cochée par le staff.

**Bloc 4 — Notes et reviews** (seulement s'il y en a) :
- *Review de session* et *review de chaque game* (`team_session_reviews`) :
  résumé, lien VOD / YouTube s'il existe, transcription repliée ;
- *Retours des joueurs* (`team_session_feedback`) : une carte par joueur ;
- *Notes du scrim* (préparation, review, checklist, § 13) pour un scrim ;
- *Présence* (`team_session_attendance`).
S'il n'y a rien : une ligne « Pas encore de review pour cette session » et,
pour le staff, « Faire la review ».

**États.** Chargement par bloc (squelettes) ; game sans stats Riot
(« Stats indisponibles pour la G3 : game non trouvée chez Riot ») ; session
sans game (« Aucune game enregistrée ») ; erreur : gabarit § 7.

### 2 bis. Réunions dans l'historique

Demande de l'utilisateur du 20/11 (`docs/DECISIONS.md`) : les sessions de
**réunion** apparaissent dans le même historique que les sessions de jeu, avec
le même style. Pas de maquette Penpot pour cette partie (spec écrite).

**Dans la liste (§ 1).**
- Filtre **Type** : *Toutes · Flex · Scrim · Tournoi · Réunion*. En
  « Toutes », réunions et sessions de jeu sont mêlées par date.
- Tuiles de synthèse en type « Réunion » : *Réunions* (« 5 ce mois-ci »),
  *Présence moyenne* (« 86 % »), *Résumés faits* (« 4 / 5 »), *Temps
  enregistré* (« 3 h 20 »). En « Toutes », les tuiles restent celles du jeu.
- **Ligne de réunion**, même gabarit que les sessions de jeu :
  - liseré gauche couleur `KIND_STYLE.meeting` (`#D9823B`), badge
    **RÉUNION** ;
  - titre = la **raison** de la réunion (« Débrief du bloc de scrims »,
    « 1:1 Rook ») ; dessous, en mono : jour, heures, durée ;
  - à la place du résultat : **présence** « 5 / 6 présents », avec des
    pastilles initiales (vert présent, rouge absent, gris sans réponse) ;
  - à la place des objectifs : **personnes concernées** (« Toute l'équipe »,
    « Staff », « 2 personnes ») ;
  - badges de contenu : « ENREGISTRÉE », « TRANSCRIPTION », « RÉSUMÉ ✓ » (vert)
    ou « RÉSUMÉ À FAIRE » (or) ;
  - chevron et états de survol / focus identiques.

**Page d'une réunion terminée** (même route `/team-session/:calendarEventId`,
mode historique, fil d'Ariane « ← Sessions d'équipe »). Pas de filtre par
game ni de stats.

- **En-tête** : badge RÉUNION, raison en titre, jour, heures, durée,
  organisateur. Boutons outline : « Revoir dans le Planning », « Exporter le
  résumé ».
- **Bloc 1 — Personnes et présence** : une ligne par personne concernée
  (rôle, nom, statut Présent / Absent / Pas répondu, raison d'absence en
  `text-dim` si donnée) ; en tête « 5 / 6 présents ». Source :
  `team_session_attendance` et les réponses à l'événement.
- **Bloc 2 — Enregistrement** : si la réunion a été enregistrée, lecteur
  audio ou vidéo (fichier local de l'enregistreur, ou lien YouTube s'il
  existe), durée, enregistré par. Sinon : « Cette réunion n'a pas été
  enregistrée. »
- **Bloc 3 — Résumé** : le résumé (`team_session_reviews.summary`, scope
  `meeting`) en premier, carte pleine largeur, éditable par le staff.
  Absent : « Pas encore de résumé » et, pour le staff, « Rédiger le résumé »
  (ou « Générer depuis la transcription » si elle existe).
- **Bloc 4 — Transcription** : repliée par défaut (« Afficher la
  transcription · 42 min »). Dépliée :
  - **champ de recherche** au-dessus (icône loupe, 320 px) : surligne les
    occurrences en or, compteur « 3 / 12 » et flèches précédent / suivant ;
    Entrée = suivant, Échap = vider ;
  - texte par blocs horodatés (« 12:40 »), un clic sur l'horodatage place le
    lecteur du bloc 2 à ce moment ;
  - « Copier la transcription » en pied.
- **Bloc 5 — Retours** : retours écrits des participants s'il y en a
  (`team_session_feedback`), comme pour une session de jeu.

**États.** Réunion sans rien (ni enregistrement, ni résumé, ni transcription) :
blocs 2 à 4 remplacés par une ligne « Rien n'a été enregistré pour cette
réunion. » ; transcription en cours : « Transcription en cours… » avec
barre de progression ; erreur : gabarit § 7.

**Données (pour le Back-end).** La raison de la réunion = le titre de
l'événement (et ses notes) ; à confirmer si un champ dédié existe déjà. Les
lignes de réunion de la liste viennent des `team_sessions` dont l'événement
est de type `meeting`.

**Textes FR / EN.** « Réunion » / « Meeting » ; « Présence moyenne » /
« Average attendance » ; « Résumés faits » / « Summaries done » ; « Temps
enregistré » / « Recorded time » ; « N / M présents » / « N / M present » ;
« Résumé à faire » / « Summary pending » ; « Afficher la transcription » /
« Show transcript » ; « Rechercher dans la transcription » / « Search the
transcript » ; « Rien n'a été enregistré pour cette réunion. » / « Nothing
was recorded for this meeting. »

### 3. Propositions à ajouter (à choisir)

1. **Comparer deux sessions** : cocher deux sessions dans la liste →
   vue côte à côte (winrate, objectifs, écart d'or, stats par rôle). Utile
   pour voir si un travail a payé d'un scrim à l'autre.
2. **Tendance sur la liste** : une petite courbe de winrate et d'objectifs
   tenus sur les 10 dernières sessions, au-dessus de la liste.
3. **Recherche par adversaire** : champ « Adversaire » dans les filtres, et un
   bilan contre lui (« 3 sessions contre Aegis : 2 V – 1 D »), relié au
   dossier adverse (§ 12).
4. **Moments clés de la session** : 3 moments repérés dans les timelines
   (premier drake perdu, plus gros écart d'or, Baron), avec lien vers la VOD.
5. **Joueur de la session** : un MVP calculé (comme l'award hebdo) affiché
   dans l'en-tête, et l'accès direct à sa carte.
6. **Rappel de review** : badge sur la sidebar quand une session terminée n'a
   pas de review depuis 48 h, pour le staff.
7. **Lien avec le Journal des drafts** (§ 11) : la draft de chaque game
   affichée dans le bloc stats, avec « Ouvrir dans le Journal ».

**Textes FR / EN.** « Sessions d'équipe » / « Team sessions » ; « Toutes ·
Flex · Scrim · Tournoi » / « All · Flex · Scrim · Tournament » ; « Objectifs
tenus » / « Objectives met » ; « Reviews faites » / « Reviews done » ;
« Review à faire » / « Review pending » ; « Toute la session » / « Whole
session » ; « Stats d'équipe » / « Team stats » ; « Stats individuelles » /
« Player stats » ; « Notes et reviews » / « Notes and reviews ».

## 16. Spec Front-end — dashboard Management d'un joueur

Décision du 20/11 (`docs/DECISIONS.md`) : un membre **sans rôle management
ni coach** (joueur, capitaine compris) voit dans Management seulement ce à
quoi il a accès. Maquette Penpot : page « Management — vue joueur » (faite le 20/11).

**Onglets pour ce rôle.** Un seul écran, **« Mon espace »**, à la place de
Vue d'ensemble / Planning / Bien-être / Tâches. Les onglets *Essais* et
*Groupes* (gestion) n'apparaissent pas ; l'entrée *Groupes* garde son accès
« quitter / voir le groupe » via le sélecteur de groupe. Le reste du
masquage des onglets par rôle attend le rapport d'Audit
(`docs/AUDIT_LIAISONS.md`).

**Mise en page** (1120 px, deux colonnes 7 / 5) :

*Colonne gauche*
1. **Cette semaine** (Planning, lecture) : les 7 jours en rangée compacte ;
   chaque événement qui me concerne en carte (type, heure, titre) avec mes
   boutons de réponse « Je serai là / Je ne peux pas » en ligne ; clic → le
   Planning sur l'événement. Prochaine session mise en avant en haut :
   « Prochain : Scrim vs Karmine Academy · jeu. 20:00 · dans 2 h », bouton
   « Voir la préparation » (§ 17).
2. **Mes dispos** (directement dans la page, pas de pop-up) : la grille
   de la semaine en lignes par jour (§ 8 « Mes dispos », même contrôle
   segmenté Habituel / Dispo / Indispo, mêmes plages horaires), avec
   enregistrement en place : bouton « Enregistrer mes dispos » activé dès
   qu'une ligne change, toast « Dispos enregistrées ». Lien discret
   « Modifier mes dispos habituelles » (la règle récurrente).
3. **Annonces** : les annonces du groupe (épinglée d'abord), lecture seule.
   La carte montre **la plus récente** (l'épinglée si elle existe) :
   - message coupé à **3 lignes** (`line-clamp-3`) ; s'il est plus long, lien
     `gold` **« Voir tout le message »** sous le texte, qui déplie le message
     en place (devient « Réduire ») ;
   - s'il y a **plus d'une** annonce, lien **« Voir toutes les annonces (4) »**
     en pied de carte : ouvre la liste complète (la carte s'allonge, plus
     récentes en haut, chacune avec son propre « Voir tout le message »).
   (Demande de l'utilisateur du 20/11.)

*Colonne droite*
4. **Mes tâches** : les tâches qui me sont attribuées seulement, case à
   cocher pour « Fait », échéance en mono (rouge si dépassée), filtre
   « À faire / Faites ». Vide : « Aucune tâche pour toi. »
5. **Mon bien-être** : le check-in du jour (énergie, humeur, sommeil, note)
   si mon consentement est donné, sinon la carte de consentement (DECISIONS,
   v0.3 § 3 bis) ; dessous, la courbe de mes 14 derniers jours et la ligne
   « Partagé avec le staff de ce groupe : oui / non » avec le lien vers le
   réglage.
6. **Mes objectifs assignés** (si le coach m'en a donné) : liste courte avec
   l'état, lien « Voir dans Mon plan » (DECISIONS : Mon plan relié).

**Ce que le joueur ne voit pas** : tableau de bord staff, bien-être des
autres, tâches des autres, essais, gestion des membres, notes privées du
staff.

**États.** Pas de groupe : « Rejoins un groupe pour voir ton espace
d'équipe » + « Rejoindre avec un code ». Chargement par carte (squelettes).
Erreur par carte (gabarit § 7) sans casser les autres.

**Textes FR / EN.** « Mon espace » / « My space » ; « Cette semaine » /
« This week » ; « Prochain » / « Next » ; « Voir la préparation » / « See the
prep » ; « Mes dispos » / « My availability » ; « Mes tâches » / « My tasks » ;
« Mon bien-être » / « My wellbeing » ; « Mes objectifs assignés » / « My
assigned goals ».

## 17. Spec Front-end — préparer une session à l'avance (coach)

Décision du 20/11 (`docs/DECISIONS.md`) : le coach prépare une session avant
qu'elle ne démarre. La session d'équipe est créée automatiquement à la
création de l'événement scrim / flex / tournoi (décision du 20/11). Maquette
Penpot : page « Session — préparation » (faite le 20/11 : vue staff à gauche, vue joueur à droite).

**D'où on y accède.**
- Panneau de détail d'un événement du Planning (§ 13) : bouton principal
  **« Préparer la session »** pour le staff (coach, manager, analyste,
  capitaine), en tête du panneau tant que la session n'a pas démarré.
- Page de la session (`/team-session/:id`) en statut **prévue** : elle
  s'ouvre directement sur la préparation (pour le staff), ou sur la vue
  joueur (ci-dessous) pour les autres.

**Page de préparation (staff)**, trois blocs empilés, enregistrement
automatique (« Enregistré · il y a 5 s » en mono dans l'en-tête), bandeau
« Session prévue · jeu. 20 nov. 20:00 · démarre automatiquement à l'heure ».

1. **Objectifs collectifs** (jusqu'à 3, comme aujourd'hui) : choix dans les
   fondamentaux d'équipe + « Ajouter un fondamental » ; chacun peut porter un
   indicateur mesurable (§ 8 de la proposition analyste) ; ordre par
   glisser-déposer.
2. **Objectifs individuels** : une ligne par joueur concerné (rôle, joueur),
   jusqu'à 2 objectifs chacun, pris dans ses fondamentaux ou son plan de
   développement (Mon plan, proposé en premier avec la mention « de son
   plan »), plus une note courte (140 caractères). Lien « Copier sur toute
   l'équipe » pour un objectif commun.
3. **Drafts liées** : la liste des drafts du Draft Sim rattachées à la
   session (nom, côté, adversaire, 10 icônes), avec « Ouvrir dans le Draft
   Sim » ; deux boutons : **« Créer une draft »** (ouvre le Draft Sim avec
   l'adversaire et le côté pré-remplis, rattachée à la session) et **« Lier
   une draft existante »** (select des drafts du groupe). Pour un scrim, les
   drafts liées au scrim (§ 13) et à la session sont les mêmes.
4. **Message aux joueurs** (facultatif) : texte court affiché en tête de la
   vue joueur (« Focus tempo Herald, on joue autour du bot »).

Pied : « Prévisualiser comme un joueur » (outline) bascule sur la vue joueur
en lecture.

**Ce que voient les joueurs avant la session** (vue joueur, lecture seule) :
en-tête (type, adversaire, heure, compte à rebours « dans 2 h ») ; le message
du coach ; les objectifs collectifs ; **son** objectif individuel mis en
avant (« Ton objectif : 0 mort avant 4:00 »), ceux des autres repliés ; les
drafts liées (consultables) ; sa présence (« Je serai là / Je ne peux pas »).
Un badge « Préparation prête » apparaît sur l'événement du Planning et dans
« Mon espace » (§ 16) quand au moins un objectif est posé.

**Quand la session démarre**, la préparation devient les objectifs de la
session (existant) ; les objectifs individuels s'affichent dans la page de
session et l'historique (§ 15, bloc Objectifs, une ligne par joueur).

**États.** Session déjà démarrée : préparation en lecture seule, bandeau
« Session en cours : les objectifs ne se modifient plus ». Événement annulé :
la session vide est supprimée (décision du 20/11), la page l'indique
(« Événement annulé »). Pas de joueur concerné : bloc 2 remplacé par « Ajoute
des personnes à l'événement pour leur donner des objectifs ».

**Données (pour le Back-end).** Objectifs collectifs : `team_session_objectives`
(existe). À ajouter : objectifs individuels par joueur et session, message du
coach, liens session ↔ drafts (`team_drafts`).

**Textes FR / EN.** « Préparer la session » / « Prepare the session » ;
« Objectifs collectifs » / « Team objectives » ; « Objectifs individuels » /
« Individual objectives » ; « de son plan » / « from their plan » ; « Copier
sur toute l'équipe » / « Copy to the whole team » ; « Drafts liées » /
« Linked drafts » ; « Créer une draft » / « Create a draft » ; « Lier une draft
existante » / « Link an existing draft » ; « Message aux joueurs » / « Message
to players » ; « Prévisualiser comme un joueur » / « Preview as a player » ;
« Ton objectif » / « Your objective » ; « Préparation prête » / « Prep ready ».

## 18. Spec Front-end — suites de l'audit des liaisons (rôles et liaisons)

Décision du 20/11 « Yes, all » sur `docs/AUDIT_LIAISONS.md`
(`docs/DECISIONS.md`). Maquettes Penpot : page « Rôles — manager, sans groupe,
check-in » (les trois écrans nouveaux). Les liaisons L1-L6 réutilisent des
blocs déjà vus (§ 16 « Mon espace », Mon plan), sans nouvel écran.

### 18.1 Dashboard d'organisation du manager (Management)

Pour un membre au rôle **manager** qui ne joue pas : l'onglet par défaut de
Management devient **« Organisation »** (à la place de Vue d'ensemble, presque
vide pour lui). Onglets gardés : Organisation, Planning, Tâches, Groupes ;
**Bien-être masqué** s'il ne joue pas. Aucune donnée de jeu ni de bien-être
des joueurs (fermées au manager).

Mise en page, deux colonnes 7 / 5 :
- **À venir (7 jours)** : une ligne par événement (type, jour, heure, titre),
  avec la présence en pastilles « 4 / 5 · 1 absent · 0 sans réponse » ; une
  absence ouvre en ligne le nom, la raison et **« Trouver un remplaçant »**
  (liste des joueurs dispo sur ce créneau, d'après les dispos) ; bouton
  « + Nouvel événement ».
- **Présence à surveiller** : les réponses manquantes à moins de 48 h, avec
  « Relancer » (notification + DM Discord si lié).
- **Tâches ouvertes du groupe** : toutes les tâches non faites, triées par
  échéance, filtre « Toutes / En retard / Sans responsable », « + Tâche ».
- **Annonces** : même carte que § 16.3 (3 lignes, « Voir tout le message »,
  « Voir toutes les annonces »), plus « + Publier une annonce ».
- **Dispos de l'équipe** : la matrice de la semaine (joueurs × jours) déjà
  présente dans le Planning, en lecture.

### 18.2 Joueur sans groupe : une seule entrée « Équipe »

Sans groupe, la section *Équipe & staff* de la barre latérale ne garde
qu'**une** entrée, **« Équipe »** (icône groupe), à la place de Lobby,
Management, Coaching, Stats collectives et Sessions d'équipe. Elle ouvre
`/team` en mode **« Pas encore d'équipe »** :

- titre « Rejoins une équipe » et une phrase : « Le Lobby, le Planning, le
  Coaching et les stats d'équipe s'ouvrent dès que tu fais partie d'un
  groupe. » ;
- trois cartes côte à côte :
  1. **Rejoindre avec un code** : champ code d'invitation + « Rejoindre »
     (rappel : compte Riot lié obligatoire, lien vers le Profil s'il manque) ;
  2. **Créer un groupe** : nom + type (équipe / coaching) + « Créer » ;
  3. **Je cherche une équipe** : « Publier une annonce LFT » (l'export LFT
     existant), avec un aperçu de sa carte joueur.
- Dès qu'un groupe existe, les 5 entrées reviennent (Lobby d'équipe en
  premier, décision du 20/11).

Pratique et Analyse ne changent pas ; aucune carte d'équipe (L1-L6) ne
s'affiche sans groupe.

### 18.3 Check-in bien-être au lancement d'une session d'équipe (L7)

Quand une session d'équipe démarre (automatiquement à l'heure, décision du
20/11) et que le joueur a donné son **accord bien-être**, un **toast large**
en bas à droite (pas une modale) : « Check-in avant la session ? » avec les
trois échelles énergie / humeur / sommeil en pastilles 1-5 directement
cliquables, et deux liens « Envoyer » / « Plus tard ». Il se ferme seul au
bout de 60 s, ou si le joueur a déjà fait son check-in du jour. Jamais
obligatoire, jamais bloquant ; sans accord bien-être, rien ne s'affiche. Une
seule fois par session.

### 18.4 Scouting d'un joueur : dossiers publiés seulement

Pour un membre **non staff** (joueur, capitaine), Coaching › Scouting n'affiche
plus la liste éditable des adversaires : il voit **les dossiers adverses
publiés** par le staff (§ 12), en cartes (logo / tag, nom, « Publié le 19 nov.
par Coach Sora », bilan contre nous). Clic → le dossier en lecture seule.
Vide : « Ton staff n'a pas encore publié de dossier adverse. » Pas de bouton
d'ajout, pas d'actualisation Riot.

### 18.5 Liaisons L1-L6

| Liaison | Où | Rendu |
|---|---|---|
| L1 plan du coach | **Mon plan** (en tête) + Dashboard | Carte « Plan de mon coach » : axe, période, notes du coach. Au Dashboard, une ligne compacte « Plan de Coach Sora : vision · jusqu'au 30 nov. → ». |
| L2 objectifs attribués | **Mon plan** + Dashboard | Section « Objectifs de mon coach » dans Mon plan (liste + état) ; au Dashboard, compteur « 2 objectifs du coach » dans la carte d'équipe. |
| L3 verdicts sur mes micro-reviews | **Revue** de la partie concernée + Labo d'erreurs | Sous chaque réponse de micro-review jugée : bandeau « Verdict de Coach Sora : justifié / à corriger » + commentaire. Au Dashboard : « 3 nouveaux verdicts → ». |
| L4 tâches attribuées | **Dashboard** | Ligne « 2 tâches à faire → » (vers « Mon espace » § 16). |
| L5 prochain événement | **Dashboard** | Bandeau « Prochain : Scrim vs KCA · mar. 19:00 · Je serai là ? » avec les deux boutons de présence (le même que § 16). |
| L6 actions de review VOD | **Mon plan** | Section « À travailler (review VOD) » : actions avec la case « fait », lien vers le moment de la VOD. |

**Carte « Mon équipe » du Dashboard** : L2, L3, L4 et L5 se regroupent dans
une seule carte compacte du Dashboard (prochain événement en tête, puis trois
lignes compteur), pour ne pas disperser le Dashboard. Sans groupe : carte
absente.

**Textes FR / EN.** « Organisation » / « Organization » ; « Trouver un
remplaçant » / « Find a sub » ; « Relancer » / « Remind » ; « Rejoins une
équipe » / « Join a team » ; « Je cherche une équipe » / « I'm looking for a
team » ; « Check-in avant la session ? » / « Check in before the session? » ;
« Plus tard » / « Later » ; « Plan de mon coach » / « My coach's plan » ;
« Objectifs de mon coach » / « My coach's goals » ; « À travailler (review
VOD) » / « To work on (VOD review) » ; « Mon équipe » / « My team ».

## 19. Spec Front-end — page Review retravaillée (21/11)

Décisions du 21/11 (`docs/DECISIONS.md`). Maquette Penpot : page « Review —
rework 21/11 », plan « Review · page retravaillée » et « Panneau · Erreurs
détectées ».

**Ordre de la page** (1120 px, une colonne de 1056) :
1. **En-tête** : « Review » + badge Victoire / Défaite ; ligne champion, rôle,
   durée, objectif de session. À droite, bouton outline **« Erreurs détectées
   · N »** (N = erreurs auto-détectées de la partie). Masqué si l'utilisateur a
   choisi « Je tague mes erreurs moi-même » (Réglages, 21/11).
2. Pastilles de stats (inchangées).
3. **Lecteur unique + panneau droit** côte à côte (680 + 360, écart 16).
   Décision du 21/11 « Un seul lecteur vidéo » : la page n'a **qu'un lecteur**,
   celui de l'enregistrement ; la micro-review n'a plus le sien et le pilote.
   Maquette : plan « Review v2 · un seul lecteur ».
   - **Panneau droit** (décision du 21/11, « même emplacement que notes
     marquées, avec un filtre pour switch entre les 2 ») : en haut, un
     **sélecteur à deux segments** 328 px, fond `black`, contour `border-dim`,
     rayon 8 : **« Micro-review 2 / 3 »** · **« Notes marquées 4 »** ; segment
     actif fond `elevated` + contour or, texte `gold-bright`, compteur mono
     `text-dim`. Par défaut : Micro-review tant qu'il reste un moment à
     répondre, sinon Notes marquées. Contour du panneau or en mode
     Micro-review, `border-dim` en mode Notes. Contenu Micro-review : § 20.
     Plans « Panneau droit · état Micro-review » et « … · état Notes marquées ».
   - **Barre du lecteur v2** (décisions du 21/11 « la barre actuelle, améliorée,
     dans le thème » puis « tu flood la bar, il y a besoin de filtres »).
     Maquettes : plans « Barre du lecteur v2 · états » (normal, mode
     micro-review) et « … · menu Filtres ouvert ». Fond `black`, padding 12,
     de haut en bas :
     1. **Repères en icônes** au-dessus de la timeline : pastille ronde 18 px,
        fond couleur 16 %, contour 1 px, glyphe de la couleur. Par défaut une
        seule rangée (Mes notes, Micro-review). Les événements de partie
        (objectifs, fights), quand ils sont filtrés, ont une **deuxième
        rangée** sous une ligne pointillée `border-dim` (toi en haut, partie
        en bas).
     2. **Regroupement** : deux repères à **moins de 26 px** se fondent en une
        pilule (jusqu'à 2 glyphes, par priorité Nashor > Drake > Héraut >
        Inhib > Larves > Tours, + compteur mono 9 px gras). Survol → info-bulle
        `elevated` avec chaque élément, par heure (« 21:30 · Nashor ·
        ennemi »). Clic → saute au premier.
     3. **Timeline** 5 px, rayon 2,5 : non lue `border-dim`, lue or ; tête
        de lecture rond 12 px `#E4C285` + fin trait vertical jusqu'aux repères.
     4. **Ligne des heures** : « 0:00 » à gauche, durée à droite. Survol de
        la timeline : l'heure sous le pointeur.
     4 bis. **Rangée de pastilles** (décision du 21/11 « retour à la rangée
        de pastilles », dite à Front, **déjà codée**, tous les lecteurs) :
        groupe segmenté **MINE / ALL / OBJECTIVES**, puis **une pastille
        colorée par type d'événement avec son compte** (KILL, DEATH, ASSIST,
        TOWER, PLATE, DRAKE, NASHOR, HERALD, VOIDGRUB, INHIB…), puis **Mes
        notes**, **Micro-review** et **AUTO** (erreurs détectées, aussi dans
        l'onglet « Notes marquées »). Un clic masque le type, un second le
        réaffiche. Le code fait foi pour les couleurs et l'ordre ; la règle de
        sauvegarde ci-dessous s'applique à cette rangée.
     5. **Contrôles** : moment précédent, −10, **lecture** (rond or 36 px),
        +10, moment suivant, volume (curseur au survol), heure « 9:12 /
        26:10 » (courante en `gold-bright`). À droite : vitesse « 1× ▾ »
        (menu 0,25× → 2×), **« Clip »** (outline `border`, ciseaux,
        raccourci **C** en info-bulle, voir « Mode clip »), **« Erreur »**
        (outline `#E3A35B`, triangle, raccourci **E** en info-bulle : ajoute
        une erreur à l'heure courante, ouvre le sélecteur de tag), **« Prise
        de note »** (§ 21, pastille **N** visible). La bascule du panneau
        droit et le plein écran passent **dans le coin haut droit de la
        vidéo** (fond noir 55 %, rayon 8, visibles au survol).
   - **Coin de la vidéo : disposition du panneau** (décision du 21/11 ;
     plans « Review v2 · panneau à gauche (mémorisé) » et « … · panneau
     masqué (lecteur pleine largeur) »), trois icônes 20 px dans l'ordre :
     1. **Changer de côté** (⇄) : le panneau latéral passe à gauche ou à
        droite du lecteur (lecteur et panneau échangent leur place, mêmes
        largeurs 680 / 360). Info-bulle « Panneau à gauche · mémorisé » (ou
        « à droite »). Inactif (35 %) quand le panneau est masqué.
     2. **Masquer / afficher le panneau** (touche **P**) : l'icône montre la
        moitié or du côté du panneau ; masqué, cadre vide + trait pointillé.
        Panneau masqué : **le lecteur prend toute la largeur** (1056 px,
        vidéo 16:9 à 594 px de haut, timeline étirée) ; un **onglet**
        « ◎ Micro-review 2 / 3 ◂ » (ou « Notes marquées 4 ») sous les
        icônes, fond noir 55 % + contour or, rouvre le panneau d'un clic.
     3. Plein écran.
     **Les deux réglages (côté, masqué) sont sauvegardés** dans les réglages
     de l'utilisateur, synchronisés au compte, comme les filtres : ils
     restent tels quels à chaque ouverture et sur toutes les reviews, jusqu'à
     ce que le joueur les change. Fermeture automatique : jamais.
   - ~~Menu « Filtres »~~ **REMPLACÉ** (décision du 21/11 « retour à la rangée
     de pastilles », voir 4 bis) : ne pas coder le pop-over ci-dessous. Seule
     la règle de **sauvegarde** reste valable, appliquée à la rangée de
     pastilles. Ancien texte pour mémoire : pop-over 300 px au-dessus du
     bouton, `elevated`,
     contour `border`, ombre) : titre « Afficher sur la timeline » +
     « Réinitialiser » ; section **TOI** : Mes notes, Micro-review, Erreurs
     détectées (absente si « Je tague mes erreurs moi-même »), Morts ;
     section **PARTIE** : « Objectifs · tous » (case à trois états) puis les
     types en pastilles (Drakes, Nashor, Héraut, Larves, Tours, Inhibs),
     Fights. Chaque ligne : case à cocher or, glyphe, nom, compteur. Puis
     « Zoom de la timeline − 1× + » et « Mémorisé pour toutes tes parties. »
     **Par défaut : Mes notes + Micro-review seulement** (premier lancement
     uniquement). **Sauvegarde** (décision du 21/11) : chaque changement est
     enregistré tout de suite dans les réglages de l'utilisateur (synchronisés
     avec son compte) ; il **n'est jamais remis à zéro** à l'ouverture d'une
     page et s'applique à **tous les lecteurs** de l'app (Review,
     Enregistrements, lecteur plein écran, VOD d'équipe). Seul
     « Réinitialiser » revient au défaut. Le mode micro-review atténue mais ne
     change pas les filtres.
   - **Mode clip** (bouton « Clip », touche **C**, ou « Clipper ce moment »
     dans le panneau Micro-review ; décision du 21/11 « interface clip user
     friendly ») ; plans « Barre du lecteur v2 · mode clip » :
     1. Barre au contour or. En haut, **vue d'ensemble** de la partie (3 px)
        avec la zone zoomée encadrée or et le clip en `gold-bright`.
     2. **Timeline zoomée automatiquement** autour du clip (± 2 min environ,
        heures aux bords) ; sélection `gold-bright` 22 % + contour, **deux
        poignées** 10 × 26 `gold-bright` à rainures, à glisser ; bulle de
        durée « 0:30 » au-dessus. Sélection par défaut : **heure courante
        − 10 s → + 20 s** ; depuis la micro-review : la fenêtre du moment.
     3. **Panneau clip** (`elevated`) : titre « Nouveau clip » avec ciseaux ;
        champs **Début** et **Fin** (heures modifiables au clavier, touches
        **I** et **O** pour poser la borne à l'heure courante) + « = 30 s » ;
        ligne **DURÉE** : 10 s, 30 s, 1 min, 2 min (centrées sur l'heure
        courante) et « Moment de micro-review » ; champ **Titre du clip
        (facultatif)**, **« ↻ Aperçu »** (lit la sélection en boucle),
        « Annuler » (Échap), **« Enregistrer le clip »** (Entrée).
     4. Après enregistrement, la barre revient en mode normal et une bande
        `elevated` s'affiche 8 s : « ✓ Clip enregistré 9:02 → 9:32 » +
        « Rangé dans Mes clips → » (or) et les actions **Exporter MP4**,
        **Copier le lien**, **Partager à l'équipe** (flux existants :
        export, `ClipSharePanel`).
   - **Couleurs des repères** : notes `#D4A24C`, micro-review `#E66556`,
     erreurs `#E3A35B`, morts `#B5A68C`, drake `#E08A3C`, Nashor `#A97BF0`,
     Héraut `#6FA0D8`, larves `#5FB38A`, tours `#8C96A3`, inhibs `#D86FA0`,
     fights `#E4D9C4`. Glyphes : signet, cible, triangle, crâne, flamme,
     couronne, œil, larve, tour, cercle barré, épées croisées.
   - **Mode micro-review** (moment ouvert dans le panneau droit) : la fenêtre
     du moment (objectif − 60 s → + 45 s ; mort − 45 s → + 30 s) est
     surlignée (bande or 8 % sur les repères, cadre or 18 % + contour
     `gold-bright` sur la timeline) ; ses **trois traits** Erreur `#E3A35B`,
     Conséquence `--hextech-red`, Conclusion `text-bright` dépassent de la
     timeline ; **les repères hors fenêtre passent à 32 %**. Sous la
     timeline, au centre : « Micro-review · 15:25 → 17:10 » mono or. Le
     lecteur se cale au début de la fenêtre ; tout revient à 100 % en
     quittant la micro-review.
   - **Notes marquées** (lecture) : une ligne par note, triées par heure :
     heure en mono or, badge de source (« MICRO-REVIEW » rouge, « PRISE DE
     NOTE » or), titre ; dessous, les tags choisis ou le texte de la note.
     Clic → la vidéo saute à l'heure. Les notes pré-remplies ne contiennent
     plus d'événements de partie : seulement les moments de micro-review
     (titre + tag choisi) et les Prises de note (décision du 21/11).
   - Sans enregistrement : lecteur remplacé par « Pas d'enregistrement pour
     cette partie » ; la liste des notes reste.
4. *(Micro-review : plus de bloc sous le lecteur, elle est dans le panneau
   droit.)* Si « Je fais mes reviews moi-même » : pas de sélecteur, le
   panneau droit montre seulement Notes marquées.
5. **Bloc-notes** (remplace les *timeline notes* et le champ « Impressions ») :
   carte pleine largeur, titre « Bloc-notes », phrase d'aide, zone de texte
   libre de 160 px minimum qui grandit avec le contenu, enregistrement
   automatique (« Enregistré · il y a 3 s » en mono). Pas d'heure, pas de
   bouton d'ajout : on écrit, c'est tout.
6. **Guide des notes**, replié par défaut : une ligne pointillée « ▸ Guide :
   quoi noter pendant une review », clic → déplie le guide actuel.
7. Question d'objectif (inchangée), puis « Reviewer plus tard » et
   « Enregistrer la review ».

**Panneau « Erreurs détectées »** (Dialog 440 px, ou panneau latéral droit) :
titre, phrase « Ce que l'app a repéré dans cette partie. Supprime celles qui
sont fausses : le Labo d'erreurs en devient plus juste. » ; une ligne par
erreur : heure (mono or), tag (texte clair), raison courte (mono `text-dim`),
deux actions **« Modifier l'erreur »** (or) et **« Supprimer »** (rouge).
Maquette : plan « Panneau v2 · Erreurs détectées (modifier + pourquoi) »
(480 px), décisions du 21/11.
- **Modifier l'erreur** : la ligne s'ouvre (fond `elevated`, contour or) :
  « NOUVEAU TAG », champ de recherche « Chercher un tag (les tiens + Codex) »,
  propositions en pastilles (choisie : rouge 14 % + contour rouge), puis
  l'étape « Pourquoi ? », puis « Enregistrer » (bouton principal).
- **Supprimer** : la ligne s'ouvre (contour rouge) sur l'étape « Pourquoi ? »,
  puis « Supprimer » (outline).
- **Étape « Pourquoi ? (facultatif) »**, commune aux deux : encart or 8 % ;
  titre + lien **« Passer »** à droite (valide l'action **en un clic**, sans
  raison) ; 5 raisons cliquables, une seule choisie (contour or + fond or
  18 %) : **Pas une erreur · Mauvais tag · Mal daté · Contexte d'équipe ·
  Autre** ; champ libre facultatif, **300 caractères max**, compteur « 52 /
  300 » mono. Pré-sélection : « Pas une erreur » pour Supprimer, « Mauvais
  tag » pour Modifier.
- Une erreur supprimée reste grisée (55 %) avec sa raison et **« Annuler »**
  jusqu'à la fermeture du panneau ; une erreur modifiée affiche son nouveau
  tag. Pied « 1 supprimée · 1 modifiée · le Labo en tient compte ». Vide :
  « L'app n'a rien détecté dans cette partie. »

**Textes FR / EN.** « Erreurs détectées » / « Detected mistakes » ; « Notes
marquées » / « Marked notes » ; « Bloc-notes » / « Notepad » ; « Guide : quoi
noter pendant une review » / « Guide: what to note during a review » ;
« Supprimer » / « Delete » ; « Annuler » / « Undo » ; « Modifier l'erreur » /
« Edit mistake » ; « Pourquoi ? (facultatif) » / « Why? (optional) » ;
« Passer » / « Skip » ; « Pas une erreur » / « Not a mistake » ; « Mauvais
tag » / « Wrong tag » ; « Mal daté » / « Wrong time » ; « Contexte d'équipe » /
« Team context » ; « Autre » / « Other » ; « Afficher » / « Show » ;
« Mes notes » / « My notes » ; « Morts » / « Deaths » ; « Objectifs » /
« Objectives » ; « Fights » / « Fights » ; « Filtres » / « Filters » ;
« Afficher sur la timeline » / « Show on timeline » ; « Réinitialiser » /
« Reset » ; « Objectifs · tous » / « Objectives · all » ; « Zoom de la
timeline » / « Timeline zoom » ; « Mémorisé pour toutes tes parties. » /
« Remembered for all your games. » ; « Erreur » / « Mistake » ; « Clip » /
« Clip » ; « Nouveau clip » / « New clip » ; « Début » / « Start » ; « Fin » /
« End » ; « Durée » / « Length » ; « Moment de micro-review » /
« Micro-review moment » ; « Titre du clip (facultatif) » / « Clip title
(optional) » ; « Aperçu » / « Preview » ; « Enregistrer le clip » / « Save
clip » ; « Clip enregistré » / « Clip saved » ; « Rangé dans Mes clips » /
« Saved to My clips » ; « Exporter MP4 » / « Export MP4 » ; « Copier le
lien » / « Copy link » ; « Partager à l'équipe » / « Share with team » ;
« Clipper ce moment » / « Clip this moment » ; « Zoom auto autour du clip ·
glisse les poignées » / « Auto-zoom around the clip · drag the handles » ;
« Changer de côté » / « Switch side » ; « Panneau à gauche · mémorisé » /
« Panel on the left · saved » ; « Masquer le panneau » / « Hide panel » ;
« Afficher le panneau » / « Show panel ».

## 20. Spec Front-end — boîte de micro-review (21/11)

Décision du 21/11. Maquette Penpot : page « Review — rework 21/11 », plan
« Micro-review · boîte (maquette 2) ». La mini-carte de preuve est la
maquette 5 (§ 23).

**Un seul lecteur (21/11)** : la boîte **n'a plus de lecteur vidéo**. Elle
pilote celui de la page (§ 19, point 3). Maquette : plan « Micro-review v2 ·
pilote le lecteur ». Ouvrir un moment (onglet ou « Moment suivant ») cale le
lecteur au début de sa fenêtre et passe la timeline en mode micro-review.

**Emplacement (21/11)** : la micro-review est un **état du panneau droit**
du lecteur (360 px, § 19 point 3), à la place des Notes marquées, via le
sélecteur « Micro-review · Notes marquées ». **Pas de mini-carte de
preuve** (décision du 21/11 « ne pas montrer la carte avec les positions ») :
les lieux restent en mots dans la phrase de contexte.

**Structure** (une colonne de 328 px) : sélecteur, onglets des moments (✓
vert si répondu, sinon le numéro ; heure mono), titre du moment en `Card
title` or + badge « OBJECTIF » / « MORT », puis :
1. Contexte du moment en une phrase (`Small`, lieu en mots, jamais de
   distance).
1 bis. **« PARCOURIR DANS LE LECTEUR »** : les **trois pastilles**
   Erreur · Conséquence · Conclusion (§ 23) avec leur heure ; clic → le lecteur
   unique saute à l'heure (pas de lecture locale). Pastille active contour 2 px.
2. « QU'EST-CE QUI A COÛTÉ CE MOMENT ? » : les causes proposées (une seule
   sélectionnable), puis « Autre cause… ».
   Points 3 et 4 **repliés** par défaut dans le panneau étroit : une ligne
   pointillée « ▸ Raisons d'après moi · autres tags d'erreur », clic → déplie.
3. **« Raisons de l'erreur d'après moi (facultatif) »** : zone de texte de 64
   px, 300 caractères.
4. **« Autres erreurs dans ce moment »** : liste des tags ajoutés ; chaque
   ligne = pastille du tag (rouge 14 %) + champ « Description (facultatif) »
   (140 caractères) + ✕. Bouton outline **« + Ajouter un tag d'erreur »** :
   ouvre un sélecteur avec recherche dans les tags du joueur et ceux du Codex
   (même liste que le Labo d'erreurs), plusieurs tags possibles.
5. Pied : à gauche « Enregistré comme note marquée à 1:17 » (mono
   `text-dim`) ; à droite « Moment suivant → ». Chaque moment répondu devient
   une note marquée à son heure (§ 19).

**Fin de la micro-review** (après le dernier moment), à la place des
réponses :
- titre « Micro-review terminée · 3 moments » ;
- **« Continuer sur d'autres moments clés »** (bouton principal) : propose les
  3 moments suivants classés par le moteur ;
- **encouragement** : carte or 10 % « Une erreur critique que l'app n'a pas
  vue ? » + bouton outline **« Ajouter une erreur non détectée »** (ouvre le
  même sélecteur de tag, avec une heure à choisir sur la timeline) ;
- lien « Terminer » qui replie la boîte.

**Textes FR / EN.** « Raisons de l'erreur d'après moi » / « Why I think it
happened » ; « Autres erreurs dans ce moment » / « Other mistakes in this
moment » ; « Ajouter un tag d'erreur » / « Add a mistake tag » ;
« Description (facultatif) » / « Description (optional) » ; « Enregistré
comme note marquée à 1:17 » / « Saved as a marked note at 1:17 » ;
« Continuer sur d'autres moments clés » / « Continue with other key moments » ;
« Ajouter une erreur non détectée » / « Add a mistake the app missed ».

## 21. Spec Front-end — bouton « Prise de note » (lecteur d'enregistrement)

Décision du 21/11 : le seul moyen d'écrire une note datée, mis en valeur.
Maquette Penpot : page « Review — rework 21/11 », plan « Prise de note ·
lecteur (maquette 3) ».

- Dans la barre de contrôle de `VideoReviewPlayer` (sur la Review : le
  **lecteur unique**, § 19 ; aucun autre lecteur n'en porte), le lien cyan « Noter » devient un **bouton plein or**, h 34 px,
  padding 0 14, rayon 8 : icône crayon + **« Prise de note »** + pastille de
  raccourci **N** (fond noir 25 %). Placé à droite de la vitesse, toujours
  visible (pas dans un menu).
- Clic ou touche **N** : la vidéo se met en pause et un **pop-over** 360 px
  s'ouvre au-dessus de la barre, à droite : titre « Prise de note » + heure
  courante en mono or ; zone de texte 64 px (focus automatique) ; tags
  facultatifs (pastilles + « + tag », mêmes tags que le Labo) ; pied
  « Entrée enregistre · Échap annule » + bouton « Noter ». Contour or 1 px,
  ombre portée.
- La note apparaît aussitôt comme repère or sur la timeline et dans « Notes
  marquées » (§ 19). Le bouton « Signet » séparé disparaît : il fait doublon.
- Textes : « Prise de note » / « Take a note » ; « Noter » / « Save note » ;
  « Entrée enregistre · Échap annule » / « Enter saves · Esc cancels ».

## 22. Spec Front-end — annonce LFT : champion, skin et fond de carte

Décision du 21/11 : mêmes choix que la carte du Lobby (§ 14). Maquette
Penpot : plan « Annonce LFT · choix de la carte (maquette 4) ».

Dialogue LFT, deux colonnes : **aperçu en direct** de l'affiche à gauche
(300 × 525, rendu 1080 × 1920 à l'export), réglages à droite (608 px) :
1. **Champion · parmi ton top** : « Auto » + les 5 champions du dos de la
   carte, tuiles 56 px, sélection contour or 2 px.
2. **Skin · avec détouré seulement** : tuiles 96 × 128 du champion choisi ;
   seuls les skins avec détouré sont listés (décision du 20/11) ; mention en
   `Data small text-dim`.
3. **Fond de carte** : les 7 motifs (`CARD_BACKGROUNDS`), vignettes 64 × 112
   (`CardPatternThumb` existant).
4. **Filtre couleur** : les 6 teintes + « Aucun » (existant).
Pied : « Annuler » / « Exporter l'annonce ». Par défaut, le choix de la carte
du Lobby (§ 14) est repris ; le changer ici ne modifie que l'annonce.

## 23. Spec Front-end — carte de micro-review : lieux, preuve, extrait

Décisions du 20/11 (rapports `docs/moteur/engine-reports/2026-11-20-*`). Maquette
Penpot : plan « Carte de micro-review · objectif (maquette 5) ».

- **En-tête à l'heure de l'objectif** (pas de l'ancrage interne) : heure en
  `Section title` or, titre du moment, badge « OBJECTIF » (ou « MORT »).
- **Phrase de contexte** avec les lieux en mots, jamais de distance ni
  d'unités ; fosse toujours nommée (« fosse du Dragon », « des Larves », « du
  Héraut », « du Baron »).
- ~~Mini-carte de preuve~~ **retirée de la Review** (décision du 21/11 « ne pas
  montrer la carte avec les positions »). Spec gardée pour mémoire, à ne pas
  coder sur la Review. **Mini-carte de preuve**, 340 × 340 (`MiniMap.tsx`) :
  lanes et base en `border-dim`, rivière `#1E3A4A`, la **fosse nommée** en
  cercle pointillé or 12 % + son nom en or 11 px ; la **tour prise** en
  losange or + « T1 top · 15:14 » mono 10 px ; l'**objectif tombé** en
  losange rouge ; les **points du joueur** autour du moment reliés par un
  trait pointillé : point plein = **position exacte** (relevé Riot ou
  événement), cercle pointillé = **position estimée** (« 16:25 ~ »). Légende
  sous la carte, 3 lignes. Les étiquettes ne se chevauchent pas : décaler à
  gauche ou au-dessus du point si besoin.
- **« Où tu étais »** à droite : une ligne par point (heure mono or, lieu en
  badge clair, ce qui se passe, « exacte » / « estimée ~ » à droite).
- **Extrait, sans lecteur propre** (décision du 21/11 « Un seul lecteur ») :
  la fenêtre **objectif − 60 s à objectif + 45 s** (mort : **−45 s à +30 s**)
  est surlignée sur la timeline du **lecteur unique** de la Review (§ 19). La
  carte garde **trois pastilles cliquables** : **Erreur** (orange `#E3A35B`),
  **Conséquence** (rouge), **Conclusion** (`text`), chacune avec son heure ;
  la pastille active a un contour 2 px. Clic : le lecteur unique saute à
  l'heure. Vidéo absente : pastilles masquées ; la carte garde la mini-carte
  et les lieux.
- Textes : « Où tu étais » / « Where you were » ; « exacte » / « exact » ;
  « estimée » / « estimated » ; « Erreur · Conséquence · Conclusion » /
  « Mistake · Consequence · Outcome ».
