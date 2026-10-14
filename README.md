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
   ├─ /v1/*       → instantanés R2 (lot F1 ; en dev : contract/fixtures/)
   └─ /api, /mcp  → atom-origin.zelqane.com (CNAME → tunnel nommé « atom »)
                       → cloudflared sur le Colab d'ines → uvicorn 127.0.0.1:8000
```

### Front (`web/`, racine Vite ; build vers `dist/`)
- `web/src/data/` — client `/v1/*` (JSON + binaires Float32 little-endian, NaN = sous le relief),
  cache des champs par (instantané, niveau, variable), types du contrat **générés** depuis
  `contract/schemas/` (`contract.gen.ts`, via `npm run contract:types` ; ne pas l'éditer à la main).
  Une ressource absente remonte comme erreur typée et s'affiche « indisponible ». **Jamais de données de démo.**
- `web/src/domain/` — fonctions pures testées : direction `dirFrom(u, v)` (d'où vient le vent,
  `null` si < 0,2 m/s), vitesses, conversions, échantillonnage d'un niveau, règle du bandeau de fraîcheur,
  **profil vertical calculé côté client** depuis les champs de la maille cliquée (intervalle à 80 % :
  vitesse ± 1,2816·σ, σ propagé depuis σu et σv, borné à 0).
- `web/src/scene/` — scène three.js (portage de l'ancienne viz) et crochet de test `window.__atom`.
- `web/src/ui/`, `web/src/pages/` — coquille React (barre, navigation, bandeau) et pages.
- Repère : x = Est (u), z = -Nord (v), y = altitude (w). Nœuds au centre des mailles
  (`x_i = (i + 0,5)·dx`). Niveaux au-dessus du niveau de la mer, adressés par **indice** (0..nz-1) ;
  la grille est toujours lue dans `/v1/meta`. « Position supposée » affichée si `georef.suppose`.
- Bandeau « Dernier état réel calculé le … » affiché si et seulement si `compute_status != "online"`.

Crochet de test (Playwright) : `window.__atom = { ready, scene, setAltitude(m), pick(x, y) }`, documenté
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
npm run typecheck && npm test        # types + tests Vitest
npm run build && npm run worker:dev  # Worker local (wrangler dev) sur dist/, http://127.0.0.1:8787
npm run contract:check               # valide schémas, instantanés de test et invariants (ajv)
npm run contract:types               # régénère web/src/data/contract.gen.ts après une PR du contrat
```
En dev, `GET /v1/*` (y compris `/v1/terrain` et `/v1/times`) est servi depuis
`contract/fixtures/<ATOM_FIXTURE>/` (par défaut `normal`). Un fichier absent répond `404 {"error":"absent"}`.
