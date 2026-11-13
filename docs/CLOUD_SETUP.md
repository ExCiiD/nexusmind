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
| `RIOT_API_KEY` | secret Cloudflare | **Non** |

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
