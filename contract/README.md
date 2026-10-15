# Contrat v1 (révision 2) — service PC-FNO3D ⇄ tableau de bord

Ce dossier est la **source unique** des échanges entre le service PC-FNO3D (dépôt `pcfno3d`, ines-pc / Colab) et le tableau de bord (ce dépôt). La révision 2 applique la relecture d'ines (PR #1) ; chaque décision est dans [`DECISIONS-rev2.md`](DECISIONS-rev2.md). Le contrat reste en version **1.0**.

Toute modification passe par une PR **relue par les deux côtés** : ines pour le service, rayen-audit-atom pour le tableau de bord. Le dépôt `pcfno3d` en recopie `schemas/` et `fixtures/` à l'identique dans `tests/contract/`.

| Fichier | Rôle |
|---|---|
| `openapi.yaml` | Points d'accès `/v1/*`, lecture et publication |
| `schemas/*.schema.json` | JSON Schema 2020-12 de chaque réponse (`common` = types partagés) |
| `fixtures/{normal,capteur_en_derive,gpu_eteint}/` | 3 instantanés de **test** (`data_kind: "test"`), déterministes : grille réduite 100 × 50 × 12 à 500 m, mêmes niveaux que v7. Disposition = disposition R2, décrite en tête de `tools/make-fixtures.mjs` |
| `tools/make-fixtures.mjs` | Régénère les instantanés de test |
| `tools/validate.mjs` | Valide les schémas et les invariants (voir ci-dessous) ; compteur d'erreurs par scénario |
| `tools/test-negative.mjs` | Test négatif obligatoire du validateur (3 défauts injectés → code 1, 3 messages) |
| `tools/gen-schemas.cjs` | Régénère les schémas, sauf `common` et `meta` écrits à la main. **Toute correction d'un schéma généré passe par ce script.** |
| `tools/publish.mjs` | Client de publication de référence (modèle, puis instantané, puis battement) |

```bash
cd contract && npm ci                      # ajv et ajv-formats en versions exactes
node tools/make-fixtures.mjs               # instantanés de test
node tools/validate.mjs                    # tous les instantanés de test
node tools/validate.mjs <dossier>          # vérifier une publication réelle avant de l'envoyer
npm test                                   # validateur + test négatif
```

Le validateur contrôle : schémas ; tailles des binaires ; NaN (ou 255) ⇔ `z − relief < min_agl_m` ; `valid_nodes` recompté ; nœuds en `x0 + i·dx` ; `speed = ‖(u,v)‖` ; direction météo recalculée ; profils (nz niveaux, valeurs identiques aux champs au nœud `(i, j)`, `p50 = speed`, intervalle ±1,2816·σ) ; sha256 et taille de **chaque** fichier des deux manifestes ; roses des vents (somme des fréquences = 1 ± 0,01, secteurs de largeur égale) ; `open_alerts` = alertes ouvertes ; id d'alerte = sha8(kind|cible) ; cohérence du réseau.

`.gitattributes` fige les fixtures en octets (`contract/fixtures/** -text`) : sans cela, `core.autocrlf` réécrit les JSON en CRLF sous Windows et les sha256 ne correspondent plus.

## Règles sémantiques (non négociables)

- **Grille** : le nœud `(i, j)` est en `x = x0 + i·dx`, `y = y0 + j·dy` (`x0 = y0 = 0` pour v7) ; `x_max = x0 + (nx−1)·dx`. x vers l'Est, y vers le Nord. **L'interface ne code jamais la grille en dur** : fixtures 100 × 50 à 500 m, v7 500 × 250 à 100 m ; tout vient de `meta`.
- **Altitudes** : en m **au-dessus de la mer**. La hauteur au-dessus du sol se calcule avec le relief (`/v1/terrain/{sha8}`, `terrain[j·nx + i]`) ; on ne la déduit jamais en changeant un libellé.
- **Nœuds absents** : un nœud existe si et seulement si `z_asl − relief ≥ grid.min_agl_m` (5 m pour v7). Sinon : `null` en JSON, NaN en Float32, 255 en uint8. Jamais −9999. Le relief n'a aucun NaN. `below_terrain` et `valid_nodes` suivent la même règle.
- **Géoréférencement** : `lat0/lon0` = nœud (0, 0) ; `rotation_deg` = angle de l'axe x depuis l'Est, sens antihoraire ; plan tangent équirectangulaire (`m_per_deg_lat = 110574`, `m_per_deg_lon = 111320·cos(lat0)`), `crs = "plan-tangent-local"`. `georef.suppose = true` tant que la position réelle n'est pas fournie (tâche 61) : l'interface **doit** afficher « position supposée ».
- **Direction** : météo, d'où vient le vent : `(270 − atan2(v,u)) mod 360`, arrondie **avant** le modulo (359,996 → 0). `null` si la vitesse est inférieure à 0,2 m/s.
- **Binaires** : un fichier par variable, **tous niveaux** : `fields/{var}.f32` (Float32 little-endian) ou `fields/{var}.u8`, nz·ny·nx valeurs, index `k·ny·nx + j·nx + i`, `j = 0` au sud. `status` en uint8 (1 = mesuré, 0 = estimé) ; `coverage` et `reliability` en uint8 quantifié (octet/254). Le codage de chaque variable est dans `meta.encoding`. Le Worker sert un niveau par lecture partielle (`/v1/fields/{id}/{level}/{var}`, en-tête `x-atom-dtype`), et une colonne par `/v1/column/{id}?i&j`.
- **Statut** : `status = 1` si la colonne `(i, j)` porte un capteur visible et `|z_nœud − z_capteur| ≤ 15 m`. Sur données synthétiques, les capteurs simulés comptent ; la nature des données est dans `versions.data_kind`, que l'interface affiche.
- **Incertitude** : elle porte toujours `method`, `members` et `calibrated` ; avant M2, `{method: "aucune", members: 1, calibrated: false}`. `speed` est la passe servie et `p50 = speed` ; l'intervalle à 80 % est `speed ± 1,2816·sigma_speed`, borné à 0 en bas. Un profil en un point quelconque est calculé **par le front** avec ces formules, à partir de `/v1/column`.
- **Valeurs inconnues** : `null`, jamais 0. Les blocs des lots pas encore livrés (`kpi.*`, `physics`, `stations_summary`, `quality.calibration`) sont `null`-ables ; l'interface affiche « non disponible ».
- **Réseau** : `snapshot.network.kind` = `treillis_synthetique` (stations.json ne liste que les capteurs signalés, `c<i>_<j>` sur le treillis à 50 m) ou `stations_aneo` (liste complète). `items: []` est valide.
- **Alertes** : `id = sha8(kind|cible)`, stable d'un instantané à l'autre ; `raised_at` = première levée ; l'instantané ne publie que `ouverte | close` (acquittement hors contrat v1). Lot responsable de chaque `kind` : voir `alerts.schema.json`.
- **Vent au moyeu** (`kpi.hub_wind_*`) : statistique sur le **domaine** à `hub_height_agl_m` au-dessus du sol (interpolation linéaire de `speed` par colonne). La production du parc reste dans `wind-farm`.
- **Rose des vents et Weibull** : précalculées aux sites déclarés ; `n_valid` est obligatoire et l'interface signale moins de 100 instants comme « statistiquement faible ». Secteurs de largeur égale, `dir_center_deg` = provenance, somme des fréquences = 1 à 0,01 près.
- **Instantanés de test** : `data_kind = "test"`, modèle fictif ; ils ne doivent jamais être présentés comme des résultats du modèle ni publiés en production.

## Publication (service GPU → Worker → R2)

1. **Modèle, une seule fois par modèle** : `PUT /v1/publish/model/{sha8}/files/{path}` pour `meta.json` et `terrain.f32`, puis `POST /v1/publish/model/{sha8}/commit` avec `model-manifest.schema.json`. Le modèle devient immuable ; un nouveau commit identique est un succès sans effet.
2. **Instantané** : `PUT /v1/publish/{snapshot_id}/files/{path}` pour chaque fichier, avec l'en-tête `X-Content-SHA256` (chemin encodé, `/` → `%2F`). Idempotent, 8 Mo maximum par fichier.
3. `POST /v1/publish/{snapshot_id}/commit` avec le manifeste (`publish-manifest.schema.json`, `data_status` obligatoire, ni `meta.json` ni `terrain.f32`). Le Worker vérifie que le modèle est commité, la présence, la taille et le sha256 de chaque fichier, et la taille de chaque champ (nz·ny·nx·octets). **`latest` ne bascule que si tout est conforme**, et l'instantané devient alors immuable. Précisions du Worker (à relire des deux côtés) :
   - `Content-Length` est obligatoire sur chaque `PUT` (411 sinon) ;
   - un commit **rejoué** refait, sans effet de bord, l'index et `latest` (reprise après une panne entre la vérification et la bascule) ; il est donc sûr de rejouer un commit dont la réponse a été perdue ;
   - une **simulation** (`snapshot.scenario` non null) est publiée et lisible par son identifiant, mais n'entre ni dans `latest` ni dans `index/times.json` ;
   - un instantané `data_kind = "test"` est refusé (422 `instantane_de_test`), sauf en dev avec `ATOM_ALLOW_TEST_SNAPSHOTS=1` ;
   - `/v1/times` : `open_alerts` = somme de `snapshot.kpi.open_alerts`, `null` si ce bloc est `null` (M4 inactif) ; l'index a une entrée par instantané, et `latest` est écrit sous condition d'etag : des commits concurrents ne perdent aucune entrée et `latest` ne recule jamais, sauf pour la toute première publication du bucket (sans `latest` existant), à faire seule.
4. `POST /v1/heartbeat` toutes les 60 s tant que le service tourne. Sans battement depuis plus de 5 min, `compute_status` passe à `offline` et le tableau de bord affiche « dernier état réel calculé le … ».

- **Identifiant** : `snapshot_id = <stem>[_<scénario>]_<sha8>`, où sha8 = 8 premiers caractères de `versions.model_sha256` (sha256 des octets du fichier de poids servi). Stem `live_AAAAMMJJ_HHMMSS` pour le direct ; `<scénario>` seulement pour une simulation (BF45, BF46). `versions.norm` = sha8 de `norm_stats.json`.
- **Disposition R2** : `models/{sha8}/…`, `snapshots/{id}/…`, `latest.json`, `index/times.json`, `heartbeat.json`.
- **Jeton de publication** : il est remis hors salon par Rayen, lu depuis l'environnement, et n'apparaît jamais dans git.
