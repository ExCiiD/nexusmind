# Labo d'erreurs : tiers d'erreurs (Fatale, Critique, Moyenne, Anodine)

_28/11/2026, session Graphic. Décision : `docs/DECISIONS.md` 28/11 « Tiers d'erreurs ».
État actuel : `docs/audits/ui-batch-27-11/4-mistakelab*.png`. Maquettes : page Penpot
« Labo — tiers d'erreurs », exports dans `docs/design/mistake-tiers/`. Aucun code._

## 1. Les tiers et leur marque

| Tier | Règle (décision 28/11) | Pips | Barre | Texte |
|---|---|---|---|---|
| **Fatale** | gros écart de gold d'équipe (~700 à 1 600) ou écart d'équipe qui snowball sur plusieurs minutes | ●●● | couleur de la famille, **100 %** | « Fatale » en texte clair, gras |
| **Critique** | écart dans la lane directe (~500) ou courbe de lane qui descend plusieurs minutes | ●●○ | couleur de la famille, **60 %** | « Critique » |
| **Moyenne** | le reste | ●○○ | couleur de la famille, **30 %** | « Moyenne », gris |
| **Anodine** (si Engine la garde) | erreur qui suit une fatale, sauf si elle est elle-même critique ou fatale | ○○○ | **contour seul** (1,5 px), couleur de la famille, sans remplissage | « Anodine », gris |

Pourquoi l'opacité et pas la nuance ni l'épaisseur :
- la **teinte reste celle de la famille** (rouge `#F43F5E`, ambre `#F59E0B`, bleu
  `#38BDF8`, `FAMILY_COLOR`), donc on lit toujours la famille d'un coup d'œil ;
- l'épaisseur ne marche pas dans une barre segmentée (les segments d'une même barre
  auraient des hauteurs différentes, illisible à 10 px) ;
- trois paliers d'opacité très écartés (100 / 60 / 30) se distinguent sur le fond
  sombre, même pour un daltonien, puisque c'est la luminosité qui change ;
- les **pips** (●●●) doublent l'information hors couleur : filtres, légende,
  inspecteur, lecteurs d'écran (`aria-label="Fatale"`).

## 2. Classement par fréquence

### 2.1 Barre segmentée

Une erreur qui mélange les tiers a **une seule barre**, coupée en segments dans
l'ordre **Fatale → Critique → Moyenne → Anodine**, de gauche à droite. La longueur totale
reste proportionnelle au nombre (comme aujourd'hui). Exemple pour 32× :
5 fatales, 9 critiques, 18 moyennes. 2 px d'écart entre segments, coins arrondis
seulement aux deux bouts.

Colonnes de la ligne : point de famille · nom · barre · `32×` · `39%` · **`5 ●●●`**
(nombre de fatales, en couleur de la famille, gras ; masqué à 0) · écart de winrate.
Le nombre de fatales est la seule nouvelle colonne : il dit « laquelle me coûte des
games » sans survol. Au survol de la barre, une infobulle donne le détail :
« 5 fatales · 9 critiques · 18 moyennes ».

L'ordre de tri reste la fréquence (la décision ne demande pas de changer le tri).

### 2.2 Filtre par tier

Deuxième rangée de pastilles, juste sous les familles, même style :
`Tous les tiers` · `●●● Fatales 7` · `●●○ Critiques 11` · `●○○ Moyennes 15` ·
(`○○○ Anodines 4` si le tier existe). Les deux filtres se combinent (famille ET
tier). Avec un tier choisi :
- chaque barre ne garde que le segment de ce tier, à pleine longueur relative au
  plus grand nombre de ce tier ;
- le compte et le % de la ligne deviennent ceux du tier (« 5× · 15 % des fatales ») ;
- les erreurs à 0 pour ce tier disparaissent ;
- la phrase de pied dit le filtre (« Fatales seulement : 7 sur 33 erreurs. »).

### 2.3 Légende

Le pied actuel (« Rouge : … Ambre : … Bleu : … ») gagne une ligne au-dessus :
quatre échantillons de barre (une couleur neutre, l'or `#D4A24C`, pour ne pas
suggérer une famille) avec pips et nom : « ●●● Fatale : écart de gold d'équipe ou
snowball · ●●○ Critique : écart de lane · ●○○ Moyenne : le reste · ○○○ Anodine :
après une fatale ».

### 2.4 Tuiles du haut (optionnel)

La tuile « Par partie » peut devenir « Fatales » : `7` / « sur 33 erreurs · 0,6 par
partie ». À valider : ce n'est pas demandé par la décision.

## 3. Inspecteur (panneau de droite)

- Sous le titre, la phrase « 13 fois sur 4 parties · 39 % de tes erreurs. » est suivie
  d'une **barre segmentée** (même rendu que le classement, pleine largeur) et de la
  ligne « 2 fatales · 4 critiques · 7 moyennes ».
- **Derniers moments** : chaque ligne gagne une pastille de tier sous le match, avec
  sa justification, sans distance (règle du 20/11) :
  - `●●● Fatale · −1 200 gold d'équipe en 2 min`
  - `●●● Fatale · écart d'équipe qui chute 4 min (−300 → −1 900)`
  - `●●○ Critique · −520 gold en lane en 3 min`
  - `●○○ Moyenne` (pas de justification)
  - `○○○ Anodine · après une fatale à 24:10`
- La pastille Fatale est en couleur de la famille pleine, Critique à 60 %, Moyenne
  et Anodine en gris.
- Un filtre de tier actif s'applique aussi aux derniers moments.

## 4. États

| Cas | Rendu |
|---|---|
| tier inconnu (pas de timeline : l'écart de gold ne se calcule pas) | segment **gris** `#978769` à 30 % en fin de barre ; pastille « ? Tier inconnu · pas de timeline » ; compté dans « Tous les tiers », jamais dans un tier |
| aucune erreur du tier filtré | WhyEmpty : « Aucune erreur fatale sur 30 jours. » + bouton « Voir tous les tiers » |
| Engine ne garde pas « Anodine » | pastille et segment retirés ; rien d'autre ne bouge |

## 5. Textes FR / EN

| FR | EN |
|---|---|
| Fatale · Critique · Moyenne · Anodine | Fatal · Critical · Medium · Trivial |
| Tous les tiers | All tiers |
| −1 200 gold d'équipe en 2 min | −1,200 team gold in 2 min |
| écart d'équipe qui chute 4 min | team gap falling for 4 min |
| −520 gold en lane en 3 min | −520 lane gold in 3 min |
| après une fatale à 24:10 | after a fatal one at 24:10 |
| Tier inconnu · pas de timeline | Unknown tier · no timeline |
| Fatales seulement : 7 sur 33 erreurs. | Fatal only: 7 of 33 mistakes. |

## 6. Ce que le Front doit recevoir (à confirmer par le Back / Engine)

Par occurrence : `tier: 'fatal' | 'critical' | 'medium' | 'trivial' | null`, et la
justification `{ kind: 'team-gap' | 'team-snowball' | 'lane-gap' | 'after-fatal',
gold, minutes, fromGold?, toGold?, afterSec? }` (null pour « moyenne »). Par erreur
classée : compte par tier. `null` = tier inconnu (§ 4).

Points ouverts : (A) tuile « Fatales » (§ 2.4) ; (B) tri par gravité en option ;
(C) tier « Anodine » (décision Engine en cours).

## 7. Frames Penpot (page « Labo — tiers d’erreurs »)

| Frame | Contenu | Export |
|---|---|---|
| TI · A | classement « Tous les tiers » (familles + tiers, barres segmentées, colonne fatales, légende) + inspecteur |  |
| TI · B | filtre « Fatales » actif : classement et derniers moments filtrés |  |
| TI · C | 32× = 5 / 9 / 18 dans les trois couleurs de famille (avec et sans anodines), infobulle, filtre sans résultat, tier inconnu |  |

Le segment Anodine est un contour plein (le pointillé devient illisible à 10 px de haut) ; les pastilles Anodine gardent le pointillé.
