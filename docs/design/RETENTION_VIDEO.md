# Paramètres › Enregistrement : 1080p éco et conservation des vidéos

_28/11/2026, session Graphic. Décision 28/11 « Bilan de santé ». Back prêt : notes
`back-sante-28-11.md` § 1, types `VideoRetentionSettings` / `VideoPurgePlan`
(`src/lib/ipc.ts`), API `window.api.videoRetentionGet / Preview / Set`. Maquettes :
page Penpot « Paramètres — rétention vidéo », exports dans
`docs/design/video-retention/`. Aucun code._

## 1. Qualité : 5e bouton « 1080p éco »

- Rangée de 5 boutons (`grid-cols-5`), du plus léger au plus lourd :
  **720p · 1080p ÉCO · 1080p · 1440p · Source**. Valeur `recordQuality: '1080p-eco'`.
- Le bouton porte « 1080p » + une étiquette verte `ÉCO` (vert `#6FA84A` à 15 %),
  même style sélectionné / non sélectionné que les 4 autres.
- Sous l'aide actuelle, une note verte, visible **seulement quand 1080p éco est
  choisi** : « 1080p éco : 3 Mb/s, ≈ 0,45 Go par game au lieu de 0,9. HUD, minimap et
  barres de vie nettes ; effets un peu plus doux en teamfight. »

## 2. Bloc « Conservation des vidéos »

Place : dernier bloc de la carte Enregistrement, après « Dossier des
enregistrements » (séparateur fin comme les autres). Visible même si
l'enregistrement auto est coupé (les vidéos existent quand même). Desktop
seulement : caché dans la web app (`videoRetentionGet` absent).

En-tête : titre + pastille `CE PC` (réglage par PC, `userData/video-retention.json`)
+ interrupteur à droite. Description : « Supprime les vidéos les plus anciennes de
ce PC. Désactivé par défaut. Les stats, reviews et erreurs restent ; seule la vidéo
part. » Ligne d'usage : « 26 enregistrements · 24,7 Go sur ce PC · <dossier> ».

Règles (cases + champ numérique) :
- ☐ Supprimer après [30] jours (7–365) → `maxAgeDays`
- ☐ Limiter à [15] Go au total (10–2000) → `maxTotalGb`
- aide : « Âge de 7 à 365 jours · taille de 10 à 2 000 Go · les deux peuvent se
  combiner · les plus anciennes partent d'abord. » Une valeur hors bornes est
  ramenée à la borne au blur.

### États

| État | Frame | Rendu |
|---|---|---|
| **Désactivé** (défaut) | RV · A | interrupteur off, règles grisées, pas d'aperçu |
| **Réglage avant la première purge** (`confirmedAt` null) | RV · B | interrupteur on, aperçu « Avec ces règles, maintenant » (`videoRetentionPreview`, relancé 300 ms après chaque changement) : **5 protégées · 21 supprimables · 18,3 Go libérés**, barre du disque (protégées or · gardées gris · supprimées rouge contour), pastilles « Jamais supprimées : clip · bookmark · erreur taguée · review · micro-review · < 2 jours · en cours » avec leur compte (`plan.kept[].reason`). Actions : « Rien n'est supprimé avant ta confirmation. » · Annuler · **Activer…** (ouvre la confirmation). Annuler remet l'interrupteur off. |
| **Actif** | RV · C haut | aperçu « Actif · prochain nettoyage » avec « à libérer », puis « Dernier nettoyage le 21/11 : 4 vidéos supprimées, 3,4 Go libérés. Vérifié au lancement et après chaque game. » Un changement de règle actif est appliqué sans redemander (la confirmation ne vaut qu'une fois, décision Back) |
| **Actif, rien à supprimer** | RV · C bas | « Rien à supprimer pour l'instant : toutes les vidéos sont dans les règles ou protégées. » |
| aucune règle cochée, interrupteur on | — | bouton Activer… désactivé, aide « Coche au moins une règle. » |

### Confirmation (RV · D)

Dialogue modal, avant la première purge seulement (`videoRetentionSet(settings, true)`) :
- titre « Supprimer 21 vidéos de ce PC ? » avec icône rouge ;
- « 18,3 Go libérés sur <dossier>. Une vidéo supprimée ne se récupère pas. » ;
- détail : supprimées 21 (du 02/10 au 25/11), dont plus de 30 jours 14
  (`why: 'age'`), dont au-delà de 15 Go 7 (`why: 'size'`) ; gardées 5 et leurs
  raisons ;
- « Les stats, reviews, erreurs taguées et notes restent : seule la vidéo part.
  Ensuite le nettoyage se fait seul, au lancement et après chaque game, sans
  redemander. » ;
- Annuler (ghost) · **Supprimer 21 vidéos** (rouge). Focus initial sur Annuler.
  Après succès : toast « 21 vidéos supprimées · 18,3 Go libérés ».

## 3. Textes FR / EN

| FR | EN |
|---|---|
| 1080p éco · ÉCO | 1080p eco · ECO |
| 1080p éco : 3 Mb/s, ≈ 0,45 Go par game au lieu de 0,9. HUD, minimap et barres de vie nettes ; effets un peu plus doux en teamfight. | 1080p eco: 3 Mb/s, ≈ 0.45 GB per game instead of 0.9. HUD, minimap and health bars stay sharp; effects slightly softer in teamfights. |
| Conservation des vidéos · CE PC | Video retention · THIS PC |
| Supprimer après N jours · Limiter à N Go au total | Delete after N days · Cap at N GB in total |
| protégées · supprimables · libérés · à libérer | protected · deletable · freed · to free |
| Jamais supprimées : clip · bookmark · erreur taguée · review · micro-review · < 2 jours · en cours | Never deleted: clip · bookmark · tagged mistake · review · micro-review · < 2 days · recording |
| Rien n'est supprimé avant ta confirmation. | Nothing is deleted until you confirm. |
| Supprimer N vidéos de ce PC ? | Delete N videos from this PC? |
| Rien à supprimer pour l'instant | Nothing to delete for now |

Points ouverts : (A) « les stats, reviews et notes restent » : à confirmer par le Back
(seul le fichier vidéo est supprimé ?) ; (B) date du dernier nettoyage : pas dans
`VideoRetentionSettings`, à ajouter (`lastRunAt`, `lastRemoved`, `lastFreedBytes`) ou
retirer la ligne.
