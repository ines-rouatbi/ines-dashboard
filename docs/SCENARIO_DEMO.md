# Scénario de démonstration (cahier des charges §23) — lot F6

Rédigé pour la soutenance et la recette. Le scénario se joue **deux fois** : GPU éteint (Worker + R2 seuls),
puis GPU allumé (service PC-FNO3D joignable par `/api`). Il a été préparé sur le **déploiement local** :
Worker (`wrangler dev`) sur `http://127.0.0.1:8787`, R2 local où M6 a publié 8 instantanés réels du modèle v7
(`017_000000` à `017_210000`, 28/02/2025, `data_kind = synthetique`), service PC-FNO3D sur
`http://127.0.0.1:8001`. En production, remplacer l'adresse par `https://atom.zelqane.com`.

## 0. Ce qu'il faut savoir avant de commencer

- **Le tableau de bord ne lit que `/v1`** (instantanés immuables dans R2, décision D1). Il n'a besoin ni du GPU
  ni du service pour afficher le dernier état publié. Le service ne sert qu'aux **nouvelles** reconstructions,
  à l'API (`/api/docs`) et au serveur MCP.
- **« GPU allumé » se lit dans `/v1/latest`** : `compute_status = "online"` tant que le service publie son
  battement de cœur (`POST /v1/heartbeat`, fait par la chaîne de publication M6, jamais à la main) depuis moins de
  5 minutes. Sinon `offline` : pastille « ○ calcul arrêté » et bandeau « Dernier état réel calculé le … ».
  L'interface relit `/v1/latest` toutes les 60 s.
- **Nature des données** affichée en permanence dans la barre (badge « données : synthétique »). Les instantanés
  v7 actuels sont synthétiques : à dire à l'oral.
- **Ce que M6 ne publie pas encore** dans ces instantanés (M2, M4 et M5 inactifs) s'affiche « non disponible » :
  incertitude σ, couverture, fiabilité et statut mesuré / estimé ; classes de fiabilité ; alertes (liste vide et
  décompte null : « non calculées », pas « zéro alerte ») ; parc éolien (publié sans éolienne) ; contrôles
  physiques ; exports NetCDF / CSV complets (`snapshot.assets.export_*` à null, fichiers > 8 Mo). Ne jamais
  présenter ces cases comme des résultats.

### Correspondance avec la liste du §23

| Point du §23 | Où le montrer | État au 16/10 |
|---|---|---|
| Fichier de mesures, contrôle qualité, station défaillante | Modèle → « Qualité des données d'entrée » (rapport M3) | Affiché ; aucun problème dans les instantanés v7 publiés |
| Reconstruction 3D < 1 s, métadonnées (version, statistiques) | Vue d'ensemble (temps de reconstruction, indicateurs) ; Modèle (versions, sha256, grille) | Affiché ; le temps publié est celui du CPU local (≈ 25 s), pas du GPU |
| Carte de confiance (mesuré / estimé, couverture, incertitude) qui s'élargit en panne | Fiabilité ; `?simulation=<id>` | « non publiée » tant que M2 est inactif |
| Particules / lignes de courant au-dessus du relief | Exploration 3D (120 m au-dessus du sol par défaut) | Fait |
| Planificateur : trois éoliennes, vent au moyeu et rotor, production | Éolien | « non disponible » (M5 ne publie pas encore d'éolienne) |
| Alerte de vent fort ; capteur qui dérive, alerte et recommandation | Alertes, Vue d'ensemble | « non calculées » (M4 inactif) ; montrable sur l'instantané de test `capteur_en_derive` en dev |
| Vue 3D colorée par l'incertitude | Exploration 3D → Coloration « Incertitude » | Légende « variable non publiée par ce modèle » tant que M2 est inactif |
| Serveur MCP : simulation de panne commentée | Assistant MCP (`/mcp`), puis Fiabilité `?simulation=<id>` | GPU allumé seulement |
| Espaces métier (agriculteur, grue, porteur) | — | Hors lot F6 |
| API dans Swagger, supervision | `/api/docs` via le Worker | GPU allumé seulement |
| MLflow v2 → v7 | Hors tableau de bord (poste d'ines) | — |
| Export CSV et NetCDF, métadonnées, DE1 à DE3 | Boutons « Exporter en CSV » ; liens NetCDF / CSV ; Modèle | CSV des valeurs affichées : fait ; NetCDF / CSV complets : « non disponible » tant que M6 ne les publie pas |
| (F6) Comparaison de deux instants | Comparaison | Fait |

## 1. Préparation (5 minutes avant)

1. Le Worker répond : `curl -s http://127.0.0.1:8787/v1/latest` renvoie un JSON avec `snapshot_id`.
   S'il ne répond pas, le relancer depuis son dossier de déploiement (`wrangler dev --local --port 8787 …`) :
   c'est le seul cas où l'on touche au déploiement.
2. Navigateur en plein écran, zoom 100 %, fenêtre au premier plan (la scène 3D ne se dessine pas dans un onglet
   caché), cache vidé une fois (Ctrl + Maj + R) pour charger le dernier build.
3. Onglets prêts : `/` (Vue d'ensemble), `/exploration`, `/comparaison`, `/modele`.
4. Pour la partie GPU allumé : service PC-FNO3D lancé (`pcfno3d serve --port 8001`, configuration `local_v7`),
   chaîne de publication M6 démarrée (elle publie le battement de cœur), clé de lecture du Worker en place
   (`.dev.vars`, jamais dans git ni dans le salon).

## 2. Partie A — GPU éteint : le dernier état publié reste utilisable

Service arrêté (ou GPU Colab éteint). Durée : 4 à 5 minutes.

1. **Vue d'ensemble** (`/`).
   - Barre : « données : synthétique », pastille « ○ calcul arrêté », bandeau « Dernier état réel calculé le
     15 octobre 2026 … — nouvelles reconstructions indisponibles ». Dire : *le site n'affiche jamais de
     démonstration ; c'est le dernier calcul réel, daté.*
   - En-tête : instantané du 28/02/2025 21:00 UTC, `017_210000_b2529442`, données d'entrée complètes ;
     « Exports complets : NetCDF non disponible · CSV non disponible ».
   - Indicateurs : vent moyen 1,6 m/s et maximal 3,5 m/s **à 100 m au-dessus du sol** sur le domaine ;
     fiabilité élevée et alertes « non disponible » ; 500 000 capteurs (treillis synthétique) ; 25 543 ms.
   - Cartes à 10, 100, 300 et 1 000 m **au-dessus du sol** (relief + h par colonne, pas un niveau mer relabellisé) :
     8 % des colonnes à 10 m (sous le premier nœud valide ailleurs), 96 % à 100 m, 100 % à 300 m, aucune à
     1 000 m (au-dessus du sommet du modèle, 1 000 m au-dessus de la mer) — c'est voulu et expliqué sur la carte.
   - Cliquer « Exporter en CSV » sous la carte à 100 m : fichier `atom_017_210000_b2529442_carte_100m-sol_speed.csv`
     (≈ 120 000 lignes ; colonnes avec unités, instant UTC, `snapshot_id`, `data_kind` sur chaque ligne).
     L'ouvrir dans un tableur pour montrer les colonnes.
   - Série au moyeu : 8 instants de 00:00 à 21:00 UTC (axe en UTC).
2. **Exploration 3D** (`/exploration`).
   - Relief ombré, exagération ×5, lignes de courant animées à 120 m au-dessus du sol, colorées par la vitesse
     (rampe de la charte, légende chiffrée en m/s). Monter l'exagération à ×10, tourner la vue.
   - Cliquer un point : profil vertical (direction d'où vient le vent, niveaux sous le relief signalés, intervalle
     à 80 % et fiabilité « non disponible » sans σ publié). « Exporter en CSV » sous le profil.
   - Frise : choisir 12:00 UTC, puis « Rejouer » la journée.
   - Coloration « Incertitude » : légende « variable non publiée par ce modèle ». À dire tel quel.
3. **Comparaison** (`/comparaison`).
   - Par défaut A = 18:00 UTC, B = 21:00 UTC (dernier), 100 m au-dessus du sol. Mêmes couleurs pour A et B
     (échelle commune), carte de B − A (bleu = baisse, rouge = hausse).
   - Statistiques : 120 331 nœuds communs (96,3 %), vitesse moyenne 1,69 → 1,55 m/s, différence moyenne
     −0,14 m/s, écart quadratique 0,28 m/s, plus forte baisse −0,92 m/s, plus forte hausse +0,65 m/s.
   - Passer à 300 m, puis à 10 m : à 10 m, seuls les nœuds présents **des deux côtés** entrent dans la différence.
   - « Exporter en CSV » : un fichier par comparaison (a_*, b_*, différence).
   - Le lien de la page garde le choix (`?a=…&b=…&h=…`) : le copier pour le rapport.
4. **Fiabilité**, **Éolien**, **Alertes** : montrer les mentions « non disponible » et dire quel lot les remplira
   (M2, M5, M4). Ne pas s'y attarder.
5. **Modèle** (`/modele`) : versions (v7, sha256 des poids, normalisation), grille 500 × 250 × 12, 849 184 nœuds
   valides, niveaux au-dessus de la mer, géoréférencement « supposé », variables non publiées, qualité des données
   d'entrée. Bloc « Service de calcul » : « ○ endormi (GPU éteint) » ou « injoignable ». Dire : *le tableau de
   bord n'en dépend pas.*

## 3. Partie B — GPU allumé : calcul en ligne

1. Démarrer le service et la publication (voir § 1.4). Attendre au plus 60 s (relecture de `/v1/latest`) :
   pastille « ● calcul en ligne », **le bandeau disparaît**.
2. **Modèle** : « Service de calcul : ● joignable », poids `best_dso_v7.pt`, calcul sur `cpu` (ou `cuda`).
3. **API** : ouvrir `/api/docs` (Swagger, via le Worker qui injecte la clé de lecture côté serveur ; le navigateur
   ne la voit jamais). Lancer `GET /api/health`, puis une reconstruction.
4. **Nouvel instantané** : quand M6 publie un instant, `/v1/latest` change ; la Vue d'ensemble se met à jour
   (au plus 60 s) et l'instant apparaît dans la frise et dans la Comparaison.
5. **MCP** : depuis l'assistant, outil `simuler_panne` ; il publie une simulation (hors `latest` et hors
   `/v1/times`). Ouvrir `/fiabilite?simulation=<identifiant>` : bloc « SIMULATION — ce n'est pas l'état courant ».
6. **Retour au GPU éteint** pendant la démo : arrêter le service. Après 5 minutes sans battement de cœur, la
   pastille repasse à « calcul arrêté » et le bandeau revient ; tout reste consultable.

## 4. Vérification automatique

- Données réelles : `npm test` joue `web/src/pages/reel.test.tsx` sur `http://127.0.0.1:8787` s'il répond
  (sinon la suite est sautée) ; `ATOM_REEL_URL=<origine>` pour un autre Worker.
- Navigateur : `e2e/tests/functional/scenario-f6.spec.ts` joue les étapes 2.1 à 2.5 (GPU éteint, `/api`
  forcé en 503) et, avec `ATOM_GPU_ON=1`, la partie B :

```bash
cd e2e && npm ci && npx playwright install chromium   # une fois
ATOM_URL=http://127.0.0.1:8787 npx playwright test --project=headless tests/functional/scenario-f6.spec.ts
ATOM_URL=http://127.0.0.1:8787 ATOM_GPU_ON=1 npx playwright test --project=headless tests/functional/scenario-f6.spec.ts
```

## 5. Vidéo de démonstration de secours

À enregistrer la veille, sur le déploiement qui servira le jour J, pour le cas où le réseau ou le poste lâche.
Elle n'est **pas** dans git (taille) : la déposer sur le Drive du projet et noter son lien dans le rapport.

1. **Outil** : OBS Studio (scène « Fenêtre du navigateur » + micro) ou, à défaut, la Xbox Game Bar de Windows
   (Win + Alt + R pour démarrer / arrêter). Sortie MP4 (H.264), 1920 × 1080, 30 images/s, débit 6 à 8 Mbit/s.
2. **Navigateur** : fenêtre seule à l'écran, plein écran (F11), zoom 100 %, extensions et notifications masquées,
   aucun onglet personnel ouvert, barre d'adresse visible au début pour montrer l'URL.
3. **Déroulé** (cible 4 à 6 min) : partie A en entier (§ 2.1 à 2.5), puis partie B si le service est disponible
   (§ 3.1 à 3.3 et 3.5). Lire le texte en italique du § 2 ; laisser 2 s sur chaque écran avant de cliquer.
4. **Contrôles avant d'arrêter** : badge « données : synthétique » lisible ; bandeau visible en partie A ; aucun
   message d'erreur ; l'export CSV ouvert au moins une fois.
5. **Après** : couper les temps morts (Clipchamp ou ShotCut), ajouter un carton de titre « ATOM-AI, tableau de
   bord, dernier état publié du 28/02/2025 (données synthétiques) », exporter, vérifier le son et la lisibilité
   des chiffres en plein écran, nommer le fichier `atom_demo_secours_AAAAMMJJ.mp4`.
6. Ne montrer **aucun secret** à l'écran (`.dev.vars`, clés d'API, jetons, identifiants du tunnel).

## 6. Écarts connus

- Les cases « non disponible » du § 0 dépendent des lots M2 à M6 : le tableau de bord les affichera sans
  modification dès que les instantanés les publieront (schémas du contrat).
- `/v1/column` omettait les variables non publiées (σ, couverture, fiabilité, statut) au lieu de les mettre à
  null : corrigé dans `src/v1.js` (lot F6) ; le déploiement local doit être reconstruit et relancé pour en
  profiter (le front tolérait déjà l'absence).
- Police Inter / Inter Display : déclarée par la charte mais non embarquée (aucun fichier de police dans le dépôt)
  ; repli sur les polices système.
- La spec e2e du scénario est écrite mais n'a pas été lancée sur ce poste (Playwright non installé, pas de
  navigateur téléchargé).
