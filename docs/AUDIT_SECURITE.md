# Audit de sécurité — Phase S (1ʳᵉ passe)

> Première itération de l'audit défensif prévu en Phase S (voir `ROADMAP.md`). Mené sur l'infrastructure réelle (Supabase, dépendances npm), sans compte de test tiers. À compléter avant la publication publique du site complet par les points S4–S8 (en-têtes, XSS, Electron, pentest manuel/outillé).

## 1. Dépendances npm (`npm audit`)

| Avant | Après |
|---|---|
| 15 vulnérabilités (3 modérées, 12 hautes) | 3 restantes (2 modérées, 1 haute) |

**Corrigé automatiquement** (`npm audit fix`, non cassant, seul `package-lock.json` a changé) : `builder-util-runtime` (electron-updater — fuite de `PRIVATE-TOKEN`/`Authorization` sur redirection cross-origin, **haute**, code concerné : mise à jour auto de l'app), `deepmerge-ts`, `defu`, `effect`, `fast-uri`, `lodash`, `undici`, `ws` (dépendances transitives des outils de build/Prisma, exposition réelle faible mais corrigées par prudence).

**Restant, reporté volontairement** (nécessite une montée de version majeure, risque de régression à ne pas faire à l'aveugle) :
- `zod` 3.25 → 4.6.7 (**haute** : épuisement mémoire sur des collections contraintes de grande taille). `zod` valide toutes les entrées IPC de l'app (`validatedHandle`) : une montée en v4 change l'API et doit être migrée avec les tests de validation, pas par un simple `--force`.
- `react-router(-dom)` 6.30 → 7.18 (**modérée**, redirection ouverte via backslash dans `<Link>`/`useNavigate`). Risque pratique faible ici : aucune route ne navigue vers une URL fournie par un tiers (les fragments `#invite=`/`#handoff=` sont lus puis retirés de la barre d'adresse avant tout rendu, jamais passés à `Link`/`navigate`). Migration v7 à planifier séparément (changements d'API).

**Action à suivre** : migration dédiée `zod` v4 + `react-router` v7, avec sa propre PR et ses propres tests — à inscrire dans la suite de la Phase S.

## 2. Supabase (`get_advisors`)

| Constat | Niveau | Statut |
|---|---|---|
| `access_invite_attempts` : RLS activé sans policy | INFO | ✅ intentionnel — la table n'est écrite/lue que par le rôle `service_role` (Edge Function `redeem-invite`), qui contourne RLS ; aucune policy signifie qu'`anon`/`authenticated` n'y ont aucun accès, ce qui est le comportement voulu. |
| 4 fonctions `SECURITY DEFINER` appelables en RPC par `authenticated` (`create_access_invite`, `create_group`, `create_group_invite`, `join_group`) | WARN | ✅ revues : chacune vérifie elle-même l'authentification (`auth.uid()`) et l'autorisation (`private.is_app_admin()`, `private.is_group_staff()`, rôle `owner`) avant d'agir, et tourne avec `search_path = ''` (pas de détournement de schéma). Design voulu : ce sont des points d'entrée contrôlés qui doivent justement dépasser RLS pour créer la première ligne (groupe, invitation). |
| Protection « mot de passe compromis » (HaveIBeenPwned) désactivée | WARN | ⏳ **action manuelle requise** : Authentication → Policies → Password → activer « Leaked password protection ». Pertinent maintenant que l'app propose un mot de passe optionnel (session du 13/11). |

## 3. Environnement de développement

En corrigeant les dépendances, `electron` a été réinstallé : npm a bloqué son script d'installation (téléchargement du binaire) via la liste blanche `allowScripts`. Les paquets de build légitimes et déjà utilisés (`electron`, `esbuild`, `ffmpeg-static`, `prisma`, `@prisma/client`, `@prisma/engines`) ont été explicitement approuvés et la liste est maintenant persistée dans `package.json` (`allowScripts`), pour que les futures installations ne rouvrent pas la question. Un zip d'Electron en cache a aussi été ré-extrait (`extract-zip`/`yauzl` s'arrêtait après la première entrée dans cet environnement) ; contourné avec l'extraction native Windows.

## 4. Points déjà couverts ailleurs

Auth, invitations, RLS des tables applicatives, durcissement Electron (sandbox, CSP, `nxm://`) : voir la checklist complète S1–S8 dans `ROADMAP.md`. Ce document ne couvre que ce qui a été vérifié dans cette passe (S2 partiel, S4 lu pour `react-router`) ; S4 (en-têtes), S5 (XSS), S7 (Electron) et le test d'intrusion manuel restent à faire avant publication.
