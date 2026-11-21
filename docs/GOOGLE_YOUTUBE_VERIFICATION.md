# Vérification Google (YouTube) — dossier prêt à remplir

Back-end, 21/11/2026. Décision de l'utilisateur du 21/11 : « Lancer la vérification Google ». **L'utilisateur remplit et envoie
lui-même les formulaires** dans Google Cloud. Ce dossier ne soumet rien et ne touche à aucun compte. Les textes à coller sont en
anglais : les formulaires de Google sont en anglais.

**But.** Que l'envoi sur YouTube marche dans l'app installée pour tous les joueurs. Deux décisions de l'utilisateur, 21/11 :
- client « Desktop app » + PKCE (remplace l'option A du 19/11) ;
- « Upload YouTube automatique » : réglage activé par le joueur. Chaque partie enregistrée et chaque clip partent sans clic sur sa
  chaîne, avec la visibilité choisie dans les réglages (public, non répertorié, privé). Désactivable à tout moment.

Sans vérification :
- un projet non vérifié affiche « application non validée » et plafonne à 100 utilisateurs ;
- le quota par défaut de l'API (10 000 unités par jour, un envoi = 1 600) permet environ 6 envois par jour **pour tous les joueurs
  réunis**.

---

## 0. Ce qui est en place dans le code (21/11)

| Point exigé par Google | État |
|---|---|
| Une seule autorisation, la plus étroite | ✅ `youtube.upload` seulement. L'app ne lit rien du compte, pas même le nom de la chaîne. |
| Flux sécurisé d'une application installée | ✅ Client « Desktop app », PKCE (S256), paramètre `state` vérifié, redirection en boucle locale `127.0.0.1`. |
| Identifiants dans l'app installée | ✅ L'identifiant et le secret du client Desktop sont ajoutés **au build** (`.env` non versionné ou variables d'environnement de `scripts/release.ps1`). Ils ne sont jamais commités ni écrits dans les journaux. `release.ps1` dit seulement s'ils sont présents. Sans eux, l'envoi est désactivé dans ce build. |
| Révocation par l'utilisateur | ✅ « Déconnecter YouTube » révoque l'autorisation chez Google (`oauth2.googleapis.com/revoke`), efface les jetons du PC et vide la file d'envoi. |
| Upload automatique | ✅ Désactivé par défaut. Activé par le joueur, avec la visibilité de son choix (non répertoriée par défaut) et le son de son choix : **sans son par défaut** (le micro, et le vocal qu'il capte, sont mélangés à la piste du jeu : on ne peut pas retirer le micro seul), ou avec le son. Une copie sans son est faite dans le dossier temporaire du système et supprimée après l'envoi. File persistante sur le PC (identifiants seulement), une vidéo à la fois, jamais deux fois la même. Le désactiver vide la file et arrête l'envoi en cours (une vidéo inachevée n'est jamais publiée). Les réunions d'équipe restent manuelles. |
| Données de l'API conservées | ✅ Seule l'adresse de la vidéo publiée. Clip : sur le PC (`Clip.youtubeUrl`). Partie : `Recording.youtubeUrl`, synchronisée (staff si les reviews sont partagées). Réunion d'équipe (manuelle) : `team_session_reviews.youtube_url`, dans le cloud (groupe). Les textes du § 2-3 le disent. |
| Jetons | ✅ Chiffrés par le trousseau Windows (`safeStorage`), jamais envoyés à un serveur Ascend. Sans chiffrement possible, la connexion est refusée (`ENCRYPTION_UNAVAILABLE`). |

**Reste côté app** : afficher la phrase sur les conditions de YouTube (§ 3.6) dans les réglages, à l'activation de l'upload
automatique et à la connexion (Front-End).

---

## 1. Pas-à-pas dans la console Google Cloud

Compte : celui qui possède le projet Google Cloud `nexusmind-493022` (son seul client OAuth est de type Desktop).

### 1.1 Écran de consentement (Google Auth Platform)
1. <https://console.cloud.google.com/> → choisir le projet → menu ☰ → **Google Auth Platform** (anciennement « APIs & Services →
   OAuth consent screen »).
2. **Branding** :
   - App name : `Ascend` ;
   - User support email : l'adresse de contact publiée (celle de la politique de confidentialité) ;
   - App logo : `build/icon.png` (PNG carré, 120 × 120 px conseillé, moins de 1 Mo) ;
   - Application home page : `https://asc3nd.app` ;
   - Privacy policy link : `https://asc3nd.app/en/privacy` (version anglaise, celle que Google lit ; FR : `https://asc3nd.app/confidentialite`) ;
   - Terms of service link : `https://asc3nd.app/en/terms` (FR : `https://asc3nd.app/conditions`) ;
   - Authorized domains : `asc3nd.app` (couvre aussi `app.asc3nd.app`, l'app web) ;
   - Developer contact email : la même adresse.
   - **Save**.
3. **Audience** : User type **External**. Statut de publication : **In production** (« Publish app »). Tant que la vérification
   n'est pas faite, l'écran « Google hasn't verified this app » reste affiché : c'est normal.
4. **Data Access** (Scopes) → **Add or remove scopes** → cocher uniquement
   `https://www.googleapis.com/auth/youtube.upload` → **Update** → **Save**. Retirer `youtube.readonly` si elle y figure.
   - Justification : texte du § 3.1 ;
   - Vidéo de démonstration : lien YouTube **non répertorié** de la vidéo du § 4.
5. **Clients** : vérifier qu'il existe un client de type **Desktop app**. Ne pas créer de client « Web » pour l'app de bureau.
6. **Verification Center** → **Prepare for verification** → relire chaque section → **Submit for verification**. Google
   répond par e-mail (questions éventuelles), en général sous quelques jours à quelques semaines pour un scope « sensible ».
   `youtube.upload` est **sensible, pas restreint** : pas d'audit de sécurité payant (CASA).

### 1.2 Quota de l'API YouTube (formulaire séparé)
7. Menu ☰ → **APIs & Services → YouTube Data API v3 → Quotas** : noter le quota actuel (10 000 unités par jour).
8. Formulaire **« YouTube API Services – Audit and Quota Extension Form »** :
   <https://support.google.com/youtube/contact/yt_api_form>. Le remplir avec les textes du § 5.
   - Google audite alors l'app au regard des **YouTube API Services Terms of Service** et des **Developer Policies**.
   - Joindre les liens du site, de la politique et la vidéo du § 4.
9. **Alerte de quota** (relecture CyberSecurity : le client Desktop est public, n'importe qui peut consommer le quota du projet) :
   menu ☰ → **Monitoring → Alerting → Create policy**, métrique « YouTube Data API v3 – quota usage », seuil 80 % du quota
   quotidien, notification par e-mail à l'adresse de contact.
10. Attendre l'accord sur les deux volets (vérification OAuth et quota). Rien à changer dans le code ensuite.

---

## 2. Prérequis et leur état

| Prérequis | État au 21/11 | Action |
|---|---|---|
| **Page d'accueil publique** qui décrit l'app | ✅ <https://asc3nd.app> (domaine du projet, attaché au worker `ascend-site`), sans `noindex` au 21/11 | relire que la page décrit bien Ascend et son usage de YouTube |
| **Domaine vérifié** dans Google Search Console (« Authorized domains ») | ✅ fichier de vérification en ligne : <https://asc3nd.app/googlec7dae68e8dccf3cd.html> (200, servi par `site/worker.ts`) | dans Search Console, cliquer **Valider** sur la propriété `https://asc3nd.app` **avec le même compte Google que celui du projet Cloud** (Google exige que le propriétaire du domaine soit propriétaire ou éditeur du projet) |
| **Politique de confidentialité** qui parle des données YouTube | ⚠️ v0.3 en brouillon (`docs/LEGAL_V0.3_DRAFT.md`) : YouTube y est cité (§ 4 et § 6), mais pas ce que Google exige | ajouter le texte du § 2.1 ci-dessous, puis publier la v0.3 (FR + EN) |
| **Conditions d'utilisation** | ✅ v0.2 sur le site (`conditions.html`) | ajouter la phrase du § 2.2 à la v0.3 |
| **E-mail d'assistance** | ✅ l'adresse de contact publiée dans la politique | la même dans la console |
| **Logo** | ✅ `build/icon.png` | le même logo sur le site et dans la console (Google compare) |
| **Nom cohérent** | ✅ « Ascend » partout (site, app, console) | — |

### 2.1 Politique de confidentialité : ajouts (à relire par CyberSecurity)

**Remplacer**, au § 4 de la v0.3, la puce « Vos accès YouTube » par :

> - **YouTube (si vous le connectez).** Ascend ne demande qu'une autorisation : publier des vidéos sur votre chaîne
>   (autorisation Google « youtube.upload »). Ascend ne lit rien de votre compte YouTube : ni vos vidéos, ni le nom de votre
>   chaîne, ni vos statistiques. L'autorisation est chiffrée par le trousseau de Windows sur votre PC ; sans ce chiffrement,
>   Ascend refuse la connexion. L'envoi se fait directement de votre PC vers YouTube, sans passer par un serveur Ascend.
> - **Upload automatique (si vous l'activez).** Dans *Réglages → YouTube*, l'option « Upload YouTube automatique » est désactivée
>   par défaut. Si vous l'activez, chaque partie enregistrée et chaque clip que vous découpez sont publiés sur votre chaîne sans
>   autre action, avec la visibilité que vous avez choisie (publique, non répertoriée ou privée ; non répertoriée par défaut).
>   Par défaut, ces vidéos partent **sans son** : votre micro, et le vocal qu'il capte, ne sont pas publiés. Si vous choisissez
>   « avec le son », votre voix et celle des personnes de votre vocal partent avec la vidéo.
>   Vous pouvez changer la visibilité ou désactiver l'option à tout moment : les vidéos pas encore envoyées ne partent plus.
>   Les vidéos déjà publiées restent sur votre chaîne ; vous les gérez ou les supprimez depuis YouTube. L'enregistrement d'une
>   réunion d'équipe n'est jamais publié automatiquement.
> - Ascend garde l'adresse de la vidéo publiée. Pour un clip, elle reste sur votre PC. Pour la vidéo d'une partie, elle est
>   synchronisée avec votre compte Ascend et visible du staff de vos groupes si vous partagez vos reviews. Pour l'enregistrement
>   d'une réunion d'équipe, elle est visible des membres du groupe. Ascend ne garde aucune autre donnée YouTube.

**Ajouter**, au § 6 (après « Discord et YouTube (Google) ») :

> En utilisant la publication sur YouTube, vous acceptez les [Conditions d'utilisation de YouTube](https://www.youtube.com/t/terms).
> Le traitement par Google est régi par les [Règles de confidentialité de Google](https://policies.google.com/privacy).

**Ajouter**, au § 8 « Vos droits » :

> - **Arrêter l'upload automatique :** *Réglages → YouTube → Upload YouTube automatique*, désactiver.
> - **Retirer l'accès YouTube :** *Réglages → YouTube → Déconnecter* révoque l'autorisation chez Google, l'efface de votre PC et
>   arrête les envois en attente. Vous pouvez aussi la retirer depuis la page des autorisations de votre compte Google :
>   <https://myaccount.google.com/permissions>.

**Version anglaise** (à mettre dans la politique EN, que Google lit) :

> - **YouTube (if you connect it).** Ascend asks for one permission only: to publish videos on your channel (Google scope
>   "youtube.upload"). Ascend does not read anything from your YouTube account: not your videos, not your channel name, not your
>   statistics. The authorization is encrypted by Windows' credential store on your PC; without that encryption, Ascend refuses
>   to connect. The upload goes straight from your PC to YouTube, never through an Ascend server.
> - **Automatic upload (if you turn it on).** In *Settings → YouTube*, "Automatic YouTube upload" is off by default. If you turn it
>   on, each recorded game and each clip you cut is published on your channel with no further action, with the visibility you
>   chose (public, unlisted or private; unlisted by default). By default these videos are uploaded **without sound**: your
>   microphone, and the voice chat it picks up, are not published. If you choose "with sound", your voice and the voices of the
>   people in your voice chat are published with the video. You can change the visibility or turn it off at any time: videos
>   not yet uploaded are no longer sent. Videos already published stay on your channel; you manage or delete them on YouTube. A
>   team meeting recording is never published automatically.
> - Ascend keeps the link of the published video. For a clip, it stays on your PC. For a full game video, it is synced with your
>   Ascend account and visible to your groups' staff if you share your reviews. For a team meeting recording, it is visible to
>   the group's members. Ascend stores no other YouTube data.
> - By publishing to YouTube you agree to the [YouTube Terms of Service](https://www.youtube.com/t/terms). Google's processing is
>   governed by the [Google Privacy Policy](https://policies.google.com/privacy).
> - **Stopping the automatic upload:** *Settings → YouTube → Automatic YouTube upload*, turn it off.
> - **Removing YouTube access:** *Settings → YouTube → Disconnect* revokes the authorization at Google, erases it from your PC and
>   stops pending uploads. You can also remove it from your Google Account permissions page:
>   <https://myaccount.google.com/permissions>.

### 2.2 Conditions d'utilisation : ajout

> La publication sur YouTube depuis Ascend est soumise aux Conditions d'utilisation de YouTube
> (<https://www.youtube.com/t/terms>). Vous êtes responsable des vidéos que vous y publiez. Avant de publier l'enregistrement
> d'une réunion d'équipe, vous devez avoir l'accord des participants, dont la voix et l'image y figurent. Si vous publiez vos
> parties avec le son, vous êtes responsable des voix d'autres personnes (vocal, appel) qu'elles contiennent.

EN : « Publishing to YouTube from Ascend is subject to the YouTube Terms of Service. You are responsible for the videos you
publish. Before publishing a team meeting recording, you must have the consent of the participants, whose voice and image it
contains. If you publish your games with sound, you are responsible for the voices of other people (voice chat, calls) they
contain. »

---

## 3. Textes prêts à coller (anglais)

Ces textes décrivent ce que fait le code au 21/11 : upload automatique des parties et des clips (si le joueur l'active), partage
manuel d'un clip, publication manuelle d'une réunion d'équipe.

### 3.1 Scope justification (`youtube.upload`)
> Ascend is a desktop coaching app for League of Legends players. It records the player's own games on their PC so they can review them with their coach or team. With the youtube.upload scope, Ascend publishes these recordings to the player's own YouTube channel: when the player turns on "Automatic YouTube upload" in the app settings, each recorded game and each clip they cut is uploaded automatically, with the visibility the player chose in the same settings (public, unlisted or private). The player can turn it off, change the visibility, or disconnect YouTube at any time. We request youtube.upload because it is the narrowest scope that allows uploading. We do not request any read scope: Ascend never lists, reads, edits or deletes the player's videos, playlists, channel data or analytics.

_21/11 : upload automatique décidé par l’utilisateur (DECISIONS.md) ; 798 caractères sur 1000._

### 3.2 App description
> Ascend helps League of Legends players improve after each game. On Windows, it detects the end of a game, records it locally,
> and guides a short review: key moments of the game, the player's mistakes, objectives for the next session, and progress over
> time. Players can work with a coach or a team. Videos stay on the player's PC; an optional Ascend account syncs their review
> data between devices. YouTube is used only to publish the player's own videos (their games, clips, or their team's review
> meetings) on their own channel, so they can share them with their coach or team.

### 3.3 How the app uses YouTube data
> - When it happens: only after the player connects YouTube. Games and clips are uploaded automatically only if the player turns
>   on "Automatic YouTube upload" (off by default); a team meeting recording is uploaded only when the player clicks to publish it.
> - Data sent to YouTube: the video file (for automatic uploads, without its audio track unless the player chooses "with sound"), a title (the clip's title, or the champion, opponent, result and date of the game) and a
>   short description (the same game details). Privacy status: the one the player chose in the settings (unlisted by default).
> - Data received from YouTube: the uploaded video's ID, used to build its link.
> - Data stored: only the uploaded video's link. For a clip, it stays on the player's PC. For a full game video, it is synced
>   with the player's Ascend account and visible to their groups' staff if they share their reviews. For a team meeting
>   recording, it is visible to the group's members. No other YouTube data is stored on Ascend servers. No YouTube data is shared
>   with third parties, used for advertising, or combined with other data.
> - The upload queue (the IDs of the videos waiting to be uploaded) is kept on the player's PC only.
> - OAuth tokens: encrypted with the Windows credential store (Electron safeStorage) on the player's PC; if encryption is not
>   available, the app refuses to connect. Tokens are never sent to Ascend servers.

### 3.4 Data retention and deletion
> A clip's video link is kept on the player's PC until the player deletes the clip. A game video's link is kept with the game's
> review, and a meeting recording's link with the team session, until they are deleted. Turning off the automatic upload empties
> the upload queue and stops the upload in progress (an unfinished upload is never published). OAuth tokens are kept on the
> player's PC until the player disconnects YouTube in the app's settings, which revokes the grant at Google
> (https://oauth2.googleapis.com/revoke), deletes the tokens and empties the queue. Uninstalling the app and deleting its data
> folder removes everything stored locally. Videos already published stay on the player's channel, where the player manages them.

### 3.5 User revocation
> In Ascend: Settings → YouTube → "Automatic YouTube upload" can be turned off at any time; Settings → YouTube → Disconnect
> revokes the authorization at Google, deletes the stored tokens and stops pending uploads. Players can also revoke access at any
> time from https://myaccount.google.com/permissions. This is stated in our privacy policy.

### 3.6 Texte à afficher dans l'app (pour Front-End, FR et EN)
- FR, sous l'option « Upload YouTube automatique » et sous le bouton de connexion : « Tes parties et tes clips seront publiés sur
  ta chaîne avec la visibilité choisie. En publiant, tu acceptes les Conditions d'utilisation de YouTube. Ascend ne lit rien de
  ta chaîne. »
- EN : « Your games and clips will be published on your channel with the visibility you chose. By publishing, you agree to the
  YouTube Terms of Service. Ascend does not read anything from your channel. »
- Lien sur « Conditions d'utilisation de YouTube » : <https://www.youtube.com/t/terms>.
- Choix du son (relecture CyberSecurity), FR : « Son : Sans son (recommandé) / Avec le son ». Sous « Avec le son » : « Ta voix
  et celle de ton vocal partent avec chaque partie. » EN : « Sound: No sound (recommended) / With sound ». « Your voice and
  your voice chat go out with every game. »
- À l'activation, FR : « Chaque partie et chaque clip seront publiés sans relecture. » EN : « Every game and clip will be
  published without review. »
- Si le joueur choisit **Public**, une confirmation en plus, FR : « Tes parties seront visibles de tout le monde sur YouTube.
  Continuer ? » EN : « Your games will be visible to everyone on YouTube. Continue? »
- Le réglage est synchronisé, FR : « S'applique à tous tes PC connectés à ce compte. » EN : « Applies to all your PCs signed
  in to this account. »

---

## 4. Vidéo de démonstration (≈ 2 min)

Google veut voir l'écran de consentement **avec l'identifiant client visible dans l'URL**, puis l'usage réel de l'autorisation.
Filmer en anglais (interface de l'app en anglais) ou sous-titrer en anglais. Publier la vidéo **non répertoriée** sur YouTube et
coller son lien dans la console.

| Temps | À l'écran | Voix ou sous-titre |
|---|---|---|
| 0:00 | Le site public (page d'accueil), puis la politique de confidentialité, section YouTube | « Ascend is a League of Legends coaching app. This is our privacy policy section about YouTube. » |
| 0:15 | L'app ouverte : Réglages → YouTube → **Connect** | « The player connects YouTube from the settings. » |
| 0:25 | Le navigateur s'ouvre sur l'écran Google : **zoomer sur la barre d'adresse** pour montrer `client_id=` et `scope=…youtube.upload`, puis sur la liste des autorisations demandées (une seule) | « The consent screen shows our client ID and a single scope: upload videos. » |
| 0:45 | Clic **Allow**, page « YouTube Connected », retour à l'app | — |
| 0:55 | Réglages → YouTube : activer **Upload YouTube automatique**, choisir la visibilité **Unlisted** | « The player turns on automatic upload and picks the visibility. » |
| 1:05 | Fin d'une partie (ou un clip découpé et sauvé) : l'indicateur d'envoi apparaît, la barre progresse, le lien s'affiche | « The recorded game is uploaded with no extra click. » |
| 1:25 | Ouvrir le lien : la vidéo sur YouTube, visibilité « Unlisted » | « The video is on the player's channel, with the chosen visibility. » |
| 1:40 | Désactiver l'option, puis Réglages → YouTube → **Disconnect**, puis <https://myaccount.google.com/permissions> où Ascend n'apparaît plus | « Turning it off stops uploads; disconnecting revokes the access at Google. » |
| 2:00 | Fin | — |

À préparer : un compte Google de test avec une chaîne YouTube, une partie enregistrée avec des données de démonstration, et l'app
dans un build qui contient l'identifiant et le secret du client Desktop.

---

## 5. Formulaire de quota (« Audit and Quota Extension »)

### 5.1 Estimation (à ajuster avec les vrais chiffres au moment de l'envoi)
- Un envoi (`videos.insert`) coûte **1 600 unités**. Ascend n'appelle aucune autre méthode de l'API (ni lecture, ni liste).
- Avec l'upload automatique, le besoin suit le nombre de **parties** (et de clips) des joueurs qui l'activent.
- Hypothèses : `A` joueurs actifs par jour, `p` part qui active l'upload automatique, `g` parties par joueur et par jour, `c`
  clips par joueur et par jour.
- Besoin quotidien = `A × p × (g + c) × 1 600` unités.
- Exemple : 200 joueurs actifs × 25 % × (4 parties + 1 clip) = 250 envois par jour = **400 000 unités**. **Demander 500 000
  unités par jour** pour les pics de soirée. Si le quota accordé est plus bas, la file attend le lendemain (minuit, heure du
  Pacifique) : rien n'est perdu.

### 5.2 Texte à coller
> Ascend is a Windows coaching app for League of Legends players (website and privacy policy linked). Our only use of the
> YouTube Data API is videos.insert. When a player turns on "Automatic YouTube upload" (off by default), each game they record
> and each clip they cut is uploaded to their own channel with the visibility they chose (unlisted by default). Players can also
> publish a team review meeting by hand. We make no read calls (no search, list, analytics or channel reads). Each upload costs
> 1,600 units. We currently have about [A] daily active players; we expect about [p]% of them to turn on automatic upload, with
> about [g] games and [c] clips per day each, i.e. about [uploads] uploads per day, [units] units per day. We request [500,000]
> units per day to cover this and evening peaks. Uploads run one at a time from each player's PC with the player's own OAuth
> token; when the quota is used up, they wait for the next day. Only the uploaded video's link is stored, as described in our
> privacy policy. We comply with the YouTube API Services Terms of Service and Developer Policies: single sensitive scope,
> automatic upload only after the player's opt-in, revocation in the app and documented in our privacy policy, links to the
> YouTube Terms of Service and the Google Privacy Policy, no storage of API data beyond the uploaded video's link.

### 5.3 Conformité aux règles YouTube (points que l'audit vérifie)
- Politique de confidentialité publique qui cite YouTube, renvoie aux conditions de YouTube et aux règles de Google, et explique
  la révocation (§ 2.1).
- Pas de stockage de données de l'API au-delà de ce qui est permis : seule l'adresse de la vidéo publiée par le joueur
  (voir § 2.1).
- Pas de contournement des quotas (un seul projet Google, pas de rotation de clés).
- Pas de publication sans accord du joueur : l'upload automatique est désactivé par défaut, le joueur l'active lui-même (avec la
  visibilité de son choix) sur un compte qu'il a connecté, et peut l'arrêter à tout moment.
- Pas de contournement du quota : une seule vidéo à la fois par PC ; quand le quota est épuisé, la file attend le lendemain.

---

## 6. Ce qui se fait avec la demande de clé Riot de production (`docs/PLAN_CLE_PROD.md`)

À préparer **une seule fois**, pour les deux demandes :
1. **Site public sur un domaine à soi** : `asc3nd.app`, déjà en place et vérifiable dans Search Console. Riot l'exige
   (« site complet »), Google aussi (domaine autorisé et vérifié).
2. **Textes légaux v0.3 publiés** (FR + EN), avec les ajouts YouTube du § 2.1 et la mention Riot (« isn't endorsed by Riot
   Games… »).
3. **Même nom, même logo, même e-mail de contact** sur le site, dans l'app, chez Riot et chez Google.
4. **Une vidéo de démonstration** : la même prise peut montrer le produit à Riot (détection de partie, review, aucun avantage
   en partie) puis le flux YouTube ; deux montages courts à partir d'un seul tournage.
5. **Chiffres d'usage** : les métriques du proxy Riot (P1-10) donnent aussi `A` pour l'estimation du quota YouTube (§ 5.1).

Ordre conseillé :
- d'abord valider le domaine dans Search Console et publier les textes v0.3 ;
- puis le même jour la demande Riot (« large-scale product ») et la vérification Google ;
- ensuite le formulaire de quota YouTube, qui peut citer l'app vérifiée.

---
## 7. Ce qui reste à décider ou à faire

| Qui | Quoi |
|---|---|
| Utilisateur | Valider `asc3nd.app` dans Search Console, avec le compte du projet Google Cloud. |
| Utilisateur | Mettre l'identifiant et le secret du client Desktop dans le `.env` non versionné (ou les variables d'environnement) avant le build ; `release.ps1` dit s'ils sont présents. |
| Utilisateur | Valider puis publier la v0.3 avec les ajouts du § 2.1. |
| CyberSecurity | Relire l'arrivée des identifiants au build et les § 2-3 (upload automatique). |
| Front-End | Réglage « Upload YouTube automatique » (activé, visibilité) et phrase du § 3.6 ; écran Réglages → YouTube sans nom de chaîne. |
