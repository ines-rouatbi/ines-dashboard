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
} from '../../web/src/geo/tunisia.ts';

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

test('coins du domaine, ancrage supposé 36,00 N ; 9,70 E ; rotation 0', () => {
	const [so, se, ne, no] = domainCorners({ lat0: 36, lon0: 9.7, rotation_deg: 0 });
	near(so.lat, 36, 1e-12);
	near(so.lon, 9.7, 1e-12);
	near(se.lat, 36, 1e-12);
	near(se.lon, 9.7 + 50000 / (111320 * Math.cos((36 * Math.PI) / 180)), 1e-9);
	near(ne.lat, 36 + 25000 / 110574, 1e-9);
	near(ne.lon, se.lon, 1e-12);
	near(no.lat, ne.lat, 1e-12);
	near(no.lon, 9.7, 1e-12);
});

test('rotation de 90° : l axe x du domaine pointe vers le nord', () => {
	const p = domainToLatLon({ lat0: 36, lon0: 9.7, rotation_deg: 90 }, 10000, 0);
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

test('fichiers : relief réel du domaine (ancrage supposé)', async () => {
	const d = await loadDomainRelief('/geo/', localFetch);
	assert.equal(d.nx, 500);
	assert.equal(d.ny, 250);
	assert.equal(d.meta.ancrage.suppose, true);
	let min = Infinity;
	let max = -Infinity;
	for (const v of d.relief) {
		min = Math.min(min, v);
		max = Math.max(max, v);
	}
	near(min, d.meta.min_m, 0.06);
	near(max, d.meta.max_m, 0.06);
});
