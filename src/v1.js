// API /v1 du tableau de bord, adossée à R2 (binding SNAPSHOTS, bucket atom-snapshots).
//
// Lecture (publique, sans clé) : le tableau de bord ne lit QUE des instantanés publiés, jamais le GPU.
// Publication (jeton PUBLISH_TOKEN, remis hors salon) : le service PC-FNO3D dépose les fichiers
// d'un instantané, puis /commit vérifie taille + sha256 de chacun et bascule latest atomiquement.
// Contrat : contract/openapi.yaml et contract/README.md.
//
// Disposition R2 :
//   snapshots/<id>/<path>          fichiers de l'instantané (meta.json, terrain.f32, fields/<k>_<var>.f32, ...)
//   snapshots/<id>/_commit.json    manifeste vérifié + published_at  (présent = instantané immuable)
//   latest.json                    pointeur vers le dernier instantané commité
//   index/times.json               liste des instantanés commités (du plus récent au plus ancien)
//   heartbeat.json                 dernier battement de cœur du service GPU

const MAX_BYTES = 8 * 1024 * 1024;
const HEARTBEAT_TTL_MS = 5 * 60 * 1000;
const ID_RE = /^[0-9A-Za-z_]+_[0-9a-f]{8}$/;
const PATH_RE = /^[a-z0-9_./-]+$/;
const VARS = new Set( [ 'u', 'v', 'w', 'speed', 'sigma_u', 'sigma_v', 'sigma_w', 'coverage', 'reliability', 'status' ] );

// Fichier JSON servi pour chaque ressource de lecture d'un instantané.
const RESOURCE_FILE = {
	snapshots: 'snapshot.json', quality: 'quality.json', alerts: 'alerts.json',
	stations: 'stations.json', 'wind-farm': 'wind-farm.json', profiles: 'profile.json',
};

const json = ( body, status = 200, extra = {} ) => new Response( JSON.stringify( body ), {
	status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
} );
const err = ( status, error, message ) => json( { error, message }, status );

async function readJSON( bucket, key ) {

	const o = await bucket.get( key );
	return o ? o.json() : null;

}

async function sha256Hex( buf ) {

	const d = await crypto.subtle.digest( 'SHA-256', buf );
	return [ ...new Uint8Array( d ) ].map( ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );

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

// Instantané « courant » d'une requête : l'identifiant explicite, sinon latest.
async function resolveId( bucket, id ) {

	if ( id && id !== 'latest' ) return ID_RE.test( id ) ? id : null;
	const latest = await readJSON( bucket, 'latest.json' );
	return latest?.snapshot_id ?? null;

}

async function serveObject( bucket, key, contentType, immutable ) {

	const o = await bucket.get( key );
	if ( ! o ) return err( 404, 'absent', key.split( '/' ).slice( 2 ).join( '/' ) || key );
	return new Response( o.body, { headers: {
		'content-type': contentType,
		'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
		etag: o.httpEtag,
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

// --- Lecture ---------------------------------------------------------------------------------

async function handleRead( request, env, parts, url ) {

	const b = env.SNAPSHOTS;
	const [ resource, a, c, d ] = parts; // /v1/<resource>/<a>/<c>/<d>

	if ( resource === 'latest' ) return latest( env );

	if ( resource === 'meta' || resource === 'terrain' ) {

		const id = await resolveId( b, url.searchParams.get( 'snapshot' ) );
		if ( ! id ) return err( 404, 'aucun_instantane', 'Aucun instantané publié.' );
		return resource === 'meta'
			? serveObject( b, `snapshots/${ id }/meta.json`, 'application/json; charset=utf-8', false )
			: serveObject( b, `snapshots/${ id }/terrain.f32`, 'application/octet-stream', true );

	}

	if ( resource === 'times' ) {

		const all = ( await readJSON( b, 'index/times.json' ) ) ?? [];
		const from = url.searchParams.get( 'from' ), to = url.searchParams.get( 'to' );
		const items = all.filter( ( t ) => ( ! from || t.valid_time >= from ) && ( ! to || t.valid_time <= to ) );
		const start = Number( url.searchParams.get( 'cursor' ) ?? 0 ) || 0, page = 200;
		return json( { total: items.length, next: start + page < items.length ? String( start + page ) : null, items: items.slice( start, start + page ) } );

	}

	if ( resource === 'windrose' ) {

		// Pré-calculée par le service pour les éoliennes déclarées (dernier instantané).
		const id = await resolveId( b, url.searchParams.get( 'snapshot' ) );
		if ( ! id ) return err( 404, 'aucun_instantane', 'Aucun instantané publié.' );
		return serveObject( b, `snapshots/${ id }/windrose.json`, 'application/json; charset=utf-8', false );

	}

	if ( resource === 'fields' ) {

		const id = await resolveId( b, a );
		const level = Number( c );
		if ( ! id || ! Number.isInteger( level ) || level < 0 || ! VARS.has( d ) ) return err( 422, 'requete_invalide', 'Attendu /v1/fields/{id}/{niveau 0..nz-1}/{variable}' );
		return serveObject( b, `snapshots/${ id }/fields/${ level }_${ d }.f32`, 'application/octet-stream', a !== 'latest' );

	}

	if ( RESOURCE_FILE[ resource ] ) {

		const id = await resolveId( b, a );
		if ( ! id ) return err( 404, 'absent', 'Instantané inconnu.' );
		return serveObject( b, `snapshots/${ id }/${ RESOURCE_FILE[ resource ] }`, 'application/json; charset=utf-8', a !== 'latest' );

	}

	return err( 404, 'route_inconnue', url.pathname );

}

// --- Publication -----------------------------------------------------------------------------

async function handlePublish( request, env, parts ) {

	if ( ! authorized( request, env ) ) return err( 401, 'non_autorise', 'Jeton de publication absent ou invalide.' );
	const b = env.SNAPSHOTS;

	if ( parts[ 0 ] === 'heartbeat' ) {

		await b.put( 'heartbeat.json', JSON.stringify( { at: new Date().toISOString() } ), { httpMetadata: { contentType: 'application/json' } } );
		return new Response( null, { status: 204 } );

	}

	const id = parts[ 1 ];
	if ( ! ID_RE.test( id ?? '' ) ) return err( 422, 'id_invalide', 'snapshot_id = <stem>_<sha8>' );
	const committed = await b.head( `snapshots/${ id }/_commit.json` );

	// POST /v1/publish/<id>/commit
	if ( parts.length === 3 && parts[ 2 ] === 'commit' && request.method === 'POST' ) {

		// Commit rejoué (réponse perdue côté client) : succès idempotent, rien ne change.
		if ( committed ) return json( { ok: true, snapshot_id: id, unchanged: true } );
		let m;
		try { m = await request.json(); } catch { return err( 422, 'json_invalide', 'Manifeste illisible.' ); }
		if ( m?.snapshot_id !== id || ! Array.isArray( m.files ) || m.files.length === 0 || ! m.valid_time || ! m.versions ) return err( 422, 'manifeste_invalide', 'Voir contract/schemas/publish-manifest.schema.json' );
		const required = [ 'meta.json', 'snapshot.json', 'terrain.f32' ];
		const listed = new Set( m.files.map( ( f ) => f.path ) );
		const missingRequired = required.filter( ( p ) => ! listed.has( p ) );
		if ( missingRequired.length ) return err( 422, 'fichier_manquant', `Obligatoires absents du manifeste : ${ missingRequired.join( ', ' ) }` );

		const problems = [];
		await Promise.all( m.files.map( async ( f ) => {

			const o = await b.head( `snapshots/${ id }/${ f.path }` );
			if ( ! o ) return problems.push( `${ f.path } : absent` );
			if ( o.size !== f.bytes ) return problems.push( `${ f.path } : ${ o.size } octets, attendu ${ f.bytes }` );
			if ( o.customMetadata?.sha256 !== f.sha256 ) problems.push( `${ f.path } : sha256 différent` );

		} ) );
		if ( problems.length ) return json( { error: 'publication_refusee', message: 'latest inchangé', problems: problems.slice( 0, 50 ) }, 422 );

		const publishedAt = new Date().toISOString();
		const meta = await readJSON( b, `snapshots/${ id }/meta.json` );
		const latestDoc = {
			snapshot_id: id, valid_time: m.valid_time, generated_at: m.generated_at ?? publishedAt, published_at: publishedAt,
			last_observation_at: m.last_observation_at ?? null, data_status: m.data_status === 'degrade' ? 'degrade' : 'complete',
			versions: m.versions, href: `/v1/snapshots/${ id }`, grid: meta?.grid ? { nx: meta.grid.nx, ny: meta.grid.ny, nz: meta.grid.nz } : undefined,
		};
		// Ordre : d'abord l'instantané devient immuable, puis l'index, puis latest en dernier.
		await b.put( `snapshots/${ id }/_commit.json`, JSON.stringify( { ...m, published_at: publishedAt } ), { httpMetadata: { contentType: 'application/json' } } );
		const times = ( ( await readJSON( b, 'index/times.json' ) ) ?? [] ).filter( ( t ) => t.snapshot_id !== id );
		times.push( { snapshot_id: id, valid_time: m.valid_time } );
		times.sort( ( p, q ) => ( p.valid_time < q.valid_time ? 1 : - 1 ) );
		await b.put( 'index/times.json', JSON.stringify( times ), { httpMetadata: { contentType: 'application/json' } } );
		const current = await readJSON( b, 'latest.json' );
		if ( ! current || current.valid_time <= m.valid_time ) {

			const { grid, ...doc } = latestDoc; // grid sert seulement aux journaux
			await b.put( 'latest.json', JSON.stringify( doc ), { httpMetadata: { contentType: 'application/json' } } );

		}
		return json( { ok: true, snapshot_id: id, published_at: publishedAt, files: m.files.length } );

	}

	// PUT /v1/publish/<id>/<path...>
	if ( request.method === 'PUT' && parts.length >= 3 ) {

		const rel = parts.slice( 2 ).join( '/' );
		if ( ! PATH_RE.test( rel ) || rel.includes( '..' ) || rel.startsWith( '_' ) ) return err( 422, 'chemin_invalide', rel );
		const declared = ( request.headers.get( 'x-content-sha256' ) || '' ).toLowerCase();
		if ( ! /^[0-9a-f]{64}$/.test( declared ) ) return err( 422, 'sha256_absent', 'En-tête X-Content-SHA256 obligatoire.' );
		const len = Number( request.headers.get( 'content-length' ) || 0 );
		if ( len > MAX_BYTES ) return err( 413, 'trop_gros', `${ MAX_BYTES } octets maximum par fichier.` );

		const key = `snapshots/${ id }/${ rel }`;
		const existing = await b.head( key );
		if ( existing && existing.customMetadata?.sha256 === declared ) return json( { ok: true, path: rel, unchanged: true }, 200 );
		if ( committed ) return err( 409, 'deja_commite', 'Instantané immuable.' );

		const buf = await request.arrayBuffer();
		if ( buf.byteLength > MAX_BYTES ) return err( 413, 'trop_gros', `${ MAX_BYTES } octets maximum par fichier.` );
		const actual = await sha256Hex( buf );
		if ( actual !== declared ) return err( 422, 'sha256_different', `Reçu ${ actual }` );
		const contentType = rel.endsWith( '.json' ) ? 'application/json' : 'application/octet-stream';
		await b.put( key, buf, { httpMetadata: { contentType }, customMetadata: { sha256: actual } } );
		return json( { ok: true, path: rel, bytes: buf.byteLength }, 201 );

	}

	return err( 405, 'methode', 'PUT /v1/publish/{id}/{path} ou POST /v1/publish/{id}/commit' );

}

export async function handleV1( request, env, url ) {

	if ( ! env.SNAPSHOTS ) return err( 503, 'r2_absent', 'Binding SNAPSHOTS non configuré.' );
	const parts = url.pathname.replace( /^\/v1\/?/, '' ).split( '/' ).filter( Boolean ).map( decodeURIComponent );
	try {

		if ( parts[ 0 ] === 'publish' || ( parts[ 0 ] === 'heartbeat' && request.method === 'POST' ) ) return await handlePublish( request, env, parts );
		if ( request.method !== 'GET' && request.method !== 'HEAD' ) return err( 405, 'methode', 'Lecture seule.' );
		return await handleRead( request, env, parts, url );

	} catch ( e ) {

		return err( 500, 'erreur_interne', String( e?.message ?? e ) );

	}

}
