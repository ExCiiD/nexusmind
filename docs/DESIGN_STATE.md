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
| Pas encore détouré (`refused`/`missing`, ou pas encore calculé) | contour pointillé `border-field`, skin à 35 % flouté, badge « EN ATTENTE » en haut à gauche (texte complet « Pas encore détouré » en info-bulle : la version longue déborde d'une tuile de 142 px) ; reste choisissable : la carte garde alors l'illustration estompée (comportement actuel de `CardChampionArt`) |
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
