# Notes Front-end — Ascend (NexusMind)

Session **Front-End Dev** (`frontend-dev`), mise en place le 19/11/2026.
Périmètre (voir `docs/TEAM_ROLES.md`) : `src/components/`, `src/pages/`,
`src/hooks/`, `src/store/`, `web/src/` (sauf `web/src/api.ts`), `src/i18n/`,
`.harness/`. Hors périmètre : `electron/`, `src/lib/`, `prisma/`, `supabase/`,
`cloudflare/`, `scripts/`, tokens de thème (`tailwind.config.ts`,
`src/index.css`, à Graphic Design). Un fichier hors périmètre se demande au
Chief.

## 1. Carte du code

- **Desktop** : `src/App.tsx` (routes, toutes importées en direct, pas de
  `React.lazy`), `src/components/Layout/{AppLayout,Sidebar}.tsx`.
  Pages par dossier dans `src/pages/<Section>/`. Section « Équipe & staff » :
  `Management/`, `TeamSpace/`, `Coaching/` (sections `*Section.tsx`),
  `Team/` (= Stats collectives + onglets Roster, Champion Pool, Draft, Scouting).
- **Primitives UI** : `src/components/ui/` (style shadcn : Radix + `cva` +
  `cn()` de `src/lib/utils.ts`) — button, card, badge, dialog, input, select,
  slider, switch, tabs, textarea, toast/toaster, tooltip (portail).
- **État** : Zustand dans `src/store/` (`useUserStore`, `useActiveGroupStore`
  — groupe actif partagé, clé `ascend_active_group` —, `useGameStore`,
  `useSessionStore`, `useBackgroundJobsStore`).
- **Données** : toujours via `window.api.*` (preload Electron). Le
  front ne parle jamais directement à Prisma, Supabase ou Riot.
- **Web app** : `web/src/` (Vite à part, `web/vite.config.ts`) — `WebLayout`,
  `pages/{Home,Account,MyReviews,Scrims,Team}Page.tsx`, adaptateur
  `api.ts` (Back-end). La web app réutilise des composants de `src/` : toute
  modif d'un composant partagé se vérifie aussi en web (`npm run web:dev`,
  serveur `web-dev`, port 5180).

## 2. Règles de composants

1. Réutiliser les primitives de `src/components/ui/` avant d'écrire un
   bouton / dialogue / onglet maison. Variantes via `cva`, fusion de classes
   via `cn()`.
2. Un composant = un fichier, export nommé, props typées (pas de `any` dans
   les props). Un écran de plus de ~400 lignes se découpe en sous-composants
   du même dossier.
3. Les panneaux indépendants d'un écran sont entourés de
   `PanelErrorBoundary` : une erreur ne doit pas blanchir toute la page.
4. Pas de logique métier dans le JSX : calculs purs dans `src/lib/*Core.ts`
   (Back-end) ou, s'ils sont purement d'affichage, dans un helper testé du
   dossier de la page.
5. États obligatoires pour tout écran qui charge : chargement, vide, erreur
   (texte traduit + action pour réessayer quand c'est possible).
6. Pas de `confirm()` / `alert()` natifs : `Dialog` de `ui/` (traduisible,
   au thème, accessible). Pas de toast en dur en anglais.
7. Groupe actif : lire `useActiveGroupStore`, ne pas recréer de sélecteur
   local (`GroupSwitcher` unique dans les en-têtes).

## 3. Thème et Tailwind

- Couleurs **uniquement** par jetons : `hextech-*` (`black, dark, elevated,
  panel, border, border-dim, cyan, teal, gold, gold-bright, red, green, text,
  text-bright, text-dim, blue, blue-bright`) ou alias shadcn (`primary`,
  `secondary`, `muted`, `destructive`, `border`, `ring`…). Jamais de hex en
  dur dans une classe ni un `style` : sinon le changement de thème
  (`data-theme` : piltover, noxus, ionia, shurima, freljord, zaun, void)
  casse. Les modificateurs d'opacité (`bg-hextech-gold/20`) marchent grâce à
  `color-mix`.
- `red` = défaite / danger, `green` = victoire / succès, sur tous les thèmes.
  Les couleurs de tiers du Champion Pool viennent de `TIER_COLOR` (une seule
  source).
- Boîtes : `rounded-lg` (8 px partout, `xl/2xl/3xl` identiques) ; puces
  `rounded` / `rounded-sm` (4 px) ; pastilles et avatars `rounded-full`.
- Typo : titres h1-h3 et `.font-display` en Big Shoulders Display majuscules
  (règle en fin de `src/index.css`) ; sortir avec `font-sans`/`font-mono`,
  `normal-case`. Chiffres et kickers : `font-mono`.
- Un besoin de nouveau jeton ou de nouvelle couleur passe par Graphic Design.
- Changement visuel = maquette Penpot validée d'abord (sauf retouche
  d'interface explicitement demandée sans maquette).

## 4. i18n

- `react-i18next`, `src/i18n/locales/{en,fr}.json` (3 112 clés au 19/11),
  `fallbackLng: 'en'`, langue en `localStorage` `nexusmind_lang`.
- Tout texte visible passe par `t('section.cle')` (ou `Trans`/`i18nKey`),
  clés littérales pour que `npm run check:i18n` les voie ; ajouter la clé
  dans **les deux** fichiers dans le même changement. Pluriels :
  `cle_one` / `cle_other`.
- FR : jargon LoL en anglais (shotcalling, spacing, trades, waves, gank,
  roam, cooldowns, jungle tracking, MVP…). Les deux registres coexistent
  (≈ 190 textes au « vous », ≈ 60 au « tu ») : suivre celui de l'écran
  touché, ne pas mélanger dans un même écran.
- Dates, nombres, durées : `Intl` / `toLocaleString(i18n.language)`, pas de
  format codé en dur.
- Vérifier les deux langues dans le harnais (le FR est en général plus long :
  pas de débordement).

## 5. Accessibilité

- Éléments cliquables = `<button>` / `<a>` (jamais un `div onClick`), focus
  visible (`focus-visible:ring-1 ring-ring` des primitives).
- Bouton icône seul : `aria-label` traduit. Infobulles Radix, pas `title`
  seul pour une info importante.
- Dialogues Radix (piège du focus, Échap, `DialogTitle` obligatoire).
- Contraste : le texte bas (`text-dim`) est réglé à 4,5:1 sur toutes les
  surfaces ; ne pas descendre en dessous (pas de `text-dim/60` pour du texte).
- Une information portée par une couleur (tier, menace, win/loss) a aussi un
  texte ou une icône.
- `<html lang>` suit déjà la langue (config i18n).

## 6. Performance

- Listes longues (historique, champions, skins ~2 145) : pagination ou
  virtualisation, images `loading="lazy"` avec taille fixée (pas de saut de
  mise en page).
- `useMemo` / `useCallback` seulement là où un calcul ou un rendu enfant est
  coûteux et mesuré ; sélecteurs Zustand fins (`useStore(s => s.x)`) plutôt
  que le store entier.
- Pas d'appel `window.api` dans une boucle de rendu ; effets avec nettoyage
  (écouteurs IPC, timers, `AbortController`).
- Les routes sont toutes chargées au démarrage (`App.tsx`) : candidat à
  `React.lazy` pour les pages lourdes, à proposer au Chief, pas à faire sans
  tâche.
- Rappel harnais : un onglet d'aperçu caché ne rend pas de frames
  (ResizeObserver / rAF muets) — prendre une capture pour forcer.

## 7. Vérification avant compte rendu

1. `npm run typecheck`, `npm run lint`, `npm run check:i18n`,
   `npx vitest run`.
2. Harnais : serveur `ui-harness` (`D:\DEV\NexusMind\.claude\launch.json`,
   port 5199, Vite + `window.api` simulé dans `.harness/mockApi.ts` et
   `.harness/mockPages.ts`, routes dans `.harness/main.tsx`). Ajouter les
   mocks nécessaires à un nouvel écran. Contrôler FR + EN, un thème non par
   défaut, largeur étroite, console sans erreur.
3. Web : `web-dev` (5180) si un composant partagé ou `web/src/` a changé.
4. Compte rendu court au Chief : fait / vérifié / non vérifié. Pas de commit.

## 8. Travail ouvert qui me revient (handoff du 19/11, § 3)

| # | Sujet | Point de départ | Dépend de |
|---|---|---|---|
| 5 | Détourage dans l'app : indicateur de téléchargement du modèle (224 Mo) ; seul le skin 0 est découpé ; tresse de Jinx coupée | `src/hooks/useChampionCutout.ts`, `src/pages/Team/CardChampionArt.tsx`, `BackgroundJobsIndicator` ; `REFINE_DEFAULTS` / `CUTOUT_VERSION` sont dans `src/lib/championCutoutCore.ts` (Back-end) | Back-end pour le cœur ; progrès du téléchargement exposé par IPC (`electron/main/championCutout.ts`) |
| 6 | Draft Sim : anciennes couleurs de tiers dans la barre du pool | `src/pages/Team/DraftTab.tsx` → `TIER_COLOR` / `MANUAL_TIERS` comme `ChampionPoolBoard.tsx` | — (prêt) |
| 7 | Scouting : adversaires de toutes les équipes de l'ordinateur | `src/pages/Team/ScoutingTab.tsx` (filtrer sur le groupe actif) ; au passage, toast en anglais en dur et `confirm()` natif à traduire / remplacer | Back-end (filtre côté IPC / `Team.groupId`) |
| 3 | Choix du skin détouré sur la page Profil | `src/pages/Profile/ProfilePage.tsx` | Pack de détourage (Graphic Design, en cours) puis hébergement (Back-end) |
| 12 | Backlog audit, items UI (UI-08, UI-11…) | `docs/AUDIT_APP_2026-11.md` § 3 | Attribution par le Chief |
| 40 | Tuile Grubs (Objectifs) : pied « camp complet : X % » au lieu de « 1er camp » | `src/components/analyst/ObjectivesView.tsx` → `ControlTiles`, clé `analyst.objectives.tiles.firstCamp` | Back-end : `grubs.fullCampShare` dans `TeamObjectivesSummary`, après la mise en production (décision du Chief, 19/11) |
