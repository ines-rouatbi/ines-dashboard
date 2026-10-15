// Génère les 3 instantanés de test du contrat v1 (révision 2) : normal, capteur_en_derive, gpu_eteint.
// Données de TEST (versions.data_kind = "test"), déterministes, sur une grille réduite (100 × 50, 500 m)
// couvrant à peu près le domaine de v7 (49,5 × 24,5 km, 12 niveaux réels au-dessus de la mer). Elles servent
// à développer et tester le front et le service sans GPU ; elles ne doivent jamais être affichées comme des
// résultats du modèle. Le « modèle » des fixtures est fictif : son sha256 est celui d'une chaîne fixe.
//
// Usage : node contract/tools/make-fixtures.mjs   (réécrit contract/fixtures/<scénario>/)
//
// Disposition d'un dossier de scénario = disposition R2 du Worker :
//
//   <scénario>/                          ≙ snapshots/<snapshot_id>/ dans R2
//     publish-manifest.json              corps du POST /v1/publish/<id>/commit (liste tous les fichiers ci-dessous)
//     snapshot.json quality.json alerts.json stations.json wind-farm.json data-quality.json
//     fields/<var>.f32                   Float32 LE, nz·ny·nx, index k·ny·nx + j·nx + i, NaN ⇔ z − relief < min_agl_m
//     fields/<var>.u8                    uint8 (status 0/1 ; coverage, reliability : octet/254) ; 255 ⇔ absent
//     profiles/<point_id>.json           profils précalculés aux points déclarés (snapshot.points)
//     windrose/<site_id>.json            roses des vents précalculées
//     models/<sha8>/                     ≙ models/<sha8>/ dans R2 (identique dans les 3 scénarios)
//       model-manifest.json              corps du POST /v1/publish/model/<sha8>/commit
//       meta.json terrain.f32            fichiers par modèle (hors manifeste d'instantané)
//     latest.json times.json             réponses que le Worker calcule (non publiées, pour le front)
//
// Nœuds : (i, j) en x = x0 + i·dx, y = y0 + j·dy (x0 = y0 = 0). Réseau : treillis synthétique de capteurs
// à 50 m (c<i>_<j>), 25 m au-dessus du sol ; stations.json ne liste que les capteurs signalés.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const NX = 100, NY = 50, DX = 500, DY = 500, X0 = 0, Y0 = 0, MIN_AGL = 5;
const LEVELS = [25, 50, 75, 100, 150, 200, 300, 400, 500, 650, 800, 1000]; // m au-dessus de la mer (v7)
const NZ = LEVELS.length, NN = NX * NY;
const HUB = 120;
const SENSOR_DX = 50, SENSOR_AGL = 25, STATUS_DZ = 15;
const LAT0 = 36.0, LON0 = 9.7, ROT = 0;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const MODEL_SHA256 = sha('contrat ATOM v1 : modèle fictif des instantanés de test');
const SHA8 = MODEL_SHA256.slice(0, 8);
const VERSIONS = { model: 'fixture-test', model_sha256: MODEL_SHA256, norm: sha('norm_stats fictif des instantanés de test').slice(0, 8), data: 'synthetique_contrat_v1', data_kind: 'test', contract: '1.0' };

const F32_VARS = ['u', 'v', 'w', 'speed', 'sigma_speed', 'sigma_u', 'sigma_v', 'sigma_w'];
const U8_VARS = ['coverage', 'reliability', 'status'];
const VARS = [...F32_VARS, ...U8_VARS];
const ENCODING = Object.fromEntries([
	...F32_VARS.map((v) => [v, { dtype: 'float32', file: `fields/${v}.f32`, nodata: 'NaN', scale: null }]),
	['coverage', { dtype: 'uint8', file: 'fields/coverage.u8', nodata: 255, scale: 1 / 254 }],
	['reliability', { dtype: 'uint8', file: 'fields/reliability.u8', nodata: 255, scale: 1 / 254 }],
	['status', { dtype: 'uint8', file: 'fields/status.u8', nodata: 255, scale: 1 }],
]);

const rng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const rd = (n) => (v) => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10 ** n) / 10 ** n);
const r2 = rd(2), r3 = rd(3), r4 = rd(4);
const nodeX = (i) => X0 + i * DX, nodeY = (j) => Y0 + j * DY;
const X_MAX = nodeX(NX - 1), Y_MAX = nodeY(NY - 1);
// Direction météo, arrondie à 0,01° AVANT le modulo (m4).
const dirFrom = (u, v) => { if (Math.hypot(u, v) < 0.2) return null; const raw = 270 - Math.atan2(v, u) * 180 / Math.PI; return ((Math.round(raw * 100) / 100) % 360 + 360) % 360; };

// Relief : crête diagonale + colline, environ 19 à 600 m.
function terrainAt(x, y) {
	const fx = x / (NX * DX), fy = y / (NY * DY);
	const d = fx - 0.15 - fy * 0.7;
	return 19 + Math.exp(-(d * d) / (2 * 0.08 * 0.08)) * 560 + Math.exp(-(((fx - 0.75) ** 2) + ((fy - 0.3) ** 2)) / 0.01) * 180;
}

// Vent synthétique : profil logarithmique, rotation avec la hauteur, accélération sur le relief.
// La règle NaN (z − relief < min_agl_m) est appliquée par l'appelant, sur le relief Float32 publié.
function windAt(x, y, zAsl, t) {
	const zg = terrainAt(x, y), agl = zAsl - zg;
	const uref = 7.5 + 2.5 * Math.sin(t);
	const base = uref * Math.log(Math.max(agl, 1) / 0.1) / Math.log(100 / 0.1);
	const speed = Math.max(0.3, base * (1 + 0.4 * (zg - 19) / 660 * Math.exp(-agl / 250)));
	const dir = (290 + 25 * Math.min(agl, 1000) / 1000) % 360;
	const rad = (270 - dir) * Math.PI / 180;
	return { u: speed * Math.cos(rad), v: speed * Math.sin(rad), w: 0.6 * Math.sin(x / 4000) * Math.exp(-agl / 300) * (zg - 19) / 660, speed, dir, agl };
}

// Géoréférencement : plan tangent équirectangulaire au nœud (0, 0).
function georef() {
	const mLon = 111320 * Math.cos(LAT0 * Math.PI / 180), th = ROT * Math.PI / 180;
	const corners = [[X0, Y0], [X_MAX, Y0], [X0, Y_MAX], [X_MAX, Y_MAX]].map(([x, y]) => {
		const e = x * Math.cos(th) - y * Math.sin(th), n = x * Math.sin(th) + y * Math.cos(th);
		return [LAT0 + n / 110574, LON0 + e / mLon];
	});
	const lats = corners.map((c) => c[0]), lons = corners.map((c) => c[1]);
	return { lat0: LAT0, lon0: LON0, rotation_deg: ROT, projection: 'equirectangulaire_tangent_noeud_0_0', m_per_deg_lat: 110574, m_per_deg_lon: r3(mLon),
		bounds: { lat_min: rd(6)(Math.min(...lats)), lat_max: rd(6)(Math.max(...lats)), lon_min: rd(6)(Math.min(...lons)), lon_max: rd(6)(Math.max(...lons)) }, suppose: true };
}

// Treillis de capteurs : c<i>_<j> en (i·50, j·50).
const SENSORS_NX = Math.floor(X_MAX / SENSOR_DX) + 1, SENSORS_NY = Math.floor(Y_MAX / SENSOR_DX) + 1;
const SENSORS_TOTAL = SENSORS_NX * SENSORS_NY;
const MUTE = { id: 'c880_420', si: 880, sj: 420 }, DRIFT = { id: 'c340_200', si: 340, sj: 200 };
const sensorXY = (s) => ({ x: s.si * SENSOR_DX, y: s.sj * SENSOR_DX });

const POINTS = [
	{ id: 'T-01', kind: 'eolienne', name: 'Éolienne virtuelle 1', x_m: 12000, y_m: 8000, windrose: true },
	{ id: 'T-02', kind: 'eolienne', name: 'Éolienne virtuelle 2', x_m: 14500, y_m: 9500, windrose: false },
	{ id: 'T-03', kind: 'eolienne', name: 'Éolienne virtuelle 3', x_m: 30000, y_m: 15000, windrose: false },
	{ id: 'S-01', kind: 'site', name: 'Site candidat nord-est', x_m: 44000, y_m: 21000, windrose: true },
];

// Fichiers par modèle (identiques dans les 3 scénarios).
const terrain = new Float32Array(NN);
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) terrain[j * NX + i] = terrainAt(nodeX(i), nodeY(j));
const below = (k, idx) => LEVELS[k] - terrain[idx] < MIN_AGL;
let VALID = 0; const VALID_BY_LEVEL = [];
for (let k = 0; k < NZ; k++) { let n = 0; for (let idx = 0; idx < NN; idx++) if (!below(k, idx)) n++; VALID += n; VALID_BY_LEVEL.push(n / NN); }
const terrainBuf = Buffer.from(terrain.buffer);
const META = {
	versions: VERSIONS,
	grid: { nx: NX, ny: NY, nz: NZ, dx_m: DX, dy_m: DY, x0_m: X0, y0_m: Y0, min_agl_m: MIN_AGL, levels_asl_m: LEVELS, order: 'zyx_sud_ouest', valid_nodes: VALID, valid_fraction_by_level: VALID_BY_LEVEL.map(r4) },
	domain: { x_max_m: X_MAX, y_max_m: Y_MAX, origin: 'noeud_0_0_sud_ouest', crs: 'plan-tangent-local' },
	georef: georef(),
	terrain: { min_m: r2(Math.min(...terrain)), max_m: r2(Math.max(...terrain)), href: `/v1/terrain/${SHA8}`, sha256: sha(terrainBuf), bytes: terrainBuf.length, source: 'instantané de test synthétique (contract/tools/make-fixtures.mjs)' },
	fields: VARS,
	encoding: ENCODING,
	units: { u: 'm/s', v: 'm/s', w: 'm/s', speed: 'm/s', sigma_speed: 'm/s', sigma_u: 'm/s', sigma_v: 'm/s', sigma_w: 'm/s', coverage: '0-1', reliability: '0-1', status: '1 mesuré / 0 estimé', altitude: 'm au-dessus de la mer' },
	conventions: { u: 'positif_est', v: 'positif_nord', w: 'positif_haut', direction: 'meteo_provenance', altitude: 'asl', nodata: 'null_json_nan_f32_255_u8' },
};

function build(scenario) {
	const dir = path.join(ROOT, scenario);
	fs.rmSync(dir, { recursive: true, force: true });
	const t = 1.1, validTime = '2025-01-12T12:00:00Z';
	const id = `test_${scenario}_${SHA8}`;
	const muted = scenario !== 'normal', drifting = scenario === 'capteur_en_derive';
	const files = [];
	const write = (rel, data) => {
		const buf = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data, null, 2) + '\n');
		fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
		fs.writeFileSync(path.join(dir, rel), buf);
		return { path: rel, sha256: sha(buf), bytes: buf.length };
	};
	const put = (rel, data) => files.push(write(rel, data));

	// Fichiers par modèle et leur manifeste.
	const mdir = `models/${SHA8}`;
	const modelFiles = [write(`${mdir}/meta.json`, META), write(`${mdir}/terrain.f32`, terrainBuf)].map((f) => ({ ...f, path: f.path.slice(mdir.length + 1) }));
	write(`${mdir}/model-manifest.json`, { model_sha8: SHA8, versions: VERSIONS, files: modelFiles });

	// Champs : un fichier par variable, tous niveaux.
	const F = Object.fromEntries(F32_VARS.map((v) => [v, new Float32Array(NZ * NN)]));
	const U = Object.fromEntries(U8_VARS.map((v) => [v, new Uint8Array(NZ * NN).fill(255)]));
	const mx = sensorXY(MUTE);
	const levelStats = [];
	for (let k = 0; k < NZ; k++) {
		let nValid = 0, el = 0, mo = 0, fa = 0; const sig = [], cov = [];
		for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
			const idx = j * NX + i, at = k * NN + idx, x = nodeX(i), y = nodeY(j);
			if (below(k, idx)) { for (const v of F32_VARS) F[v][at] = NaN; continue; }
			const wv = windAt(x, y, LEVELS[k], t);
			nValid++;
			let coverage = Math.exp(-wv.agl / 800) * (1 - 0.85 * Math.exp(-((x - 44000) ** 2 + (y - 21000) ** 2) / (2 * 3000 ** 2)));
			if (muted) coverage *= 1 - 0.5 * Math.exp(-((x - mx.x) ** 2 + (y - mx.y) ** 2) / (2 * 1500 ** 2));
			const qc = Math.round(Math.min(1, Math.max(0, coverage)) * 254), c = qc / 254;
			const sigma = 0.15 + 0.9 * (1 - c);
			const qr = Math.round(Math.min(1, Math.max(0, 1 - sigma / 1.2)) * 254), rel = qr / 254;
			// D7 : colonne portant un capteur visible (toutes, treillis à 50 m) et |z_nœud − z_capteur| ≤ 15 m.
			const sensorVisible = !(muted && 10 * i === MUTE.si && 10 * j === MUTE.sj);
			const measured = sensorVisible && Math.abs(LEVELS[k] - (terrain[idx] + SENSOR_AGL)) <= STATUS_DZ;
			F.u[at] = wv.u; F.v[at] = wv.v; F.w[at] = wv.w; F.speed[at] = Math.hypot(Math.fround(wv.u), Math.fround(wv.v));
			F.sigma_speed[at] = sigma; F.sigma_u[at] = sigma; F.sigma_v[at] = sigma * 0.9; F.sigma_w[at] = sigma * 0.1;
			U.coverage[at] = qc; U.reliability[at] = qr; U.status[at] = measured ? 1 : 0;
			if (rel >= 0.75) el++; else if (rel >= 0.5) mo++; else fa++;
			sig.push(sigma); cov.push(c);
		}
		const med = (a) => { if (!a.length) return null; const s = [...a].sort((p, q) => p - q); return r3(s[s.length >> 1]); };
		levelStats.push({ z_asl_m: LEVELS[k], valid_nodes: nValid, share_elevee: nValid ? r3(el / nValid) : null, share_moyenne: nValid ? r3(mo / nValid) : null, share_faible: nValid ? r3(fa / nValid) : null, sigma_speed_median: med(sig), coverage_median: med(cov) });
	}
	for (const v of F32_VARS) put(ENCODING[v].file, Buffer.from(F[v].buffer));
	for (const v of U8_VARS) put(ENCODING[v].file, Buffer.from(U[v].buffer));

	// Capteurs signalés (treillis : seulement les états autres que « active »).
	const flagged = [];
	if (muted) flagged.push({ id: MUTE.id, x_m: mx.x, y_m: mx.y, height_agl_m: SENSOR_AGL, state: 'muette', last_seen: '2025-01-12T09:40:00Z', speed: null, dir_from_deg: null, bias_ms: null, quality_score: 0 });
	if (drifting) {
		const p = sensorXY(DRIFT), wv = windAt(p.x, p.y, terrainAt(p.x, p.y) + SENSOR_AGL, t);
		flagged.push({ id: DRIFT.id, x_m: p.x, y_m: p.y, height_agl_m: SENSOR_AGL, state: 'derive', last_seen: validTime, speed: r2(wv.speed + 1.85), dir_from_deg: r2(wv.dir), bias_ms: 1.85, quality_score: 0.55 });
	}
	put('stations.json', { items: flagged });
	const nState = (s) => flagged.filter((f) => f.state === s).length;
	const network = { kind: 'treillis_synthetique', sensors_total: SENSORS_TOTAL, sensors_visible: SENSORS_TOTAL - nState('muette') - nState('exclue'), unit: 'capteur' };

	// Alertes : id = sha8(kind|cible), stable d'un instantané à l'autre.
	const alerts = [];
	const alert = (a) => alerts.push({ id: sha(`${a.kind}|${a.target}`).slice(0, 8), station_id: null, turbine_id: null, location: null, value: null, threshold: null, unit: null, ...a });
	if (muted) alert({ level: 'avertissement', kind: 'station_muette', target: MUTE.id, title: `Capteur ${MUTE.id} muet`, cause: 'Aucune mesure depuis 2 h 20', recommendation: 'Planifier une intervention sur le capteur', raised_at: '2025-01-12T10:10:00Z', status: 'ouverte', station_id: MUTE.id, location: { x_m: mx.x, y_m: mx.y }, value: 140, threshold: 30, unit: 'min' });
	if (drifting) alert({ level: 'important', kind: 'capteur_derive', target: DRIFT.id, title: `Capteur ${DRIFT.id} en dérive`, cause: 'Écart persistant de +1,85 m/s entre la mesure et la reconstruction sans le capteur (6 instants)', recommendation: "Planifier un étalonnage ; réduire le poids du capteur dans l'intervalle", raised_at: '2025-01-12T11:00:00Z', status: 'ouverte', station_id: DRIFT.id, location: { x_m: sensorXY(DRIFT).x, y_m: sensorXY(DRIFT).y }, value: 1.85, threshold: 1.0, unit: 'm/s' });
	alert({ level: 'information', kind: 'zone_mal_couverte', target: 'm22_10', title: 'Zone mal couverte au nord-est', cause: 'Indice de couverture < 0,2 et incertitude élevée', recommendation: 'Emplacement prioritaire pour un nouveau capteur', raised_at: '2025-01-12T08:00:00Z', status: 'ouverte', location: { x_m: 44000, y_m: 21000 }, value: 0.17, threshold: 0.2 });
	alert({ level: 'information', kind: 'cisaillement', target: 'T-03', title: 'Cisaillement marqué sur T-03 (résorbé)', cause: 'Exposant de cisaillement > 0,3 sur le rotor', recommendation: 'Aucune action : alerte close', raised_at: '2025-01-12T06:00:00Z', status: 'close', turbine_id: 'T-03', location: { x_m: 30000, y_m: 15000 }, value: 0.34, threshold: 0.3 });
	put('alerts.json', { items: alerts });
	const open = (lv) => alerts.filter((a) => a.level === lv && a.status === 'ouverte').length;
	const nOpen = alerts.filter((a) => a.status === 'ouverte').length;

	// Parc éolien virtuel (M5) : REWS pondéré par l'aire, α, veer, quantiles du parc sur les membres.
	const MODEL = 'generique-2MW';
	const pc = { speed_ms: [0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 25, 25.01], power_kw: [0, 0, 70, 180, 340, 560, 840, 1180, 1520, 1820, 2000, 2000, 0] };
	const power = (s) => { if (s < 3 || s > 25) return 0; for (let q = 1; q < pc.speed_ms.length; q++) if (s <= pc.speed_ms[q]) { const a = pc.speed_ms[q - 1], b = pc.speed_ms[q]; return pc.power_kw[q - 1] + (pc.power_kw[q] - pc.power_kw[q - 1]) * (s - a) / (b - a); } return 0; };
	const Z = [-1.6, -1.2, -0.8, -0.4, 0, 0.4, 0.8, 1.2, 1.6]; // membres de l'ensemble (écarts réduits)
	const quant = (a, q) => { const s = [...a].sort((p, r) => p - r), x = q * (s.length - 1), lo = Math.floor(x); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (x - lo); };
	const R = 45, sg = 0.35;
	const farmMembers = Z.map(() => 0);
	const turbines = POINTS.filter((p) => p.kind === 'eolienne').map((p) => {
		const zg = terrainAt(p.x_m, p.y_m), hub = windAt(p.x_m, p.y_m, zg + HUB, t), lo = windAt(p.x_m, p.y_m, zg + HUB - R, t), hi = windAt(p.x_m, p.y_m, zg + HUB + R, t);
		let num = 0, den = 0;
		for (let q = -4; q <= 4; q++) { const h = q * R / 4.5, wgt = 2 * Math.sqrt(R * R - h * h); num += wgt * windAt(p.x_m, p.y_m, zg + HUB + h, t).speed ** 3; den += wgt; }
		const rews = Math.cbrt(num / den);
		const pm = Z.map((z) => power(Math.max(0, rews + sg * z)));
		pm.forEach((v, m) => { farmMembers[m] += v; });
		const st = rews < 3 ? 'arret_vent_faible' : rews > 25 ? 'arret_vent_fort' : 'production';
		const iv = (s) => ({ p10: r2(Math.max(0, s - 1.2816 * sg)), p50: r2(s), p90: r2(s + 1.2816 * sg) });
		return { id: p.id, name: p.name, x_m: p.x_m, y_m: p.y_m, virtual: true, model: MODEL, hub_agl_m: HUB, rotor_d_m: 2 * R, rated_kw: 2000, cut_in_ms: 3, cut_out_ms: 25,
			hub_speed: iv(hub.speed), rews: iv(rews), shear_alpha: r3(Math.log(hi.speed / lo.speed) / Math.log((HUB + R) / (HUB - R))),
			veer_deg: r2(((hi.dir - lo.dir + 540) % 360) - 180), power_kw: { p10: Math.round(quant(pm, 0.1)), p50: Math.round(quant(pm, 0.5)), p90: Math.round(quant(pm, 0.9)) },
			state: st, air_density: 1.225, air_density_source: 'atmosphere_standard' };
	});
	put('wind-farm.json', { turbines, farm: { power_kw: { p10: Math.round(quant(farmMembers, 0.1)), p50: Math.round(quant(farmMembers, 0.5)), p90: Math.round(quant(farmMembers, 0.9)) }, rated_kw: 2000 * turbines.length, n_production: turbines.filter((tb) => tb.state === 'production').length, n_arret: turbines.filter((tb) => tb.state !== 'production').length }, power_curves: { [MODEL]: pc } });

	// Profils précalculés aux points déclarés, lus dans les champs publiés au nœud le plus proche (D5).
	const unc = { method: 'ensemble-masquage-v1', members: 8, calibrated: true, scale_factor: 1.3, coverage_80_validation: 0.81 };
	for (const p of POINTS) {
		const i = Math.round((p.x_m - X0) / DX), j = Math.round((p.y_m - Y0) / DY), idx = j * NX + i, zt = terrain[idx];
		const sensor = !(muted && 10 * i === MUTE.si && 10 * j === MUTE.sj) ? { id: `c${10 * i}_${10 * j}`, distance_m: 0 } : { id: `c${10 * i + 1}_${10 * j}`, distance_m: SENSOR_DX };
		put(`profiles/${p.id}.json`, { point_id: p.id, i, j, x_m: nodeX(i), y_m: nodeY(j), z_terrain_m: r3(zt), nearest_sensor: sensor, uncertainty: unc,
			levels: LEVELS.map((z, k) => {
				const at = k * NN + idx, base = { z_asl_m: z, z_agl_m: r3(z - zt) };
				if (below(k, idx)) return { ...base, below_terrain: true, u: null, v: null, w: null, speed: null, sigma_speed: null, dir_from_deg: null, speed_interval: { p10: null, p50: null, p90: null }, status: null, coverage: null, reliability: null, reliability_class: null };
				const s = r3(F.speed[at]), sgm = r3(F.sigma_speed[at]), rel = U.reliability[at] / 254;
				return { ...base, below_terrain: false, u: r3(F.u[at]), v: r3(F.v[at]), w: r3(F.w[at]), speed: s, sigma_speed: sgm, dir_from_deg: dirFrom(F.u[at], F.v[at]),
					speed_interval: { p10: r3(Math.max(0, s - 1.2816 * sgm)), p50: s, p90: r3(s + 1.2816 * sgm) }, status: U.status[at] === 1 ? 'mesure' : 'estime',
					coverage: r4(U.coverage[at] / 254), reliability: r4(rel), reliability_class: rel >= 0.75 ? 'elevee' : rel >= 0.5 ? 'moyenne' : 'faible' };
			}) });
	}

	// Roses des vents par site (36 instants seulement → statistiquement faible, volontaire).
	const edges = [0, 3, 6, 9, 12, 15, 25], NS = 12, W = 360 / NS;
	for (const p of POINTS.filter((q) => q.windrose)) {
		const cnt = Array.from({ length: NS }, () => Array(edges.length - 1).fill(0)), R1 = rng(11 + p.x_m);
		const N = 36;
		for (let n = 0; n < N; n++) {
			const wv = windAt(p.x_m, p.y_m, terrainAt(p.x_m, p.y_m) + HUB, n * 0.4);
			const d = (wv.dir + (R1() - 0.5) * 60 + 360) % 360, sec = Math.round(d / W) % NS;
			const b = Math.max(0, edges.findIndex((e, q) => q > 0 && wv.speed < e) - 1);
			cnt[sec][b]++;
		}
		put(`windrose/${p.id}.json`, { site_id: p.id, x_m: p.x_m, y_m: p.y_m, hub_agl_m: HUB, period: { from: '2025-01-01T00:00:00Z', to: validTime }, n_valid: N, sector_width_deg: W, speed_bin_edges_ms: edges,
			sectors: cnt.map((bins, q) => ({ dir_center_deg: q * W, frequency: r4(bins.reduce((a, b) => a + b, 0) / N), speed_bins: bins.map((c) => r4(c / N)) })),
			weibull: { k: 2.1, c_ms: 9.4, aep_mwh: null, capacity_factor: null } });
	}

	// Fiabilité agrégée (M2) et qualité des entrées (M3).
	put('quality.json', { uncertainty: unc, by_level: levelStats, calibration: { evaluated_on: 'instantané de test synthétique : pas une mesure', coverage_80: 0.81, corr_error_sigma: 0.42, dso6_pass: true } });
	const interp = Math.round(SENSORS_TOTAL * 0.012);
	put('data-quality.json', { period: { from: '2025-01-12T11:50:00Z', to: validTime }, files: drifting ? { received: 6, accepted: 5, rejected: 1, quarantined: 0 } : { received: 6, accepted: 6, rejected: 0, quarantined: 0 },
		sensors: { total: SENSORS_TOTAL, observed: network.sensors_visible - interp, interpolated: interp, muette: nState('muette'), exclue: nState('exclue') }, interpolated_fraction: r4(interp / SENSORS_TOTAL),
		issues: [{ kind: 'valeur_interpolee', target: 'treillis', count: interp, detail: 'Capteurs sans mesure directe, interpolés (source_type)' },
			...(muted ? [{ kind: 'capteur_muet', target: MUTE.id, count: 1, detail: 'Aucune mesure depuis 09:40' }] : []),
			...(drifting ? [{ kind: 'fichier_rejete', target: 'aneo_2025-01-12T1150.csv', count: 1, detail: 'Horodatage hors période' }] : [])] });

	// D10 : vent au moyeu sur le DOMAINE, à HUB m au-dessus du sol (interpolation linéaire de speed par colonne).
	let hs = 0, hn = 0, hmax = 0;
	for (let idx = 0; idx < NN; idx++) {
		const z = terrain[idx] + HUB;
		for (let k = 0; k + 1 < NZ; k++) {
			if (LEVELS[k] > z || LEVELS[k + 1] < z) continue;
			const a = F.speed[k * NN + idx], b = F.speed[(k + 1) * NN + idx];
			if (Number.isNaN(a) || Number.isNaN(b)) break;
			const s = a + (b - a) * (z - LEVELS[k]) / (LEVELS[k + 1] - LEVELS[k]);
			hs += s; hn++; hmax = Math.max(hmax, s); break;
		}
	}
	const validTotal = levelStats.reduce((a, l) => a + l.valid_nodes, 0);
	const high = levelStats.reduce((a, l) => a + (l.share_elevee ?? 0) * l.valid_nodes, 0);

	put('snapshot.json', { snapshot_id: id, valid_time: validTime, versions: VERSIONS, network,
		kpi: { share_high_reliability: r3(high / validTotal), reconstruction_ms: 91,
			open_alerts: { information: open('information'), avertissement: open('avertissement'), important: open('important'), critique: open('critique') },
			hub_wind_mean_ms: hn ? r2(hs / hn) : null, hub_wind_max_ms: hn ? r2(hmax) : null, hub_height_agl_m: HUB },
		// gpu_eteint exerce le cas « bloc non disponible » (B5) : physics = null.
		physics: scenario === 'gpu_eteint' ? null : { mass_residual_rms: 2.6e-5, mass_residual_p95: 5.97e-5, mass_residual_ok: true, ground_condition_rms_ms: 0.004, rho_source: 'atmosphere_standard' },
		stations_summary: { active: SENSORS_TOTAL - flagged.length, suspecte: nState('suspecte'), muette: nState('muette'), derive: nState('derive'), exclue: nState('exclue') },
		scenario: null,
		points: POINTS.map((p) => ({ id: p.id, kind: p.kind, name: p.name, x_m: p.x_m, y_m: p.y_m, profile: true, windrose: p.windrose })),
		assets: { meta: `/v1/meta/${SHA8}`, terrain: `/v1/terrain/${SHA8}`, fields_template: `/v1/fields/${id}/{level}/{var}`, column_template: `/v1/column/${id}?i={i}&j={j}`,
			profile_template: `/v1/profiles/${id}/{point_id}`, windrose_template: `/v1/windrose/{site_id}?snapshot=${id}`,
			quality: `/v1/quality/${id}`, alerts: `/v1/alerts/${id}`, stations: `/v1/stations/${id}`, wind_farm: `/v1/wind-farm/${id}`, data_quality: `/v1/data-quality/${id}`, export_netcdf: null, export_csv: null } });

	// Manifeste de publication de l'instantané, puis les réponses calculées par le Worker.
	const dataStatus = scenario === 'normal' ? 'complete' : 'degrade';
	const head = { snapshot_id: id, valid_time: validTime, generated_at: '2025-01-12T12:00:02Z', last_observation_at: '2025-01-12T11:59:40Z' };
	write('publish-manifest.json', { ...head, data_status: dataStatus, versions: VERSIONS, files });
	const off = scenario === 'gpu_eteint';
	write('latest.json', { ...head, published_at: '2025-01-12T12:00:04Z', compute_status: off ? 'offline' : 'online', heartbeat_at: off ? '2025-01-12T12:01:00Z' : '2025-01-12T12:04:30Z', data_status: dataStatus, versions: VERSIONS, href: `/v1/snapshots/${id}` });
	write('times.json', { total: 1, next: null, items: [{ snapshot_id: id, valid_time: validTime, open_alerts: nOpen }] });
	console.log(`${scenario}: ${id}, ${files.length} fichiers d'instantané + ${modelFiles.length} du modèle ${SHA8}, ${VALID} nœuds valides`);
}

for (const s of ['normal', 'capteur_en_derive', 'gpu_eteint']) build(s);
