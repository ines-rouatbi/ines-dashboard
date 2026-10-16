// Tests de web/src/geo/tunisia.ts et des fichiers web/public/geo/ (node:test, Node ≥ 22.6 : types TS effacés).
// Lancer : cd tools/geo && node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	domainCorners,
	domainToLatLon,
	latLonToPixel,
	pixelToLatLon,
	parseF32LE,
	reliefAt,
	loadTunisia,
	loadDomainRelief,
	positionNoeud,
} from '../../web/src/geo/tunisia.ts';
import { lireMetaContrat } from './meta-contrat.mjs';

const GEO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/geo');
// fetch local : lit les fichiers du dossier web/public/geo
const localFetch = async (url) => {
	const file = path.join(GEO, url.replace(/^\/geo\//, ''));
	const buf = fs.readFileSync(file);
	return {
		ok: true,
		status: 200,
		json: async () => JSON.parse(buf.toString('utf8')),
		arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
	};
};
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} ± ${tol}`);

const META = lireMetaContrat([]); // meta des instantanés de test du contrat (grille 100 × 50 à 500 m)

test('coins du domaine = nœuds extrêmes de la grille du meta (x0 + i·dx), = georef.bounds', () => {
	const [so, se, ne, no] = domainCorners(META);
	const b = META.georef.bounds;
	near(so.lat, b.lat_min, 1e-6);
	near(so.lon, b.lon_min, 1e-6);
	near(se.lon, b.lon_max, 1e-6);
	near(ne.lat, b.lat_max, 1e-6);
	near(no.lon, so.lon, 1e-12);
	near(se.lat, so.lat, 1e-12);
	// (nx − 1)·dx, pas nx·dx : 49 500 m pour la grille de test.
	near(se.lon - so.lon, ((META.grid.nx - 1) * META.grid.dx_m) / META.georef.m_per_deg_lon, 1e-9);
});

test('x0 et y0 soustraits : le nœud (0, 0) est en lat0/lon0 même si x0, y0 ≠ 0', () => {
	const m = { grid: { ...META.grid, x0_m: 1000, y0_m: -500 }, georef: { lat0: 36, lon0: 9.7, rotation_deg: 0 } };
	const p0 = positionNoeud(m, 0, 0);
	assert.deepEqual(p0, { x: 1000, y: -500 });
	const q = domainToLatLon(m, p0.x, p0.y);
	near(q.lat, 36, 1e-12);
	near(q.lon, 9.7, 1e-12);
	const p1 = domainToLatLon(m, 1000 + META.grid.dx_m, -500);
	near(p1.lon, 9.7 + META.grid.dx_m / (111320 * Math.cos((36 * Math.PI) / 180)), 1e-9);
});

test('rotation de 90° : l axe x du domaine pointe vers le nord', () => {
	const p = domainToLatLon({ grid: { ...META.grid, x0_m: 0, y0_m: 0 }, georef: { lat0: 36, lon0: 9.7, rotation_deg: 90 } }, 10000, 0);
	near(p.lat, 36 + 10000 / 110574, 1e-9);
	near(p.lon, 9.7, 1e-9);
});

test('lat/lon ↔ pixel : aller-retour et coins de l image', () => {
	const img = { fichier: 'x.png', largeur_px: 674, hauteur_px: 1400, bbox: { lat_min: 30, lat_max: 37.6, lon_min: 7.4, lon_max: 11.8 }, m_par_px: { x: 600, y: 600 } };
	assert.deepEqual(latLonToPixel(img, 37.6, 7.4), { x: 0, y: 0 });
	const c = latLonToPixel(img, 30, 11.8);
	near(c.x, 674, 1e-9);
	near(c.y, 1400, 1e-9);
	const q = pixelToLatLon(img, ...Object.values(latLonToPixel(img, 35.8256, 10.63699)));
	near(q.lat, 35.8256, 1e-9);
	near(q.lon, 10.63699, 1e-9);
});

test('parseF32LE', () => {
	const b = Buffer.alloc(8);
	b.writeFloatLE(1.5, 0);
	b.writeFloatLE(-2, 4);
	assert.deepEqual([...parseF32LE(b.buffer.slice(b.byteOffset, b.byteOffset + 8))], [1.5, -2]);
});

test('fichiers : relief national cohérent, Jebel Chambi ~1 500 m, Tunis et Sousse sur terre près de la côte', async () => {
	const t = await loadTunisia('/geo/', localFetch);
	assert.equal(t.villes.length, 25);
	assert.equal(t.relief.length, t.meta.nx * t.meta.ny);
	// pic du Jebel Chambi : maximum dans un rayon de 0,05° autour de 35,2 N ; 8,68 E
	let chambi = -Infinity;
	for (let lat = 35.15; lat <= 35.25; lat += 0.005) for (let lon = 8.63; lon <= 8.73; lon += 0.005) chambi = Math.max(chambi, reliefAt(t.meta, t.relief, lat, lon));
	// La source zoom 8 donne ~1 480 m (contrôle consigné dans tunisie-relief.json) ; la grille à
	// 0,01° écrête le sommet de ~100 m car ses nœuds tombent à ~1 km du pic : tolérance élargie vers le bas.
	assert.ok(chambi >= 1350 && chambi <= 1600, `Chambi grille ${chambi}`);
	near(t.meta.controles.jebel_chambi.source_zoom8_m, 1500, 100);
	for (const nom of ['Tunis', 'Sousse']) {
		const v = t.villes.find((x) => x.nom === nom);
		assert.ok(reliefAt(t.meta, t.relief, v.lat, v.lon) > 0, `${nom} doit être sur terre`);
		let sea = false;
		for (let d = -0.1; d <= 0.1 && !sea; d += 0.01) for (let e = -0.1; e <= 0.1; e += 0.01) if (reliefAt(t.meta, t.relief, v.lat + d, v.lon + e) <= 0) sea = true;
		assert.ok(sea, `${nom} doit être à moins de ~10 km de la mer`);
	}
	for (const v of t.villes) {
		const p = latLonToPixel(t.meta.image, v.lat, v.lon);
		assert.ok(p.x >= 0 && p.x <= t.meta.image.largeur_px && p.y >= 0 && p.y <= t.meta.image.hauteur_px, `${v.nom} hors image`);
	}
});

test('fichiers : relief réel du domaine aux nœuds de la grille du meta (ancrage supposé, fond de carte)', async () => {
	const d = await loadDomainRelief('/geo/', localFetch);
	// Construit avec le meta de test du contrat : même grille, nœuds en x0 + i·dx (B2), pas de centres de maille.
	assert.deepEqual([d.nx, d.ny], [META.grid.nx, META.grid.ny]);
	for (const c of ['dx_m', 'dy_m', 'x0_m', 'y0_m']) assert.equal(d.meta.grille[c], META.grid[c], c);
	assert.equal(d.meta.ancrage.suppose, true);
	assert.match(d.meta.usage, /FOND DE CARTE/);
	assert.match(d.meta.usage, /\/v1\/terrain/);
	let min = Infinity;
	let max = -Infinity;
	for (const v of d.relief) {
		min = Math.min(min, v);
		max = Math.max(max, v);
	}
	near(min, d.meta.min_m, 0.06);
	near(max, d.meta.max_m, 0.06);
});
