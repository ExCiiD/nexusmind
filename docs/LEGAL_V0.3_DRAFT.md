# Textes légaux v0.3 — BROUILLON (à valider par l'utilisateur)

> Rédigé le 19/11/2026 par la session CyberSecurity, à la demande du Chief. **Pas encore en vigueur.** Ne rien reporter dans `src/legal/` ni dans `site/` avant la validation de l'utilisateur. Une fois validé : le Front-end reporte le texte dans l'app (`src/legal/privacy.{fr,en}.md`, `terms.{fr,en}.md`) et ajoute la case de consentement (partie C) ; Graphic Design reporte le texte sur le site (`site/src/legal/confidentialite.html`, `privacy.html`, `conditions.html`, `terms.html`). La version anglaise reste à traduire depuis ce texte.
>
> Base : la v0.2 du site (18/11). Chaque ajout a été vérifié dans le schéma de production (lecture seule) le 19/11. Les passages **nouveaux ou modifiés** sont marqués ➕ dans la partie B ; tout le reste est repris de la v0.2.
>
> Ce brouillon n'est pas un avis juridique : la qualification finale (base légale, âge minimum, durées) est la décision de l'éditeur.

---

## A. Ce qui change par rapport à la v0.2

| # | Ajout | Fait vérifié (19/11) |
|---|---|---|
| 1 | **Présence aux réunions** | Table `team_session_attendance` : session, joueur, présent/absent, qui a marqué, quand. Lisible par tous les membres du groupe, modifiable par le staff et le capitaine. |
| 2 | **Récompenses MVP / Grinder** | Calculées sur le PC (`electron/main/weeklyAwards.ts`) à partir des données Riot des joueurs du roster, puis affichées sur les cartes joueurs du groupe. |
| 3 | **Liens publics de rapport d'équipe** | `report_shares` : une copie figée du rapport (nom du groupe, noms des joueurs, statistiques de la semaine), servie **sans connexion** à quiconque a le lien (`team-report/<jeton>`). Révocable, sans expiration automatique. |
| 4 | **Flux calendrier `.ics`** | `calendar_subscriptions` : adresse à jeton, lisible **sans connexion**, avec le planning du groupe. Révocable. |
| 5 | **Logos d'équipe** | Bucket `group-logos` **public** : une image envoyée par le staff est lisible par quiconque a son adresse. |
| 6 | **Micro-reviews** | `micro_review_answers` (moment de la partie, champion, rôle, réponse, note) et `micro_review_verdicts` (correction du coach), partagés avec le staff du groupe. |
| 7 | **Feuille de présence et retours de session** | `team_session_feedback`, `team_session_reviews` : retours écrits par les joueurs et le staff, visibles par le groupe. |
| 8 | **Départ d'un groupe et suppression du compte** | Ce qui reste et ce qui disparaît (voir l'encadré ci-dessous). |
| 9 | **Bien-être : consentement explicite au stockage** | La v0.2 ne demandait le consentement que pour le **partage**. Le stockage dans le cloud lui-même porte sur des données de santé (art. 9) : consentement explicite au premier check-in, retirable, avec effacement (partie C). |
| 10 | **Notifications par Discord** | Le bot envoie aussi des messages privés au staff (absence ou retour d'un joueur), pas seulement dans le salon d'équipe. |

> ⚠️ **Constat technique pendant la rédaction (S19-16, signalé au Chief) :** la suppression de compte (`delete-account`) **échoue** pour tout utilisateur qui a écrit une ligne dans l'une de ces tables : `team_discussion_comments`, `team_session_feedback`, `team_session_games`, `team_session_reviews`, `team_session_objectives`, `calendar_event_requests`, `group_fundamentals`, `report_shares` ou `calendar_subscriptions`. Leurs clés étrangères vers `auth.users` sont en `NO ACTION`. Par ailleurs, `groups.created_by` est en `ON DELETE CASCADE` : supprimer le compte du **créateur** d'un groupe supprime **tout le groupe** pour tous ses membres. Tant que ce n'est pas corrigé, le § 8 « Effacement » de la v0.2 comme celui-ci promettent quelque chose que l'app ne fait pas toujours. Le texte ci-dessous décrit le comportement **visé** après correction (encadré du § 7) : à ne publier qu'une fois le correctif livré.

---

## B. Texte proposé — Politique de confidentialité (FR)

**Politique de confidentialité**
Version 0.3 · mise à jour le [date de validation] · s'applique à l'application de bureau, à l'app web et à ce site

### 1. Qui est responsable de vos données
Ascend est édité par ExCiiD, La Réunion, France. Contact pour toute question sur vos données : exciid501@gmail.com.

### 2. Le principe : local d'abord
Par défaut, vos sessions, reviews, notes, scores, statistiques et enregistrements vidéo restent dans l'application, sur votre ordinateur. Le compte Ascend sert à sauvegarder ces données, à les synchroniser entre vos appareils et, si vous le choisissez, à travailler avec un coach ou une équipe.

### 3. Ce que nous traitons, et pourquoi

| Données | Quand | Pourquoi |
|---|---|---|
| Adresse e-mail | À la création du compte | Connexion par code envoyé par e-mail, messages liés au service. |
| Riot ID et identifiant de compte Riot (PUUID) de vos comptes liés | Quand vous liez un compte Riot | Retrouver vos parties via l'API Riot Games. |
| Données de coaching : sessions, parties suivies, reviews, notes, erreurs taguées, objectifs, évaluations | Si vous avez un compte (synchronisation) | Sauvegarde, synchronisation entre vos appareils, accès depuis l'app web. |
| ➕ Micro-reviews : moment de la partie, champion, rôle, votre réponse et votre note, et la correction éventuelle du coach | Quand vous répondez à une micro-review avec un compte | Votre progression ; visibles par le staff d'un groupe seulement si vous partagez vos reviews avec ce groupe. |
| Groupes, rôles, invitations, réglages de partage | Si vous rejoignez une équipe ou un groupe de coaching | Faire fonctionner le travail à plusieurs, dans les limites que vous fixez. |
| Commentaires, objectifs assignés, scrims, disponibilités, planning, annonces, tâches, drafts | Si vous utilisez les fonctions d'équipe ou de coaching | Les partager avec les membres concernés du groupe. |
| ➕ Sessions d'équipe : présence ou absence aux réunions (et qui l'a notée), parties jouées, retours et reviews de session | Quand le staff ou le capitaine organise une session d'équipe | Suivre l'assiduité et le travail collectif ; visibles par les membres du groupe. |
| ➕ Récompenses hebdomadaires (MVP, Grinder) | Si vous êtes dans le roster d'une équipe | Calculées sur l'ordinateur des membres à partir de vos parties classées (données publiques de l'API Riot), et affichées sur les cartes joueurs du groupe. |
| ➕ Logo de l'équipe | Si le staff en envoie un | Afficher l'équipe. L'image est publique : quiconque a son adresse peut la voir. |
| ➕ Rapports d'équipe partagés par lien | Si le staff crée un lien de rapport | Une copie figée du rapport de la semaine (nom de l'équipe, noms des joueurs, statistiques), lisible **sans connexion** par toute personne qui a le lien, jusqu'à ce que le staff le révoque. |
| ➕ Abonnement au calendrier (`.ics`) | Si le staff crée une adresse d'abonnement | Le planning de l'équipe, lisible **sans connexion** par toute personne qui a l'adresse, jusqu'à ce qu'elle soit révoquée. |
| Check-ins de bien-être (énergie, humeur, sommeil, note facultative) | ➕ Uniquement si vous en remplissez **et** que vous avez accepté leur enregistrement (voir § 3 bis) | Votre suivi personnel ; partagés avec le staff d'un groupe seulement si vous l'activez pour ce groupe. Le staff peut recevoir une alerte si votre charge de jeu est élevée et que votre humeur baisse plusieurs jours de suite, uniquement si vous partagez vos statistiques **et** votre bien-être avec ce groupe. |
| Notifications | Selon votre activité de groupe | Vous prévenir (commentaire reçu, objectif assigné, rappel de scrim). |
| Signalements de bug et suggestions | Quand vous en envoyez un | Corriger et améliorer l'app. Le diagnostic technique n'est joint que si vous cochez la case ; il est expurgé des données personnelles. |
| Identifiant Discord et salon lié | Si votre équipe utilise le bot Discord et que vous liez votre compte | Répondre aux commandes du bot (planning, disponibilités, scrims). ➕ Si vous êtes membre du staff et avez lié votre compte, le bot peut aussi vous envoyer en message privé les absences et retours des joueurs. ➕ Les commandes de planning du bot sont visibles par les membres du serveur Discord lié à l'équipe. |
| Requêtes vers l'API Riot (Riot ID, identifiants de match) | À chaque récupération de données de jeu | Transmises par notre relais, qui ajoute la clé d'API et limite le volume par compte. |

**Base légale :** l'exécution du service que vous demandez (article 6.1.b du RGPD). ➕ Pour les check-ins de bien-être, qui sont des données de santé, leur **enregistrement** comme leur **partage** avec un groupe reposent sur votre consentement explicite (article 9.2.a), retirable à tout moment.

### ➕ 3 bis. Check-ins de bien-être : votre consentement
- La première fois que vous remplissez un check-in, Ascend vous demande si vous acceptez qu'il soit enregistré et synchronisé avec votre compte. Sans cet accord, aucun check-in n'est enregistré.
- Le partage avec le staff d'un groupe est un **second** accord, distinct, à donner groupe par groupe (*Réglages de partage*).
- Vous pouvez retirer votre accord à tout moment dans *Réglages → Confidentialité* : vos check-ins sont alors **supprimés** de votre compte et cessent immédiatement d'être visibles par les groupes.
- Ascend n'utilise jamais ces données pour autre chose que votre suivi et celui de votre staff, quand vous l'avez choisi.

### 4. Ce qui ne quitte jamais votre ordinateur
- Les vidéos de vos parties, clips et miniatures.
- Le cache des matchs Riot et les statistiques détaillées calculées à partir de celui-ci.
- L'audio des débriefs : la transcription est faite par un modèle qui tourne sur votre PC.
- Vos accès YouTube : si vous publiez une vidéo sur votre chaîne, l'autorisation est chiffrée par le trousseau de Windows et l'envoi se fait directement de votre PC vers YouTube. *(À ajuster selon la décision A/B sur YouTube : avec l'option B, l'échange d'autorisation passe par un serveur Ascend, à mentionner au § 6.)*
- Les webhooks Discord personnels et les réglages propres à chaque PC (dossier d'enregistrement, qualité, apparence).

### 5. Qui voit quoi
- Vous seul, par défaut.
- Le staff d'un groupe (coach, analyste, manager) voit vos reviews, micro-reviews et statistiques seulement si vous partagez ces catégories avec ce groupe.
- Vos coéquipiers voient les données d'équipe (planning, scrims, drafts, pools de champions publiés, ➕ présence aux réunions, retours de session, récompenses de la semaine), jamais vos reviews personnelles.
- ➕ **Sans connexion :** toute personne qui a le lien d'un rapport partagé, l'adresse d'abonnement au calendrier ou l'adresse du logo de l'équipe. Le staff peut révoquer les deux premiers à tout moment.
- Vous pouvez quitter un groupe ou retirer un partage à tout moment ; l'accès cesse immédiatement.

### 6. Hébergeurs et destinataires
- **Supabase** : comptes, synchronisation, sauvegardes, fonctions de groupe, ➕ logos d'équipe, rapports partagés et calendriers. Hébergement Union européenne / Suisse (région Zurich).
- **Cloudflare** : relais vers l'API Riot Games, app web, bot Discord et ce site (réseau mondial).
- **Riot Games** : reçoit les requêtes d'API nécessaires, selon sa propre politique de confidentialité.
- **Discord et YouTube (Google)** : uniquement si vous utilisez ces intégrations.
- **GitHub** : héberge les fichiers d'installation et les mises à jour de l'application ; ce site interroge l'API publique de GitHub pour afficher la dernière version.

Aucune donnée n'est vendue ni utilisée à des fins publicitaires. Ce site n'utilise ni cookie, ni outil de mesure d'audience, ni police ou script hébergé par un tiers.

### 7. Durées de conservation
- Sauvegardes cloud : les 10 plus récentes par compte ; les plus anciennes sont supprimées automatiquement.
- Compte, données synchronisées et données de groupe : jusqu'à la suppression de votre compte.
- ➕ Check-ins de bien-être : jusqu'au retrait de votre consentement ou à la suppression de votre compte.
- ➕ Rapports partagés et adresses de calendrier : jusqu'à leur révocation par le staff, ou la suppression du groupe.
- Journaux techniques du relais Riot : durée de rétention standard de l'hébergeur, sans conservation des requêtes par Ascend.
- Signalements de bug : jusqu'à leur traitement, puis supprimés sur simple demande.

➕ **Quand vous quittez un groupe :** votre accès cesse immédiatement et le groupe ne voit plus vos données partagées (reviews, statistiques, bien-être). Ce que vous avez écrit **pour le groupe** (commentaires, retours de session, demandes au planning) et ce que le staff a noté vous concernant (présence, objectifs assignés) restent dans le groupe, car ils font partie de son historique. Vous pouvez demander leur suppression à exciid501@gmail.com.

➕ **Quand vous supprimez votre compte :** votre compte, vos données synchronisées, vos sauvegardes, vos check-ins, vos partages et vos liens Discord sont supprimés. Vos contributions aux groupes (commentaires, retours, présences notées) sont supprimées ou rendues anonymes. *(À trancher par l'éditeur.)* Si vous êtes le créateur d'un groupe, la propriété est transmise à un autre membre du staff ; s'il n'y en a pas, le groupe est supprimé. *(Comportement visé après le correctif S19-16 ; aujourd'hui, le groupe est supprimé pour tous.)*

### 8. Vos droits
- **Accès et portabilité :** *Réglages → Sauvegarde* exporte toutes vos données dans un fichier `.nexusmind`.
- **Effacement :** *Réglages → Compte Ascend → Supprimer mon compte* supprime immédiatement votre compte, vos données synchronisées et vos sauvegardes cloud (voir § 7 pour les données de groupe). Les données présentes sur votre PC ne sont pas touchées : pour les effacer, désinstallez l'application, puis supprimez son dossier de données (dans `%APPDATA%`) et votre dossier d'enregistrements.
- ➕ **Retrait du consentement au bien-être :** *Réglages → Confidentialité*, effet immédiat (§ 3 bis).
- **Rectification, opposition, limitation, retrait du consentement :** écrivez à exciid501@gmail.com. Réponse sous un mois.
- **Réclamation :** vous pouvez saisir l'autorité de protection des données de votre pays (en France, la CNIL).

### 9. Mineurs
Ascend s'adresse aux personnes de 15 ans et plus. En dessous de cet âge, l'utilisation d'un compte suppose l'accord d'un titulaire de l'autorité parentale. ➕ Pour les check-ins de bien-être, le consentement d'un utilisateur de moins de 15 ans doit être donné ou autorisé par ce titulaire.

### 10. Sécurité
Connexions chiffrées (HTTPS), session de l'application de bureau protégée par le trousseau de Windows, accès aux données contrôlé ligne par ligne côté serveur (chacun ne lit que ce qui lui est destiné ou partagé), clé d'API Riot jamais présente dans l'application. ➕ Les liens publics (rapports, calendrier) reposent sur des jetons longs et aléatoires : ne les partagez qu'avec les personnes concernées.

### 11. Modifications
Cette politique peut évoluer avec l'application. Les changements importants seront signalés dans l'app avant de s'appliquer. ➕ La v0.3 en est un : elle sera annoncée dans l'app à la première ouverture qui suit sa publication.

*Mentions Riot Games : inchangées (texte anglais officiel de la v0.2).*

---

## C. Consentement au premier check-in de bien-être (à intégrer par le Front-end)

**Moment :** au premier envoi d'un check-in (énergie, humeur, sommeil) par un utilisateur connecté, avant tout enregistrement, local ou cloud. Si l'utilisateur refuse, rien n'est enregistré et le formulaire reste accessible pour plus tard.

**Texte FR proposé (le jargon LoL reste en anglais) :**

> **Enregistrer vos check-ins de bien-être ?**
> Votre énergie, votre humeur et votre sommeil sont des données de santé. Avec votre accord, Ascend les enregistre dans votre compte pour suivre leur évolution d'une session à l'autre et les synchronise entre vos appareils.
> - Personne d'autre ne les voit, sauf si vous activez plus tard leur partage avec le staff d'un groupe.
> - Vous pouvez retirer votre accord à tout moment dans *Réglages → Confidentialité* : vos check-ins seront alors supprimés.
>
> [ J'accepte ] [ Pas maintenant ] · *En savoir plus* (lien vers le § 3 bis)

**Règles pour l'implémentation :**
1. La case n'est **pas** pré-cochée ; « Pas maintenant » est aussi visible que « J'accepte ».
2. Enregistrer la preuve du consentement : date, version du texte (`v0.3`), et le retrait éventuel avec sa date. Où et comment : à décider par le Back-end.
3. Le retrait supprime les lignes de `wellbeing_checkins` de l'utilisateur (le Back-end vérifie le chemin de suppression, synchronisation comprise) et coupe `share_wellbeing` dans tous ses groupes.
4. Le partage avec un groupe (`share_wellbeing`) reste un réglage séparé, désactivé par défaut, avec son propre texte : « Partager mes check-ins de bien-être avec le staff de [groupe] ».
5. Pour les utilisateurs qui ont **déjà** des check-ins (1 ligne en production au 19/11) : leur demander le consentement à la prochaine ouverture ; s'ils refusent, supprimer les check-ins existants.

**Texte EN :** à traduire depuis le texte FR validé.

---

## D. Conditions d'utilisation : retouches proposées
Les CGU de la v0.2 couvrent déjà l'usage du service. Deux ajouts suffisent :
1. **Liens publics :** « Le staff qui crée un lien de rapport ou une adresse de calendrier est responsable de leur diffusion ; ces liens donnent accès sans connexion aux informations qu'ils contiennent, y compris les noms des joueurs. »
2. **Contenu d'équipe :** « Ce que vous publiez dans un groupe (commentaires, retours, logos) doit respecter les autres membres. Le staff du groupe peut le supprimer. »

---

## E. Avant publication (liste à cocher)
- [ ] Validation du texte par l'utilisateur (parties B, C, D), y compris les deux passages marqués « à trancher ».
- [ ] Correctif S19-16 livré (suppression de compte et transmission de la propriété du groupe), sinon retirer l'encadré « Quand vous supprimez votre compte » ou le réécrire selon le comportement réel.
- [ ] Décision YouTube A/B reportée au § 4 et au § 6.
- [ ] Case de consentement livrée **avant** la publication du texte qui l'annonce.
- [ ] Même version (0.3) et même date dans l'app et sur le site ; traduction EN faite.
- [ ] Revue Audit (cohérence app et site) et CyberSecurity (correspondance avec les données réellement collectées).
