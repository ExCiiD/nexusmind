# Plan — site vitrine Ascend

> Front-end généré avec **Gemini 4** (code) et **Midjourney** (visuels). Ce document est le brief : objectifs, structure, textes, visuels (prompts), contraintes, technique et lancement.

---

## 1. Objectifs & publics

| Public | Ce qu'il doit comprendre en 10 s | Action attendue |
|---|---|---|
| **Joueur solo** ambitieux (Silver → Master) | « Une méthode de pro pour progresser seul, sans IA payante, qui s'occupe de tout enregistrer et analyser » | Télécharger l'app Windows |
| **Coach** indépendant | « Je suis mes élèves, je commente leurs reviews, je leur assigne des objectifs, depuis n'importe où » | Créer un groupe de coaching |
| **Équipe / structure** amateur ou semi-pro | « Scrims, disponibilités, drafts, scouting, suivi des joueurs au même endroit » | Créer une équipe |

KPI : taux de clic sur « Télécharger », comptes créés, groupes créés (mesure sans cookies : compteur côté serveur des téléchargements et inscriptions).

## 2. Positionnement & messages

- **Promesse** : « Deviens ton propre coach. »
- **Différenciants** (à prouver par des captures, pas des adjectifs) :
  1. Boucle complète : session → objectif → partie enregistrée → review guidée → progrès mesuré.
  2. Erreurs détectées automatiquement sur chaque partie (Mistake Library), expliquées.
  3. Un assistant **sans IA** : règles transparentes, il explique toujours *pourquoi*.
  4. Collaboration coach / équipe intégrée (commentaires horodatés, objectifs, scrims).
  5. Local d'abord, gratuit, données exportables, RGPD.
- **Ton** : direct, compétitif, crédible (vocabulaire de joueur, pas de jargon marketing). FR + EN dès le lancement.

## 3. Structure (une page longue + pages légales)

1. **Hero** — titre « Deviens ton propre coach », sous-titre (boucle de progression en une phrase), CTA principal « Télécharger pour Windows » (lien GitHub API, version affichée), CTA secondaire « Ouvrir l'app web ». Visuel : capture de l'app dans un cadre + ambiance Hextech.
2. **Preuve rapide** — 3 chiffres ou badges (ex. « 13 erreurs détectées automatiquement », « 0 € d'IA », « 100 % de tes données exportables »).
3. **La boucle en 4 étapes** — Session & objectif → Partie enregistrée → Review guidée & erreurs auto → Progrès mesuré. Une capture par étape, animation au scroll.
4. **Mistake Library** — vidéo courte (GIF/MP4 muet) : timeline avec marqueurs d'erreurs + note explicative.
5. **L'assistant sans IA** — carte d'insight avec « basé sur tes 20 dernières games » ; message : transparent, gratuit, il apprend de tes 👍/👎.
6. **Pour les coachs** — commentaires horodatés, objectifs assignés, vue des élèves (web + desktop).
7. **Pour les équipes** — scrims, disponibilités, drafts, scouting, synergies (+ « bientôt » : tableau de bord staff, plans de dev).
8. **Confidentialité & données** — local d'abord, synchro chiffrée en transit, vidéos jamais envoyées, suppression du compte en un clic.
9. **FAQ** — gratuit ? Mac ? Riot autorise ? Vos vidéos ? Clé Riot ? Différence avec les outils IA ?
10. **CTA final** + footer (mentions légales, confidentialité, CGU, GitHub, Discord, **mention Riot obligatoire**).

## 4. Direction artistique

- **Palette** (identique à l'app) : noir `#010A13`, bleu nuit `#0A1628`, or `#C8AA6E` / `#F0E6D2`, cyan `#0AC8B9`, rouge `#FF4655`.
- **Typo** : titres display (même famille que l'app, ex. Beaufort-like libre de droits → *Cinzel* ou *Marcellus*), texte *Inter*.
- **Style** : « hextech » sobre — lignes fines dorées, verre sombre, lueurs cyan discrètes ; beaucoup d'espace ; les **captures réelles de l'app** sont les héroïnes, les visuels Midjourney servent l'ambiance.

### Interdits (droits)
- **Aucun asset Riot** (splash arts, icônes de champions, logo LoL, police Beaufort officielle, maps) sur la vitrine — Riot autorise l'usage de son API, pas de ses marques dans le marketing.
- Midjourney : ne pas demander de champions nommés ni de « League of Legends style » ; rester générique (fantasy-tech).
- Mention obligatoire en footer : « Ascend isn't endorsed by Riot Games… » (texte complet dans la politique de confidentialité).

### Prompts Midjourney (point de départ)
1. **Hero background** : `dark fantasy-tech command room, floating holographic strategy map, thin gold filigree lines, deep navy and black, subtle cyan glow, cinematic lighting, wide composition with empty center for text, ultra clean, no characters, no text --ar 21:9 --style raw --v 7`
2. **Section "boucle"** (4 icônes) : `minimal gold line icon on dark navy background, hextech style, {recording camera | magnifying glass over timeline | rising graph | target with arrow}, thin elegant strokes, centered, no text --ar 1:1 --style raw`
3. **Section coach** : `silhouette of a coach and a player looking at a glowing tactical screen together, dark navy room, gold and cyan accents, from behind, no faces visible, cinematic, no text --ar 16:9 --style raw`
4. **Section équipe** : `five abstract player silhouettes around a holographic round table showing a map, gold rim light, dark background, teamwork mood, no text --ar 16:9 --style raw`
5. **Texture de fond** : `subtle dark hexagonal pattern with faint gold lines, seamless, very low contrast --tile --ar 1:1`

### Captures à produire (depuis l'app réelle, données de démo)
Dashboard, Session (objectif + assistant), lecteur VOD avec marqueurs d'erreurs, Analytics « Où j'en suis », Mistakes stats, Coaching (vue coach), Scrims (web, mobile), fenêtre de signalement. Format 2× (retina), cadres d'appareil sobres.

## 5. Brief Gemini 4 (génération du code)

- **Stack** : site statique **Astro** (ou HTML/Tailwind pur) — pas de framework lourd, Lighthouse ≥ 95.
- **Tailwind** avec les tokens de couleur ci-dessus ; composants : Hero, StepCard, FeatureSplit (texte + capture), FAQ (accordéon accessible), Footer.
- **i18n** : `/` (FR) et `/en/` ; `hreflang`.
- **Bouton Télécharger** : même logique que l'app web (`useLatestRelease` : GitHub API, pré-versions incluses, repli sur la page des releases) ; afficher la version.
- **Performance** : images AVIF/WebP, `loading="lazy"`, vidéo MP4 muette en boucle < 3 Mo, polices auto-hébergées (`font-display: swap`).
- **Accessibilité** : contrastes AA, navigation clavier, `prefers-reduced-motion` respecté (animations désactivées).
- **SEO** : title/description par langue, Open Graph + image de partage (générée Midjourney + logo), `sitemap.xml`, données structurées `SoftwareApplication`.
- **Sécurité** : en-têtes identiques au site web (CSP stricte, HSTS) ; aucun script tiers.
- **Mesure** : pas de cookies ; compteur de téléchargements côté serveur (Worker) si besoin.

Prompt de départ suggéré pour Gemini : *« Génère un site vitrine statique Astro + Tailwind, une page longue FR/EN, sections : [liste §3], palette [§4], composants [§5], accessible AA, Lighthouse 95+, sans dépendance JS sauf l'accordéon FAQ et le bouton de téléchargement qui interroge l'API GitHub releases (pré-versions incluses). Utilise des placeholders d'images nommés selon §4. »*

## 6. Hébergement & domaine

- Même Cloudflare que l'app web (Workers static assets) : `nexusmind-site` ; domaine personnalisé recommandé (ex. `nexusmind.gg` / `.app`) → aussi requis par Riot pour une **clé API Production** (site public + CGU + confidentialité).
- L'app web passe sous `app.<domaine>`, la vitrine sur la racine.

## 7. Lancement — checklist

1. Placeholders légaux complétés (éditeur, contact) et relus.
2. Captures + vidéo de démo produites avec un compte de démonstration.
3. Visuels Midjourney validés (aucun élément Riot).
4. Domaine + DNS + certificat ; redirections `www`.
5. Pages légales publiées sur le site (mêmes textes que dans l'app).
6. Test Lighthouse (perf, a11y, SEO) et test mobile.
7. Demande de clé Riot **Production** avec l'URL du site.
8. Annonce (Discord, Reddit, réseaux) + lien de téléchargement suivi.
