// Client de référence de la publication (contrat v1) : envoie un instantané au Worker puis le commite.
// Sert à tester le Worker en local, et de modèle pour le publieur Python du service (lot M6).
//
// Usage : ATOM_PUBLISH_TOKEN=... node contract/tools/publish.mjs <dossier_instantané> [url_de_base]
//         url_de_base par défaut : http://127.0.0.1:8787 (wrangler dev). JAMAIS d'instantané de test en production.
import fs from 'node:fs';
import path from 'node:path';

const [dir, base = 'http://127.0.0.1:8787'] = process.argv.slice(2);
const token = process.env.ATOM_PUBLISH_TOKEN;
if (!dir || !token) { console.error('Usage : ATOM_PUBLISH_TOKEN=... node contract/tools/publish.mjs <dossier> [url]'); process.exit(2); }
if (/atom\.zelqane\.com/.test(base) && /fixtures/.test(path.resolve(dir))) { console.error('Refus : un instantané de test ne se publie jamais en production.'); process.exit(2); }

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'publish-manifest.json'), 'utf8'));
const auth = { authorization: `Bearer ${token}` };
const id = manifest.snapshot_id;

let n = 0;
for (const f of manifest.files) {
	const body = fs.readFileSync(path.join(dir, f.path));
	for (let attempt = 1; ; attempt++) {
		const r = await fetch(`${base}/v1/publish/${id}/${f.path}`, { method: 'PUT', headers: { ...auth, 'x-content-sha256': f.sha256 }, body });
		if (r.ok) break;
		if (attempt >= 3 || r.status < 500) { console.error(`✗ ${f.path} : ${r.status} ${await r.text()}`); process.exit(1); }
	}
	if (++n % 25 === 0) console.log(`  ${n}/${manifest.files.length}`);
}
const r = await fetch(`${base}/v1/publish/${id}/commit`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(manifest) });
console.log(`commit ${r.status} ${await r.text()}`);
await fetch(`${base}/v1/heartbeat`, { method: 'POST', headers: auth });
process.exit(r.ok ? 0 : 1);
