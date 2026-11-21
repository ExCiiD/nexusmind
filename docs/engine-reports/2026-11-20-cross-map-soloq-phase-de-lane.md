# Pas de reproche de cross-map aux laners en soloQ pendant la phase de lane

_20/11/2026, session Engine. Retour de l'utilisateur sur une carte de micro-review (capture) : « 8:01 · Lane top —
l'ennemi prend les Larves pendant que tu finis une tour en side lane, 900 unités parcourues vers la fosse dans les 25
dernières secondes, aucun cross-map en contrepartie ». Saison en cours seulement (16.x). `docs/DECISIONS.md` relu
avant ce rapport. Lecture seule du code._

## 1. La connaissance (règle de l'utilisateur)

> « En soloQ, il n'y a généralement pas de cross-map en phase de lane (avant 14 min) pour les solo laners. Si un drake
> est fait, l'ADC ne devrait pas aller top juste pour cross-map : il perdrait des CS, du gold, de l'XP ou du délai sur sa
> quête. C'est un cas très spécifique, où toute la team s'accorde pour overload l'autre side, donc quand il y a un swap
> entre les deux sides. Pareil pour les grubs, encore plus spécifique : si la botlane est bot, le toplaner n'a pas à
> cross-map à 8 min de jeu si ce n'est pas un play collectif prévu, car il perdrait plus qu'autre chose. Ce genre de
> remarque relève d'un environnement d'équipe, pas de la soloQ. »

En clair :
- **Avant 14:00, en soloQ, un laner (top, mid, ADC) n'est pas censé répondre à un objectif ennemi par un cross-map.**
- Rester sur sa lane et prendre ses plaques ou sa tour est le bon choix, pas de la « greed ».
- Le cross-map coordonné (swap, overload d'un side) n'existe qu'en **environnement d'équipe**, où le play est prévu.

Cela rejoint ce que le moteur enseigne déjà :
- la fiche `codex_top_grubs_luxury_dragon_first` : « crash d'abord ou reste » ;
- le coût d'une wave (≈ 1/3 de niveau) ;
- le retard de quête mesuré dans le bilan des roams.

## 2. Ce que le moteur fait aujourd'hui (la carte de la capture)

Dans `anomalyDetector.ts` § 2 « Enemy epic objectives », le schéma **`tempo-hesitation`** se déclenche pour **tous les
rôles et à toute heure** quand l'ennemi prend un Dragon, l'Ancien, le Baron ou les Larves (`HESITATION_KINDS`). Trois
conditions :
- le joueur était à plus de 2 800 de la fosse 30 s avant ;
- **aucun cross-map de l'équipe** (monstre épique ou bâtiment pris sans lui de −40 s à +15 s) ;
- l'un de ces trois cas :
  - une plaque ou une tour prise **par lui** dans les 75 s (`towerGreed`) ;
  - 1 200 unités parcourues vers la fosse dans les 25 dernières secondes ;
  - resté dans la rivière.

La carte de la capture cumule les deux premiers cas : tour de lane prise (lue comme de la greed) et marche vers la fosse.
Le déclencheur « objectif absent » simple a la même logique : il n'est annulé que par un objectif pris par l'équipe à
±60 s.

Les mêmes reproches existent aussi ailleurs :
- **M6** (Labo, « pas de ward avant un objectif ») vise un laner pour chaque objectif **perdu** ;
- la règle **« Ward avant les objectifs »** de la vérification d'objectif de session compte ces objectifs.

## 3. La règle proposée

**Contexte d'équipe** : la partie fait partie d'une session d'équipe (table `team_session_games`, sessions flex, scrim
ou ranked5), ou c'est une partie personnalisée ou de tournoi. **Sinon, c'est de la soloQ**, flex hors session d'équipe
comprise (à confirmer, § 6).

**En soloQ, avant 14:00, pour TOP, MIDDLE et BOTTOM :**

| Cas | Aujourd'hui | Proposé |
|---|---|---|
| Objectif ennemi de **l'autre côté de la carte** (Dragon pour le top ; Larves, Héraut ou Baron pour l'ADC ; tout objectif hors de la moitié de carte de la lane) | moment « absent » ou « hésitation » possible | **aucun moment** |
| Objectif ennemi **de son côté** (Larves ou Héraut pour le top, Dragon pour l'ADC, les deux pour le mid), joueur resté sur sa lane | « absent » ou « hésitation » | **aucun moment** : rester en lane est le choix par défaut |
| Plaques ou tour de **sa propre lane** prises pendant l'objectif | « tower greed » | comptées comme **contrepartie** (gold, plaques et quête) |
| Joueur **parti** vers l'objectif et arrivé trop tard (1 200 unités vers la fosse, pas de fight) | « hésitation » | gardé, mais le texte dit « tu as quitté ta lane pour un objectif sans y arriver à temps » et ne parle jamais de cross-map |
| Joueur **mort** au fight de l'objectif | moment « mort critique » | **inchangé** : c'est une décision qu'il a prise |
| Mot « cross-map » dans une carte | possible | **jamais** pour un laner en soloQ avant 14:00 |
| **M6** ward avant un objectif perdu, laner | erreur auto gravité 1 | **pas d'erreur** avant 14:00 en soloQ |
| Vérification d'objectif « Ward avant les objectifs », laner | objectifs perdus comptés | ceux d'avant 14:00 ne comptent pas en soloQ |

**Inchangé :**
- **support et jungler**, rôles de vision et de mouvement : leurs règles d'objectif restent. L'utilisateur ne parle que
  des solo laners et de l'ADC ;
- **après 14:00** : les règles actuelles restent ;
- **en contexte d'équipe** : les remarques de cross-map restent, puisque le play peut avoir été prévu.

**Bilan des roams et des ganks** (rapports du 20/11) : un laner qui reste en lane pendant un objectif ennemi n'est
jamais compté « perdant ». Dans la « suite adverse », un objectif ennemi ne compte contre le roamer que si **son
vis-à-vis** y a participé, ce qui était déjà le cas. Le jungler garde la notion de trade cross-map : c'est son rôle.

## 4. Mise en œuvre

**Back-end :**
1. le détecteur reçoit un contexte `teamContext: boolean` en entrée, à côté du sélecteur. Il est calculé dans
   `microReview.ipc.ts` (et pour les règles M\*) à partir de `team_session_games` ou de la file de la partie. La fonction
   reste pure ;
2. `DETECTOR_SPEC.soloQLaning` : `{ untilSec: 840, roles: ['TOP', 'MIDDLE', 'BOTTOM'] }` ;
3. dans le § 2 du détecteur, les règles du tableau ci-dessus ;
4. dans `tempo-hesitation`, `towerGreed` est ignoré pour ces rôles avant 14:00 en soloQ, et la tour ou les plaques de sa
   lane comptent comme contrepartie ;
5. M6 (`mistakeRules.ts`) et la vérification d'objectif (`objectiveVerification.ts`) suivent la même règle ;
6. `ANALYSIS_VERSION` + 1 : les cartes déjà en cache se recalculent, et celle de la capture disparaît.

**Front-end :** texte de la variante « parti trop tard » sans le mot cross-map (fr + en). Le texte existant
« aucun cross-map en contrepartie » ne s'affiche plus qu'en contexte d'équipe ou après 14:00.

**Tests :**
- la partie de la capture (top, Larves à 8:01, tour de sa lane prise, soloQ) → aucun moment ;
- la même partie en session d'équipe → moment gardé ;
- ADC en soloQ, Larves ennemies à 9:00 → aucun moment ;
- ADC parti vers le Dragon et arrivé trop tard → moment « parti trop tard », sans le mot cross-map ;
- support, même situation → inchangé ;
- après 14:00 → inchangé ;
- M6 laner avant 14:00 en soloQ → pas d'erreur.

**Effort :** Back-end ≈ 0,5 jour, Front-end ≈ 0,1 jour.

## 5. Risques

- **Moins de moments pour les laners** en début de partie. C'est voulu : ces moments étaient des faux positifs en
  soloQ. Les cartes libérées laissent la place à d'autres moments (morts, retard de CS, roams).
- **Contexte d'équipe mal lu** : une partie de groupe non rattachée à une session d'équipe sera traitée comme de la
  soloQ. C'est le côté sûr : moins de reproches, jamais de faux reproche de cross-map.
- **Mid** : en soloQ, un mid avec la prio aide souvent son jungler au Dragon. La règle le traite comme les autres
  laners (pas de reproche d'absence), mais ses morts et ses roams restent jugés.

## 6. À confirmer par l'utilisateur

La **flex jouée hors session d'équipe** compte-t-elle comme de la soloQ ? Proposé : oui. Seules les parties rattachées à
une session d'équipe (flex, scrim, ranked5), les customs et les tournois sont un environnement d'équipe.
