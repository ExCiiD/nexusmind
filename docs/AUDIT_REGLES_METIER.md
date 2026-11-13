# Audit des features & catalogue des règles métier

> Objectif : rendre Ascend **le plus automatique possible sans IA**, en laissant au joueur uniquement ce qui demande son jugement (et qui le fait progresser).
> Statut : ✅ codé · 🟡 partiel · ⏳ à faire. Dernière mise à jour : 13/11/2026.

---

## 1. Ce que l'app peut savoir sans demander au joueur

| Source | Ce qu'elle donne | Limites |
|---|---|---|
| **Riot Match-V5** (fin de partie) | rôle, champion, KDA, CS, or, dégâts, vision, wards posées/détruites, objectifs, file, durée, `challenges` (KP, part de dégâts, CS avantage en lane…) | une seule photo de fin de partie |
| **Riot Timeline-V5** (par minute + événements) | position/or/XP/CS de chaque joueur chaque minute ; événements horodatés : kills (position, tueur, assistants, dégâts reçus), wards posées/détruites, achats/ventes, montées de sorts, objectifs (drakes, Hérauts, larves, Baron, Atakhan), tours, plaques | pas de positions entre deux minutes, **pas d'utilisation des sorts d'invocateur, pas de skillshots, pas de buissons, pas de position des wards** |
| **Live Client API** (pendant la partie) | début/fin, champion, mode | rien d'exploitable sur le jeu de l'adversaire |
| **API locale du client LoL (LCU)** — *non branchée* | sélection des champions (picks/bans en direct), runes, sorts choisis | à brancher (B5) |
| **Base locale** | sessions, objectifs, KPI, reviews, notes horodatées, erreurs, bookmarks, clips, bilans, équipes, drafts, customs | ce que le joueur a saisi |
| **Cloud (Supabase)** | groupes, commentaires coach, objectifs assignés, scrims, disponibilités | — |

**Règle d'or** : une règle n'écrit que ce qu'elle peut **prouver** avec ces données et l'explique toujours (« Mort 40 s avant le Baron pris par l'ennemi »). Ce qui relève de l'intention ou de la perception reste au joueur.

---

## 2. Audit feature par feature

| Feature | Aujourd'hui | Automatisable par règles | Doit rester manuel (et pourquoi) |
|---|---|---|---|
| **Comptes / onboarding** | Saisie Riot ID | Détection du compte connecté au client (LCU) ; liaison auto des smurfs vus sur le même PC | Choix du profil principal |
| **Bilan (évaluation)** | 100 % manuel (1-5) | Pré-remplissage depuis les stats (évaluation auto, plan validé « plus tard ») ; rappel de réévaluation quand l'écart stats/bilan dépasse un seuil | Validation finale, fondamentaux non mesurables (mécanique, comm, mental) |
| **Création de session** | Manuel (objectifs, KPI) | Proposition d'objectif (assistant ✅), objectif du coach (W3 ✅), reprise de la dernière config ✅ ; **objectif-expérience avec critère et durée (B1)** | Le choix final de l'objectif |
| **Ajout des games à la session** | ✅ auto (détection fin de partie) | Exclusion auto hors rôle ✅ ; regroupement auto en session « libre » si aucune session active | — |
| **Fin de session** | Manuel | Clôture auto après 45 min sans partie, conclusion pré-remplie (bilan objectif, stats, verdict B1) | La conclusion du joueur |
| **Review** | Manuel (notes, KPI 1-5, texte, respect objectif) | Pré-remplissage : moments clés (morts, objectifs) en notes horodatées, **respect de l'objectif calculé quand l'objectif a un critère mesurable**, KPI chiffrables proposés ; review rapide 60 s (B3) | Le « pourquoi » des erreurs, le ressenti, le texte libre |
| **Enregistrement** | ✅ auto (auto-record), liaison auto par horodatage | Nettoyage auto des vidéos anciennes non reviewées (quota disque) ; miniatures ✅ | — |
| **Bookmarks / clips** | Manuel | **Bookmarks auto** à chaque mort, kill multiple, objectif ; clip auto des erreurs sévérité 3 | Les clips « exemple à suivre » |
| **Mistake Library** | 🟡 4 tags auto / 20 | Voir §3.1 — **13 tags auto** après cette itération | Mécanique fine (skillshots, sorts, kiting), runes |
| **Phase de lane** | ✅ auto (rapport, note) | Tags d'erreurs dérivés (ouverture ratée, déficit CS) | — |
| **Stats détaillées / moyennes** | ✅ auto | Snapshots auto ✅ ; alertes de tendance (assistant ✅) | — |
| **Analytics** | ✅ auto (lecture) | Résumé « où j'en suis » ✅ ; profil meilleur/pire (B4) | — |
| **Historique** | ✅ auto | Statut « à reviewer » prioritaire auto (B3) | — |
| **Reviews externes** | Manuel | Pré-remplissage moments clés depuis le match | Toute l'analyse |
| **Partage Discord** | Manuel | Résumé hebdo auto (si webhook configuré), alerte coach | — |
| **Gamification** | ✅ auto (XP, streak, badges) | Badges liés aux verdicts B1 (« fondamental diplômé ») | — |
| **Assistant** | ✅ auto (règles + 👍/👎) | Étendu par ce catalogue | — |
| **Équipe – roster / pools** | Manuel + import auto (maîtrises) ✅ | Rôle principal déduit des 50 dernières games ; tiers de pool auto (confort = winrate + nb games) | Choix stratégiques du staff |
| **Équipe – draft** | Manuel | Suggestions bans (champions les plus joués/gagnants des adversaires, scouting ✅) ; alerte « pick hors pool » | La draft finale |
| **Équipe – scouting** | ✅ auto (pools adverses, synergies) | Rapport adversaire pré-scrim auto | — |
| **Customs / scrims** | Import CSV manuel | Import auto des parties custom depuis l'historique Riot des membres (même match, ≥ 3 membres) | Notes de débrief |
| **Coaching (W3)** | Manuel | Alerte coach : joueur inactif, review non faite, objectif échoué 3 fois | Les commentaires |
| **Scrims (W4)** | Manuel | Rappels de disponibilité, scrim marqué « fait » après l'heure, rattachement auto des customs du créneau | Plan de jeu, analyse |
| **Sync / sauvegarde** | ✅ auto | — | — |
| **Signalements** | Manuel | Diagnostics joints ✅ ; regroupement auto des doublons (même route + même erreur) | — |

---

## 3. Catalogue des règles métier

Format : **ID — nom** · déclencheur · conditions (cas) · action · confiance.
Les seuils dépendent du **rôle** (L = laner top/mid/adc, J = jungle, S = support) et sont ajustables.

### 3.1 Mistake Library (détection automatique d'erreurs) — `electron/main/mistakeDetector.ts`

Déclencheur commun : la timeline de la partie est disponible (après enrichissement Riot). Une erreur auto = `autoDetected: true`, note explicative, sévérité 1-3, masquable dans le lecteur.

| ID | Tag | Conditions (cas) | Sévérité | Statut |
|---|---|---|---|---|
| M1 | `unused-gold` | mort avec > 1 500 or non dépensé ; > 2 500 → sévérité 3 | 2-3 | ✅ |
| M2 | `dove-tower` | mort à < 700 u d'une tour ennemie (externe/interne/inhib) | 3 | ✅ |
| M3 | `late-back` | retour fontaine avec > 2 000 or et aucun achat depuis > 4 min | 2 | ✅ |
| M4 | `overstay` | hors fenêtre d'objectif (±30 s) : (a) plaque prise < 20 s avant la mort, ou (b) mort > 60 % en territoire ennemi ; (a)+(b) → 3 | 2-3 | ✅ |
| M5 | `death-before-objective` *(nouveau)* | mort ≤ 60 s avant un objectif majeur **pris par l'ennemi** (drake, Héraut, larves, Baron, Atakhan) ; Baron/Atakhan/âme → 3 ; si le joueur est jungler → +1 | 2-3 | ✅ |
| M6 | `no-ward-pre-obj` | objectif majeur, **aucune ward posée par le joueur dans les 90 s avant**, joueur en vie ; laners : uniquement objectifs **perdus** ; support/jungle : tous les objectifs, sévérité +1 | 1-2 | ✅ |
| M7 | `forgot-trinket` | après 3:00, **> 4 min sans poser de ward** alors que le joueur est en vie (support : > 2 min 30) ; une seule détection par trou | 1 | ✅ |
| M8 | `solo-baron-died` | mort à < 1 800 u de la fosse du Baron/Héraut avec **≤ 1 allié à < 3 000 u** (position de la minute) | 3 | ✅ |
| M9 | `caught-out` *(nouveau)* | après 14:00, mort hors fenêtre d'objectif, **aucun allié à < 2 500 u**, ≥ 2 ennemis impliqués | 2 | ✅ |
| M10 | `bad-trade` | avant 14:00, **tué en solo par l'adversaire direct de lane** (aucun assistant), hors fenêtre de gank ; laners uniquement | 2 | ✅ |
| M11 | `bad-positioning` | combat d'équipe (≥ 3 morts en 15 s) où le joueur **meurt en premier** ; ADC / mid / support enchanteur → sévérité 2, autres → 1 | 1-2 | ✅ |
| M12 | `bad-lane-opening` | laners : (a) mort avant 4:00, ou (b) CS à 5:00 inférieur de ≥ 8 à l'adversaire, ou (c) or à 5:00 < −400 ; 2 cas sur 3 → sévérité 3 | 2-3 | ✅ |
| M13 | `cs-deficit` *(nouveau)* | laners : CS à 10:00 inférieur de ≥ 15 à l'adversaire direct (≥ 25 → 3) | 2-3 | ✅ |
| M14 | `xp-deficit` *(nouveau)* | 2 niveaux de retard ou plus sur l'adversaire direct à 10:00 ou 15:00 | 2 | ✅ |
| M15 | `dead-during-objective` *(nouveau)* | mort et encore mort au moment d'un objectif majeur pris par l'ennemi (complète M5 quand la mort a lieu > 60 s avant) | 2 | reporté — nécessite une formule fiable du timer de mort (dépend du niveau et du temps de jeu) ; le risque de faux positifs est trop élevé sans elle |
| M16 | `walked-into-ward` | non détectable (pas de position des wards) | — | manuel |
| M17 | `face-checked` | non détectable fiablement (pas de buissons) | — | manuel |
| M18 | `wasted-summoner`, `whiff-skillshot`, `bad-kiting`, `bad-engage-angle`, `bad-dmg-maximisation`, `bad-threat-assessment`, `bad-wave-sync`, `bad-rune-choice` | non observables dans les données Riot | — | manuel (le joueur les tague en VOD) |

Règles transverses de la Mistake Library :
- **MX1 — Déduplication** : une erreur auto par (tag, minute) ; les erreurs manuelles ne sont jamais touchées.
- **MX2 — Relance automatique** : la détection tourne dès que la timeline est en cache (enrichissement post-partie, ouverture d'une review, refresh) ✅.
- **MX3 — Apprentissage du seuil** : si le joueur supprime ≥ 3 fois un même tag auto, sa sévérité par défaut baisse de 1 pour ce joueur (✅ ; simplification : compteur cumulatif, jamais remis à zéro par une recréation manuelle — voir [MOTEUR_REGLES.md](MOTEUR_REGLES.md)).
- **MX4 — Top erreurs → objectif** : un tag présent dans ≥ 40 % des 10 dernières games devient une suggestion d'objectif (assistant) (✅ règle `dominant_mistake`).
- **MX5 — Clip auto** : erreur sévérité 3 avec vidéo liée → bookmark à `t − 15 s` (✅, seulement si le décalage vidéo de l'enregistrement est fiable).

### 3.2 Sessions & objectifs

| ID | Règle | Cas | Statut |
|---|---|---|---|
| S1 | Proposer l'objectif | (a) objectif assigné par le coach en cours → prioritaire ; (b) tag d'erreur récurrent (MX4) ; (c) fondamental le plus faible du bilan ; (d) objectif répété 4 sessions sans progrès → fondamental voisin | 🟡 (a)(c)(d) |
| S2 | Objectif-expérience (B1) | critère mesurable choisi dans une liste (morts < 14 min, CS@10, wards/min, KP…) → verdict après N games : **acquis** (critère tenu ≥ 70 % des games), **en progrès** (tendance positive), **sans effet** | ✅ (moteur de coaching, lot 2) |
| S3 | Fin de session auto | aucune partie depuis 45 min → clôture + conclusion pré-remplie | ✅ (détection « client fermé » non faite) |
| S4 | Garde-fou de session | (a) 3 défaites d'affilée → suggestion de pause ; (b) règle anti-tilt du joueur (B8) atteinte → rappel ; (c) > 2 h 30 de jeu → fatigue | 🟡 (a)(c) |
| S5 | Game hors rôle | rôle joué ≠ rôle principal → exclue des moyennes du rôle, signalée ✅ | ✅ |

### 3.3 Review

| ID | Règle | Cas | Statut |
|---|---|---|---|
| R1 | Notes horodatées pré-remplies | chaque mort, multi-kill, objectif pris/perdu, tour perdue → note à compléter | ✅ |
| R2 | Respect de l'objectif calculé | si l'objectif a un critère (S2) → coché/décoché automatiquement, modifiable | ✅ |
| R3 | Détection de biais | KPI auto-noté ≥ 4 alors que l'indicateur lié est dans le pire tiers personnel → alerte « auto-évaluation optimiste » | ✅ (assistant) |
| R4 | Choix de la review complète (B3) | priorité : défaite serrée (écart d'or final < 3k) > game avec ≥ 2 erreurs sévérité 3 > écart à la moyenne > dernière game | ✅ |
| R5 | Rappel de review | > 3 games non reviewées dans la session → bandeau (existant, assistant) ; game prioritaire désormais fournie (R4) ; coach notifié si > 7 jours → W5 | 🟡 (notification coach ⏳ W5) |

### 3.4 Assistant (Phase A) — existant, à enrichir

Règles actuelles : morts précoces répétées, biais KPI, objectif sans progrès, tilt, baisse de vision, tendance CS, longue session… (voir `electron/main/assistant/rules.ts`).
Ajouts proposés (✅ livrés avec le moteur de coaching, voir [MOTEUR_REGLES.md](MOTEUR_REGLES.md)) : **AS1** profil meilleur/pire (B4) ; **AS2** tag d'erreur dominant (MX4) ; **AS3** champion à sortir du pool (≥ 10 games, winrate < 40 %, KDA sous la moyenne personnelle) ; **AS4** heure de jeu défavorable (winrate après minuit < winrate global − 10 pts sur ≥ 15 games) ; **AS5** fatigue de série (performance des games 4+ d'une session < games 1-3).

### 3.5 Équipe (staff)

| ID | Règle | Cas | Statut |
|---|---|---|---|
| T1 | Rôle principal d'un membre | rôle majoritaire sur ses 50 dernières games classées (≥ 60 %) | ⏳ |
| T2 | Tier de pool auto | S : ≥ 15 games & winrate ≥ 55 % ; A : ≥ 8 games ; B : maîtrise élevée mais peu joué récemment ; « à tester » : < 3 games | 🟡 (auto-fill) |
| T3 | Bans suggérés | champions les plus joués × winrate des adversaires (scouting), pondérés par le rôle | ⏳ |
| T4 | Alerte draft | pick hors pool d'un joueur, ou deux picks d'un même joueur « à tester » | ⏳ |
| T5 | Import auto des customs | partie custom où ≥ 3 membres apparaissent ensemble → proposée à l'import | ⏳ |
| T6 | Synergies | duo avec ≥ 5 games ensemble, winrate ≥ 60 % → « duo fort » ; < 40 % → « duo à travailler » | 🟡 |

### 3.6 Coaching & scrims (staff ↔ joueurs)

| ID | Règle | Cas | Statut |
|---|---|---|---|
| C1 | Joueur inactif | aucune game synchronisée depuis 5 jours → alerte staff | ⏳ |
| C2 | Objectif assigné en échec | verdict « sans effet » 2 fois sur le même objectif assigné → alerte coach | ⏳ |
| C3 | Review en attente | commentaire coach non lu / non résolu depuis 3 jours → rappel joueur | ⏳ |
| C4 | Disponibilités | scrim dans < 48 h et < 5 joueurs « dispo » → alerte staff ; joueur sans réponse → rappel | ⏳ |
| C5 | Scrim terminé | heure de fin dépassée → statut « fait » proposé ; customs du créneau rattachées (T5) | ⏳ |
| C6 | Rapport pré-scrim | adversaire renseigné → scouting auto (pools, bans T3) attaché au scrim | ⏳ |

### 3.7 Progression & bilans

| ID | Règle | Cas | Statut |
|---|---|---|---|
| P1 | Rappel de réévaluation | date planifiée atteinte ✅ ; ou écart stats/bilan > 1,5 point sur ≥ 3 fondamentaux | ✅ |
| P2 | Fondamental « diplômé » | verdict S2 « acquis » 2 fois de suite → badge + suggestion du fondamental suivant de la même catégorie | ✅ |
| P3 | Grilles de niveau (B6) | comportements cochés → niveau proposé ; écart > 1 avec l'auto-note → alerte biais | ⏳ |

---

## 4. Ce qui doit rester manuel (volontairement)

- **Le « pourquoi »** d'une erreur et le texte libre de review : c'est l'exercice qui fait progresser.
- **Le choix final** d'un objectif, d'une draft, d'un plan de jeu.
- **Les erreurs mécaniques** non observables (skillshots, sorts d'invocateur, kiting, angle d'engage, choix de runes).
- **Le ressenti / mental** : l'app propose (tilt, fatigue), le joueur décide.

## 5. Mise en œuvre

- M5–M13 ✅ (9 nouvelles détections, 4 nouveaux tags), détection relancée automatiquement après chaque partie.
- Moteur de coaching (voir [MOTEUR_REGLES.md](MOTEUR_REGLES.md)) : S2, R2, P2 (lot 2) puis MX2 (corrigé), MX5, R1, R4, R5, S3 (lot 3), puis AS1, AS3, AS4, AS5, M14, MX3, P1 (lot 4) ✅. M15 reporté (formule de timer de mort pas assez fiable).
- Lot 5 (page « Mon plan », pré-remplissage du bilan depuis les stats) ✅.
- Les 5 lots du moteur de coaching sont livrés. Le moteur de règles métier est terminé pour cette itération ; la suite se trouve dans [PLAN_GESTION_EQUIPE.md](PLAN_GESTION_EQUIPE.md) (équipe) et [ROADMAP.md](ROADMAP.md) (reste du produit).
