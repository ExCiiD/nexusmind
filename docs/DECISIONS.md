# Décisions de l'utilisateur — registre partagé

**Toute session lit ce fichier avant de travailler** (maquette, spec, code,
rapport) et s'y conforme. Une décision de l'utilisateur vaut pour tout le
projet, quelle que soit la session à qui il l'a dite. La session qui la
reçoit l'ajoute ici et prévient le Chief, qui la transmet aux sessions
concernées. Une ligne par décision, la plus récente en haut, avec la date et
les mots de l'utilisateur quand c'est possible.

| Date | Décision | Concerne |
|---|---|---|
| 20/11 | Moteur : **bilan coût/gain de chaque roam pour tous les laners**, pas seulement le mid. **Support** : jugé sur ce que paie son ADC (farm, PV et mana, gold et XP contre l'ADC adverse) et sur le timer de départ (wave crash, après un recall, après 1-2 kills sur la botlane adverse). **Quêtes de rôle** comptées dans l'impact (écart avec le vis-à-vis direct). **Jungler** : « bilan de gank » (camps perdus, écart de gold et d'XP avec le jungler ennemi avant et après, compensation, avantage créé). Rapports dans `docs/engine-reports/2026-11-20-*`, en attente d'implémentation. | engine, back, front |
| 20/11 | **Tout le monde doit être au courant de ce que je demande** : chaque demande va dans ce registre et chaque session le relit. | toutes |
| 20/11 | Cartes du Lobby : **n'afficher que des champions et skins détourés**, jamais l'art d'origine. Si le skin n'a pas de détouré, le premier skin détouré du champion, sinon un halo neutre. | front, design |
| 20/11 | **Lobby d'équipe en premier** dans la section « Équipe & staff », **avant Management** (barre latérale, maquettes, specs, captures). | front, design |
| 20/11 | Champion Pool : section **« New » sous « Flex »** (ordre main, comfort, flex, new, learning), partout où les tiers s'affichent. | front, design, back |
| 20/11 | Choix du champion et du skin de sa carte : icônes du dos cliquables sur **sa** carte seulement, zoom au survol, pop-up des skins du champion cliqué (spec `DESIGN_STATE.md` § 14, « Validée »). | front, design, back |
| 20/11 | **Saison en cours seulement** : aucune donnée 2025 (15.x) dans le moteur ; règles d'avant 2026 gardées seulement sans timer précis ; préparer 2027 à l'avance, basculer seulement une fois vérifiée. | engine, back, front |
| 20/11 | Les 73 parties 2025 du cache local : **« Oui, supprimer »** (fait). | back |
| 20/11 | Le Chief est la session `local_c8abf60b…` ; ne plus relayer les messages « session X attend ». | toutes |
| 19/11 | **Coût d'hébergement : plafond de 2 €** au-delà des offres gratuites, prévenir avant tout coût. | back |
| 19/11 | Équipe construite depuis les joueurs du groupe, compte Riot obligatoire pour rejoindre ; jargon LoL en anglais dans les textes français. | toutes |
| 19/11 | Changements visuels maquettés dans Penpot avant d'être codés. | design, front |
