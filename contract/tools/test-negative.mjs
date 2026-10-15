// Test négatif du validateur (obligatoire) : sur une copie du scénario « normal », injecte exactement
// 3 défauts, met à jour le manifeste pour les deux premiers afin qu'ils ne déclenchent pas d'écart de sha256,
// puis vérifie que validate.mjs sort en code 1 avec exactement 3 messages :
//   1. une direction inversée dans un profil précalculé ;
//   2. un NaN au mauvais endroit (nœud valide de fields/w.f32) ;
//   3. un sha256 faux dans publish-manifest.json.
//
// Usage : cd contract && node tools/test-negative.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'fixtures', 'normal');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'atom-contrat-'));
const DIR = path.join(TMP, 'negatif');
fs.cpSync(SRC, DIR, { recursive: true });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const readJ = (rel) => JSON.parse(fs.readFileSync(path.join(DIR, rel), 'utf8'));
const writeJ = (rel, o) => fs.writeFileSync(path.join(DIR, rel), JSON.stringify(o, null, 2) + '\n');
const manifest = readJ('publish-manifest.json');
const resync = (rel) => { const b = fs.readFileSync(path.join(DIR, rel)); const f = manifest.files.find((x) => x.path === rel); f.sha256 = sha(b); f.bytes = b.length; };

// 1. Direction inversée.
const prof = readJ('profiles/T-01.json');
const lv = prof.levels.find((l) => !l.below_terrain && l.dir_from_deg !== null);
lv.dir_from_deg = Math.round(((lv.dir_from_deg + 180) % 360) * 100) / 100;
writeJ('profiles/T-01.json', prof);
resync('profiles/T-01.json');

// 2. NaN sur un nœud valide (dernier niveau, colonne (0, 0), loin des points déclarés).
const meta = readJ(`models/${manifest.snapshot_id.slice(-8)}/meta.json`);
const { nx, ny, nz } = meta.grid;
const wb = fs.readFileSync(path.join(DIR, 'fields/w.f32'));
const w = new Float32Array(wb.buffer.slice(wb.byteOffset, wb.byteOffset + wb.length));
const at = (nz - 1) * nx * ny;
if (Number.isNaN(w[at])) throw new Error('le nœud choisi est déjà absent');
w[at] = NaN;
fs.writeFileSync(path.join(DIR, 'fields/w.f32'), Buffer.from(w.buffer));
resync('fields/w.f32');

// 3. sha256 faux.
const victim = manifest.files.find((f) => f.path === 'alerts.json');
victim.sha256 = victim.sha256.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
writeJ('publish-manifest.json', manifest);

const r = spawnSync(process.execPath, [path.join(HERE, 'validate.mjs'), DIR], { encoding: 'utf8' });
const messages = r.stderr.split('\n').filter((l) => l.startsWith('✗ negatif : ') && !/écart\(s\)$/.test(l));
fs.rmSync(TMP, { recursive: true, force: true });
console.log(messages.join('\n'));
const ok = r.status === 1 && messages.length === 3
	&& messages.some((m) => /dir_from_deg/.test(m)) && messages.some((m) => /NaN incohérent/.test(m)) && messages.some((m) => /sha256 différent/.test(m));
if (!ok) { console.error(`Test négatif ÉCHOUÉ : code ${r.status}, ${messages.length} message(s), 3 attendus.\n${r.stdout}${r.stderr}`); process.exit(1); }
console.log('Test négatif réussi : code 1, 3 messages (direction, NaN, sha256).');
