// Valide les instantanés de test contre les schémas du contrat v1, et vérifie les invariants
// que JSON Schema ne sait pas exprimer (tailles des binaires, NaN sous le relief, direction météo,
// sha256 du manifeste de publication). Sort en code 1 au premier écart.
//
// Usage : node contract/tools/validate.mjs [dossier_instantané ...]
//         (par défaut : tous les dossiers de contract/fixtures/)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS = path.join(HERE, '..', 'schemas');
const FIXTURES = path.join(HERE, '..', 'fixtures');

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false, allowUnionTypes: true });
addFormats(ajv);
for (const f of fs.readdirSync(SCHEMAS)) ajv.addSchema(JSON.parse(fs.readFileSync(path.join(SCHEMAS, f), 'utf8')), f);

const FILE_SCHEMA = {
	'meta.json': 'meta.schema.json', 'latest.json': 'latest.schema.json', 'times.json': 'times.schema.json',
	'snapshot.json': 'snapshot.schema.json', 'profile.json': 'profile.schema.json', 'quality.json': 'quality.schema.json',
	'alerts.json': 'alerts.schema.json', 'stations.json': 'stations.schema.json', 'wind-farm.json': 'wind-farm.schema.json',
	'windrose.json': 'windrose.schema.json', 'publish-manifest.json': 'publish-manifest.schema.json',
};

let errors = 0;
const fail = (where, msg) => { errors++; console.error(`✗ ${where} : ${msg}`); };
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const dirFrom = (u, v) => ((270 - Math.atan2(v, u) * 180 / Math.PI) % 360 + 360) % 360;

function checkSnapshot(dir) {
	const name = path.basename(dir);
	for (const [f, s] of Object.entries(FILE_SCHEMA)) {
		const p = path.join(dir, f);
		if (!fs.existsSync(p)) { fail(name, `${f} absent`); continue; }
		const ok = ajv.validate(s, read(dir, f));
		if (!ok) for (const e of ajv.errors) fail(`${name}/${f}`, `${e.instancePath || '/'} ${e.message}`);
	}
	if (errors) return;

	const meta = read(dir, 'meta.json');
	const { nx, ny, nz, levels_asl_m: levels } = meta.grid;
	if (levels.length !== nz) fail(name, `levels_asl_m (${levels.length}) ≠ nz (${nz})`);
	if (levels.some((z, k) => k && z <= levels[k - 1])) fail(name, 'levels_asl_m non strictement croissants');

	// Binaires : taille exacte, NaN cohérents entre variables, terrain sans NaN.
	const f32 = (rel) => { const b = fs.readFileSync(path.join(dir, rel)); if (b.length !== nx * ny * 4) fail(name, `${rel} : ${b.length} octets, attendu ${nx * ny * 4}`); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
	const terrain = f32('terrain.f32');
	if (terrain.some(Number.isNaN)) fail(name, 'terrain.f32 contient des NaN');
	for (let k = 0; k < nz; k++) {
		const u = f32(`fields/${k}_u.f32`), v = f32(`fields/${k}_v.f32`);
		for (const variable of meta.fields) {
			const a = f32(`fields/${k}_${variable}.f32`);
			for (let idx = 0; idx < a.length; idx++) {
				const below = levels[k] <= terrain[idx];
				if (below !== Number.isNaN(a[idx])) { fail(name, `fields/${k}_${variable}.f32[${idx}] : NaN incohérent avec le relief`); break; }
			}
		}
		// Direction : la vitesse publiée doit valoir |(u,v)|.
		const sp = f32(`fields/${k}_speed.f32`);
		for (let idx = 0; idx < sp.length; idx++) if (!Number.isNaN(sp[idx]) && Math.abs(Math.hypot(u[idx], v[idx]) - sp[idx]) > 1e-3) { fail(name, `fields/${k}_speed incohérent avec u, v`); break; }
	}

	// Profil : direction météo recalculée depuis (u, v).
	for (const l of read(dir, 'profile.json').levels) {
		if (l.below_terrain) continue;
		const d = dirFrom(l.u, l.v), diff = Math.abs(((d - l.dir_from_deg) + 540) % 360 - 180);
		if (diff > 1.5) fail(name, `profile z=${l.z_asl_m} : dir_from_deg ${l.dir_from_deg} ≠ ${d.toFixed(1)} recalculé`);
		if (!(l.speed_interval.p10 <= l.speed_interval.p50 && l.speed_interval.p50 <= l.speed_interval.p90)) fail(name, `profile z=${l.z_asl_m} : intervalle non ordonné`);
	}

	// Manifeste de publication : sha256 et tailles exacts.
	for (const f of read(dir, 'publish-manifest.json').files) {
		const b = fs.readFileSync(path.join(dir, f.path));
		if (b.length !== f.bytes) fail(name, `${f.path} : taille ${b.length} ≠ ${f.bytes}`);
		if (crypto.createHash('sha256').update(b).digest('hex') !== f.sha256) fail(name, `${f.path} : sha256 différent`);
	}

	// Cohérences croisées.
	const snap = read(dir, 'snapshot.json'), latest = read(dir, 'latest.json');
	if (snap.snapshot_id !== latest.snapshot_id) fail(name, 'snapshot_id différent entre latest et snapshot');
	if (!snap.snapshot_id.endsWith('_' + (snap.versions.model_sha256 ?? '').slice(0, 8)) && snap.versions.model_sha256) fail(name, 'snapshot_id ne finit pas par le sha8 du modèle');
	const st = read(dir, 'stations.json').items;
	if (snap.kpi.stations_total !== st.length) fail(name, 'kpi.stations_total ≠ nombre de stations');
	if (!errors) console.log(`✓ ${name}`);
}

if (!fs.existsSync(path.join(FIXTURES, 'normal', 'meta.json'))) {
	console.error('Instantanés de test absents : lance d’abord « node contract/tools/make-fixtures.mjs ».');
	process.exit(1);
}
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(FIXTURES).map((d) => path.join(FIXTURES, d)).filter((d) => fs.statSync(d).isDirectory());
for (const d of dirs) checkSnapshot(d);
if (errors) { console.error(`${errors} écart(s) au contrat`); process.exit(1); }
console.log('Contrat v1 : tous les instantanés sont conformes.');
