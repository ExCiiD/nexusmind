# Contrat — Serveur de chaque compte Riot

Back-end, 20/11/2026. Décision du 20/11 (`docs/DECISIONS.md`) : détection automatique par compte à partir du puuid, plus
un choix manuel par compte dans les Paramètres (« Auto » par défaut). Valable pour tous les joueurs, y compris après un
transfert.

Fichiers :
- calculs partagés : `src/lib/riotRegionCore.ts` ;
- desktop : `electron/main/accountRegions.ts` (IPC `account:regions`, `account:set-region-mode`), `riotClient.ts` ;
- web : `web/src/riotWeb.ts` (détection seulement).

## API desktop pour le Front (écran des Paramètres)

```ts
listAccountRegions?(opts?: { force?: boolean }): Promise<AccountRegionInfo[]>
setAccountRegionMode?(accountId: string, mode: 'auto' | Platform): Promise<AccountRegionInfo>

interface AccountRegionInfo {
  accountId: string            // 'main' pour le compte du profil, sinon l'id de l'Account
  puuid: string
  gameName: string; tagLine: string
  mode: 'auto' | Platform      // le choix du joueur
  region: Platform | null      // le serveur utilisé maintenant
  detected: Platform | null    // le serveur trouvé par Riot (null : pas encore, ou Riot injoignable)
  detectedAt: string | null
  previousRegion: Platform | null  // le serveur d'avant un transfert, encore lu pour les anciennes parties
}
// Platform : 'BR1' | 'EUN1' | 'EUW1' | 'JP1' | 'KR' | 'LA1' | 'LA2' | 'NA1' | 'OC1' | 'PH2' | 'RU' | 'SG2' | 'TH2' | 'TR1' | 'TW2' | 'VN2'
```

- Une ligne par compte, le compte principal en premier.
- Le sélecteur propose « Auto (détecté : EUW) » puis les serveurs.
- `force: true` relance la détection : c'est le bouton « Détecter à nouveau ».
- Erreurs : `BAD_REGION` (valeur inconnue), `NOT_FOUND` (compte inconnu).
- Un choix manuel l'emporte toujours, et il n'est jamais remplacé par une détection.

## Comportement

- **Détection** : account-v1 `region/by-game/lol/by-puuid/{puuid}`. `active-shards` n'accepte pas `lol`.
- **Cache** : 10 min par compte. Une recherche de parties vide relance la détection, au plus une fois par minute et par
  compte.
- **Appels concernés** : tous ceux qui partent d'un puuid utilisent le serveur du compte, jamais `User.region` :
  - desktop : chaîne d'après-partie, rattrapage, historique, « Dernière partie », stats, rang, maîtrises, rosters,
    récompenses de la semaine, LFT ;
  - web : rosters, scouting, stats d'équipe.

  Une partie se lit toujours sur le serveur inscrit dans son id (`EUW1_…`).
- **Transfert** :
  - un compte en « Auto » enregistre son nouveau serveur dans `region` et garde l'ancien dans `previousRegion` ;
  - les listes lisent aussi l'ancien serveur, le nouveau en premier, donc l'historique d'avant le transfert reste
    visible.
- **Cloud** : les rosters gardent la région saisie, et l'appel corrige le serveur au moment de la lecture. Aucune donnée
  du cloud n'est réécrite.

## Mise en production

1. **Proxy** (`cloudflare/riot-proxy`) : nouvelle route autorisée `/riot/account/v1/region/by-game/lol/by-puuid/{id}`,
   jamais gardée dans le cache partagé.
   - Déploiement avec l'accord de l'utilisateur : `wrangler deploy` depuis l'export, retour arrière `wrangler rollback`.
   - Sans ce déploiement, l'app et le web gardent la région enregistrée (le proxy répond 403, c'est prévu).
2. **Desktop** : la migration Prisma `20261120130000_account_region_mode` est appliquée au démarrage, après la sauvegarde
   automatique.
3. **Supabase** : aucune migration.

## Parties hors session (beta.15, décision « Yes, every game »)

- **Où vont les parties** : toute partie de Summoner's Rift ou d'Arena crée une Game.
  - Avec une session active : elle y est rattachée et compte dans ses KPI, comme avant.
  - Sans session : elle va dans le conteneur hors session du profil. C'est la Session fermée
    `objectiveId = '__review_only__'`, déjà utilisée pour les vidéos orphelines (`electron/main/offSessionGames.ts`).
    Elle est toujours `isSessionEligible: false`.
- **Pourquoi pas `Game.sessionId` facultatif** : toutes les requêtes trouvent les parties d'un profil par
  `session.userId` (environ 120). Une Game sans session sortirait des stats et de l'Historique de son profil, et la
  synchronisation et les sauvegardes y perdraient leur propriétaire. Le conteneur donne le même résultat sans
  reconstruire la table `Game`, dont les enfants sont supprimés en cascade.
- **Fin de partie** :
  - `onGameEnd` reçoit `game` (la vidéo y est rattachée tout de suite), avec `sessionId: null` et
    `isSessionEligible: false` ;
  - pas de navigation automatique vers la review, pas de toast off-role.
- **Historique** (`analytics:get-game-history`) :
  - les parties hors session sont listées, avec **`offSession: true`** (et `objectiveId: '__review_only__'`) ;
  - le tri est maintenant du plus récent au plus ancien, toutes sessions confondues ;
  - Front : un badge « Hors session » et aucun objectif affiché.
- **« Dernière partie » et l'historique Riot** (`stats:match-history`) : sans changement. `imported` et `gameId` sont
  remplis pour une partie hors session.
- **Listes de sessions** : le conteneur n'y apparaît pas, comme avant.

## Plateforme réelle et rattrapage au démarrage

- **Journal du client** : le log de partie (`<install>/Logs/GameLogs/…_r3dlog.txt`) donne `-PlatformID` et `-GameID`.
  L'enrichissement lit directement `EUW1_8051837730`, quel que soit le serveur enregistré.
- **Rattrapage** (`electron/main/gameCatchUp.ts`) : 90 s après le démarrage, en arrière-plan, l'app importe dans le
  conteneur hors session les parties des 3 derniers jours qui manquent.
  - Sources : les journaux du client, plus les 20 dernières parties de chaque compte.
  - Seules les files suivies sont importées : classées, normales et Arena. Les remakes sont exclus.
  - Elle relie ensuite les vidéos orphelines par l'heure.
  - La dernière partie de chaque compte fixe aussi son serveur (en « Auto »), même avant le déploiement du proxy.
  - Pour l'utilisateur, EUW1_8051837730 et sa vidéo reviennent seules au premier démarrage de la beta.15.
