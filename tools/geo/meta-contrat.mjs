/**
 * Grille et géoréférencement du domaine, lus dans un meta.json du contrat v1 (rév. 2) : jamais codés en dur.
 *
 *   --meta <meta.json>   meta d'un modèle publié (GET /v1/meta enregistré dans un fichier) ;
 *                        par défaut, le meta des instantanés de test du contrat
 *                        (contract/fixtures/normal/models/<sha8>/meta.json, grille réduite 100 × 50 à 500 m).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function cheminMetaParDefaut() {
	const models = path.resolve(HERE, '../../contract/fixtures/normal/models');
	const sha8 = fs.existsSync(models) ? fs.readdirSync(models).find((d) => /^[0-9a-f]{8}$/.test(d)) : null;
	if (!sha8) throw new Error(`aucun meta.json de test sous ${models} : passer --meta <meta.json>`);
	return path.join(models, sha8, 'meta.json');
}

/** { fichier, grid: {nx, ny, dx_m, dy_m, x0_m, y0_m}, georef, modele } depuis --meta ou le meta de test. */
export function lireMetaContrat(argv = process.argv.slice(2)) {
	const k = argv.indexOf('--meta');
	const fichier = k >= 0 && argv[k + 1] ? path.resolve(argv[k + 1]) : cheminMetaParDefaut();
	const m = JSON.parse(fs.readFileSync(fichier, 'utf8'));
	const g = m.grid;
	for (const c of ['nx', 'ny', 'dx_m', 'dy_m', 'x0_m', 'y0_m']) if (typeof g?.[c] !== 'number') throw new Error(`${fichier} : grid.${c} absent (contrat v1 rév. 2)`);
	for (const c of ['lat0', 'lon0', 'rotation_deg']) if (typeof m.georef?.[c] !== 'number') throw new Error(`${fichier} : georef.${c} absent`);
	return {
		fichier,
		grid: { nx: g.nx, ny: g.ny, dx_m: g.dx_m, dy_m: g.dy_m, x0_m: g.x0_m, y0_m: g.y0_m },
		georef: m.georef,
		modele: { model: m.versions?.model ?? null, model_sha256: m.versions?.model_sha256 ?? null, data_kind: m.versions?.data_kind ?? null },
	};
}
