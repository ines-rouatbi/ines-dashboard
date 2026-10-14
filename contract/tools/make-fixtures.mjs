// Génère les 3 instantanés de test du contrat v1 : normal, capteur_en_derive, gpu_eteint.
// Données SYNTHÉTIQUES, déterministes, sur une grille réduite (100 × 50, 500 m) couvrant le même
// domaine que v7 (50 × 25 km, 12 niveaux réels au-dessus de la mer). Elles servent à développer et
// tester le front et le service sans GPU ; elles ne doivent jamais être affichées comme des résultats.
//
// Usage : node contract/tools/make-fixtures.mjs   (écrit contract/fixtures/<scénario>/...)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const NX = 100, NY = 50, DX = 500, DY = 500;
const LEVELS = [25, 50, 75, 100, 150, 200, 300, 400, 500, 650, 800, 1000]; // m au-dessus de la mer (v7)
const NZ = LEVELS.length;
const MODEL_SHA = 'b2529442';
const VERSIONS = { model: 'v7', norm: 'n7', data: 'aneo_dataset_3d_v2', contract: '1.0' };
const HUB = 120;

// Générateur pseudo-aléatoire déterministe.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Relief : crête diagonale + collines, 19 à 680 m (ordre de grandeur de v7).
function terrainAt(x, y) {
	const fx = x / (NX * DX), fy = y / (NY * DY);
	const d = (fx - 0.15 - fy * 0.7);
	const ridge = Math.exp(-(d * d) / (2 * 0.08 * 0.08)) * 560;
	const hill = Math.exp(-(((fx - 0.75) ** 2) + ((fy - 0.3) ** 2)) / 0.01) * 180;
	return 19 + ridge + hill;
}

// Vent synthétique : profil logarithmique, rotation avec l'altitude (spirale d'Ekman simplifiée),
// accélération au-dessus du relief. Direction de référence : vent d'ouest-nord-ouest (290°).
function windAt(x, y, zAsl, t) {
	const zg = terrainAt(x, y);
	const agl = zAsl - zg;
	if (agl <= 0) return null;
	const z0 = 0.1;
	const uref = 7.5 + 2.5 * Math.sin(t);
	const base = uref * Math.log(Math.max(agl, 1) / z0) / Math.log(100 / z0);
	const speedup = 1 + 0.4 * (zg - 19) / 660 * Math.exp(-agl / 250);
	const speed = Math.max(0.3, base * speedup);
	const dirFrom = (290 + 25 * Math.min(agl, 1000) / 1000) % 360;
	const rad = (270 - dirFrom) * Math.PI / 180; // u = s·cos, v = s·sin avec direction météo
	const u = speed * Math.cos(rad), v = speed * Math.sin(rad);
	const w = 0.6 * Math.sin(x / 4000) * Math.exp(-agl / 300) * (zg - 19) / 660;
	return { u, v, w, speed, dirFrom, agl };
}

const dirFrom = (u, v) => { const s = Math.hypot(u, v); if (s < 0.2) return null; return ((270 - Math.atan2(v, u) * 180 / Math.PI) % 360 + 360) % 360; };

function stationsBase() {
	const R = rng(7), items = [];
	for (let k = 0; k < 40; k++) {
		const x = 1000 + R() * (NX * DX - 2000), y = 1000 + R() * (NY * DY - 2000);
		items.push({ id: `ANEO-${String(k + 1).padStart(3, '0')}`, x_m: Math.round(x), y_m: Math.round(y), height_agl_m: [15, 20, 25, 30][k % 4] });
	}
	return items;
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const r2 = (v) => v === null ? null : Math.round(v * 100) / 100;

function build(scenario) {
	const dir = path.join(ROOT, scenario);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(path.join(dir, 'fields'), { recursive: true });
	const t = 1.1;
	const validTime = '2025-01-12T12:00:00Z';
	const snapshotId = `017_120000_${MODEL_SHA}`;
	const stationsAll = stationsBase();
	const driftId = 'ANEO-017', muteId = 'ANEO-031';
	const files = [];
	const put = (rel, data) => { const buf = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data, null, 2) + '\n'); fs.writeFileSync(path.join(dir, rel), buf); files.push({ path: rel, sha256: sha(buf), bytes: buf.length }); };

	// Terrain statique.
	const terr = new Float32Array(NX * NY);
	for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) terr[j * NX + i] = terrainAt((i + 0.5) * DX, (j + 0.5) * DY);
	put('terrain.f32', Buffer.from(terr.buffer));

	// Distance à la station la plus proche → couverture, incertitude, fiabilité.
	const active = stationsAll.filter((s) => !(scenario !== 'normal' && s.id === muteId));
	const nearest = (x, y) => { let best = null; for (const s of active) { const d = Math.hypot(s.x_m - x, s.y_m - y); if (!best || d < best.d) best = { s, d }; } return best; };
	const vars = ['u', 'v', 'w', 'speed', 'sigma_u', 'sigma_v', 'sigma_w', 'coverage', 'reliability', 'status'];
	let valid = 0;
	const validByLevel = [];
	const levelStats = [];
	for (let k = 0; k < NZ; k++) {
		const arr = Object.fromEntries(vars.map((v) => [v, new Float32Array(NX * NY)]));
		let nValid = 0, el = 0, mo = 0, fa = 0; const sig = [], cov = [];
		for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
			const x = (i + 0.5) * DX, y = (j + 0.5) * DY, idx = j * NX + i;
			const wv = windAt(x, y, LEVELS[k], t);
			if (!wv) { for (const v of vars) arr[v][idx] = NaN; continue; }
			nValid++;
			const nb = nearest(x, y);
			const coverage = Math.exp(-nb.d / 4000) * Math.exp(-wv.agl / 1500);
			const sigma = 0.15 + 0.9 * (1 - coverage);
			const reliability = Math.max(0, Math.min(1, 1 - sigma / 1.2));
			const measured = nb.d < DX * 0.75 && wv.agl < 40;
			arr.u[idx] = wv.u; arr.v[idx] = wv.v; arr.w[idx] = wv.w; arr.speed[idx] = wv.speed;
			arr.sigma_u[idx] = sigma; arr.sigma_v[idx] = sigma * 0.9; arr.sigma_w[idx] = sigma * 0.1;
			arr.coverage[idx] = coverage; arr.reliability[idx] = reliability; arr.status[idx] = measured ? 1 : 0;
			if (reliability >= 0.75) el++; else if (reliability >= 0.5) mo++; else fa++;
			sig.push(sigma); cov.push(coverage);
		}
		for (const v of vars) put(`fields/${k}_${v}.f32`, Buffer.from(arr[v].buffer));
		valid += nValid; validByLevel.push(nValid / (NX * NY));
		const med = (a) => { if (!a.length) return null; const s = [...a].sort((p, q) => p - q); return r2(s[s.length >> 1]); };
		levelStats.push({ z_asl_m: LEVELS[k], valid_nodes: nValid, share_elevee: nValid ? r2(el / nValid) : 0, share_moyenne: nValid ? r2(mo / nValid) : 0, share_faible: nValid ? r2(fa / nValid) : 0, sigma_speed_median: med(sig), coverage_median: med(cov) });
	}

	const meta = {
		contract_version: '1.0',
		grid: { nx: NX, ny: NY, nz: NZ, dx_m: DX, dy_m: DY, levels_asl_m: LEVELS, order: "z,y,x ; j=0 au sud, i=0 à l ouest", valid_nodes: valid, valid_fraction_by_level: validByLevel.map(r2) },
		domain: { x_max_m: (NX - 0.5) * DX, y_max_m: (NY - 0.5) * DY, origin: 'coin_sud_ouest', crs: 'local-metrique' },
		georef: { lat0: 36.0, lon0: 9.7, rotation_deg: 0, suppose: true },
		terrain: { min_m: r2(Math.min(...terr)), max_m: r2(Math.max(...terr)), href: '/v1/terrain', source: 'instantané de test synthétique (contract/tools/make-fixtures.mjs)' },
		fields: vars,
		units: { u: 'm/s', v: 'm/s', w: 'm/s', speed: 'm/s', sigma_u: 'm/s', sigma_v: 'm/s', sigma_w: 'm/s', coverage: '0-1', reliability: '0-1', status: '1 mesuré / 0 estimé', altitude: 'm au-dessus de la mer' },
		conventions: { u: "positif vers l Est", v: 'positif vers le Nord', w: 'positif vers le haut', direction: 'meteo : d ou vient le vent, (270 - atan2(v,u)) mod 360', nodata: 'null en JSON, NaN dans les binaires' },
	};
	put('meta.json', meta);

	// Stations.
	const stations = stationsAll.map((s) => {
		const wv = windAt(s.x_m, s.y_m, terrainAt(s.x_m, s.y_m) + s.height_agl_m, t);
		let state = 'active', bias = r2((rng(s.x_m)() - 0.5) * 0.2), lastSeen = validTime;
		if (scenario !== 'normal' && s.id === muteId) { state = 'muette'; lastSeen = '2025-01-12T09:40:00Z'; }
		if (scenario === 'capteur_en_derive' && s.id === driftId) { state = 'derive'; bias = 1.85; }
		return { ...s, state, last_seen: lastSeen, speed: state === 'muette' ? null : r2(wv.speed + (state === 'derive' ? bias : 0)), dir_from_deg: state === 'muette' ? null : r2(wv.dirFrom), bias_ms: state === 'muette' ? null : bias, quality_score: state === 'active' ? 0.95 : state === 'derive' ? 0.55 : 0 };
	});
	put('stations.json', { items: stations });
	const count = (st) => stations.filter((s) => s.state === st).length;

	// Alertes.
	const alerts = [];
	if (scenario !== 'normal') alerts.push({ id: 'A-0001', level: 'avertissement', kind: 'station_muette', title: `Station ${muteId} muette`, cause: 'Aucune mesure depuis 2 h 20', recommendation: 'Planifier une intervention sur la station', raised_at: '2025-01-12T12:00:00Z', status: 'ouverte', station_id: muteId, turbine_id: null, location: null, value: 140, threshold: 30, unit: 'min' });
	if (scenario === 'capteur_en_derive') alerts.push({ id: 'A-0002', level: 'important', kind: 'capteur_derive', title: `Capteur ${driftId} en dérive`, cause: 'Écart persistant de +1,85 m/s entre la mesure et la reconstruction sans la station (6 instants)', recommendation: "Planifier un étalonnage ; réduire le poids de la station dans l'intervalle", raised_at: '2025-01-12T12:00:00Z', status: 'ouverte', station_id: driftId, turbine_id: null, location: null, value: 1.85, threshold: 1.0, unit: 'm/s' });
	alerts.push({ id: 'A-0003', level: 'information', kind: 'zone_mal_couverte', title: 'Zone mal couverte au nord-est', cause: 'Indice de couverture < 0,2 et incertitude élevée', recommendation: 'Emplacement prioritaire pour une nouvelle station', raised_at: '2025-01-12T12:00:00Z', status: 'ouverte', station_id: null, turbine_id: null, location: { x_m: 44000, y_m: 21000 }, value: 0.17, threshold: 0.2, unit: null });
	put('alerts.json', { items: alerts });
	const open = (lv) => alerts.filter((a) => a.level === lv && a.status === 'ouverte').length;

	// Parc éolien virtuel (3 éoliennes), courbe de référence générique 2 MW.
	const pc = { name: 'Référence générique 2 MW', speed_ms: [0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 25, 25.01], power_kw: [0, 0, 70, 180, 340, 560, 840, 1180, 1520, 1820, 2000, 2000, 0] };
	const power = (s) => { if (s < 3 || s > 25) return 0; for (let q = 1; q < pc.speed_ms.length; q++) if (s <= pc.speed_ms[q]) { const a = pc.speed_ms[q - 1], b = pc.speed_ms[q]; return pc.power_kw[q - 1] + (pc.power_kw[q] - pc.power_kw[q - 1]) * (s - a) / (b - a); } return 0; };
	const turbines = [[12000, 8000], [14500, 9500], [30000, 15000]].map(([x, y], n) => {
		const zg = terrainAt(x, y), hub = windAt(x, y, zg + HUB, t), lo = windAt(x, y, zg + HUB - 45, t), hi = windAt(x, y, zg + HUB + 45, t);
		let c3 = 0; for (let q = -4; q <= 4; q++) { const s = windAt(x, y, zg + HUB + q * 10, t).speed; c3 += s ** 3; }
		const rews = Math.cbrt(c3 / 9), sg = 0.35;
		const st = rews < 3 ? 'arret_vent_faible' : rews > 25 ? 'arret_vent_fort' : 'production';
		return { id: `T-0${n + 1}`, name: `Éolienne virtuelle ${n + 1}`, x_m: x, y_m: y, virtual: true, model: pc.name, hub_agl_m: HUB, rotor_d_m: 90, rated_kw: 2000, cut_in_ms: 3, cut_out_ms: 25,
			hub_speed: { p10: r2(hub.speed - 1.28 * sg), p50: r2(hub.speed), p90: r2(hub.speed + 1.28 * sg) }, rews: { p10: r2(rews - 1.28 * sg), p50: r2(rews), p90: r2(rews + 1.28 * sg) },
			shear_ms: r2(hi.speed - lo.speed), veer_deg: r2(hi.dirFrom - lo.dirFrom), power_kw: { p10: Math.round(power(rews - 1.28 * sg)), p50: Math.round(power(rews)), p90: Math.round(power(rews + 1.28 * sg)) }, state: st, air_density: 1.2 };
	});
	const sum = (k) => turbines.reduce((a, tb) => a + tb.power_kw[k], 0);
	put('wind-farm.json', { turbines, farm: { power_kw: { p10: sum('p10'), p50: sum('p50'), p90: sum('p90') }, rated_kw: 6000, n_production: turbines.filter((tb) => tb.state === 'production').length, n_arret: turbines.filter((tb) => tb.state !== 'production').length }, power_curve: pc });

	// Rose des vents (36 instants seulement → statistiquement faible, volontaire).
	const edges = [0, 3, 6, 9, 12, 15, 25];
	const sectors = Array.from({ length: 12 }, (_, q) => ({ dir_center_deg: q * 30, frequency: 0, speed_bins: Array(edges.length - 1).fill(0) }));
	const R = rng(11);
	for (let n = 0; n < 36; n++) { const wv = windAt(12000, 8000, terrainAt(12000, 8000) + HUB, n * 0.4); const d = (wv.dirFrom + (R() - 0.5) * 60 + 360) % 360; const sec = Math.round(d / 30) % 12; sectors[sec].frequency += 1 / 36; const b = edges.findIndex((e, q) => q > 0 && wv.speed < e) - 1; sectors[sec].speed_bins[Math.max(0, b)] += 1 / 36; }
	for (const s of sectors) { s.frequency = r2(s.frequency); s.speed_bins = s.speed_bins.map((v) => Math.round(v * 1000) / 1000); }
	put('windrose.json', { x_m: 12000, y_m: 8000, hub_agl_m: HUB, period: { from: '2025-01-01T00:00:00Z', to: '2025-01-12T12:00:00Z' }, n_valid: 36, speed_bin_edges_ms: edges, sectors, weibull: { k: 2.1, c_ms: 9.4, aep_mwh: null, capacity_factor: null } });

	// Fiabilité agrégée.
	const unc = { method: 'ensemble-masquage-v1', members: 8, calibrated: true, scale_factor: 1.3, coverage_80_validation: 0.81 };
	put('quality.json', { uncertainty: unc, by_level: levelStats, calibration: { evaluated_on: 'instantané de test synthétique — pas une mesure', coverage_80: 0.81, corr_error_sigma: 0.42, dso6_pass: true } });

	// Profil au-dessus de l'éolienne 1.
	const px = 12000, py = 8000, zg = terrainAt(px, py), nb = nearest(px, py);
	put('profile.json', { x_m: px, y_m: py, z_terrain_m: r2(zg), nearest_station: { id: nb.s.id, distance_m: Math.round(nb.d) }, uncertainty: unc,
		levels: LEVELS.map((z) => { const wv = windAt(px, py, z, t); if (!wv) return { z_asl_m: z, agl_m: r2(z - zg), below_terrain: true, u: null, v: null, w: null, speed: null, dir_from_deg: null, speed_interval: { p10: null, p50: null, p90: null }, status: null, coverage: null, reliability: null, reliability_class: null };
			const cov = Math.exp(-nb.d / 4000) * Math.exp(-wv.agl / 1500), sg = 0.15 + 0.9 * (1 - cov), rel = Math.max(0, Math.min(1, 1 - sg / 1.2));
			return { z_asl_m: z, agl_m: r2(wv.agl), below_terrain: false, u: r2(wv.u), v: r2(wv.v), w: r2(wv.w), speed: r2(wv.speed), dir_from_deg: r2(dirFrom(wv.u, wv.v)), speed_interval: { p10: r2(wv.speed - 1.28 * sg), p50: r2(wv.speed), p90: r2(wv.speed + 1.28 * sg) }, status: 'estime', coverage: r2(cov), reliability: r2(rel), reliability_class: rel >= 0.75 ? 'elevee' : rel >= 0.5 ? 'moyenne' : 'faible' }; }) });

	// Résumé de l'instantané.
	const hubSpeeds = turbines.map((tb) => tb.hub_speed.p50);
	put('snapshot.json', { snapshot_id: snapshotId, valid_time: validTime, versions: VERSIONS,
		kpi: { stations_active: count('active'), stations_total: stations.length, share_high_reliability: r2(levelStats.reduce((a, l) => a + l.share_elevee * l.valid_nodes, 0) / valid), reconstruction_ms: 91, mass_residual_rms: 2.6e-5,
			open_alerts: { information: open('information'), avertissement: open('avertissement'), important: open('important'), critique: open('critique') },
			hub_wind_mean_ms: r2(hubSpeeds.reduce((a, b) => a + b, 0) / hubSpeeds.length), hub_wind_max_ms: r2(Math.max(...hubSpeeds)), hub_height_agl_m: HUB },
		physics: { mass_residual_rms: 2.6e-5, mass_residual_p95: 5.97e-5, ground_condition_rms: 0.004, roughness_ratio: 0.951, dso2_pass: true },
		stations_summary: { active: count('active'), suspecte: count('suspecte'), muette: count('muette'), derive: count('derive'), exclue: count('exclue') },
		scenario: null,
		assets: { fields_template: `/v1/fields/${snapshotId}/{level}/{var}`, quality: `/v1/quality/${snapshotId}`, alerts: `/v1/alerts/${snapshotId}`, stations: `/v1/stations/${snapshotId}`, wind_farm: `/v1/wind-farm/${snapshotId}`, profile: `/v1/profiles/${snapshotId}` } });

	put('times.json', { total: 1, next: null, items: [{ snapshot_id: snapshotId, valid_time: validTime, open_alerts: alerts.length }] });

	// Manifeste de publication (ce que le service enverra au /commit), puis latest.
	const pubFiles = files.slice();
	fs.writeFileSync(path.join(dir, 'publish-manifest.json'), JSON.stringify({ snapshot_id: snapshotId, valid_time: validTime, generated_at: '2025-01-12T12:00:02Z', last_observation_at: '2025-01-12T11:59:40Z', data_status: scenario === 'normal' ? 'complete' : 'degrade', versions: VERSIONS, files: pubFiles }, null, 2) + '\n');
	const off = scenario === 'gpu_eteint';
	fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ snapshot_id: snapshotId, valid_time: validTime, generated_at: '2025-01-12T12:00:02Z', published_at: '2025-01-12T12:00:04Z', last_observation_at: '2025-01-12T11:59:40Z',
		compute_status: off ? 'offline' : 'online', heartbeat_at: off ? '2025-01-12T12:01:00Z' : '2025-01-12T12:04:30Z', data_status: scenario === 'normal' ? 'complete' : 'degrade', versions: VERSIONS, href: `/v1/snapshots/${snapshotId}` }, null, 2) + '\n');
	console.log(`${scenario}: ${files.length} fichiers, ${valid} nœuds valides`);
}

for (const s of ['normal', 'capteur_en_derive', 'gpu_eteint']) build(s);
