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
