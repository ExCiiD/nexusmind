# Mise en place du cloud Ascend (W1)

Ce qui est **déjà fait** (via le code et le MCP Supabase) :

- Projet Supabase `Ascend` (`zwubyzrfpelhxjjezvrh`, Zurich) réactivé.
- Table `public.cloud_backups` + bucket privé `backups` (50 Mo/fichier, un dossier par utilisateur, RLS).
- Edge Function `delete-account` (suppression RGPD des sauvegardes + du compte).
- Worker Cloudflare `nexusmind-riot-proxy` **déployé** : https://nexusmind-riot-proxy.nexusmind-riot-proxy.workers.dev (clé Riot permanente en secret `RIOT_API_KEY`, JWT Supabase vérifiés via JWKS ES256).

Ce qu'il reste à faire **par toi** (comptes et tableaux de bord) :

## 1. E-mails de connexion : envoyer un code, pas un lien

Supabase → *Authentication → Emails → Templates*. Remplace le contenu de **Magic link** **et** de **Confirm signup** par :

```html
<h2>Ton code Ascend / Your Ascend code</h2>
<p>Saisis ce code dans l'application / Enter this code in the app:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>Il expire dans 1 heure. Si tu n'as rien demandé, ignore cet e-mail.<br>
It expires in 1 hour. If you didn't request it, ignore this e-mail.</p>
```

Objet conseillé : `{{ .Token }} — code Ascend`.

> L'envoi d'e-mails intégré à Supabase est très limité (quelques e-mails par heure) : suffisant pour tester, pas pour la bêta publique. Avant d'inviter des joueurs, configure un SMTP (*Authentication → Emails → SMTP Settings*), par exemple Resend ou Brevo, qui ont des offres gratuites.

## 2. Déployer le proxy Riot (Cloudflare Worker)

Depuis `cloudflare/riot-proxy/` :

```bash
npm install
npx wrangler login
npx wrangler secret put RIOT_API_KEY
npx wrangler deploy
```

`wrangler secret put` te demande la clé Riot (colle-la, elle n'est stockée que chez Cloudflare). `wrangler deploy` affiche l'URL du Worker, du type `https://nexusmind-riot-proxy.<ton-compte>.workers.dev`.

Vérification : `https://<url-du-worker>/health` doit répondre `{"ok":true}`.

> Clé Riot : une clé *Development* expire toutes les 24 h (à remettre avec `wrangler secret put`). Pour la bêta, demande une clé *Personal*/*Production* sur developer.riotgames.com.

## 3. Brancher l'app sur le proxy

Dans `.env` (racine du projet) :

```
MAIN_VITE_RIOT_PROXY_URL=https://nexusmind-riot-proxy.<ton-compte>.workers.dev
```

- Avec cette ligne, l'app (dev **et** builds) passe par le proxy et exige d'être connecté.
- Sans elle, `npm run dev` utilise `RIOT_DEV_API_KEY` du `.env` en direct. Cette variable n'est **jamais** incluse dans un build.
- Un build sans `MAIN_VITE_RIOT_PROXY_URL` n'a plus aucun accès Riot : pense à la définir avant `npm run release`.

## Variables de l'app

| Variable | Où | Public ? |
|---|---|---|
| `MAIN_VITE_SUPABASE_URL` | `.env` | Oui (inclus dans le build) |
| `MAIN_VITE_SUPABASE_ANON_KEY` | `.env` | Oui — clé publique, protégée par RLS |
| `MAIN_VITE_RIOT_PROXY_URL` | `.env` | Oui |
| `RIOT_DEV_API_KEY` | `.env` | **Non** — lue à l'exécution en dev uniquement |
| `RIOT_API_KEY` | secret Cloudflare (riot-proxy) | **Non** |
| `DISCORD_PUBLIC_KEY` / `DISCORD_BOT_TOKEN` / `DISCORD_APPLICATION_ID` | secrets Cloudflare (discord-bot) | **Non** |
| `SUPABASE_SERVICE_ROLE_KEY` | secret Cloudflare (discord-bot) | **Non — contourne RLS** |

## 4. Site web (W4)

En ligne : https://nexusmind-web.nexusmind-riot-proxy.workers.dev (Cloudflare Workers static assets).

Redéployer après une modification :

```bash
npm run web:build
```

```bash
cd web && npx wrangler deploy
```

Lance toujours `wrangler` depuis `web/` (ou `cloudflare/riot-proxy/`) : à la racine, sans configuration, wrangler 4 tente de « configurer » le projet tout seul (modifie `package.json`, ajoute des dépendances et un `vite.config.ts`).

## 5. Bot Discord d'équipe (E11)

Le code (Worker Cloudflare + handlers de commandes) est **fait et poussé**, mais contrairement au proxy Riot ou au site web, **je ne peux pas créer l'Application Discord à ta place** — ça se passe uniquement sur ton propre compte Discord. Voici les étapes, dans l'ordre.

### 5.1 Créer l'Application Discord

1. https://discord.com/developers/applications → **New Application**, donne-lui un nom (ex. « Ascend »).
2. Onglet **General Information** : note l'**Application ID** et la **Public Key**.
3. Onglet **Bot** → **Reset Token** (ou **Add Bot** si pas encore fait) : note le **Token** (affiché une seule fois — si tu le perds, il faudra en regénérer un).
4. Toujours sur l'onglet **Bot** : décoche **Public Bot** si tu veux garder le contrôle de qui l'ajoute (pas obligatoire).

### 5.2 Déployer le Worker

Depuis `cloudflare/discord-bot/` :

```bash
npm install
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler deploy
```

- Les 3 premiers secrets viennent de l'étape 5.1.
- `SUPABASE_SERVICE_ROLE_KEY` vient de Supabase → **Project Settings → API → service_role key** (⚠️ pas la clé `anon` — celle-ci contourne toutes les règles RLS, elle ne doit **jamais** atterrir dans l'app desktop/web, seulement ici).
- `wrangler deploy` affiche l'URL du Worker (`https://nexusmind-discord-bot.<ton-compte>.workers.dev`).

### 5.3 Brancher Discord sur le Worker

1. Developer Portal → ton Application → **General Information** → **Interactions Endpoint URL** : colle l'URL du Worker de l'étape précédente, puis **Save**. Discord lui envoie un ping de vérification immédiatement (le Worker y répond tout seul) — s'il refuse de sauvegarder, revérifie les 4 secrets.
2. Enregistre les commandes slash (depuis `cloudflare/discord-bot/`) :
   ```bash
   DISCORD_BOT_TOKEN=... DISCORD_APPLICATION_ID=... node scripts/register-commands.mjs
   ```
   (Les commandes **globales** mettent jusqu'à 1h à apparaître la première fois — plus rapide pour une modification d'une commande existante.)
3. Invite le bot sur le serveur Discord de l'équipe : Developer Portal → **OAuth2 → URL Generator**, coche **bot** et **applications.commands**, permission **Send Messages** (et **Use Slash Commands**), ouvre le lien généré et choisis le serveur.

### 5.4 Lier une équipe + les joueurs (dans l'app)

Tout se passe depuis la page **Compte** du site web (section « Bot Discord ») :

- Le staff clique **Generate code** sous le nom du groupe → lance `/link-team <code>` sur le serveur Discord cible (code valable 15 min).
- N'importe quel membre clique **Generate code** sous « My Discord account » → lance `/link-me <code>` sur le même serveur (code valable 10 min) — nécessaire pour `/availability`, pas pour `/calendar`/`/scrims`/`/common-availability` qui sont publiques.
- Un staff lance `/set-channel` **dans le salon** où les rappels doivent apparaître (sinon le bot répond aux commandes mais n'envoie jamais d'alerte spontanée).

À partir de là : `/calendar`, `/scrims`, `/common-availability`, `/availability away` / `/availability back` fonctionnent, et un cron (toutes les 15 min) poste les rappels d'événements/scrims à venir (24h avant) et les nouveaux créneaux de disponibilité commune.
