#!/usr/bin/env node
/**
 * controle-carte.mjs — image de contrôle de la carte de la Tunisie (non publiée).
 *
 * Superpose à web/public/geo/tunisie-ombre.png les 25 villes (croix rouges) et le domaine ATOM
 * à son ancrage SUPPOSÉ (cadre magenta), et imprime pour chaque ville le pixel, l'altitude de la
 * grille et la distance approximative à la mer la plus proche.
 *
 * Usage : node --experimental-strip-types controle-carte.mjs --out <fichier.png> [--meta <meta.json>]
 *         (image à écrire hors du dépôt ; domaine lu dans le meta du contrat, voir meta-contrat.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { domainCorners, latLonToPixel, reliefAt } from '../../web/src/geo/tunisia.ts';
import { lireMetaContrat } from './meta-contrat.mjs';

const GEO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/geo');
const k = process.argv.indexOf('--out');
if (k < 0 || !process.argv[k + 1]) {
	console.error('usage : node controle-carte.mjs --out <fichier.png>');
	process.exit(2);
}
const OUT = path.resolve(process.argv[k + 1]);

const meta = JSON.parse(fs.readFileSync(path.join(GEO, 'tunisie-relief.json'), 'utf8'));
const { villes } = JSON.parse(fs.readFileSync(path.join(GEO, 'villes.json'), 'utf8'));
const b = fs.readFileSync(path.join(GEO, meta.fichier));
const relief = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const png = PNG.sync.read(fs.readFileSync(path.join(GEO, meta.image.fichier)));

const put = (x, y, [r, g, bl]) => {
	x = Math.round(x);
	y = Math.round(y);
	if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
	const o = 4 * (y * png.width + x);
	png.data[o] = r;
	png.data[o + 1] = g;
	png.data[o + 2] = bl;
	png.data[o + 3] = 255;
};
const line = (a, c, col) => {
	const n = Math.ceil(Math.hypot(c.x - a.x, c.y - a.y)) + 1;
	for (let s = 0; s <= n; s++) put(a.x + ((c.x - a.x) * s) / n, a.y + ((c.y - a.y) * s) / n, col);
};

// Domaine (ancrage supposé)
const corners = domainCorners(lireMetaContrat()).map((p) => latLonToPixel(meta.image, p.lat, p.lon));
for (let s = 0; s < 4; s++) line(corners[s], corners[(s + 1) % 4], [220, 0, 200]);

const seaDistKm = (lat, lon) => {
	let best = Infinity;
	for (let d = -0.5; d <= 0.5; d += 0.01)
		for (let e = -0.5; e <= 0.5; e += 0.01)
			if (reliefAt(meta, relief, lat + d, lon + e) <= 0) best = Math.min(best, Math.hypot(d * 110.574, e * 111.32 * Math.cos((lat * Math.PI) / 180)));
	return best;
};

for (const v of villes) {
	const p = latLonToPixel(meta.image, v.lat, v.lon);
	for (let t = -6; t <= 6; t++) {
		put(p.x + t, p.y, [210, 20, 20]);
		put(p.x, p.y + t, [210, 20, 20]);
		put(p.x + t, p.y + 1, [210, 20, 20]);
		put(p.x + 1, p.y + t, [210, 20, 20]);
	}
	const z = reliefAt(meta, relief, v.lat, v.lon);
	const d = seaDistKm(v.lat, v.lon);
	console.log(`${v.nom.padEnd(18)} px (${p.x.toFixed(0).padStart(3)}, ${p.y.toFixed(0).padStart(4)})  alt grille ${z.toFixed(0).padStart(5)} m  mer à ${Number.isFinite(d) ? d.toFixed(1) + ' km' : '> 50 km'}`);
}
fs.writeFileSync(OUT, PNG.sync.write(png));
console.log(`image de contrôle : ${OUT}`);
