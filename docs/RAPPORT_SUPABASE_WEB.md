# Impact de la web app sur Supabase — rapport avant redéploiement

> Rédigé par la session **Audit** le 19/11/2026, à la demande de l'utilisateur
> (via le Chief).
> Mesures en **lecture seule** sur le projet Supabase `NexusMind`
> (`zwubyzrfpelhxjjezvrh`, région eu-central-2), par les outils MCP
> `get_organization` et `get_project` et des requêtes SQL de taille ou de
> comptage. Aucune écriture.
> Tarifs relevés le 19/11/2026 sur les pages officielles :
> - <https://supabase.com/pricing> ;
> - <https://supabase.com/docs/guides/platform/compute-and-disk>.

## En bref

1. **Ascend est déjà au plan Pro** (25 $/mois), pas au plan gratuit. La
   question « quand faut-il passer au payant ? » est donc déjà réglée.
2. **Les quotas du plan Pro sont très loin d'être atteints**, même avec
   1 000 utilisateurs : base de données, stockage, trafic sortant (egress)
   et comptes actifs restent largement sous les limites incluses.
3. **Le vrai point à surveiller, c'est la puissance du serveur** (« compute »),
   pas les quotas. Le projet tourne sur la plus petite instance payante
   (Micro). Les 17-18/11, elle a déjà saturé son budget d'accès disque, à
   cause de boucles de rafraîchissement trop fréquentes. La web app ajoute de
   ces boucles.
4. **Coût probable :** 25 $/mois jusqu'à environ une centaine d'utilisateurs
   actifs ; environ 30 $/mois (instance Small) vers 300 ; de 30 à 85 $/mois
   vers 1 000, selon que la tâche I (moins de rafraîchissements) est faite ou
   non.
5. **Recommandation :** faire la tâche I (rafraîchissements ≤ 3 par minute et
   pause quand l'onglet est caché) avant ou avec le déploiement de la web
   app. C'est la mesure qui protège le plus le serveur et le budget.

## 1. Le plan actuel et l'usage réel

### Plan et instance

| Élément | Valeur | Source |
|---|---|---|
| Plan de l'organisation « ExCiiD's Org » | **Pro** | `get_organization` : `plan: pro` |
| Prix du plan | 25 $/mois, dont **10 $ de crédit compute** qui paie une instance Micro | page Pricing |
| Instance du projet NexusMind | **Micro** : CPU partagé, 1 Go de RAM, 60 connexions directes, 200 clients via le pooler | `max_connections = 60`, `shared_buffers` ≈ 224 Mo, cohérent avec Micro (page Compute) |
| Autres projets actifs dans la même organisation | **NatFitSport** (actif) ; ezRes et « ExCiiD's Project » en pause | `list_projects` |

> **À vérifier par l'utilisateur dans l'onglet Billing :** sur le plan Pro,
> chaque projet actif paie son instance. Le crédit de 10 $ ne couvre qu'une
> seule instance Micro. Si NatFitSport tourne aussi en Micro, la facture de
> l'organisation est probablement d'environ **35 $/mois** (25 + 10). Ce coût
> ne vient pas d'Ascend.

### Limites du plan Pro (incluses dans les 25 $) et usage d'Ascend aujourd'hui

| Ressource | Inclus dans Pro | Au-delà | Usage NexusMind au 19/11 | Taux d'usage |
|---|---|---|---|---|
| Taille de la base | 8 Go de disque | 0,125 $/Go | **17 Mo**, dont 1,2 Mo de données synchronisées (`sync_records`, 1 182 lignes, 3 comptes) | 0,2 % |
| Stockage de fichiers (logos) | 100 Go | 0,0213 $/Go | **87 Ko** (5 fichiers) | ~0 % |
| Trafic sortant (egress) | 250 Go/mois, plus 250 Go servis depuis le cache | 0,09 $/Go (0,03 $/Go en cache) | non mesurable par SQL. Estimation : < 1 Go/mois (6 comptes, 4 connectés sur 30 jours) | < 1 % |
| Comptes actifs par mois (MAU) | 100 000 | 0,00325 $/MAU | **4** connectés sur 30 jours (6 comptes au total) | ~0 % |
| Appels d'edge functions | 2 millions/mois | 2 $ par million | 5 fonctions (invitation, passage desktop → web, suppression de compte, rapport et calendrier d'équipe), appelées ponctuellement | ~0 % |
| Realtime (connexions simultanées) | 500 | 10 $ par tranche de 1 000 | **non utilisé** : l'app fait du polling, aucun `.channel()` | 0 % |
| Connexions à la base | 60 (Micro) | instance plus grosse | 24 connexions ouvertes au moment de la mesure, surtout internes à Supabase | 40 % |

**Lecture pour un non-spécialiste :** Ascend utilise moins de 1 % de presque
tout ce que le plan paie déjà. La seule jauge qui bouge vraiment est la
puissance de l'instance, et surtout son budget disque :
- le disque garantit 500 opérations par seconde ;
- il peut monter en pointe à 11 800 opérations par seconde tant qu'il lui
  reste du budget ;
- quand le budget est épuisé, tout ralentit.

C'est ce qui s'est passé les 17-18/11 (`EndOfGamePrompt.tsx:14`,
`TeamSessionBanner.tsx:14` : boucles passées de 7,5 s à 15 s pour cette
raison).

## 2. Ce que la web app ajoute par rapport au desktop

L'app desktop parle déjà directement à Supabase. La web app fait de même,
depuis le navigateur. Elle n'ajoute donc pas de nouveau type de charge, mais
**une deuxième source** : un coach peut avoir l'app desktop et la web app
ouvertes en même temps, et chaque onglet ouvert interroge le serveur.

| Source de charge | Desktop | Web app | Commentaire |
|---|---|---|---|
| Boucles de rafraîchissement au repos | environ **12 appels/min** (UI-11) : cloche 30 s, annonces 30 s, bannière de session 15-30 s, invite de fin de partie 15-30 s, barre latérale 60 s, groupes rechargés en double | environ **6 à 8 appels/min par onglet ouvert** : cloche (30 s), annonces (30 s) et bannière de session d'équipe (15-30 s), toutes dans `WebLayout.tsx` | Elles continuent quand l'onglet est en arrière-plan. **Cible de la tâche I : ≤ 3 appels/min**, et pause quand la fenêtre ou l'onglet est caché. |
| Synchronisation | boucle de sync toutes les 30 s (15 s pendant une session d'équipe en direct), qui n'envoie que les changements | aucune (le web lit les données synchronisées) | — |
| Pages lourdes | — | « Mes revues » lit jusqu'à **5 000 lignes** de `sync_records` (`collabCore.ts:232`, environ 2 Mo par visite au volume maximum) ; l'accueil charge tous les scrims pour en montrer 3 ; Scrims recharge tout après chaque case cochée (WSC-08) | C'est le poste d'egress principal de la web app une fois les comptes bien remplis. |
| Logos de groupe | servis depuis le stockage Supabase | idem | Fichiers publics mis en cache 1 an (`cacheControl: '31536000'`, `collabCore.ts:113`) : ils sont comptés en **egress en cache**, 4 fois moins cher, et sont minuscules (87 Ko au total). Impact négligeable. |
| Sessions d'authentification | jeton dans le trousseau | jeton dans le navigateur | Un utilisateur desktop + web reste **un seul MAU**. Chaque appareil rafraîchit son jeton environ une fois par heure : négligeable. Il y a 159 jetons de rafraîchissement en base pour 6 comptes, dont la plupart ont expiré ; aucun coût. |
| Fichiers de la web app (HTML, JS, images) | — | servis par **Cloudflare**, pas par Supabase | Aucun egress Supabase pour le chargement de l'app elle-même. |

## 3. Projection par paliers

### Hypothèses (à affiner avec les vraies mesures après le déploiement)

- **Utilisateur actif** : se connecte au moins une fois dans le mois.
- **Données en base** : environ 0,4 Mo par compte aujourd'hui (1,2 Mo pour
  3 comptes synchronisés, après quelques semaines). Projection : **2 à 5 Mo
  par compte et par an**. Le cache des parties Riot (le plus gros) reste en
  local et n'est pas synchronisé.
- **Egress web par utilisateur** : environ **50 Mo/mois**, détaillés ainsi :
  - rafraîchissements : 7 appels/min, environ 1,5 Ko par réponse, 40 h
    d'onglet ouvert par mois, soit environ 25 Mo ;
  - pages consultées (dont « Mes revues ») : environ 20 Mo ;
  - reste : 5 Mo.

  Le desktop ajoute un peu de sync (des changements seulement).
- **Simultanéité** : aux heures de pointe, environ **20 %** des utilisateurs
  ont l'app ouverte. Chacun envoie environ 12 appels/min (desktop) plus
  7 appels/min (un onglet web), soit environ 0,3 requête par seconde par
  utilisateur en ligne aujourd'hui, et environ 0,1 après la tâche I.

### Résultats

| Palier (utilisateurs actifs) | Base de données (1 an) | Egress / mois | En ligne en pointe | Requêtes/s en pointe : aujourd'hui → après tâche I | Instance conseillée | Coût Supabase pour Ascend |
|---|---|---|---|---|---|---|
| **6 (aujourd'hui)** | 17 Mo | < 1 Go | 1-2 | < 1 | Micro | **25 $/mois** |
| **50** | 0,1-0,25 Go | ~2,5 Go | ~10 | ~3 → ~1 | Micro | **25 $/mois** |
| **300** | 0,6-1,5 Go | ~15 Go | ~60 | ~19 → ~6 | Micro si tâche I faite, sinon **Small** | **25 à 30 $/mois** |
| **1 000** | 2-5 Go | ~50 Go | ~200 | ~63 → ~20 | **Small** si tâche I faite, sinon **Medium** | **30 $/mois** (Small) **à 85 $/mois** (Medium) |

Calcul du coût : 25 $ de plan, plus le prix de l'instance, moins le crédit
de 10 $ :
- Micro ≈ 10 $, donc 0 $ de supplément ;
- Small ≈ 15 $, donc +5 $ ;
- Medium ≈ 60 $, donc +50 $.

**Aucun dépassement de quota** (base, egress, MAU, stockage, edge functions)
n'est attendu avant plusieurs milliers d'utilisateurs.

### Et si on était au plan gratuit ?

Pour information, puisque la question était posée. Le plan gratuit inclut
500 Mo de base, 5 Go d'egress, 50 000 MAU et une instance partagée de
0,5 Go. Il **met le projet en pause après une semaine sans activité**.
- Il ne suffirait plus **vers 100 utilisateurs actifs**, à cause des 5 Go
  d'egress ;
- et il serait risqué dès maintenant, à cause de la petite instance et de la
  mise en pause.

Le plan Pro reste le bon choix.

## 4. Recommandations pour limiter les coûts

Par ordre d'impact :

1. **Faire la tâche I avant ou avec le déploiement web** (tri des P2 de
   `QUALITY_CRITERIA.md`) :
   - un seul « poller » partagé ;
   - ≤ 3 appels/min au repos ;
   - **pause quand l'onglet est caché** (`document.visibilityState`) et
     quand la fenêtre desktop est réduite.

   Sur le web, l'onglet oublié en arrière-plan est le cas le plus fréquent.
   C'est le levier n° 1 : il divise la charge par 3 environ et repousse le
   passage à une instance plus grosse.
2. **Alléger les pages web lourdes (WSC-08)** : paginer « Mes revues »
   (50 par page au lieu de 5 000 lignes), ne charger que les 3 prochains
   scrims sur l'accueil, et ne recharger que la ligne modifiée dans Scrims.
3. **Surveiller deux jauges dans le tableau de bord Supabase**
   (Observability) :
   - **Disk IO balance** : s'il descend régulièrement près de 0, passer en
     Small (+5 $/mois) ;
   - **CPU** : s'il dépasse 70 % en continu, même décision.

   Changer d'instance se fait en un clic et provoque une courte coupure,
   d'environ une minute.
4. **Vérifier que le plafond de dépenses (« spend cap ») est activé** dans
   Billing. C'est le réglage par défaut du plan Pro : il empêche toute facture
   de dépassement surprise, au prix d'un service limité si un quota est
   atteint.
5. **Mettre en pause les projets inutilisés de l'organisation** (NatFitSport,
   s'il ne sert plus). C'est probablement 10 $/mois d'économie immédiate.
   C'est la décision de l'utilisateur.
6. **Purger les vieux marqueurs de suppression de `sync_records`** (plan #11) :
   négligeable aujourd'hui, utile à long terme pour la taille de la base et
   des sauvegardes.
7. **Plus tard :** remplacer une partie du polling par Supabase Realtime (des
   notifications poussées). 500 connexions simultanées sont incluses dans
   Pro, assez pour environ 2 500 utilisateurs à 20 % de simultanéité. Moins
   de requêtes, mais un chantier plus gros : à envisager après la tâche I si
   la charge le justifie.

## Limites de ce rapport

- L'egress et le CPU réels ne sont pas lisibles en SQL. Les chiffres
  d'egress sont des **estimations** fondées sur le code. Après le
  déploiement, relever les vrais chiffres dans Supabase (Usage, puis
  Observability) au bout d'une semaine et mettre à jour ce document.
- La taille réelle des réponses (≈ 1,5 Ko) et les 40 h/mois d'onglet ouvert
  sont des hypothèses.
- Le coût de NatFitSport dans la facture de l'organisation est déduit, pas
  vérifié.
