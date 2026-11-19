# Plan de monétisation — gratuit pendant la bêta, puis offres payantes

> Session **Audit**, 19/11/2026, à la demande de l'utilisateur (via le Chief). Rien n'est codé.
>
> **Décision de l'utilisateur :** gratuit pendant la bêta, puis certaines fonctionnalités réservées aux comptes
> payants. Critères donnés :
> - la charge Supabase (et Riot) ;
> - le contenu premium qu'on ne trouve pas gratuitement en ligne ;
> - donner un avant-goût (création de groupe, annonce LFT, espace d'équipe) sans tout donner (certaines stats,
>   scouting…).
>
> **Appuis :** `docs/RAPPORT_SUPABASE_WEB.md` (charge Supabase), `docs/PLAN_CLE_PROD.md` (coût Riot),
> `docs/DEMANDE_CLE_PROD.md` (règles Riot).

## En bref

- **Deux offres payantes**, en plus du palier gratuit que Riot impose :
  - **Ascend Pro** (joueur) : **4,99 €/mois** ou **39,99 €/an** ;
  - **Ascend Team** (groupe) : **19,99 €/mois** ou **179 €/an**, payé par l'owner, valable pour tout le roster.
- **Gratuit pour toujours :** le cœur du coaching individuel (micro-review, Labo d'erreurs, plan), la création
  d'**un** groupe, l'annonce LFT, l'espace d'équipe en lecture, le Planning. Les analyses gratuites sont plafonnées
  (fenêtre récente), pas supprimées.
- **Payant :** ce qui coûte cher en appels Riot ou en requêtes Supabase, **et** qu'on ne trouve pas ailleurs :
  - scouting d'équipes adverses illimité et complet ;
  - synergie et stats collectives sur la saison ;
  - review VOD collaborative ;
  - rapports hebdomadaires ;
  - historique et analyses sur toute la saison ;
  - groupes multiples ;
  - bot Discord complet.
- **Règle Riot à respecter** : si on fait payer, le contenu doit être **transformatif**. Il ne faut donc **jamais
  vendre la donnée brute de Riot** (historique de parties nu, rang). On vend l'**analyse**, la **collaboration** et la
  **profondeur**. La monétisation ne démarre qu'**après** l'approbation de la clé de production.
- **Techniquement :** un champ de plan côté serveur (Supabase), des droits vérifiés **côté serveur**
  (RLS, RPC, edge functions, proxy Riot), et l'interface qui ne fait qu'afficher. Paiement par un « merchant of
  record » (Paddle ou Lemon Squeezy) qui gère la TVA européenne. Textes légaux v0.4 (CGV, droit de rétractation).

## 1. Inventaire des fonctionnalités

Charge, estimée d'après les rapports (ordre de grandeur, au repos ou par usage) :
- **Riot** : appels sur la clé partagée (100 req / 2 min aujourd'hui, environ 50 req/s avec la clé de production) ;
- **Supabase** : requêtes, stockage et egress.

« Valeur premium » : est-ce introuvable gratuitement ailleurs (op.gg, u.gg, Mobalytics gratuit, Porofessor) ?

| Fonctionnalité | Charge Riot | Charge Supabase | Trouvable gratuitement ailleurs ? | Valeur premium |
|---|---|---|---|---|
| Détection de partie, enregistrement local, fin de partie (match + timeline) | 3-5 appels par partie (incompressible) | ~0 (local) | Enregistrement : oui (Outplayed, Insights) | Faible : **cœur gratuit** |
| Micro-review guidée 45 s, détecteurs, Labo d'erreurs | 0 de plus (timeline déjà chargée) | sync de quelques lignes | **Non** (spécifique à Ascend) | Forte, mais c'est **le produit d'appel** : gratuit, en partie plafonné |
| Plan de progression, objectifs, bilan des fondamentaux | 0 | faible (sync) | Non | Moyenne : gratuit |
| Historique et stats : 20 dernières parties | ~20 appels une fois, puis cache | faible | **Oui** (op.gg, u.gg) | Faible : gratuit |
| Historique, stats détaillées, radar sur **toute la saison** | 50-300 appels par compte (premier chargement) | faible | En partie (stats brutes oui ; radar des fondamentaux, non) | Moyenne : **Pro** (pour l'analyse, pas la donnée brute) |
| Phase de lane détaillée, tendances, comparaison aux paliers | 0 de plus (timelines) | faible | En partie (Mobalytics Plus) | Moyenne : **Pro** |
| Revue externe (analyser la partie d'un autre joueur) | 3-5 appels par partie | faible | Non (comme outil de coaching) | Forte : **Pro** (coach) |
| Sync multi-appareils, sauvegarde cloud | 0 | sync : ~2 req/min par appareil visible ; sauvegarde : stockage | — | Sync : gratuit (nécessaire au web). **Sauvegarde automatique quotidienne : Pro** (stockage) |
| Web app (consultation, reviews, scrims) | comme le desktop | ~1,9 req/min par onglet visible | — | Gratuit (lecture) |
| **Créer un groupe**, inviter, rôles | 0 | faible | Discord gratuit | **Avant-goût : 1 groupe gratuit** |
| Plusieurs groupes (académie, équipe 2…) | 0 | linéaire | — | **Team** |
| **Annonce LFT** (carte joueur, export image) | 1-2 appels (rang, maîtrises) | faible | Partiellement (LFT Discord à la main) | **Avant-goût : gratuit** |
| **Espace d'équipe** (roster, cartes, Management en lecture) | rang des membres | faible | Non (sous cette forme) | **Avant-goût : lecture gratuite** |
| Planning, disponibilités, réunions, présence | 0 | **polling** (le plus coûteux au repos), ICS par edge function | Google Calendar et bots Discord, mais pas intégrés | Planning de base gratuit ; ICS et rappels : **Team** |
| Sessions d'équipe en direct, fin de partie d'équipe | 3-5 appels par partie et par joueur | poller live (15 s pendant une session) | Non | **Team** (charge en direct) |
| **Scouting d'équipe adverse** | **le plus lourd** : ~100 (rapide) à ~1 500 (complet, 5 joueurs) appels | moyen | En partie (op.gg multi-search, à la main) ; **le rapport agrégé, non** | Forte : **1 scout rapide par semaine gratuit**, illimité et complet en **Team** |
| **Synergie et stats collectives** (Flex + scrims) | 100-500 appels par calcul | moyen (`team_custom_games`) | **Non** | Forte : **Team** (gratuit : 20 dernières parties Flex) |
| Champion Pool d'équipe, tiers auto | maîtrises (30 par joueur) | faible | En partie | Lecture gratuite ; tiers auto et menaces : **Team** |
| Draft Sim (menaces, pool adverse) | via le scouting | faible | En partie (drafters gratuits sans données adverses) | Draft simple gratuit ; **avec les données de scouting : Team** |
| Scrims : suivi, import CSV, liens draft, (phase 2) codes de tournoi | tournoi : 1 code + 1 match par partie | moyen | **Non** | **Team** |
| Review VOD collaborative (commentaires horodatés, assignations) | 0 | **moyen à fort** (commentaires, polling) | Non (sinon outils pros payants) | Forte : **Team** |
| Rapport hebdomadaire d'équipe (edge `team-report`), tableau de bord du staff | 0 | edge function + requêtes | **Non** | Forte : **Team** |
| Bien-être (check-ins, partage au staff, alertes) | 0 | faible, données de santé | Non | Check-in perso gratuit ; **tableau de bord du staff : Team** |
| Essais (trials), plans de développement, tâches | 0 | faible | Non | **Team** |
| Bot Discord (rappels, rôles, remplaçants) | 0 | cron par serveur (lit le pool) | Bots génériques | Liaison + annonces gratuites ; **cron complet : Team** |
| Récompenses hebdo (MVP, Grinder), icônes de profil | 0 | faible | — | Gratuit (engagement) ; icônes de prestige : cosmétique **Pro** |

## 2. Découpage Gratuit / Payant

### Gratuit (palier exigé par Riot, et avant-goût)

| Domaine | Inclus | Limite |
|---|---|---|
| Coaching perso | micro-review, Labo d'erreurs, plan, bilan, enregistrement local | **illimité** (c'est ce qui fait venir les joueurs) |
| Stats | historique, stats détaillées, radar | **20 dernières parties** par compte ; 1 compte Riot lié |
| Cloud | compte, sync multi-appareils, web app | sauvegarde cloud **manuelle**, 1 par semaine |
| Groupe | **créer 1 groupe**, inviter, rôles, Planning de base, annonces | **1 groupe** possédé (rejoindre : illimité) ; jusqu'à **10 membres** |
| LFT | carte joueur et annonce LFT | illimité |
| Espace d'équipe | roster, cartes, Champion Pool en **lecture**, Draft Sim simple | — |
| Scouting | scout **rapide** (100 parties) | **1 équipe adverse par semaine et par groupe** |
| Stats collectives | synergie Flex | **20 dernières parties** Flex de l'équipe |
| Bien-être | check-in personnel | partage au staff possible, sans tableau de bord |

### Ascend Pro (joueur) — 4,99 €/mois ou 39,99 €/an

- Historique, stats détaillées et radar sur **toute la saison**, jusqu'à **3 comptes Riot** liés.
- Phase de lane détaillée, tendances, comparaison aux paliers.
- **Revue externe** : analyser les parties d'un autre joueur (coachs indépendants, duo), **20 par mois**.
- Sauvegarde cloud **automatique quotidienne**, avec 30 jours d'historique.
- Icônes et bannières de prestige (cosmétique, sans effet sur le jeu).

### Ascend Team (groupe) — 19,99 €/mois ou 179 €/an, payé par l'owner, pour tout le roster

- **Scouting illimité**, rapide ou **complet** (saison), rapports agrégés, données injectées dans le Draft Sim.
- **Synergie et stats collectives sur la saison** (Flex + scrims + tournois).
- **Scrims** : suivi, import CSV, liens draft ; en phase 2, **codes de tournoi** (récupération automatique).
- **Review VOD collaborative**, assignations, **rapport hebdomadaire**, tableau de bord du staff.
- Bien-être : **tableau de bord du staff** et alertes (avec le consentement de chaque joueur).
- Essais, plans de développement, tâches, sessions d'équipe en direct.
- **Jusqu'à 3 groupes** (académie, équipe 2) et **25 membres** par groupe.
- Bot Discord complet (rappels, remplaçants), abonnement ICS.
- **Tous les membres du groupe ont les avantages Pro** dans le contexte du groupe. Au minimum, le staff a la revue
  externe des joueurs du roster.

### Pourquoi ce découpage tient

- **Charge :** les deux postes Riot les plus lourds (scouting complet, synergie sur la saison) et les deux postes
  Supabase les plus lourds (sessions en direct, review VOD collaborative) sont payants ou plafonnés. Le gratuit reste
  autour des chiffres du rapport Supabase (≤ 3 req/min au repos).
- **Valeur introuvable ailleurs :** scouting agrégé, synergie, review VOD collaborative, rapports et staff
  dashboard n'existent pas gratuitement. Les stats brutes, si : elles restent gratuites (20 parties) et le Pro vend
  l'**analyse** en profondeur, pas la donnée.
- **Avant-goût :** on crée son groupe, on publie sa LFT, on voit l'espace d'équipe, on fait **un** vrai scout par
  semaine. La valeur est visible, la version complète est payante.

## 3. Implications techniques

### Données et droits (Supabase, source de vérité)

1. **Tables :**
   - `subscriptions` (`user_id`, `plan` en `free` / `pro`, `status`, `current_period_end`, `provider`,
     `provider_ref`) ;
   - `group_subscriptions` (`group_id`, `plan` en `free` / `team`, `status`, `current_period_end`, `paid_by`).

   Écriture **réservée au rôle service** (webhook du prestataire de paiement) ; lecture pour le propriétaire.
2. **Fonctions de droits :** `private.user_plan(uid)`, `private.group_plan(group_id)` et
   `private.entitled(uid, feature, group_id)`, en `security definer` et `search_path = ''`, sur le modèle de
   `has_group_role`.
3. **Contrôles côté serveur, jamais seulement dans l'interface :**
   - **RLS et RPC :** `create_group` refuse un 2e groupe possédé en `free` ; l'ajout d'un 11e membre est refusé en
     `free` ; les tables de review VOD collaborative, de rapports et d'essais sont accessibles en écriture seulement
     si `group_plan = 'team'` (les données restent **lisibles** après une résiliation : on ne perd rien) ;
   - **edge functions :** `team-report` ne génère rien sans `team` ; `team-calendar-ics` sert l'ICS seulement en
     `team` ;
   - **quotas comptés côté serveur :** une table `usage_counters` (`user_id` ou `group_id`, `feature`, `period`,
     `count`), incrémentée par une RPC `consume(feature)` **avant** le travail, par exemple « 1 scout par semaine par
     groupe ». Le client ne fait que montrer le compteur.
4. **Proxy Riot :** le quota de scout est vérifié par la RPC `consume('scout')`, qui renvoie un jeton court (signé
   par le serveur) que le proxy exige sur les appels `background` du scouting. Le proxy applique aussi un **budget
   quotidien par plan**, par exemple 1 500 appels par jour en gratuit et 10 000 en Team. L'en-tête de priorité seul
   ne suffit pas, parce que le client peut le falsifier.
5. **Desktop :** les analyses locales (micro-review) restent locales et gratuites. Les limites de profondeur (20
   parties) s'appliquent aux **appels Riot** (proxy) et à l'interface ; on n'essaie pas de verrouiller du code local.
6. **Paiement :** un **merchant of record** (Paddle ou Lemon Squeezy). Il facture, encaisse la **TVA européenne**,
   gère les remboursements et le **droit de rétractation**. Pour un développeur seul, c'est plus sûr que Stripe en
   direct, qui demanderait une immatriculation et des déclarations de TVA OSS. Webhook vers une edge function
   `billing-webhook` (signature vérifiée, idempotente), qui met à jour `subscriptions` et `group_subscriptions`.
7. **Grâce et résiliation :** 7 jours de grâce en cas d'échec de paiement ; à l'expiration, **lecture seule** des
   données Team, jamais de suppression.
8. **Bêta :** tout le monde est en `team` (droits ouverts) jusqu'à la date de fin de bêta. Les fondateurs (comptes
   de la bêta) peuvent recevoir un tarif réduit à vie (`plan_note = 'founder'`).

### Conformité Riot (General Policies, relues le 19/11/2026)

| Règle | Application |
|---|---|
| **Palier gratuit obligatoire** (« A free tier for players is required ») | ✅ coaching perso illimité, 1 groupe, LFT, espace d'équipe, 1 scout par semaine |
| **Monétiser seulement au statut Approved ou Acknowledged** | ⚠️ ne lancer les offres payantes **qu'après** l'approbation de la clé de production ; pendant la bêta, rien n'est payant |
| **Contenu transformatif si on fait payer** | ✅ on vend l'analyse (scouting agrégé, synergie, radar, rapports) et la collaboration, **pas** la donnée brute de Riot. **À éviter :** faire payer l'accès simple à l'historique ou au rang |
| Paiements acceptés : abonnements, dons, crowdfunding | ✅ abonnement |
| Pas de jeu d'argent, pas de prix abusif | ✅ |
| Pas de publicité dans les propriétés de Riot (jeu, client) | ✅ aucune publicité |

### Légal

- **CGV et CGU v0.4 :** prix TTC, durée, renouvellement, résiliation à tout moment, **droit de rétractation de 14 jours**
  (contenu numérique : renonciation expresse si l'accès est immédiat), remboursement.
- **Politique de confidentialité :** prestataire de paiement (sous-traitant ou responsable distinct selon le modèle
  MoR), données conservées (aucune donnée de carte chez Ascend).
- **CyberSecurity :** revoir le webhook, les RPC de quotas et le jeton de scout.

### Effort indicatif (après la clé de production)

| Lot | Session | Effort |
|---|---|---|
| Tables, fonctions de droits, RLS, RPC `consume` | backend-dev | M |
| Webhook de paiement + intégration MoR | backend-dev | M |
| Proxy : jeton de scout + budget par plan | backend-dev | M |
| Interface : écran Offres, compteurs, états « Team requis » (sans cacher les données existantes) | graphic-design → frontend-dev | M |
| Textes v0.4 | cybersecurity + utilisateur | S |

## 4. Prix proposés et marché

| Produit | Prix public | Positionnement | Source (consultée le 19/11/2026) |
|---|---|---|---|
| **Mobalytics Plus** (joueur, LoL) | **9,99 $/mois** ; 24,99 $ / 3 mois ; 69,99 $/an (5,83 $/mois) | stats, builds, coaching automatisé, sans publicité | page officielle <https://mobalytics.gg/lol/glp/plus>, via la recherche ; chiffres repris par <https://hexgate.app/blog/hexgate-vs-blitz-vs-mobalytics/> |
| **Blitz Premium** (joueur, LoL) | ~4,99 $/mois (source tierce, non confirmée sur blitz.gg) | sans publicité, builds Masters+ | <https://toolradar.com/tools/blitz/pricing> |
| **iSCRIM** (scrims, équipes) | « from 149 $/mo », avec un palier gratuit (périmètre non confirmé) | outil d'équipe | <https://www.itechguides.com/products/iscrim/> |
| Coaching humain (Metafy) | abonnements mensuels de coachs, de quelques dizaines à plus de 100 $ | service humain | <https://metafy.gg/@gnarz/sessions/monthly-plan-SbGQfhpcPL6> (exemple) |

**Proposition :**
- **Pro : 4,99 €/mois, 39,99 €/an** (−33 %). En dessous de Mobalytics Plus (9,99 $), au niveau de Blitz Premium. Pour
  un joueur, l'offre est complémentaire : c'est le coaching gratuit qui fait venir.
- **Team : 19,99 €/mois, 179 €/an** (−25 %), pour **tout le roster** (environ 2 € par joueur et par mois pour 10
  membres). Bien en dessous des outils d'équipe dédiés (iSCRIM dès 149 $), et justifié par le coût Riot du scouting et
  de la synergie.
- **Fondateurs :** −50 % à vie pour les comptes de la bêta, pour remercier les premiers testeurs et les retenir.
- **À valider sur le terrain :** sondage auprès des groupes bêta (« combien paierait votre équipe ? ») avant de figer.

**Limites de cette étude de prix :** Mobalytics, Blitz et Skill Capped refusent la lecture automatique de leurs
pages (403). Les chiffres de Blitz et d'iSCRIM viennent de sites tiers et sont à confirmer à la main ; Skill Capped
n'a pas été trouvé.
