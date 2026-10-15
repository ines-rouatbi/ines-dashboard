#!/usr/bin/env node
/**
 * build-tunisia.mjs — carte de la Tunisie et relief réel du domaine ATOM-AI
 * =========================================================================
 *
 * Cahier des charges §17.1 et V3D1 (relief ombré, côte, nord, échelle, position du
 * domaine signalée « supposée ») et §18.3 point 2 (relief réel du domaine, à comparer
 * au relief synthétique du générateur).
 *
 * Source : Terrain Tiles, AWS Open Data (bucket public `elevation-tiles-prod`), format
 * Terrarium PNG — la même source que la scène Tukai Pro « map ». Sources amont : SRTM,
 * GMTED, ETOPO1 ; Mapzen.
 *   https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
 *   Décodage : élévation (m) = (R·256 + G + B/256) − 32768. Tuiles Web Mercator 256 px.
 *
 * Usage :
 *   cd tools/geo && npm install && node build-tunisia.mjs [--raw <dossier-cache>] [--out <dossier>]
 *   --raw : cache des tuiles brutes (défaut : <tmp>/atom-geo-raw). Une tuile présente
 *           n'est jamais retéléchargée.
 *   --out : dossier de sortie (défaut : ../../web/public/geo).
 *
 * Sorties (dans --out) :
 *   tunisie-relief.f32        Float32 little-endian, ny×nx, [j][i], j=0 au sud, i=0 à l'ouest ;
 *                             nœuds lat = 30,00 + j·0,01 ; lon = 7,40 + i·0,01 (zoom 8 rééchantillonné,
 *                             bilinéaire). Mètres au-dessus de la mer ; mer (et dépressions) ≤ 0 conservées.
 *   tunisie-relief.json       Métadonnées : bbox, nx, ny, pas, min/max, source, attribution, date.
 *   tunisie-ombre.png         Estompage (azimut 315°, élévation 45°), terre #B8925A, mer #CFE0EC,
 *                             côte (isoligne 0 m) #12263A ; nord en haut ; projection équirectangulaire
 *                             à échelle conservée à la latitude moyenne (pixels ~carrés au sol).
 *                             La conversion lat/lon → pixel est décrite dans tunisie-relief.json (« image »).
 *   domaine-relief-reel.f32   Float32 LE, 250×500 ([j][i], j=0 au sud), relief au centre des mailles
 *                             de 100 m du domaine ATOM, zoom 12 (~30 m), bilinéaire.
 *   domaine-relief-reel.json  Statistiques, ancrage SUPPOSÉ, méthode, attribution.
 *
 * Projection du domaine (identique à web/src/geo/tunisia.ts) : plan tangent local au coin
 * sud-ouest (lat0, lon0) ; 1° de latitude = 110 574 m ; 1° de longitude = 111 320·cos(lat0) m ;
 * rotation_deg = rotation de l'axe x du domaine par rapport à l'est géographique, sens
 * trigonométrique (antihoraire). Ancrage par défaut : 36,00 N ; 9,70 E ; rotation 0 — SUPPOSÉ.
 *
 * Dépendance : pngjs (dev, version exacte) pour décoder et encoder les PNG. fetch natif (Node ≥ 18).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (name, def) => {
	const k = args.indexOf(name);
	return k >= 0 && args[k + 1] ? path.resolve(args[k + 1]) : def;
};
const RAW = argOf('--raw', path.join(os.tmpdir(), 'atom-geo-raw'));
const OUT = argOf('--out', path.resolve(HERE, '../../web/public/geo'));

const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const SOURCE = {
	nom: 'Terrain Tiles (AWS Open Data, bucket elevation-tiles-prod), format Terrarium PNG',
	url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
	attribution: 'Terrain Tiles, AWS Open Data — sources SRTM, GMTED, ETOPO1 ; Mapzen',
};

// --- Boîte nationale et grille ---------------------------------------------------------
const BBOX = { lat_min: 30.0, lat_max: 37.6, lon_min: 7.4, lon_max: 11.8 };
const STEP = 0.01;
const Z_COUNTRY = 8;
const IMG_H = 1400;

// --- Domaine ATOM ----------------------------------------------------------------------
export const M_PER_DEG_LAT = 110574;
export const M_PER_DEG_LON_EQ = 111320;
const DOMAIN = { lat0: 36.0, lon0: 9.7, rotation_deg: 0, nx: 500, ny: 250, dx: 100, dy: 100 };
const Z_DOMAIN = 12;

// --- Web Mercator ----------------------------------------------------------------------
const lonToPx = (lon, z) => ((lon + 180) / 360) * 256 * 2 ** z;
const latToPx = (lat, z) => {
	const r = (lat * Math.PI) / 180;
	return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * 2 ** z;
};

// --- Tuiles : téléchargement, cache, décodage -------------------------------------------
const decoded = new Map();
let nDownloaded = 0;
let nCached = 0;

async function fetchTile(z, x, y) {
	const file = path.join(RAW, 'terrarium', String(z), String(x), `${y}.png`);
	if (fs.existsSync(file) && fs.statSync(file).size > 0) {
		nCached++;
		return fs.readFileSync(file);
	}
	fs.mkdirSync(path.dirname(file), { recursive: true });
	let lastErr;
	for (let attempt = 1; attempt <= 4; attempt++) {
		try {
			const res = await fetch(TILE_URL(z, x, y));
			if (!res.ok) throw new Error(`HTTP ${res.status} pour ${z}/${x}/${y}`);
			const buf = Buffer.from(await res.arrayBuffer());
			fs.writeFileSync(file + '.part', buf);
			fs.renameSync(file + '.part', file);
			nDownloaded++;
			return buf;
		} catch (e) {
			lastErr = e;
			await new Promise((r) => setTimeout(r, 500 * attempt));
		}
	}
	throw lastErr;
}

function decodeTerrarium(buf) {
	const png = PNG.sync.read(buf);
	if (png.width !== 256 || png.height !== 256) throw new Error(`tuile ${png.width}×${png.height} inattendue`);
	const out = new Float32Array(256 * 256);
	const d = png.data;
	for (let k = 0; k < 256 * 256; k++) out[k] = d[4 * k] * 256 + d[4 * k + 1] + d[4 * k + 2] / 256 - 32768;
	return out;
}

/** Charge (téléchargement + cache + décodage) toutes les tuiles couvrant la boîte, avec 1 tuile de marge. */
export async function loadTiles(z, lat_min, lat_max, lon_min, lon_max) {
	const n = 2 ** z;
	const x0 = Math.max(0, Math.floor(lonToPx(lon_min, z) / 256) - 1);
	const x1 = Math.min(n - 1, Math.floor(lonToPx(lon_max, z) / 256) + 1);
	const y0 = Math.max(0, Math.floor(latToPx(lat_max, z) / 256) - 1);
	const y1 = Math.min(n - 1, Math.floor(latToPx(lat_min, z) / 256) + 1);
	const jobs = [];
	for (let x = x0; x <= x1; x++)
		for (let y = y0; y <= y1; y++) jobs.push([x, y]);
	// 6 téléchargements simultanés au plus
	for (let k = 0; k < jobs.length; k += 6) {
		await Promise.all(
			jobs.slice(k, k + 6).map(async ([x, y]) => {
				decoded.set(`${z}/${x}/${y}`, decodeTerrarium(await fetchTile(z, x, y)));
			}),
		);
	}
	return { tiles: jobs.length, x0, x1, y0, y1 };
}

/** Élévation d'un pixel global (zoom z), entiers. */
function pixel(z, gx, gy) {
	const tx = Math.floor(gx / 256);
	const ty = Math.floor(gy / 256);
	const t = decoded.get(`${z}/${tx}/${ty}`);
	if (!t) throw new Error(`tuile ${z}/${tx}/${ty} non chargée`);
	return t[(gy - ty * 256) * 256 + (gx - tx * 256)];
}

/** Élévation bilinéaire en (lat, lon) ; les centres des pixels Terrarium sont en (i + 0,5). */
export function elevation(z, lat, lon) {
	const fx = lonToPx(lon, z) - 0.5;
	const fy = latToPx(lat, z) - 0.5;
	const ix = Math.floor(fx);
	const iy = Math.floor(fy);
	const ax = fx - ix;
	const ay = fy - iy;
	const a = pixel(z, ix, iy);
	const b = pixel(z, ix + 1, iy);
	const c = pixel(z, ix, iy + 1);
	const d = pixel(z, ix + 1, iy + 1);
	return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
}

// --- Domaine : plan tangent local -------------------------------------------------------
/** (x, y) en m dans le repère du domaine → (lat, lon). Identique à web/src/geo/tunisia.ts. */
export function domainToLatLon(georef, x, y) {
	const th = (georef.rotation_deg * Math.PI) / 180;
	const e = x * Math.cos(th) - y * Math.sin(th);
	const n = x * Math.sin(th) + y * Math.cos(th);
	return {
		lat: georef.lat0 + n / M_PER_DEG_LAT,
		lon: georef.lon0 + e / (M_PER_DEG_LON_EQ * Math.cos((georef.lat0 * Math.PI) / 180)),
	};
}

// --- Utilitaires --------------------------------------------------------------------------
const hex = (s) => [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16));
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
function writeF32(file, arr) {
	const buf = Buffer.alloc(arr.length * 4);
	for (let k = 0; k < arr.length; k++) buf.writeFloatLE(arr[k], 4 * k);
	fs.writeFileSync(file, buf);
}
function stats(arr) {
	let min = Infinity;
	let max = -Infinity;
	let sum = 0;
	for (const v of arr) {
		if (v < min) min = v;
		if (v > max) max = v;
		sum += v;
	}
	return { min, max, mean: sum / arr.length };
}

// --- 1. Carte nationale -------------------------------------------------------------------
async function buildCountry(today) {
	const info = await loadTiles(Z_COUNTRY, BBOX.lat_min, BBOX.lat_max, BBOX.lon_min, BBOX.lon_max);
	console.log(`zoom ${Z_COUNTRY} : ${info.tiles} tuiles (x ${info.x0}–${info.x1}, y ${info.y0}–${info.y1})`);

	const nx = Math.round((BBOX.lon_max - BBOX.lon_min) / STEP) + 1;
	const ny = Math.round((BBOX.lat_max - BBOX.lat_min) / STEP) + 1;
	const grid = new Float32Array(nx * ny);
	for (let j = 0; j < ny; j++) {
		const lat = BBOX.lat_min + j * STEP;
		for (let i = 0; i < nx; i++) grid[j * nx + i] = elevation(Z_COUNTRY, lat, BBOX.lon_min + i * STEP);
	}
	writeF32(path.join(OUT, 'tunisie-relief.f32'), grid);
	const g = stats(grid);

	// Image : équirectangulaire, échelle horizontale corrigée de cos(latitude moyenne).
	const latMid = (BBOX.lat_min + BBOX.lat_max) / 2;
	const H = IMG_H;
	const W = Math.round((H * (BBOX.lon_max - BBOX.lon_min) * Math.cos((latMid * Math.PI) / 180)) / (BBOX.lat_max - BBOX.lat_min));
	const E = new Float32Array(W * H);
	for (let r = 0; r < H; r++) {
		const lat = BBOX.lat_max - ((r + 0.5) / H) * (BBOX.lat_max - BBOX.lat_min);
		for (let c = 0; c < W; c++) E[r * W + c] = elevation(Z_COUNTRY, lat, BBOX.lon_min + ((c + 0.5) / W) * (BBOX.lon_max - BBOX.lon_min));
	}
	const mPerPxY = ((BBOX.lat_max - BBOX.lat_min) * M_PER_DEG_LAT) / H;
	const mPerPxX = ((BBOX.lon_max - BBOX.lon_min) * M_PER_DEG_LON_EQ * Math.cos((latMid * Math.PI) / 180)) / W;

	// Mer = pixels ≤ 0 m connexes (4-voisinage) aux bords nord et est : exclut les dépressions
	// continentales sous le niveau de la mer (chott el Gharsa, ~ −17 m), qui restent « terre ».
	const sea = new Uint8Array(W * H);
	const stack = [];
	const seed = (k) => {
		if (!sea[k] && E[k] <= 0) {
			sea[k] = 1;
			stack.push(k);
		}
	};
	for (let c = 0; c < W; c++) seed(c);
	for (let r = 0; r < H; r++) seed(r * W + W - 1);
	while (stack.length) {
		const k = stack.pop();
		const r = (k / W) | 0;
		const c = k - r * W;
		if (r > 0) seed(k - W);
		if (r < H - 1) seed(k + W);
		if (c > 0) seed(k - 1);
		if (c < W - 1) seed(k + 1);
	}

	// Estompage : lumière venant de l'azimut 315° (NO), élévation 45°.
	const Z_FACTOR = 3; // exagération verticale de l'ombrage seul (pixels de ~600 m)
	const az = (315 * Math.PI) / 180;
	const el = (45 * Math.PI) / 180;
	const L = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
	const flat = L[2];
	const SAND = hex('#B8925A');
	const SEA = hex('#CFE0EC');
	const INK = hex('#12263A');
	const png = new PNG({ width: W, height: H, colorType: 2, inputHasAlpha: false });
	const at = (r, c) => E[Math.min(H - 1, Math.max(0, r)) * W + Math.min(W - 1, Math.max(0, c))];
	for (let r = 0; r < H; r++) {
		for (let c = 0; c < W; c++) {
			const k = r * W + c;
			let col;
			if (sea[k]) col = SEA;
			else {
				const coast = (r > 0 && sea[k - W]) || (r < H - 1 && sea[k + W]) || (c > 0 && sea[k - 1]) || (c < W - 1 && sea[k + 1]);
				if (coast) col = INK;
				else {
					const dzdE = (Z_FACTOR * (at(r, c + 1) - at(r, c - 1))) / (2 * mPerPxX);
					const dzdN = (Z_FACTOR * (at(r - 1, c) - at(r + 1, c))) / (2 * mPerPxY);
					const nn = Math.hypot(dzdE, dzdN, 1);
					const hs = Math.max(0, (-dzdE * L[0] - dzdN * L[1] + L[2]) / nn);
					const f = Math.min(1.22, 0.3 + (0.7 * hs) / flat); // terrain plat → couleur sable exacte
					col = SAND.map((v) => Math.min(255, Math.round(v * f)));
				}
			}
			png.data[4 * k] = col[0];
			png.data[4 * k + 1] = col[1];
			png.data[4 * k + 2] = col[2];
			png.data[4 * k + 3] = 255;
		}
	}
	fs.writeFileSync(path.join(OUT, 'tunisie-ombre.png'), PNG.sync.write(png, { colorType: 2, deflateLevel: 9 }));

	// Contrôle : pic du Jebel Chambi (point culminant, 1 544 m), source zoom 8 échantillonnée finement
	// et grille à 0,01° (les nœuds tombent à ~1 km du sommet, d'où un écrêtage).
	let chambiSrc = -Infinity;
	let chambiGrid = -Infinity;
	for (let la = 35.15; la <= 35.25; la += 0.002)
		for (let lo = 8.63; lo <= 8.73; lo += 0.002) chambiSrc = Math.max(chambiSrc, elevation(Z_COUNTRY, la, lo));
	for (let j = Math.round((35.15 - BBOX.lat_min) / STEP); j <= Math.round((35.25 - BBOX.lat_min) / STEP); j++)
		for (let i = Math.round((8.63 - BBOX.lon_min) / STEP); i <= Math.round((8.73 - BBOX.lon_min) / STEP); i++) chambiGrid = Math.max(chambiGrid, grid[j * nx + i]);

	const meta = {
		nom: 'Tunisie — relief SRTM (Terrain Tiles), grille régulière lat/lon',
		bbox: BBOX,
		nx,
		ny,
		pas_deg: STEP,
		pas_m_approx: { nord_sud: round(STEP * M_PER_DEG_LAT, 0), est_ouest_a_lat_moyenne: round(STEP * M_PER_DEG_LON_EQ * Math.cos((latMid * Math.PI) / 180), 0) },
		noeuds: 'lat_j = lat_min + j·pas ; lon_i = lon_min + i·pas (nœuds, bords inclus)',
		fichier: 'tunisie-relief.f32',
		format: 'Float32 little-endian, [j][i], j=0 au sud, i=0 à l ouest',
		unite: 'm au-dessus du niveau de la mer ; mer et dépressions continentales ≤ 0 conservées (bathymétrie ETOPO1 en mer)',
		min_m: round(g.min, 1),
		max_m: round(g.max, 1),
		image: {
			fichier: 'tunisie-ombre.png',
			largeur_px: W,
			hauteur_px: H,
			bbox: BBOX,
			projection: 'équirectangulaire ; nord en haut ; x ∝ longitude, y ∝ latitude ; échelle horizontale corrigée de cos(latitude moyenne) pour des pixels quasi carrés au sol',
			lat_moyenne: latMid,
			conversion: 'px = (lon − lon_min)/(lon_max − lon_min)·largeur ; py = (lat_max − lat)/(lat_max − lat_min)·hauteur (bords des pixels)',
			m_par_px: { x: round(mPerPxX, 1), y: round(mPerPxY, 1) },
			estompage: { azimut_deg: 315, elevation_deg: 45, exageration_ombrage: Z_FACTOR },
			couleurs: { relief: '#B8925A', mer: '#CFE0EC', cote: '#12263A' },
			cote: 'isoligne 0 m : pixels de terre au contact (4-voisinage) de la mer ; mer = pixels ≤ 0 m reliés aux bords nord et est (les dépressions continentales sous 0 m restent en terre)',
		},
		source: { ...SOURCE, zoom: Z_COUNTRY, resolution_native_m_approx: round((40075016.7 * Math.cos((latMid * Math.PI) / 180)) / (256 * 2 ** Z_COUNTRY), 0), reechantillonnage: 'bilinéaire' },
		controles: {
			jebel_chambi: {
				reference_m: 1544,
				source_zoom8_m: round(chambiSrc, 0),
				grille_0_01deg_m: round(chambiGrid, 0),
				note: 'la grille à ~1 km écrête les sommets ; utiliser la source pour les altitudes de sommets',
			},
		},
		date_extraction: today,
		outil: 'tools/geo/build-tunisia.mjs',
	};
	fs.writeFileSync(path.join(OUT, 'tunisie-relief.json'), JSON.stringify(meta, null, 2) + '\n');
	console.log(`relief national : ${nx}×${ny}, min ${meta.min_m} m, max ${meta.max_m} m ; image ${W}×${H}`);
	console.log(`Jebel Chambi : source z8 ${round(chambiSrc, 0)} m, grille ${round(chambiGrid, 0)} m (réf. 1 544 m)`);
	return meta;
}

// --- 2. Domaine ATOM ---------------------------------------------------------------------
async function buildDomain(today) {
	const { lat0, lon0, nx, ny, dx, dy } = DOMAIN;
	const corners = [
		[0, 0],
		[nx * dx, 0],
		[0, ny * dy],
		[nx * dx, ny * dy],
	].map(([x, y]) => domainToLatLon(DOMAIN, x, y));
	const lats = corners.map((p) => p.lat);
	const lons = corners.map((p) => p.lon);
	const info = await loadTiles(Z_DOMAIN, Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons));
	console.log(`zoom ${Z_DOMAIN} : ${info.tiles} tuiles (x ${info.x0}–${info.x1}, y ${info.y0}–${info.y1})`);

	const grid = new Float32Array(nx * ny);
	for (let j = 0; j < ny; j++) {
		for (let i = 0; i < nx; i++) {
			const p = domainToLatLon(DOMAIN, (i + 0.5) * dx, (j + 0.5) * dy);
			grid[j * nx + i] = elevation(Z_DOMAIN, p.lat, p.lon);
		}
	}
	writeF32(path.join(OUT, 'domaine-relief-reel.f32'), grid);
	const s = stats(grid);
	let below0 = 0;
	for (const v of grid) if (v <= 0) below0++;
	const meta = {
		nom: 'Relief réel du domaine ATOM-AI (ancrage SUPPOSÉ)',
		ancrage: {
			lat0,
			lon0,
			rotation_deg: DOMAIN.rotation_deg,
			coin: 'sud-ouest',
			suppose: true,
			avertissement: 'Position SUPPOSÉE : la position réelle du domaine n a pas été fournie (tâche 61). À afficher « position supposée ».',
		},
		domaine: { longueur_est_m: nx * dx, largeur_nord_m: ny * dy, coins_latlon: { so: corners[0], se: corners[1], no: corners[2], ne: corners[3] } },
		grille: { nx, ny, dx_m: dx, dy_m: dy, centres: 'x = 50 … 49 950 m ; y = 50 … 24 950 m (centres de maille)' },
		fichier: 'domaine-relief-reel.f32',
		format: 'Float32 little-endian, ny×nx = 250×500, [j][i], j=0 au sud, i=0 à l ouest',
		unite: 'm au-dessus du niveau de la mer',
		min_m: round(s.min, 1),
		max_m: round(s.max, 1),
		moyenne_m: round(s.mean, 1),
		mailles_sous_0m: below0,
		methode:
			'Plan tangent local au coin sud-ouest : lat = lat0 + n/110574 ; lon = lon0 + e/(111320·cos(lat0)), avec (e, n) = rotation de (x, y) de rotation_deg (sens antihoraire depuis l est) ; échantillonnage bilinéaire des tuiles Terrarium au zoom 12 (~31 m à 36° N) au centre de chaque maille de 100 m.',
		source: { ...SOURCE, zoom: Z_DOMAIN },
		date_extraction: today,
		outil: 'tools/geo/build-tunisia.mjs',
	};
	fs.writeFileSync(path.join(OUT, 'domaine-relief-reel.json'), JSON.stringify(meta, null, 2) + '\n');
	console.log(`domaine : min ${meta.min_m} m, max ${meta.max_m} m, moyenne ${meta.moyenne_m} m, mailles ≤ 0 : ${below0}`);
	return meta;
}

async function main() {
	fs.mkdirSync(RAW, { recursive: true });
	fs.mkdirSync(OUT, { recursive: true });
	const today = new Date().toISOString().slice(0, 10);
	console.log(`cache : ${RAW}\nsortie : ${OUT}`);
	await buildCountry(today);
	await buildDomain(today);
	console.log(`tuiles téléchargées : ${nDownloaded}, lues en cache : ${nCached}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}
