# Contrat v1 — service PC-FNO3D ⇄ tableau de bord

Ce dossier est la **source unique** des échanges entre le service PC-FNO3D (dépôt `pcfno3d`, ines-pc / Colab) et le tableau de bord (ce dépôt).

Toute modification passe par une PR **relue par les deux côtés** : ines pour le service, rayen-audit-atom pour le tableau de bord. Le dépôt `pcfno3d` en recopie `schemas/` et `fixtures/` à l'identique dans `tests/contract/`.

| Fichier | Rôle |
|---|---|
| `openapi.yaml` | Points d'accès `/v1/*`, lecture et publication |
| `schemas/*.schema.json` | JSON Schema 2020-12 de chaque réponse (`common` = types partagés) |
| `fixtures/{normal,capteur_en_derive,gpu_eteint}/` | 3 instantanés de test **synthétiques** et déterministes (grille réduite 100 × 50 × 12, 500 m, mêmes niveaux et même domaine que v7) |
| `tools/make-fixtures.mjs` | Régénère les instantanés de test |
| `tools/validate.mjs` | Valide les schémas et les invariants (tailles des binaires, NaN ⇔ relief, vitesse = ‖(u,v)‖, direction météo, sha256) |
| `tools/gen-schemas.cjs` | Régénère les schémas (sauf `common` et `meta`, écrits à la main) |

```bash
node contract/tools/make-fixtures.mjs   # instantanés de test
node contract/tools/validate.mjs        # tous les instantanés de test
node contract/tools/validate.mjs <dossier_d_un_instantané_réel>   # vérifier une publication avant de l'envoyer
```

## Règles sémantiques (non négociables)

- **Repère** : x vers l'Est, y vers le Nord, origine au coin sud-ouest.
- **Altitudes** : en m **au-dessus de la mer**. La hauteur au-dessus du sol se calcule avec le relief (`/v1/terrain`) ; on ne la déduit jamais en changeant un libellé.
- **Géoréférencement** : `georef.suppose = true` tant que la position réelle n'est pas fournie (tâche 61). L'interface **doit** alors afficher « position supposée ».
- **Direction** : météo, c'est-à-dire d'où vient le vent : `(270 − atan2(v,u)) mod 360`. Elle vaut `null` si la vitesse est inférieure à 0,2 m/s.
- **Binaires** : Float32 little-endian, un fichier par (niveau, variable), index `j*nx + i` avec `j = 0` au sud. **NaN sous le relief**, jamais −9999. Le relief lui-même n'a aucun NaN.
- **Statut** : `mesure` est réservé à un nœud porté par un capteur réel ; tout le reste est `estime`.
- **Incertitude** : elle porte toujours `method`, `members` et `calibrated`. L'intervalle p10–p90 est un intervalle à 80 %.
- **Rose des vents et Weibull** : `n_valid` est obligatoire. L'interface signale moins de 100 instants comme « statistiquement faible ».
- **Instantanés de test** : ils sont synthétiques et ne doivent jamais être présentés comme des résultats du modèle.

## Publication (service GPU → Worker → R2)

1. `PUT /v1/publish/{snapshot_id}/{path}` pour chaque fichier, avec l'en-tête `X-Content-SHA256`. L'opération est idempotente, et chaque fichier fait au plus 8 Mo.
2. `POST /v1/publish/{snapshot_id}/commit` avec le manifeste (`publish-manifest.schema.json`). Le Worker vérifie la présence, la taille et le sha256 de chaque fichier. **`latest` ne bascule que si tout est conforme**, et l'instantané devient alors immuable.
3. `POST /v1/heartbeat` toutes les 60 s tant que le service tourne. Sans battement depuis plus de 5 min, `compute_status` passe à `offline` et le tableau de bord affiche « dernier état réel calculé le … ».

- **Identifiant** : `snapshot_id = <stem>_<sha8 du modèle>`.
- **Jeton de publication** : il est remis hors salon par Rayen, lu depuis l'environnement, et n'apparaît jamais dans git.
