# atom.zelqane.com — façade & tableau de bord 3D de PC-FNO3D

Worker Cloudflare qui publie à l'URL **stable** `atom.zelqane.com` le service de champ de vent 3D
d'ines (PC-FNO3D, réseau ANEO), tournant sur un Colab éphémère derrière un tunnel nommé.

## Rôle du Worker (`src/worker.js`)
1. Sert le **front** (build Vite statique, `dist/`) à la racine, avec repli SPA.
2. Proxifie `/api/*` et `/mcp*` vers le tunnel (`ORIGIN = https://atom-origin.zelqane.com`) en
   **injectant la clé d'API lecture-seule** côté serveur (`X-API-Key`) : le navigateur ne la voit jamais.
3. Relaie `/mcp` en **flux** (streamable HTTP), laisse passer `Mcp-Session-Id` / `MCP-Protocol-Version`.
4. Quand le Colab dort (erreur Cloudflare 502/504/520–530) → renvoie un `503 service_asleep` JSON propre.


## Architecture
```
navigateur → atom.zelqane.com (ce Worker : front statique dist/ + injection clé + proxy)
   ├─ /           → dist/ (Vite + TypeScript + React 18 + three.js + ECharts)
   ├─ /v1/*       → src/v1.js : instantanés R2 (en dev : même code sur un faux R2 = contract/fixtures/)
   └─ /api, /mcp  → atom-origin.zelqane.com (CNAME → tunnel nommé « atom »)
                       → cloudflared sur le Colab d'ines → uvicorn 127.0.0.1:8000
```

### Front (`web/`, racine Vite ; build vers `dist/`)
- `web/src/data/` — client `/v1/*` (contrat v1 **révision 2**) : JSON, et un niveau de champ décodé selon
  l'en-tête `x-atom-dtype` (float32 LE, NaN = absent ; uint8 × `meta.encoding[var].scale`, 255 = absent) ;
  cache des champs par (instantané, niveau, variable) ; `/v1/column`, `/v1/data-quality` ; types du contrat **générés** depuis
  `contract/schemas/` (`contract.gen.ts`, via `npm run contract:types` ; ne pas l'éditer à la main).
  Une ressource absente remonte comme erreur typée et s'affiche « indisponible ». **Jamais de données de démo.**
- `web/src/domain/` — fonctions pures testées : direction `dirFrom(u, v)` (d'où vient le vent,
  `null` si < 0,2 m/s), vitesses, conversions, échantillonnage d'un niveau, règle du bandeau de fraîcheur,
  **profil vertical au clic calculé par le front** depuis UNE requête `/v1/column/{id}?i&j` (direction météo,
  intervalle à 80 % = `speed ± 1,2816·sigma_speed` borné à 0, statut mesuré / estimé), capteur visible le plus
  proche (treillis `c<i>_<j>` à 50 m ou stations ANEO), géoréférencement (plan tangent, `rotation_deg`).
- `web/src/scene/` — scène three.js (lot F2) : relief du modèle ombré (`/v1/terrain/{sha8}`) avec exagération ×1 à ×10,
  socle, nord, échelle ; lignes de courant colorées ; coupes horizontale et verticale ; capteurs et éoliennes ;
  plan par défaut à **120 m au-dessus du sol**, calculé par colonne avec le relief (`domain/hauteurSol.ts`, D6), mode
  altitude mer en option ; coloration vitesse / incertitude / fiabilité et légende chiffrée ; frise `/v1/times` et
  rejeu ; carte de situation (`geo/tunisia.ts`). Crochet de test `window.__atom`.
- `web/src/ui/`, `web/src/pages/` — coquille React (barre, navigation, bandeau) et pages.
- Lot F6 (intégration réelle) : page **Comparaison** (`/comparaison?a=&b=&h=` : deux instantanés à la même hauteur
  au-dessus du sol, échelle commune, différence B − A seulement sur les nœuds présents des deux côtés,
  `domain/comparaison.ts`) ; **export CSV** des valeurs affichées, généré côté client (`domain/exportCsv.ts` :
  cartes, plan et profil de l'Exploration, comparaison) et liens `snapshot.assets.export_*` (« non disponible »
  tant que M6 ne les publie pas) ; **charte §17.4** centralisée dans `web/src/ui/couleurs.ts` et les variables CSS
  de `theme.css` (contrôlées par `dev/charte.test.ts`, contrastes AA) ; état du service de calcul (`/api/health`)
  sur la page Modèle. Scénario de démonstration : `docs/SCENARIO_DEMO.md`.
- Repère : x = Est (u), z = -Nord (v), y = altitude (w). Nœud (i, j) en `x0 + i·dx`, `y0 + j·dy` ; un nœud
  existe ssi `z − relief ≥ grid.min_agl_m`. Niveaux au-dessus du niveau de la mer, adressés par **indice**
  (0..nz-1) ; la grille est toujours lue dans `/v1/meta`. « Position supposée » affichée si `georef.suppose`.
- Nature des données (`versions.data_kind` : test, synthétique, réel) affichée en permanence dans la barre
  supérieure ; valeurs `null` des blocs pas encore livrés (`kpi`, `physics`…) affichées « non disponible ».
- Bandeau « Dernier état réel calculé le … » affiché si et seulement si `compute_status != "online"`.

Crochet de test (Playwright) : `window.__atom = { ready, scene, setAltitude(m mer), setHauteurSol(m sol), pick(x, y), orbit(deg), regler(r), etat() }`, documenté
dans `web/src/types/atom-hook.d.ts`. `ready` est résolue au premier rendu d'un champ et **rejetée** avec un
message si les données ne se chargent pas en 15 s ; `pick` prend des pixels CSS relatifs au canevas.

L'ancienne viz statique (importmap CDN, mode démo) est conservée dans `legacy/`, non servie.

## Déploiement
```bash
npm run build                               # produit dist/
npx wrangler secret put PCFNO3D_READ_KEY   # clé lecture-seule émise par le service d'ines (Ines → Rayen)
npx wrangler deploy                         # publie sur atom.zelqane.com (zone zelqane.com)
```
Tunnel déjà créé côté Cloudflare : `atom` (id `e552f718-…`) + CNAME `atom-origin.zelqane.com`.
Le connecteur se lance sur le Colab d'ines (voir la remise hors salon).

## Dév local
```bash
npm install
npm run dev                          # Vite sur http://localhost:5173, /v1/* servi par les fixtures
ATOM_FIXTURE=gpu_eteint npm run dev  # autre scénario : normal | capteur_en_derive | gpu_eteint
ATOM_V1_ORIGIN=http://127.0.0.1:8787 npm run dev   # vrais instantanés : /v1 et /api relayés vers ce Worker (lecture)
ATOM_REEL_URL=http://127.0.0.1:8787 npm test       # web/src/pages/reel.test.tsx sur ce Worker (sautée s'il ne répond pas)
npm run typecheck && npm test        # types + tests Vitest
npm run build && npm run worker:dev  # Worker local (wrangler dev) sur dist/, http://127.0.0.1:8787
npm run contract:check               # valide schémas, instantanés de test et invariants (ajv)
npm run contract:types               # régénère web/src/data/contract.gen.ts après une PR du contrat
```
En dev, `GET /v1/*` est servi par **le code du Worker** (`src/v1.js`) branché sur un faux binding R2
(`dev/fixtures.ts`) qui lit `contract/fixtures/<ATOM_FIXTURE>/` (par défaut `normal`) : une seule
implémentation de `/v1`, mêmes réponses et mêmes en-têtes qu'en production. Un scénario inexistant répond
`404 {"error":"absent"}` partout.
