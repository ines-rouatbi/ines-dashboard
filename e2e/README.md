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

**Prérequis du banc de perf** : Google Chrome installé (projet `headed-gpu`, `channel: 'chrome'`).
Le drapeau `--use-angle` vaut `d3d11` sous Windows, `metal` sous macOS, `gl` ailleurs ; `ATOM_ANGLE` le force.

`wrangler` est épinglé en version exacte dans `e2e/` (4.144.0, comme le front) et lancé par
`npx --no-install` : jamais une version téléchargée au vol.

## Projets Playwright

| Projet | Dossier | Rôle |
|---|---|---|
| `oracles` | `oracles/` | Direction météo, champs Float32 LE `[j][i]` avec NaN sous le relief, hauteur sol / mer, REWS, cisaillement, courbe de puissance, Weibull, rose des vents. Ces calculs ne servent **qu'à vérifier** ce que renvoie l'API : décision D4, ils restent en Python. |
| `headless` | `tests/functional/` | Fumée : bonne page, pas d'erreur JS, WebGL, `/api` en `503 service_asleep` quand le GPU dort. Les tests des 3 instantanés de test sont marqués `fixme` jusqu'à `contract/`. |
| `headed-gpu` | `tests/perf/` | FPS (5e centile sur 10 s de rotation caméra), clic → retour visuel (p95), changement d'altitude (p95), premier rendu, mémoire JS. Un seul Chrome à la fois. |

## Variables

| Variable | Défaut | Effet |
|---|---|---|
| `ATOM_URL` | `http://127.0.0.1:<ATOM_PORT>` | Adresse testée. Si absente, Playwright lance le `wrangler dev` épinglé sur la config de la racine (ou réutilise le serveur du port). |
| `ATOM_PORT` | `8787` | Port du `wrangler dev` lancé par Playwright. |
| `ATOM_REQUIRE_API` | — | `1` (CI, et dès F0) : l'absence de `window.__atom`, ou un `ready` rejeté, fait **échouer** le banc au lieu de le sauter ou de mesurer la visionneuse historique. |
| `ATOM_MACHINE` | `non renseigné` | Libellé du poste écrit dans le rapport (pas de nom d'hôte automatique : les références sont commitées). |
| `ATOM_ANGLE` | selon l'OS | Moteur ANGLE de Chrome (`d3d11`, `metal`, `vulkan`, `gl`). |
| `ATOM_GPU` | GPU intégré | `haute-perf` force le GPU dédié (`--force_high_performance_gpu`). |
| `ATOM_FPS_MS` | `10000` | Durée de la mesure de FPS. |
| `ATOM_ALTITUDES` | `10,100,300,1000` | Hauteurs (m) alternées pour la mesure de changement d'altitude. |
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
  setAltitude(m): Promise,     // résolue après la frame peinte du nouveau niveau
  pick(x, y): Promise,         // pixels CSS relatifs au canvas ; { i, j, x_m, y_m } ou null hors domaine
  orbit?(deg): Promise,        // facultatif ; sinon le banc fait tourner la caméra à la souris
}
```
