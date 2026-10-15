// API /v1 du tableau de bord, adossée à R2 (binding SNAPSHOTS, bucket atom-snapshots). Contrat v1, révision 2.
//
// Lecture (publique, sans clé) : le tableau de bord ne lit QUE des fichiers publiés et commités, jamais le GPU.
// Le Worker ne fait aucun calcul scientifique : il lit R2 (lectures partielles comprises) et applique seulement
// les conversions du contrat (NaN → null, uint8 × scale, 255 → null).
// Publication (jeton PUBLISH_TOKEN, remis hors salon) : le service PC-FNO3D dépose d'abord les fichiers du
// modèle, puis ceux de l'instantané ; chaque /commit vérifie taille + sha256 de chaque fichier ; latest ne
// bascule qu'après un commit d'instantané conforme.
// Contrat : contract/openapi.yaml, contract/README.md, contract/DECISIONS-rev2.md.
//
// Règles de bascule de latest (commit d'instantané) :
//   - un commit refusé (422) n'écrit RIEN : ni _commit.json, ni index, ni latest ;
//   - un commit rejoué (_commit.json déjà présent, par ex. après une panne entre _commit.json et latest)
//     refait, de façon idempotente, l'écriture de l'index puis de latest à partir du _commit.json stocké ;
//   - une simulation (snapshot.json : scenario non null, BF45 et BF46) est publiée et lisible par son
//     identifiant, mais n'entre ni dans latest ni dans l'index /v1/times (frise des reconstructions) ;
//   - un instantané de test (versions.data_kind = "test", D15) est refusé, sauf si la variable de dev
//     ATOM_ALLOW_TEST_SNAPSHOTS vaut "1" (wrangler dev --var ATOM_ALLOW_TEST_SNAPSHOTS:1). Jamais en production.
// Commits concurrents : l'index n'a plus de fichier partagé (une clé par instantané), et latest est écrit
// sous condition d'etag (5 essais) : il ne recule jamais. Seule exception : tant qu'AUCUN latest n'existe,
// la toute première écriture n'a pas d'etag à comparer ; le publieur sérialise donc au moins sa
// première publication (en pratique, il publie un instantané à la fois).
//
// Disposition R2 :
//   models/<sha8>/<path>           fichiers par modèle (meta.json, terrain.f32)
//   models/<sha8>/_commit.json     manifeste vérifié (présent = modèle immuable)
//   snapshots/<id>/<path>          fichiers de l'instantané (snapshot.json, fields/<var>.f32|u8, profiles/, windrose/, ...)
//   snapshots/<id>/_commit.json    manifeste vérifié + published_at (présent = instantané immuable)
//   latest.json                    pointeur vers le dernier instantané commité
//   index/times/<valid_time>~<id>  une entrée vide par instantané commité (hors simulations), données en
//                                  customMetadata ; /v1/times les liste (R2 list), du plus récent au plus ancien
//   heartbeat.json                 dernier battement de cœur du service GPU

const MAX_BYTES = 8 * 1024 * 1024;
const HEARTBEAT_TTL_MS = 5 * 60 * 1000;
const ID_RE = /^[0-9A-Za-z_]+_[0-9a-f]{8}$/;
const SHA8_RE = /^[0-9a-f]{8}$/;
const POINT_RE = /^[A-Za-z0-9_-]+$/;
const PATH_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/;
const DATA_STATUS = new Set( [ 'complete', 'degrade' ] );
const IMMUTABLE = 'public, max-age=31536000, immutable';
const JSON_TYPE = 'application/json; charset=utf-8';

// Ressources JSON d'un instantané : /v1/<ressource>/<id> → snapshots/<id>/<fichier>.
const RESOURCE_FILE = {
	snapshots: 'snapshot.json', quality: 'quality.json', alerts: 'alerts.json',
	stations: 'stations.json', 'wind-farm': 'wind-farm.json', 'data-quality': 'data-quality.json',
};

const json = ( body, status = 200, extra = {} ) => new Response( JSON.stringify( body ), {
	status, headers: { 'content-type': JSON_TYPE, 'cache-control': 'no-store', ...extra },
} );
const err = ( status, error, message ) => json( { error, message }, status );
const testAutorise = ( env ) => env.ATOM_ALLOW_TEST_SNAPSHOTS === '1';
const refusTest = () => err( 422, 'instantane_de_test', 'Données de test (versions.data_kind = "test") refusées par ce Worker (ATOM_ALLOW_TEST_SNAPSHOTS absent).' );

// Erreur interne : détail journalisé côté Worker, réponse générique avec une référence pour le retrouver.
function erreurInterne( e ) {

	const ref = crypto.randomUUID().slice( 0, 8 );
	console.error( `[v1] erreur interne ${ ref } :`, e?.stack ?? e );
	return json( { error: 'erreur_interne', message: `Erreur interne (référence ${ ref }).`, ref }, 500 );

}
const putJSON = ( b, key, doc ) => b.put( key, JSON.stringify( doc ), { httpMetadata: { contentType: 'application/json' } } );

async function readJSON( bucket, key ) {

	const o = await bucket.get( key );
	return o ? o.json() : null;

}

async function sha256Hex( buf ) {

	const d = await crypto.subtle.digest( 'SHA-256', buf );
	return [ ...new Uint8Array( d ) ].map( ( x ) => x.toString( 16 ).padStart( 2, '0' ) ).join( '' );

}

function timingSafeEqual( a, b ) {

	const ea = new TextEncoder().encode( a ), eb = new TextEncoder().encode( b );
	if ( ea.length !== eb.length ) return false;
	let diff = 0;
	for ( let i = 0; i < ea.length; i ++ ) diff |= ea[ i ] ^ eb[ i ];
	return diff === 0;

}

function authorized( request, env ) {

	const h = request.headers.get( 'authorization' ) || '';
	const token = h.startsWith( 'Bearer ' ) ? h.slice( 7 ) : '';
	return Boolean( env.PUBLISH_TOKEN ) && token.length > 0 && timingSafeEqual( token, env.PUBLISH_TOKEN );

}

// meta d'un modèle COMMITÉ. Immuable : mis en cache dans l'isolat.
const metaCache = new Map();
async function modelMeta( b, sha8 ) {

	if ( metaCache.has( sha8 ) ) return metaCache.get( sha8 );
	if ( ! ( await b.head( `models/${ sha8 }/_commit.json` ) ) ) return null;
	const meta = await readJSON( b, `models/${ sha8 }/meta.json` );
	if ( meta ) metaCache.set( sha8, meta );
	return meta;

}

// Instantané d'une requête : l'identifiant explicite s'il est commité, sinon latest.
// Renvoie { id, immutable } ou null.
async function resolveId( b, id ) {

	if ( id && id !== 'latest' ) {

		if ( ! ID_RE.test( id ) ) return null;
		return ( await b.head( `snapshots/${ id }/_commit.json` ) ) ? { id, immutable: true } : null;

	}
	const latest = await readJSON( b, 'latest.json' );
	return latest?.snapshot_id ? { id: latest.snapshot_id, immutable: false } : null;

}

async function serveObject( b, key, contentType, immutable ) {

	const o = await b.get( key );
	if ( ! o ) return err( 404, 'absent', key.replace( /^(snapshots|models)\/[^/]+\//, '' ) );
	return new Response( o.body, { headers: {
		'content-type': contentType, 'cache-control': immutable ? IMMUTABLE : 'no-store', etag: o.httpEtag,
	} } );

}

async function latest( env ) {

	const b = env.SNAPSHOTS;
	const [ l, hb ] = await Promise.all( [ readJSON( b, 'latest.json' ), readJSON( b, 'heartbeat.json' ) ] );
	if ( ! l ) return err( 404, 'aucun_instantane', 'Aucun instantané publié pour l’instant.' );
	const hbAt = hb?.at ?? null;
	const online = hbAt !== null && Date.now() - Date.parse( hbAt ) < HEARTBEAT_TTL_MS;
	return json( { ...l, heartbeat_at: hbAt, compute_status: hbAt === null ? 'unknown' : online ? 'online' : 'offline' } );

}

// Lecture partielle d'un fichier de champ tous niveaux : [offset, offset + length[.
async function readRange( b, key, offset, length ) {

	const o = await b.get( key, { range: { offset, length } } );
	if ( ! o ) return null;
	const buf = await o.arrayBuffer();
	return buf.byteLength === length ? buf : null;

}

// Lecture « en peigne » : `count` valeurs de `n` octets espacées de `stride` octets à partir de `start`,
// en UNE seule lecture R2 (plage [start, start + (count−1)·stride + n[), lue en flux : seuls les octets
// utiles sont gardés en mémoire. Renvoie un tableau de `count` ArrayBuffer de n octets, ou null.
async function readStrided( b, key, start, count, stride, n ) {

	if ( count <= 0 ) return [];
	const length = ( count - 1 ) * stride + n;
	const o = await b.get( key, { range: { offset: start, length } } );
	if ( ! o ) return null;
	const out = Array.from( { length: count }, () => new Uint8Array( n ) );
	const take = ( chunk, pos ) => {

		// Copie les octets du morceau [pos, pos + chunk.length[ qui tombent dans une valeur utile.
		const end = pos + chunk.length;
		for ( let k = Math.max( 0, Math.floor( ( pos - n + 1 ) / stride ) ); k < count && k * stride < end; k ++ ) {

			const a = Math.max( k * stride, pos ), z = Math.min( k * stride + n, end );
			for ( let p = a; p < z; p ++ ) out[ k ][ p - k * stride ] = chunk[ p - pos ];

		}

	};
	let pos = 0;
	const reader = o.body && typeof o.body.getReader === 'function' ? o.body.getReader() : null;
	if ( reader ) {

		for ( ;; ) {

			const { done, value } = await reader.read();
			if ( done ) break;
			take( value, pos );
			pos += value.byteLength;

		}

	} else {

		const all = new Uint8Array( await o.arrayBuffer() );
		take( all, 0 );
		pos = all.byteLength;

	}
	return pos === length ? out.map( ( u ) => u.buffer ) : null;

}

const dtypeBytes = ( enc ) => ( enc.dtype === 'uint8' ? 1 : 4 );
function decode( buf, enc ) {

	if ( enc.dtype === 'uint8' ) {

		const q = new Uint8Array( buf )[ 0 ];
		return q === 255 ? null : q * ( enc.scale ?? 1 );

	}
	const x = new DataView( buf ).getFloat32( 0, true );
	return Number.isNaN( x ) ? null : x;

}

// --- Lecture ---------------------------------------------------------------------------------

async function handleRead( request, env, parts, url ) {

	const b = env.SNAPSHOTS;
	const [ resource, a, c, d ] = parts; // /v1/<resource>/<a>/<c>/<d>
	if ( parts.length === 0 ) return err( 404, 'route_inconnue', url.pathname );

	if ( resource === 'latest' ) return latest( env );

	// /v1/meta (modèle de latest) et /v1/meta/{sha8} (immuable).
	if ( resource === 'meta' ) {

		let sha8 = a, immutable = true;
		if ( ! sha8 ) {

			const l = await readJSON( b, 'latest.json' );
			if ( ! l ) return err( 404, 'aucun_instantane', 'Aucun instantané publié.' );
			sha8 = l.snapshot_id.slice( - 8 ); immutable = false;

		}
		if ( ! SHA8_RE.test( sha8 ) || ! ( await modelMeta( b, sha8 ) ) ) return err( 404, 'modele_inconnu', String( sha8 ) );
		return serveObject( b, `models/${ sha8 }/meta.json`, JSON_TYPE, immutable );

	}

	if ( resource === 'terrain' ) {

		if ( ! SHA8_RE.test( a ?? '' ) ) return err( 422, 'requete_invalide', 'Attendu /v1/terrain/{sha8} (voir meta.terrain.href)' );
		if ( ! ( await modelMeta( b, a ) ) ) return err( 404, 'modele_inconnu', a );
		return serveObject( b, `models/${ a }/terrain.f32`, 'application/octet-stream', true );

	}

	if ( resource === 'times' ) {

		const all = await lireIndex( b );
		const from = url.searchParams.get( 'from' ), to = url.searchParams.get( 'to' );
		const items = all.filter( ( t ) => ( ! from || t.valid_time >= from ) && ( ! to || t.valid_time <= to ) );
		const start = Number( url.searchParams.get( 'cursor' ) ?? 0 ) || 0, page = 200;
		return json( { total: items.length, next: start + page < items.length ? String( start + page ) : null, items: items.slice( start, start + page ) } );

	}

	// /v1/windrose/{site_id}?snapshot= : rose précalculée, dans latest par défaut.
	if ( resource === 'windrose' ) {

		if ( ! POINT_RE.test( a ?? '' ) ) return err( 422, 'requete_invalide', 'Attendu /v1/windrose/{site_id}' );
		const s = await resolveId( b, url.searchParams.get( 'snapshot' ) );
		if ( ! s ) return err( 404, 'aucun_instantane', 'Instantané inconnu.' );
		return serveObject( b, `snapshots/${ s.id }/windrose/${ a }.json`, JSON_TYPE, s.immutable );

	}

	// /v1/profiles/{id}/{point_id} : profil précalculé en un point déclaré.
	if ( resource === 'profiles' ) {

		if ( ! POINT_RE.test( c ?? '' ) ) return err( 422, 'requete_invalide', 'Attendu /v1/profiles/{id}/{point_id}' );
		const s = await resolveId( b, a );
		if ( ! s ) return err( 404, 'absent', 'Instantané inconnu.' );
		return serveObject( b, `snapshots/${ s.id }/profiles/${ c }.json`, JSON_TYPE, s.immutable );

	}

	// /v1/fields/{id}/{level}/{var} : un niveau, lu par lecture partielle dans le fichier tous niveaux.
	if ( resource === 'fields' ) {

		const s = await resolveId( b, a );
		if ( ! s ) return err( 404, 'absent', 'Instantané inconnu.' );
		const meta = await modelMeta( b, s.id.slice( - 8 ) );
		if ( ! meta ) return err( 404, 'modele_inconnu', s.id.slice( - 8 ) );
		const level = Number( c ), { nx, ny, nz } = meta.grid;
		const enc = meta.fields.includes( d ) ? meta.encoding[ d ] : null;
		if ( ! /^\d+$/.test( c ?? '' ) || level >= nz || ! enc ) return err( 422, 'requete_invalide', `Attendu /v1/fields/{id}/{niveau 0..${ nz - 1 }}/{${ meta.fields.join( '|' ) }}` );
		const size = nx * ny * dtypeBytes( enc );
		const o = await b.get( `snapshots/${ s.id }/${ enc.file }`, { range: { offset: level * size, length: size } } );
		if ( ! o ) return err( 404, 'absent', enc.file );
		return new Response( o.body, { headers: {
			'content-type': 'application/octet-stream', 'content-length': String( size ),
			'x-atom-dtype': enc.dtype, 'access-control-expose-headers': 'x-atom-dtype',
			'cache-control': s.immutable ? IMMUTABLE : 'no-store',
		} } );

	}

	// /v1/column/{id}?i&j : valeurs brutes de la colonne (i, j), toutes lectures partielles en parallèle.
	if ( resource === 'column' ) {

		const s = await resolveId( b, a );
		if ( ! s ) return err( 404, 'absent', 'Instantané inconnu.' );
		const sha8 = s.id.slice( - 8 ), meta = await modelMeta( b, sha8 );
		if ( ! meta ) return err( 404, 'modele_inconnu', sha8 );
		const g = meta.grid, { nx, ny, nz } = g;
		const iq = url.searchParams.get( 'i' ), jq = url.searchParams.get( 'j' );
		const i = Number( iq ), j = Number( jq );
		if ( ! /^\d+$/.test( iq ?? '' ) || ! /^\d+$/.test( jq ?? '' ) || i >= nx || j >= ny ) return err( 422, 'requete_invalide', `Attendu ?i=0..${ nx - 1 }&j=0..${ ny - 1 }` );
		const idx = j * nx + i, NN = nx * ny;
		// Sous-requêtes R2 : 1 pour le relief, puis UNE lecture « en peigne » par variable (valeurs aux
		// indices k·ny·nx + j·nx + i, D13), soit 1 + len(meta.fields) au lieu de 1 + nz·len(meta.fields).
		// Les niveaux sous min_agl_m sont absents par contrat (null) : ils ne sont pas lus.
		const tb = await readRange( b, `models/${ sha8 }/terrain.f32`, idx * 4, 4 );
		if ( ! tb ) return err( 404, 'absent', 'Relief incomplet.' );
		const zt = new DataView( tb ).getFloat32( 0, true );
		const levels = g.levels_asl_m.map( ( z ) => ( { z_asl_m: z, z_agl_m: z - zt, below_terrain: z - zt < g.min_agl_m } ) );
		let k0 = levels.findIndex( ( l ) => ! l.below_terrain );
		if ( k0 < 0 ) k0 = nz;
		const cols = await Promise.all( meta.fields.map( ( v ) => {

			const enc = meta.encoding[ v ], n = dtypeBytes( enc );
			return readStrided( b, `snapshots/${ s.id }/${ enc.file }`, ( k0 * NN + idx ) * n, nz - k0, NN * n, n );

		} ) );
		if ( cols.some( ( x ) => x === null ) ) return err( 404, 'absent', 'Fichier de champ incomplet.' );
		meta.fields.forEach( ( v, f ) => {

			for ( let k = 0; k < nz; k ++ ) levels[ k ][ v ] = k < k0 ? null : decode( cols[ f ][ k - k0 ], meta.encoding[ v ] );

		} );
		return json( { i, j, x_m: g.x0_m + i * g.dx_m, y_m: g.y0_m + j * g.dy_m, z_terrain_m: zt, levels }, 200, { 'cache-control': s.immutable ? IMMUTABLE : 'no-store' } );

	}

	if ( RESOURCE_FILE[ resource ] ) {

		const s = await resolveId( b, a );
		if ( ! s ) return err( 404, 'absent', 'Instantané inconnu.' );
		return serveObject( b, `snapshots/${ s.id }/${ RESOURCE_FILE[ resource ] }`, JSON_TYPE, s.immutable );

	}

	return err( 404, 'route_inconnue', url.pathname );

}

// --- Publication -----------------------------------------------------------------------------

// PUT d'un fichier sous <prefix>/<rel> : idempotent si même sha256, refusé après commit.
async function putFile( request, b, prefix, committed, rel ) {

	if ( ! PATH_RE.test( rel ) ) return err( 422, 'chemin_invalide', rel );
	const declared = ( request.headers.get( 'x-content-sha256' ) || '' ).toLowerCase();
	if ( ! /^[0-9a-f]{64}$/.test( declared ) ) return err( 422, 'sha256_absent', 'En-tête X-Content-SHA256 obligatoire.' );
	// Content-Length obligatoire : un corps de taille inconnue (transfert par morceaux) n'est jamais lu.
	const cl = request.headers.get( 'content-length' );
	if ( cl === null || ! /^\d+$/.test( cl ) ) return err( 411, 'longueur_requise', 'En-tête Content-Length obligatoire.' );
	if ( Number( cl ) > MAX_BYTES ) return err( 413, 'trop_gros', `${ MAX_BYTES } octets maximum par fichier.` );

	const key = `${ prefix }/${ rel }`;
	const existing = await b.head( key );
	if ( existing && existing.customMetadata?.sha256 === declared ) return json( { ok: true, path: rel, unchanged: true }, 200 );
	if ( committed ) return err( 409, 'deja_commite', 'Fichiers immuables après commit.' );

	const buf = await request.arrayBuffer();
	if ( buf.byteLength > MAX_BYTES ) return err( 413, 'trop_gros', `${ MAX_BYTES } octets maximum par fichier.` );
	const actual = await sha256Hex( buf );
	if ( actual !== declared ) return err( 422, 'sha256_different', `Reçu ${ actual }` );
	await b.put( key, buf, { httpMetadata: { contentType: rel.endsWith( '.json' ) ? 'application/json' : 'application/octet-stream' }, customMetadata: { sha256: actual } } );
	return json( { ok: true, path: rel, bytes: buf.byteLength }, 201 );

}

// Vérifie présence, taille et sha256 de chaque fichier listé sous <prefix>/.
async function verifyFiles( b, prefix, files ) {

	const problems = [];
	await Promise.all( files.map( async ( f ) => {

		if ( ! PATH_RE.test( f?.path ?? '' ) ) return problems.push( `${ f?.path } : chemin invalide` );
		const o = await b.head( `${ prefix }/${ f.path }` );
		if ( ! o ) return problems.push( `${ f.path } : absent` );
		if ( o.size !== f.bytes ) return problems.push( `${ f.path } : ${ o.size } octets, attendu ${ f.bytes }` );
		if ( o.customMetadata?.sha256 !== f.sha256 ) problems.push( `${ f.path } : sha256 différent` );

	} ) );
	return problems;

}
const refused = ( problems ) => json( { error: 'publication_refusee', message: 'Rien n’a changé.', problems: problems.slice( 0, 50 ) }, 422 );

async function commitModel( request, b, sha8, committed, env ) {

	if ( committed ) return json( { ok: true, model_sha8: sha8, unchanged: true } );
	let m;
	try { m = await request.json(); } catch { return err( 422, 'json_invalide', 'Manifeste illisible.' ); }
	if ( m?.model_sha8 !== sha8 || ! Array.isArray( m.files ) || ! m.versions?.model_sha256?.startsWith( sha8 ) ) return err( 422, 'manifeste_invalide', 'Voir contract/schemas/model-manifest.schema.json' );
	if ( m.versions.data_kind === 'test' && ! testAutorise( env ) ) return refusTest();
	const listed = new Set( m.files.map( ( f ) => f.path ) );
	const problems = [ 'meta.json', 'terrain.f32' ].filter( ( p ) => ! listed.has( p ) ).map( ( p ) => `${ p } : absent du manifeste` );
	if ( problems.length ) return refused( problems );
	problems.push( ...await verifyFiles( b, `models/${ sha8 }`, m.files ) );
	if ( problems.length ) return refused( problems );

	const meta = await readJSON( b, `models/${ sha8 }/meta.json` );
	const terrain = await b.head( `models/${ sha8 }/terrain.f32` );
	const g = meta?.grid;
	if ( ! g || meta.versions?.model_sha256 !== m.versions.model_sha256 ) problems.push( 'meta.json : versions.model_sha256 différent du manifeste' );
	else {

		if ( terrain.size !== g.nx * g.ny * 4 ) problems.push( `terrain.f32 : ${ terrain.size } octets, attendu nx·ny·4 = ${ g.nx * g.ny * 4 }` );
		if ( meta.terrain?.sha256 !== terrain.customMetadata?.sha256 ) problems.push( 'terrain.f32 : sha256 ≠ meta.terrain.sha256' );
		if ( meta.versions?.data_kind !== m.versions.data_kind ) problems.push( 'meta.json : versions.data_kind différent du manifeste' );
		for ( const v of meta.fields ?? [] ) if ( ! meta.encoding?.[ v ] ) problems.push( `meta.encoding.${ v } absent` );

	}
	if ( problems.length ) return refused( problems );
	await putJSON( b, `models/${ sha8 }/_commit.json`, { ...m, committed_at: new Date().toISOString() } );
	return json( { ok: true, model_sha8: sha8, files: m.files.length } );

}

// Après _commit.json : index puis latest. Idempotent (rejouable à l'identique depuis le _commit.json stocké).
//   - simulation : ni index ni latest ;
//   - latest ne recule jamais : il bascule si valid_time est plus récent, ou égal avec une publication
//     au moins aussi récente (un commit rejoué d'un instantané plus ancien ne reprend pas la main).
async function finaliser( b, c ) {

	const id = c.snapshot_id;
	if ( c.simulation ) return { latest: false, index: false };

	// Index : UNE entrée par instantané (aucune lecture-modification-écriture partagée, donc aucune perte
	// d'entrée entre deux commits concurrents). open_alerts = somme de snapshot.kpi.open_alerts, null si
	// le bloc est null (lot M4 inactif, B5 : jamais 0 pour l'inconnu).
	const snap = await readJSON( b, `snapshots/${ id }/snapshot.json` );
	const oa = snap?.kpi?.open_alerts;
	const openAlerts = oa && typeof oa === 'object' ? Object.values( oa ).reduce( ( s, n ) => s + ( Number.isInteger( n ) ? n : 0 ), 0 ) : null;
	await b.put( cleIndex( c.valid_time, id ), '', { customMetadata: {
		snapshot_id: id, valid_time: c.valid_time, open_alerts: openAlerts === null ? '' : String( openAlerts ),
	} } );

	// latest : écriture conditionnelle (etag) pour qu'un commit concurrent plus ancien ne le fasse jamais reculer.
	const doc = {
		snapshot_id: id, valid_time: c.valid_time, generated_at: c.generated_at ?? c.published_at, published_at: c.published_at,
		last_observation_at: c.last_observation_at ?? null, data_status: c.data_status, versions: c.versions, href: `/v1/snapshots/${ id }`,
	};
	for ( let essai = 0; essai < 5; essai ++ ) {

		const o = await b.get( 'latest.json' );
		const current = o ? await o.json() : null;
		const bascule = ! current || current.valid_time < c.valid_time
			|| ( current.valid_time === c.valid_time && ( current.snapshot_id === id || ( current.published_at ?? '' ) <= c.published_at ) );
		if ( ! bascule ) return { latest: false, index: true };
		// Premier latest du bucket : pas d'etag à comparer (voir la note sur la sérialisation, en tête).
		const r = await b.put( 'latest.json', JSON.stringify( doc ), {
			httpMetadata: { contentType: 'application/json' }, ...( o ? { onlyIf: { etagMatches: o.etag } } : {} ),
		} );
		if ( r !== null ) return { latest: true, index: true };

	}
	throw new Error( 'latest.json : conflit d’écriture persistant (5 essais)' );

}

// Index des instantanés : index/times/<valid_time>~<snapshot_id>, corps vide, données en customMetadata.
// L'ordre lexicographique des clés R2 est l'ordre chronologique (valid_time ISO 8601 UTC).
const INDEX_PREFIX = 'index/times/';
const cleIndex = ( validTime, id ) => `${ INDEX_PREFIX }${ validTime }~${ id }`;

async function lireIndex( b ) {

	const items = [];
	let cursor;
	do {

		const page = await b.list( { prefix: INDEX_PREFIX, cursor, limit: 1000, include: [ 'customMetadata' ] } );
		for ( const o of page.objects ) {

			const m = o.customMetadata ?? {};
			if ( ! m.snapshot_id || ! m.valid_time ) continue;
			items.push( { snapshot_id: m.snapshot_id, valid_time: m.valid_time, open_alerts: m.open_alerts === '' || m.open_alerts === undefined ? null : Number( m.open_alerts ) } );

		}
		cursor = page.truncated ? page.cursor : undefined;

	} while ( cursor );
	return items.reverse(); // du plus récent au plus ancien

}

async function commitSnapshot( request, b, id, committed, env ) {

	// Commit rejoué (réponse perdue, ou panne entre _commit.json et latest) : l'instantané est déjà vérifié
	// et immuable ; on refait seulement, de façon idempotente, l'index et latest depuis le _commit.json stocké.
	if ( committed ) {

		const c = await readJSON( b, `snapshots/${ id }/_commit.json` );
		if ( ! c ) return err( 404, 'absent', '_commit.json illisible.' );
		const f = await finaliser( b, c );
		return json( { ok: true, snapshot_id: id, published_at: c.published_at, unchanged: true, simulation: Boolean( c.simulation ), latest: f.latest } );

	}
	let m;
	try { m = await request.json(); } catch { return err( 422, 'json_invalide', 'Manifeste illisible.' ); }
	if ( m?.snapshot_id !== id || ! Array.isArray( m.files ) || m.files.length === 0 || ! m.valid_time || ! m.versions ) return err( 422, 'manifeste_invalide', 'Voir contract/schemas/publish-manifest.schema.json' );
	if ( ! DATA_STATUS.has( m.data_status ) ) return err( 422, 'manifeste_invalide', 'data_status obligatoire : complete | degrade' );
	if ( m.versions.data_kind === 'test' && ! testAutorise( env ) ) return refusTest();
	const sha8 = id.slice( - 8 );
	if ( m.versions.model_sha256?.slice( 0, 8 ) !== sha8 ) return err( 422, 'manifeste_invalide', 'snapshot_id ne finit pas par le sha8 de versions.model_sha256' );
	const meta = await modelMeta( b, sha8 );
	if ( ! meta ) return err( 422, 'modele_non_commite', `Publier d'abord le modèle : /v1/publish/model/${ sha8 }/commit` );

	// Fichiers obligatoires, et taille exacte de chaque champ tous niveaux.
	const byPath = new Map( m.files.map( ( f ) => [ f.path, f ] ) );
	const problems = [];
	for ( const p of [ 'meta.json', 'terrain.f32' ] ) if ( byPath.has( p ) ) problems.push( `${ p } : fichier du modèle, interdit dans le manifeste d'instantané` );
	if ( ! byPath.has( 'snapshot.json' ) ) problems.push( 'snapshot.json : absent du manifeste' );
	const { nx, ny, nz } = meta.grid;
	for ( const v of meta.fields ) {

		const enc = meta.encoding[ v ], f = byPath.get( enc.file ), want = nz * ny * nx * dtypeBytes( enc );
		if ( ! f ) problems.push( `${ enc.file } : absent du manifeste` );
		else if ( f.bytes !== want ) problems.push( `${ enc.file } : ${ f.bytes } octets déclarés, attendu nz·ny·nx·${ dtypeBytes( enc ) } = ${ want }` );

	}
	if ( problems.length ) return refused( problems );
	problems.push( ...await verifyFiles( b, `snapshots/${ id }`, m.files ) );
	if ( problems.length ) return refused( problems );

	// snapshot.json (vérifié ci-dessus) : même identifiant, même nature des données ; scenario ≠ null = simulation.
	let snap = null;
	try { snap = await readJSON( b, `snapshots/${ id }/snapshot.json` ); } catch { /* signalé ci-dessous */ }
	if ( ! snap || typeof snap !== 'object' ) return refused( [ 'snapshot.json : illisible' ] );
	if ( snap.snapshot_id !== id ) problems.push( `snapshot.json : snapshot_id ${ snap.snapshot_id } ≠ ${ id }` );
	if ( snap.versions?.data_kind !== m.versions.data_kind ) problems.push( 'snapshot.json : versions.data_kind différent du manifeste' );
	if ( problems.length ) return refused( problems );
	const simulation = snap.scenario != null;

	// Ordre : d'abord l'instantané devient immuable (_commit.json), puis l'index, puis latest en dernier.
	const c = { ...m, published_at: new Date().toISOString(), simulation };
	await putJSON( b, `snapshots/${ id }/_commit.json`, c );
	const f = await finaliser( b, c );
	return json( { ok: true, snapshot_id: id, published_at: c.published_at, files: m.files.length, simulation, latest: f.latest } );

}

async function handlePublish( request, env, parts ) {

	if ( ! authorized( request, env ) ) return err( 401, 'non_autorise', 'Jeton de publication absent ou invalide.' );
	const b = env.SNAPSHOTS;

	if ( parts[ 0 ] === 'heartbeat' ) {

		await putJSON( b, 'heartbeat.json', { at: new Date().toISOString() } );
		return new Response( null, { status: 204 } );

	}

	// /v1/publish/model/<sha8>/(files/<path...> | commit)
	if ( parts[ 1 ] === 'model' ) {

		const sha8 = parts[ 2 ] ?? '';
		if ( ! SHA8_RE.test( sha8 ) ) return err( 422, 'sha8_invalide', 'Attendu 8 caractères hexadécimaux.' );
		const committed = await b.head( `models/${ sha8 }/_commit.json` );
		if ( parts.length === 4 && parts[ 3 ] === 'commit' && request.method === 'POST' ) return commitModel( request, b, sha8, committed, env );
		if ( parts[ 3 ] === 'files' && parts.length >= 5 && request.method === 'PUT' ) return putFile( request, b, `models/${ sha8 }`, committed, parts.slice( 4 ).join( '/' ) );
		return err( 405, 'methode', 'PUT /v1/publish/model/{sha8}/files/{path} ou POST /v1/publish/model/{sha8}/commit' );

	}

	// /v1/publish/<id>/(files/<path...> | commit)
	const id = parts[ 1 ] ?? '';
	if ( ! ID_RE.test( id ) ) return err( 422, 'id_invalide', 'snapshot_id = <stem>[_<scénario>]_<sha8>' );
	const committed = await b.head( `snapshots/${ id }/_commit.json` );
	if ( parts.length === 3 && parts[ 2 ] === 'commit' && request.method === 'POST' ) return commitSnapshot( request, b, id, committed, env );
	if ( parts[ 2 ] === 'files' && parts.length >= 4 && request.method === 'PUT' ) return putFile( request, b, `snapshots/${ id }`, committed, parts.slice( 3 ).join( '/' ) );
	return err( 405, 'methode', 'PUT /v1/publish/{id}/files/{path} ou POST /v1/publish/{id}/commit' );

}

export async function handleV1( request, env, url ) {

	if ( ! env.SNAPSHOTS ) return err( 503, 'r2_absent', 'Binding SNAPSHOTS non configuré.' );
	try {

		const parts = url.pathname.replace( /^\/v1\/?/, '' ).split( '/' ).filter( Boolean ).map( decodeURIComponent );
		if ( parts[ 0 ] === 'publish' || ( parts[ 0 ] === 'heartbeat' && request.method === 'POST' ) ) return await handlePublish( request, env, parts );
		if ( request.method !== 'GET' && request.method !== 'HEAD' ) return err( 405, 'methode', 'Lecture seule.' );
		return await handleRead( request, env, parts, url );

	} catch ( e ) {

		if ( e instanceof URIError ) return err( 400, 'chemin_invalide', 'Encodage d’URL invalide.' );
		return erreurInterne( e );

	}

}
