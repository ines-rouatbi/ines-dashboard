# atom.zelqane.com — façade & viz 3D de PC-FNO3D

Worker Cloudflare qui publie à l'URL **stable** `atom.zelqane.com` le service de champ de vent 3D
d'ines (PC-FNO3D, réseau ANEO), tournant sur un Colab éphémère derrière un tunnel nommé.

## Rôle du Worker (`src/worker.js`)
1. Sert la **viz three.js** (statique, `public/`) à la racine.
2. Proxifie `/api/*` et `/mcp*` vers le tunnel (`ORIGIN = https://atom-origin.zelqane.com`) en
   **injectant la clé d'API lecture-seule** côté serveur (`X-API-Key`) : le navigateur ne la voit jamais.
3. Relaie `/mcp` en **flux** (streamable HTTP), laisse passer `Mcp-Session-Id` / `MCP-Protocol-Version`.
4. Quand le Colab dort (erreur Cloudflare 502/504/520–530) → renvoie un `503 service_asleep` JSON
   propre que la viz affiche en « service endormi » (bascule en mode démo).

## Architecture
```
navigateur → atom.zelqane.com (ce Worker : viz + injection clé + proxy)
   → atom-origin.zelqane.com (CNAME → tunnel nommé « atom »)
      → cloudflared sur le Colab d'ines → uvicorn 127.0.0.1:8000  (/api /mcp /app)
```

## Viz (`public/`)
- `api.js` — modèle de données normalisé + **source démo** (champ synthétique) + adaptateur **live**.
  Un seul endroit à ajuster quand ines confirme la forme exacte de `/api/meta` et `/api/field`.
- `viz.js` — scène three.js : domaine, relief, flèches instanciées colorées par vitesse, picking.
- `app.js` — contrôles (instant, altitude, densité), dashboard (grille, DSO, stats, profil vertical).
- Repère : x = Est (u), z = -Nord (v), y = altitude (w). La **direction indique d'où vient le vent**.

## Déploiement
```bash
npx wrangler secret put PCFNO3D_READ_KEY   # clé lecture-seule émise par le service d'ines (Ines → Rayen)
npx wrangler deploy                         # publie sur atom.zelqane.com (zone zelqane.com)
```
Tunnel déjà créé côté Cloudflare : `atom` (id `e552f718-…`) + CNAME `atom-origin.zelqane.com`.
Le connecteur se lance sur le Colab d'ines (voir la remise hors salon).

## Dév local
```bash
npx wrangler dev   # http://127.0.0.1:8787 — /api/* répond « service_asleep » → viz en mode démo
```
