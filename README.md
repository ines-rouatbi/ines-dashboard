# atom.zelqane.com — façade de PC-FNO3D et front-end ATOM Wind

Worker Cloudflare qui publie à l'URL **stable** `atom.zelqane.com` le service de champ de vent 3D
d'ines (PC-FNO3D, réseau ANEO), tournant sur un Colab éphémère derrière un tunnel nommé.

## Rôle du Worker (`src/worker.js`)
1. Sert le **front-end ATOM Wind** (statique, `public/`) à la racine (depuis le 25/10/2026,
   à la demande d'ines : il remplace la visionneuse three.js d'origine, toujours dans l'historique git).
2. Proxifie `/api/*` et `/mcp*` vers le tunnel (`ORIGIN = https://atom-origin.zelqane.com`) en
   **injectant la clé d'API lecture-seule** côté serveur (`X-API-Key`) : le navigateur ne la voit jamais.
3. Relaie `/mcp` en **flux** (streamable HTTP), laisse passer `Mcp-Session-Id` / `MCP-Protocol-Version`.
4. Quand le Colab dort (erreur Cloudflare 502/504/520–530) → renvoie un `503 service_asleep` JSON
   propre ; ATOM Wind affiche alors « service hors ligne » et tourne sur sa journée d'exemple.

## Architecture
```
navigateur → atom.zelqane.com (ce Worker : ATOM Wind + injection clé + proxy)
   → atom-origin.zelqane.com (CNAME → tunnel nommé « atom »)
      → cloudflared sur le Colab d'ines → uvicorn 127.0.0.1:8000  (/api /mcp /app)
```

## Front-end ATOM Wind (`public/`)
- `index.html` — la page (maquette d'ines, Mon vent, Agriculteur, Tableau de bord, Carte 3D, Alertes,
  Éolien, Fiabilité, Nesma). **Ne pas l'éditer ici** : elle est construite dans le dépôt pcfno3d
  (`python scripts/build_atom_wind.py` → `webapp/atom-wind/index.html`) puis recopiée ici.
- `atom-data.js` — couche de données : `GET /api/atom-wind/grille` (relief réel, eau, z0, stations),
  `/api/atom-wind/jours`, `/api/atom-wind/jour?date=AAAA-MM-JJ` (u, v aux hauteurs 10–1000 m au-dessus
  du sol, grille de 500 m), `/api/atom-wind/reseau-aneo` (plan OS6). Même origine : ce Worker relaie
  vers le Colab et injecte la clé, le navigateur n'en porte aucune.
- Mise à jour : copier `webapp/atom-wind/index.html` et `atom-data.js` de pcfno3d dans `public/`, puis
  déployer.

## Déploiement
```bash
npx wrangler secret put PCFNO3D_READ_KEY   # clé lecture-seule émise par le service d'ines (Ines → Rayen)
npx wrangler deploy                         # publie sur atom.zelqane.com (zone zelqane.com)
```
Tunnel déjà créé côté Cloudflare : `atom` (id `e552f718-…`) + CNAME `atom-origin.zelqane.com`.
Le connecteur se lance sur le Colab d'ines (voir la remise hors salon).

## Dév local
```bash
npx wrangler dev   # http://127.0.0.1:8787 — /api/* répond « service_asleep » → journée d'exemple
npx wrangler dev --var ORIGIN:http://127.0.0.1:8000   # contre un service pcfno3d local
```
