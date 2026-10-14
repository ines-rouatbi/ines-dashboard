# Contrat v1 — révision 2 : décisions sur la relecture d'ines (PR #1)

Relecture `pullrequestreview-5522364414`, commit relu `61a0087`. Décisions de rayen-audit-atom, coordinateur, dans le cadre du plan validé par Rayen. Le contrat reste en **version 1.0** : il n'a encore jamais été publié en production.

## Bloquants

- **B1 — accepté.**
  - `grid.min_agl_m` devient obligatoire (5.0 pour v7).
  - Règle : `NaN ⇔ z_asl − relief < min_agl_m`, appliquée dans README, `validate.mjs`, `below_terrain` et `valid_nodes`.
- **B2 — accepté.**
  - `grid.x0_m` et `grid.y0_m` deviennent obligatoires (0 pour v7) ; un nœud est en `x = x0 + i·dx`, `y = y0 + j·dy`.
  - `domain.x_max_m = x0 + (nx−1)·dx`.
  - `georef.lat0/lon0` désigne le nœud (0, 0).
  - Les fixtures sont régénérées avec les nœuds en `i·dx`.
- **B3 — tranché.**
  - **Profil en un point quelconque** : il est calculé PAR LE FRONT à partir des champs publiés (formules fixées par le contrat).
  - La route `/v1/profiles/{id}?x_m&y_m` est **supprimée**. Elle est remplacée par `/v1/profiles/{id}/{point_id}`, des profils précalculés aux seuls points déclarés (éoliennes, sites). Ils sont facultatifs et listés dans `snapshot.points`.
  - Le champ **`sigma_speed`** est publié : écart-type calibré de la norme horizontale, produit par M2. Intervalle à 80 % = `speed ± 1,2816·sigma_speed`, borné à 0 en bas (D6).
  - **Rose des vents** : `/v1/windrose/{site_id}`, précalculée par M5 et M6 pour les sites et éoliennes déclarés, avec sa période dans le fichier.
- **B4 — accepté, avec un compromis.**
  - `snapshot.network` = `{ kind: "treillis_synthetique" | "stations_aneo", sensors_total, sensors_visible, unit: "capteur" }`.
  - `stations.json` : en mode `stations_aneo`, la liste complète. En mode `treillis_synthetique`, **seulement les capteurs signalés** (état autre que `active`), d'identifiant `c<i>_<j>` (indices du treillis à 50 m), puisqu'on ne peut pas lister 500 000 capteurs.
  - `items: []` reste valide.
  - Les fixtures `normal` et `gpu_eteint` sont en treillis. `capteur_en_derive` est en treillis avec 1 capteur en dérive et 1 muet, sous des identifiants `c…` : il n'y a plus d'`ANEO-xxx` inventés.
- **B5 — accepté.**
  - Les blocs `kpi.*` issus des lots futurs, `physics`, `stations_summary` et `quality` deviennent `null`-ables, et l'interface affiche « non disponible ».
  - Avant M2, `uncertainty` = `{method: "aucune", members: 1, calibrated: false}`.
  - Jamais de 0 pour une valeur inconnue.
- **B6 — accepté.**
  - `contract/package.json` avec `ajv` et `ajv-formats` en versions fixées.
  - `.gitattributes` : `contract/fixtures/** -text` et `*.f32 binary`.
  - Compteur d'erreurs par scénario dans le validateur.
  - Contrôle du sha8 toujours exécuté, puisque `model_sha256` devient obligatoire.

## À discuter

- **D1 — accepté.**
  - `model_sha256` obligatoire : sha256 des octets du fichier de poids servi.
  - `norm` = sha8 de `norm_stats.json`.
  - `snapshot_id = <stem>[_<scénario>]_<sha8>`, avec un stem `live_AAAAMMJJ_HHMMSS` pour le direct.
- **D2 — accepté.** `versions.contract` suit le motif `^1\.\d+$`.
- **D3 — accepté.**
  - Fichiers **par modèle** publiés une seule fois : `models/{sha8}/meta.json` et `models/{sha8}/terrain.f32`.
  - Routes : `PUT /v1/publish/model/{sha8}/files/{path}` puis `POST /v1/publish/model/{sha8}/commit`.
  - `meta` porte `versions` et `terrain.sha256`, avec `terrain.href = /v1/terrain/{sha8}`.
  - Le manifeste d'instantané ne contient plus ni `meta.json` ni `terrain.f32`.
  - `/v1/meta` sert le meta du modèle de `latest`, `/v1/meta/{sha8}` un modèle précis.
- **D4 — accepté.**
  - `rotation_deg` est l'angle de l'axe x depuis l'Est, dans le sens antihoraire.
  - Projection : plan tangent équirectangulaire au nœud (0, 0), avec `m_per_deg_lat = 110574` et `m_per_deg_lon = 111320·cos(lat0)`.
  - `georef.bounds` (lat/lon min/max) devient obligatoire.
  - `crs = "plan-tangent-local"`.
- **D5 — accepté.** Les profils précalculés renvoient le nœud utilisé (`i`, `j`, `x_m`, `y_m`) et `z_terrain_m = terrain[j·nx+i]`.
- **D6 — accepté.**
  - `speed` est la passe servie, et `p50 = speed`.
  - L'intervalle est une dispersion calibrée symétrique, ±1,2816·`sigma_speed`.
  - Les quantiles empiriques sont écartés.
- **D7 — accepté.**
  - `status = 1` si la colonne (i, j) porte un capteur visible et `|z_nœud − z_capteur| ≤ 15 m`.
  - Sur données synthétiques, les capteurs simulés comptent : c'est la démonstration de BF7. La nature est portée par `versions.data_kind`, et l'interface l'affiche.
- **D8 — accepté.**
  - L'instantané ne publie que `status: "ouverte" | "close"`. L'acquittement sera géré plus tard par le Worker, hors contrat v1.
  - `id` = sha8 de `kind|cible`, où la cible est le capteur, l'éolienne ou une maille de 2 km : il est stable d'un instantané à l'autre.
  - `raised_at` = première levée (journal JSONL de M4).
  - Lot responsable de chaque `kind` : `hors_plage` M3, `station_muette` M3, `stations_insuffisantes` M3, `capteur_derive` M4, `incoherence_physique` M4, `derive_entrees` M4, `zone_mal_couverte` M2, `vent_fort_moyeu` M5, `cisaillement` M5.
- **D9 — accepté.**
  - `shear_alpha` : exposant de loi de puissance entre le bas et le haut du rotor. Il remplace `shear_ms`.
  - `veer_deg` dans [−180, 180), positif dans le sens horaire avec la hauteur.
  - REWS pondéré par l'aire.
  - Quantiles du parc calculés sur les membres de l'ensemble.
  - `air_density` obligatoire (`null`-able) + `air_density_source`.
  - `power_curves` indexé par `model`.
- **D10 — tranché.** `hub_wind_*` = statistique **sur le domaine** à `hub_height_agl_m` au-dessus du sol, productible dès aujourd'hui. La production du parc reste dans `wind-farm`.
- **D11 — accepté.**
  - `physics` : `rho_source` ; `mass_residual_ok` (instant vs seuil DSO2), qui remplace `dso2_pass` ; `ground_condition_rms_ms`, en m/s.
  - `roughness_ratio` est retiré : il demande la vérité.
  - Doublon `kpi.mass_residual_rms` supprimé.
- **D12 — accepté.** Nouvelle ressource `/v1/data-quality/{id}` (`data-quality.schema.json`, `assets.data_quality`) pour le rapport de M3.
- **D13 — accepté.**
  - **Un fichier par variable, tous niveaux** : `fields/{var}.f32` de nz·ny·nx, soit 6 Mo en v7, sous la limite de 8 Mo.
  - `status` en **uint8** : `fields/status.u8`, 255 = absent.
  - `coverage` et `reliability` en **uint8 quantifié** : 0..254 → 0..1, 255 = absent.
  - Le Worker sert un niveau par lecture partielle R2 : `GET /v1/fields/{id}/{level}/{var}` reste la route de lecture du front et ne change pas.
- **D14 — accepté.** `PUT /v1/publish/{id}/files/{path}` ; `POST /v1/publish/{id}/commit`.
- **D15 — accepté.** `versions.data_kind: "synthetique" | "reel" | "test"`, affiché par l'interface. Les fixtures sont en `test`.
- **D16 — accepté.** `data_status` obligatoire dans le manifeste.

## Mineurs : tous acceptés

- **m1** : codes courts au lieu de `const` en prose (`order: "zyx_sud_ouest"`, `direction: "meteo_provenance"`, etc.).
- **m2** : `uniqueItems`.
- **m3** : `agl_m` → `z_agl_m`. `minItems = nz` n'est pas exprimable : contrôle déplacé dans `validate.mjs`.
- **m4** : arrondi avant le modulo, documenté.
- **m5** : `additionalProperties: false` partout.
- **m6 et m7** : le plan est aligné.
- **m8** : secteurs de largeur égale, somme des fréquences égale à 1 à 0,01 près (contrôle du validateur), `dir_center_deg` = provenance, `n_valid ≥ 0`.
- **m9** : `open_alerts` = alertes ouvertes.
- **m10** : `assets` décrit toutes ses clés.
- **m11** : rappel dans le README.
- **m12** : passer par `gen-schemas.cjs`.
