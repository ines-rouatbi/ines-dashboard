# e2e/ — tests, banc de performance et oracles (lot F5)

Paquet autonome (son propre `package.json` et lockfile) pour ne pas entrer en conflit avec le
`package.json` racine posé par F0. Il pourra être replié dans un workspace plus tard.

```bash
cd e2e
npm ci
npx playwright install chromium      # navigateur du projet « headless »
npm run oracles                      # tests purs, sans navigateur ni serveur
npm test                             # fonctionnels headless (porte / CI)
npm run perf                         # banc de perf : Chrome avec fenêtre et GPU matériel
```

## Serveur testé

Prérequis : `npm ci` à la **racine** du dépôt (Vite, et le code du Worker `src/v1.js`).

| `ATOM_SERVER` | Serveur lancé par Playwright (si `ATOM_URL` est absent) | Données |
|---|---|---|
| `vite` (défaut) | `npx --no-install vite` de la racine, au port `ATOM_PORT` | `/v1` servi depuis `contract/fixtures/` par le **vrai** `src/v1.js` sur un faux R2 (`dev/fixtures.ts`). `?scenario=normal|capteur_en_derive|gpu_eteint` choisit l'instantané (cookie de dev `atom_fixture`, sinon `ATOM_FIXTURE`, sinon `normal`). Pas de build, pas de R2. Pas de proxy `/api` : le test « `/api` en 503 » est sauté. `ATOM_F4_ROUTE` vaut d'office `<ATOM_URL>/{page}?scenario={scenario}` : les tests des pages Éolien et Alertes tournent. |
| `wrangler` | `npx --no-install wrangler dev` épinglé de `e2e/` sur la config de la racine | Worker complet (`/api` compris). Il faut d'abord `npm run build` à la racine, un `PUBLISH_TOKEN` local dans `.dev.vars` (jamais commité), puis publier un instantané de test dans le R2 **local** : `ATOM_PUBLISH_TOKEN=<jeton local> node contract/tools/publish.mjs contract/fixtures/normal http://127.0.0.1:8787`. Une fois les correctifs F1 fusionnés, lancer wrangler avec `--var ATOM_ALLOW_TEST_SNAPSHOTS:1`, sans quoi les données de test sont refusées. |
| (aucun) | — | `ATOM_URL` fourni : serveur externe, rien n'est lancé. |

**Prérequis du banc de perf** : Google Chrome installé (projet `headed-gpu`, `channel: 'chrome'`).
Le drapeau `--use-angle` vaut `d3d11` sous Windows, `metal` sous macOS, `gl` ailleurs ; `ATOM_ANGLE` le force.

`wrangler` est épinglé en version exacte dans `e2e/` (4.144.0, comme le front) et lancé par
`npx --no-install` : jamais une version téléchargée au vol.

## Projets Playwright

| Projet | Dossier | Rôle |
|---|---|---|
| `oracles` | `oracles/` | Direction météo, champs Float32 LE `[j][i]` avec NaN sous le relief, hauteur sol / mer, REWS, cisaillement, courbe de puissance, Weibull, rose des vents. Ces calculs ne servent **qu'à vérifier** ce que renvoie l'API : décision D4, ils restent en Python. |
| `headless` | `tests/functional/` | Fumée : bonne page, pas d'erreur JS, WebGL, `/api` en `503 service_asleep` quand le GPU dort. `scene-f2.spec.ts` : critères V3D1 à V3D8 de la scène 3D sur les 3 instantanés de test (`?scenario=`). |
| `headless` (F6) | `tests/functional/scenario-f6.spec.ts` | Scénario §23 de bout en bout (`docs/SCENARIO_DEMO.md`) : GPU éteint (`/api` forcé en 503, `latest` hors ligne) puis, avec `ATOM_GPU_ON=1`, GPU allumé ; exports CSV téléchargés et relus. Viser le Worker sur les vrais instantanés : `ATOM_URL=http://127.0.0.1:8787`. |
| `headed-gpu` | `tests/perf/` | FPS (5e centile sur 10 s de rotation caméra), clic → retour visuel (p95), changement d'altitude (p95), premier rendu, mémoire JS. Un seul Chrome à la fois. |

## Variables

| Variable | Défaut | Effet |
|---|---|---|
| `ATOM_URL` | `http://127.0.0.1:<ATOM_PORT>` | Adresse testée. Si absente, Playwright lance le serveur choisi par `ATOM_SERVER` (ou réutilise celui du port). |
| `ATOM_PORT` | `8787` | Port du serveur lancé par Playwright (Vite ou `wrangler dev`). |
| `ATOM_SERVER` | `vite` | `vite` (fixtures du contrat) ou `wrangler` (Worker local) ; voir « Serveur testé ». |
| `ATOM_F4_ROUTE` | `<ATOM_URL>/{page}?scenario={scenario}` avec Vite | Gabarit d'URL des pages Éolien et Alertes ; sans lui, leurs tests navigateur sont sautés. |
| `ATOM_F3_ROUTE` | `ATOM_F4_ROUTE` | Gabarit d'URL des pages F3 (`{page}` = vide pour la Vue d'ensemble, `fiabilite`, `modele`) ; `pages-f3.spec.ts` y vérifie aussi VIS1 (`window.__atom.vis1`, moins de 3 s). |
| `ATOM_REQUIRE_API` | — | `1` (CI, et dès F0) : l'absence de `window.__atom`, ou un `ready` rejeté, fait **échouer** le banc au lieu de le sauter ou de mesurer la visionneuse historique. |
| `ATOM_MACHINE` | `non renseigné` | Libellé du poste écrit dans le rapport (pas de nom d'hôte automatique : les références sont commitées). |
| `ATOM_ANGLE` | selon l'OS | Moteur ANGLE de Chrome (`d3d11`, `metal`, `vulkan`, `gl`). |
| `ATOM_GPU` | GPU intégré | `haute-perf` force le GPU dédié (`--force_high_performance_gpu`). |
| `ATOM_FPS_MS` | `10000` | Durée de la mesure de FPS. |
| `ATOM_ALTITUDES` | `10,100,300,1000` | Hauteurs (m) **au-dessus du sol** alternées pour la mesure de changement d'altitude, passées à `setHauteurSol` (mode sol de F2, calcul par colonne avec le relief). `setAltitude` attend une altitude **mer** et ne sert qu'en repli. |
| `ATOM_SCENE_PATH` | `/exploration` | Page de la scène 3D ouverte par la fumée, le banc et `scene-f2.spec.ts`. |
| `ATOM_FEEDBACK` | `#profile-card` | Visionneuse historique seulement : panneau observé pour dater le retour du clic. Avec `window.__atom`, le clic est mesuré par `pick()` + double rAF, sans observer le DOM. |
| `ATOM_EXPECT_TITLE` | `PC-FNO3D\|ATOM` | Garde-fou : titre attendu de la page. |

**Piège du port 8787** : si un autre `wrangler dev` (un autre projet) l'occupe déjà, Playwright le
réutiliserait sans rien dire. Chaque test vérifie donc le titre de la page avant de mesurer. Sur un poste
où le port est pris : `ATOM_PORT=8788 npm run perf`.

## Rapport de performance

`reports/perf-<date>.json` : environnement (machine, navigateur, **moteur WebGL réellement utilisé**),
puis chaque métrique avec son seuil et un statut :

- `ok` / `hors_seuil` : mesurée, comparée au seuil (V3D10 ≥ 30 FPS, clic p95 < 150 ms, altitude p95 < 500 ms, VIS1 < 3 s) ;
- `non_mesure` : **pas mesurée**, avec la raison (`window.__atom absent (F0 non livré)`, moins de 20 échantillons…).
  Jamais un zéro ni un `ok` par défaut. Le verdict global vaut alors `incomplet`.

Les rapports sont ignorés par git ; seuls les `reports/reference-*.json` (un par jalon) sont commités.

## Interface attendue de la page (F0)

```ts
window.__atom = {
  ready: Promise,              // résolue après le premier rendu PEINT ; rejetée si /v1/meta, /v1/latest
                               // ou le premier champ manquent (sinon au bout de 15 s) → métriques non_mesure
  scene,
  setAltitude(m): Promise,     // m AU-DESSUS DE LA MER (niveau publié le plus proche) ; résolue après la frame peinte
  setHauteurSol(m): Promise,   // F2 : m AU-DESSUS DU SOL (par colonne, relief du modèle) ; défaut de la page : 120 m
  regler(r), etat(),           // F2 : réglages (coloration, coupes, couches, instantané…) et état observable
  pick(x, y): Promise,         // pixels CSS relatifs au canvas ; { i, j, x_m, y_m } ou null hors domaine
  orbit?(deg): Promise,        // facultatif ; sinon le banc fait tourner la caméra à la souris
}
```
