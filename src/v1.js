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
// Disposition R2 :
//   models/<sha8>/<path>           fichiers par modèle (meta.json, terrain.f32)
//   models/<sha8>/_commit.json     manifeste vérifié (présent = modèle immuable)
//   snapshots/<id>/<path>          fichiers de l'instantané (snapshot.json, fields/<var>.f32|u8, profiles/, windrose/, ...)
//   snapshots/<id>/_commit.json    manifeste vérifié + published_at (présent = instantané immuable)
//   latest.json                    pointeur vers le dernier instantané commité
//   index/times.json               liste des instantanés commités (du plus récent au plus ancien)
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

		const all = ( await readJSON( b, 'index/times.json' ) ) ?? [];
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
		const reads = [ readRange( b, `models/${ sha8 }/terrain.f32`, idx * 4, 4 ) ];
		for ( const v of meta.fields ) {

			const enc = meta.encoding[ v ], n = dtypeBytes( enc );
			for ( let k = 0; k < nz; k ++ ) reads.push( readRange( b, `snapshots/${ s.id }/${ enc.file }`, ( k * NN + idx ) * n, n ) );

		}
		const bufs = await Promise.all( reads );
		if ( bufs.some( ( x ) => x === null ) ) return err( 404, 'absent', 'Fichier de champ ou relief incomplet.' );
		const zt = new DataView( bufs[ 0 ] ).getFloat32( 0, true );
		const levels = g.levels_asl_m.map( ( z ) => ( { z_asl_m: z, z_agl_m: z - zt, below_terrain: z - zt < g.min_agl_m } ) );
		let r = 1;
		for ( const v of meta.fields ) for ( let k = 0; k < nz; k ++ ) levels[ k ][ v ] = decode( bufs[ r ++ ], meta.encoding[ v ] );
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
	const len = Number( request.headers.get( 'content-length' ) || 0 );
	if ( len > MAX_BYTES ) return err( 413, 'trop_gros', `${ MAX_BYTES } octets maximum par fichier.` );

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

async function commitModel( request, b, sha8, committed ) {

	if ( committed ) return json( { ok: true, model_sha8: sha8, unchanged: true } );
	let m;
	try { m = await request.json(); } catch { return err( 422, 'json_invalide', 'Manifeste illisible.' ); }
	if ( m?.model_sha8 !== sha8 || ! Array.isArray( m.files ) || ! m.versions?.model_sha256?.startsWith( sha8 ) ) return err( 422, 'manifeste_invalide', 'Voir contract/schemas/model-manifest.schema.json' );
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
		for ( const v of meta.fields ?? [] ) if ( ! meta.encoding?.[ v ] ) problems.push( `meta.encoding.${ v } absent` );

	}
	if ( problems.length ) return refused( problems );
	await putJSON( b, `models/${ sha8 }/_commit.json`, { ...m, committed_at: new Date().toISOString() } );
	return json( { ok: true, model_sha8: sha8, files: m.files.length } );

}

async function commitSnapshot( request, b, id, committed ) {

	// Commit rejoué (réponse perdue côté client) : succès idempotent, rien ne change.
	if ( committed ) return json( { ok: true, snapshot_id: id, unchanged: true } );
	let m;
	try { m = await request.json(); } catch { return err( 422, 'json_invalide', 'Manifeste illisible.' ); }
	if ( m?.snapshot_id !== id || ! Array.isArray( m.files ) || m.files.length === 0 || ! m.valid_time || ! m.versions ) return err( 422, 'manifeste_invalide', 'Voir contract/schemas/publish-manifest.schema.json' );
	if ( ! DATA_STATUS.has( m.data_status ) ) return err( 422, 'manifeste_invalide', 'data_status obligatoire : complete | degrade' );
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

	const publishedAt = new Date().toISOString();
	const latestDoc = {
		snapshot_id: id, valid_time: m.valid_time, generated_at: m.generated_at ?? publishedAt, published_at: publishedAt,
		last_observation_at: m.last_observation_at ?? null, data_status: m.data_status, versions: m.versions, href: `/v1/snapshots/${ id }`,
	};
	// Ordre : d'abord l'instantané devient immuable, puis l'index, puis latest en dernier.
	await putJSON( b, `snapshots/${ id }/_commit.json`, { ...m, published_at: publishedAt } );
	const alerts = await readJSON( b, `snapshots/${ id }/alerts.json` );
	const openAlerts = Array.isArray( alerts?.items ) ? alerts.items.filter( ( x ) => x.status === 'ouverte' ).length : null;
	const times = ( ( await readJSON( b, 'index/times.json' ) ) ?? [] ).filter( ( t ) => t.snapshot_id !== id );
	times.push( { snapshot_id: id, valid_time: m.valid_time, open_alerts: openAlerts } );
	times.sort( ( p, q ) => ( p.valid_time < q.valid_time ? 1 : p.valid_time > q.valid_time ? - 1 : 0 ) );
	await putJSON( b, 'index/times.json', times );
	const current = await readJSON( b, 'latest.json' );
	if ( ! current || current.valid_time <= m.valid_time ) await putJSON( b, 'latest.json', latestDoc );
	return json( { ok: true, snapshot_id: id, published_at: publishedAt, files: m.files.length } );

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
		if ( parts.length === 4 && parts[ 3 ] === 'commit' && request.method === 'POST' ) return commitModel( request, b, sha8, committed );
		if ( parts[ 3 ] === 'files' && parts.length >= 5 && request.method === 'PUT' ) return putFile( request, b, `models/${ sha8 }`, committed, parts.slice( 4 ).join( '/' ) );
		return err( 405, 'methode', 'PUT /v1/publish/model/{sha8}/files/{path} ou POST /v1/publish/model/{sha8}/commit' );

	}

	// /v1/publish/<id>/(files/<path...> | commit)
	const id = parts[ 1 ] ?? '';
	if ( ! ID_RE.test( id ) ) return err( 422, 'id_invalide', 'snapshot_id = <stem>[_<scénario>]_<sha8>' );
	const committed = await b.head( `snapshots/${ id }/_commit.json` );
	if ( parts.length === 3 && parts[ 2 ] === 'commit' && request.method === 'POST' ) return commitSnapshot( request, b, id, committed );
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

		return err( 500, 'erreur_interne', String( e?.message ?? e ) );

	}

}
