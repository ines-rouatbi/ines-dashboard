// Client de référence de la publication (contrat v1, révision 2) : publie d'abord les fichiers par modèle
// (models/<sha8>/, une seule fois par modèle, idempotent), puis l'instantané, puis un battement de cœur.
// Sert à tester le Worker en local, et de modèle pour le publieur Python du service (lot M6).
//
// Usage : ATOM_PUBLISH_TOKEN=... node contract/tools/publish.mjs <dossier_instantané> [url_de_base]
//         url_de_base par défaut : http://127.0.0.1:8787 (wrangler dev). JAMAIS d'instantané de test en production.
// Le dossier suit la disposition décrite en tête de make-fixtures.mjs.
import fs from 'node:fs';
import path from 'node:path';

const [dir, base = 'http://127.0.0.1:8787'] = process.argv.slice(2);
const token = process.env.ATOM_PUBLISH_TOKEN;
if (!dir || !token) { console.error('Usage : ATOM_PUBLISH_TOKEN=... node contract/tools/publish.mjs <dossier> [url]'); process.exit(2); }
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'publish-manifest.json'), 'utf8'));
if (/atom\.zelqane\.com/.test(base) && (manifest.versions?.data_kind === 'test' || /fixtures/.test(path.resolve(dir)))) { console.error('Refus : un instantané de test ne se publie jamais en production.'); process.exit(2); }

const auth = { authorization: `Bearer ${token}` };
const id = manifest.snapshot_id, sha8 = id.slice(-8);
const mdir = path.join(dir, 'models', sha8);
const modelManifest = JSON.parse(fs.readFileSync(path.join(mdir, 'model-manifest.json'), 'utf8'));

async function putAll(prefix, root, files) {
	let n = 0;
	for (const f of files) {
		const body = fs.readFileSync(path.join(root, f.path));
		for (let attempt = 1; ; attempt++) {
			const r = await fetch(`${base}${prefix}/files/${encodeURIComponent(f.path)}`, { method: 'PUT', headers: { ...auth, 'x-content-sha256': f.sha256 }, body });
			if (r.ok) break;
			if (attempt >= 3 || r.status < 500) { console.error(`✗ ${prefix} ${f.path} : ${r.status} ${await r.text()}`); process.exit(1); }
		}
		if (++n % 10 === 0) console.log(`  ${prefix} ${n}/${files.length}`);
	}
}
async function commit(prefix, body) {
	const r = await fetch(`${base}${prefix}/commit`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
	const text = await r.text();
	console.log(`commit ${prefix} ${r.status} ${text}`);
	if (!r.ok) process.exit(1);
}

// 1. Modèle (meta.json, terrain.f32) : rien n'est renvoyé s'il est déjà commité à l'identique.
await putAll(`/v1/publish/model/${sha8}`, mdir, modelManifest.files);
await commit(`/v1/publish/model/${sha8}`, modelManifest);
// 2. Instantané : le Worker refuse le commit si le modèle n'est pas commité.
await putAll(`/v1/publish/${id}`, dir, manifest.files);
await commit(`/v1/publish/${id}`, manifest);
// 3. Battement de cœur.
await fetch(`${base}/v1/heartbeat`, { method: 'POST', headers: auth });
