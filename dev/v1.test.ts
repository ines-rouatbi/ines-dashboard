// Tests du Worker /v1 (src/v1.js) sur un faux binding R2 en mémoire, avec les instantanés de test du contrat.
//   - publication : sha256, Content-Length obligatoire, 8 Mo, commit refusé sans effet ;
//   - commit interrompu après _commit.json puis rejoué : index et latest rattrapés, de façon idempotente ;
//   - simulation (scenario ≠ null) : publiée et lisible par son id, jamais dans latest ni dans l'index ;
//   - instantané de test (data_kind = "test") refusé sauf ATOM_ALLOW_TEST_SNAPSHOTS = "1" ;
//   - /v1/column : nombre de lectures R2 compté (limite de 50 sous-requêtes de l'offre gratuite) ;
//   - erreur interne : message générique avec une référence, détail seulement dans le journal.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleV1 } from '../src/v1.js';

const racine = resolve( fileURLToPath( new URL( '..', import.meta.url ) ), 'contract/fixtures' );
const JETON = 'jeton-de-test-local';
const sha256 = ( b: Uint8Array | string ) => createHash( 'sha256' ).update( b ).digest( 'hex' );

// --- Faux binding R2 -------------------------------------------------------------------------

interface Stocke { octets: Uint8Array; customMetadata: Record<string, string>; etag: string }

class FauxR2 {

	readonly objets = new Map<string, Stocke>();
	appels = { get: 0, head: 0, put: 0, list: 0 };
	private version = 0;
	/** Mises en attente aléatoires (0 à 2 tâches) : entrelace vraiment les commits concurrents. */
	entrelacer = false;
	private async pause() { if ( this.entrelacer ) for ( let k = Math.floor( Math.random() * 3 ); k > 0; k -- ) await new Promise( ( ok ) => setTimeout( ok, 0 ) ); }
	octetsLus = 0;
	/** Clé dont l'écriture échoue (panne simulée), ou null. */
	panne: ( ( key: string ) => boolean ) | null = null;
	/** Taille des morceaux des corps en flux (petite : teste les frontières de morceaux). */
	morceau = 7;

	private objet( key: string, s: Stocke, octets: Uint8Array ) {

		const morceau = this.morceau;
		return {
			key, size: s.octets.byteLength, customMetadata: s.customMetadata, etag: s.etag, httpEtag: `"${ s.etag }"`,
			get body() {

				let p = 0;
				return new ReadableStream<Uint8Array>( {
					pull( c ) { if ( p >= octets.length ) { c.close(); return; } c.enqueue( octets.slice( p, p + morceau ) ); p += morceau; },
				} );

			},
			arrayBuffer: async () => octets.slice().buffer,
			json: async () => JSON.parse( new TextDecoder().decode( octets ) ),
		};

	}

	async head( key: string ) {

		this.appels.head ++;
		await this.pause();
		const s = this.objets.get( key );
		return s ? this.objet( key, s, new Uint8Array() ) : null;

	}

	async get( key: string, opts?: { range?: { offset: number; length: number } } ) {

		this.appels.get ++;
		await this.pause();
		const s = this.objets.get( key );
		if ( ! s ) return null;
		const octets = opts?.range ? s.octets.slice( opts.range.offset, opts.range.offset + opts.range.length ) : s.octets;
		this.octetsLus += octets.byteLength;
		return this.objet( key, s, octets );

	}

	async put( key: string, v: string | ArrayBuffer | Uint8Array, o?: { customMetadata?: Record<string, string>; onlyIf?: { etagMatches?: string } } ) {

		this.appels.put ++;
		await this.pause();
		if ( this.panne?.( key ) ) throw new Error( `R2 indisponible (simulé) : ${ key }` );
		// Écriture conditionnelle (R2 : onlyIf) : null si l'etag ne correspond plus.
		if ( o?.onlyIf?.etagMatches !== undefined && this.objets.get( key )?.etag !== o.onlyIf.etagMatches ) return null;
		const octets = typeof v === 'string' ? new TextEncoder().encode( v ) : v instanceof Uint8Array ? v.slice() : new Uint8Array( v.slice( 0 ) );
		const s = { octets, customMetadata: o?.customMetadata ?? {}, etag: `e${ ++ this.version }` };
		this.objets.set( key, s );
		return this.objet( key, s, octets );

	}

	async list( o: { prefix?: string; cursor?: string; limit?: number } = {} ) {

		this.appels.list ++;
		await this.pause();
		// Pages de 2 objets : exerce la pagination (cursor) du Worker.
		const cles = [ ...this.objets.keys() ].filter( ( k ) => k.startsWith( o.prefix ?? '' ) ).sort();
		const debut = Number( o.cursor ?? 0 ), fin = Math.min( cles.length, debut + Math.min( 2, o.limit ?? 1000 ) );
		const objects = cles.slice( debut, fin ).map( ( k ) => ( { key: k, customMetadata: this.objets.get( k )!.customMetadata } ) );
		return fin < cles.length ? { objects, truncated: true, cursor: String( fin ) } : { objects, truncated: false };

	}

	lireJSON( key: string ) { const s = this.objets.get( key ); return s ? JSON.parse( new TextDecoder().decode( s.octets ) ) : null; }

	remettreCompteurs() { this.appels = { get: 0, head: 0, put: 0, list: 0 }; this.octetsLus = 0; }

}

// --- Client de publication (comme contract/tools/publish.mjs) ------------------------------------

type Env = { SNAPSHOTS: FauxR2; PUBLISH_TOKEN: string; ATOM_ALLOW_TEST_SNAPSHOTS?: string };

async function appel( env: Env, method: string, chemin: string, corps?: Uint8Array | string, entetes: Record<string, string> = {} ) {

	const url = new URL( `http://atom.local${ chemin }` );
	const h: Record<string, string> = { authorization: `Bearer ${ JETON }`, ...entetes };
	if ( corps !== undefined && ! ( 'content-length' in entetes ) ) h[ 'content-length' ] = String( typeof corps === 'string' ? new TextEncoder().encode( corps ).byteLength : corps.byteLength );
	const r: Response = await handleV1( new Request( url, { method, body: corps, headers: h } ), env, url );
	const type = r.headers.get( 'content-type' ) ?? '';
	// Réponses JSON lues champ par champ dans les tests.
	const reponse: any = type.includes( 'json' ) ? await r.json() : await r.arrayBuffer();
	return { status: r.status, corps: reponse, r };

}

interface Fichier { path: string; bytes: number; sha256: string }
interface Scenario { manifeste: { snapshot_id: string; files: Fichier[]; [ k: string ]: unknown }; fichiers: Map<string, Uint8Array>; modele: { manifeste: { files: Fichier[] }; fichiers: Map<string, Uint8Array> }; sha8: string }

function charger( sc: string ): Scenario {

	const dir = join( racine, sc );
	const manifeste = JSON.parse( readFileSync( join( dir, 'publish-manifest.json' ), 'utf8' ) );
	const sha8 = manifeste.snapshot_id.slice( - 8 );
	const fichiers = new Map<string, Uint8Array>( manifeste.files.map( ( f: Fichier ) => [ f.path, new Uint8Array( readFileSync( join( dir, f.path ) ) ) ] ) );
	const mdir = join( dir, 'models', sha8 );
	const mm = JSON.parse( readFileSync( join( mdir, 'model-manifest.json' ), 'utf8' ) );
	const mf = new Map<string, Uint8Array>( mm.files.map( ( f: Fichier ) => [ f.path, new Uint8Array( readFileSync( join( mdir, f.path ) ) ) ] ) );
	return { manifeste, fichiers, modele: { manifeste: mm, fichiers: mf }, sha8 };

}

/** Variante simulation d'un scénario : snapshot.json avec scenario ≠ null, nouvel identifiant, manifeste recalculé. */
function simulation( base: Scenario ): Scenario {

	return variante( base, base.manifeste.snapshot_id.replace( /_([0-9a-f]{8})$/, '_panne_zone_$1' ), ( snap ) => {

		snap.scenario = { kind: 'panne_zone', zone: { x_min_m: 0, x_max_m: 10000, y_min_m: 0, y_max_m: 10000 }, baseline_snapshot_id: base.manifeste.snapshot_id };

	} );

}

/** Variante d'un scénario : nouvel identifiant, snapshot.json modifié, manifeste recalculé (valid_time compris). */
function variante( base: Scenario, id: string, modifier: ( snap: Record<string, any> ) => void = () => {} ): Scenario {

	const snap = JSON.parse( new TextDecoder().decode( base.fichiers.get( 'snapshot.json' )! ) );
	snap.snapshot_id = id;
	modifier( snap );
	const octets = new TextEncoder().encode( JSON.stringify( snap ) );
	const fichiers = new Map( base.fichiers ); fichiers.set( 'snapshot.json', octets );
	const files = base.manifeste.files.map( ( f ) => f.path === 'snapshot.json' ? { path: f.path, bytes: octets.byteLength, sha256: sha256( octets ) } : f );
	return { ...base, manifeste: { ...base.manifeste, snapshot_id: id, valid_time: snap.valid_time, files }, fichiers };

}

async function deposer( env: Env, s: Scenario ) {

	for ( const f of s.modele.manifeste.files ) {

		const r = await appel( env, 'PUT', `/v1/publish/model/${ s.sha8 }/files/${ encodeURIComponent( f.path ) }`, s.modele.fichiers.get( f.path ), { 'x-content-sha256': f.sha256 } );
		expect( r.status, `modèle ${ f.path }` ).toBeLessThan( 300 );

	}
	const rm = await appel( env, 'POST', `/v1/publish/model/${ s.sha8 }/commit`, JSON.stringify( s.modele.manifeste ) );
	expect( rm.status, JSON.stringify( rm.corps ) ).toBe( 200 );
	for ( const f of s.manifeste.files ) {

		const r = await appel( env, 'PUT', `/v1/publish/${ s.manifeste.snapshot_id }/files/${ encodeURIComponent( f.path ) }`, s.fichiers.get( f.path ), { 'x-content-sha256': f.sha256 } );
		expect( r.status, f.path ).toBeLessThan( 300 );

	}

}

/** Index lu par l'API, comme le client Python : GET /v1/times[?from&to]. */
async function times( env: Env, q = '' ): Promise<{ snapshot_id: string; valid_time: string; open_alerts: number | null }[]> {

	const r = await appel( env, 'GET', `/v1/times${ q }` );
	expect( r.status ).toBe( 200 );
	return r.corps.items;

}

const commit = ( env: Env, s: Scenario ) => appel( env, 'POST', `/v1/publish/${ s.manifeste.snapshot_id }/commit`, JSON.stringify( s.manifeste ) );

// --- Tests -----------------------------------------------------------------------------------

describe.skipIf( ! existsSync( racine ) )( 'Worker /v1 (src/v1.js) sur faux R2', () => {

	let env: Env;
	beforeEach( () => { env = { SNAPSHOTS: new FauxR2(), PUBLISH_TOKEN: JETON, ATOM_ALLOW_TEST_SNAPSHOTS: '1' }; } );
	afterEach( () => { vi.restoreAllMocks(); } );

	it( 'publication nominale : latest et index pointent sur l’instantané', async () => {

		const s = charger( 'normal' );
		await deposer( env, s );
		const r = await commit( env, s );
		expect( r.status ).toBe( 200 );
		expect( r.corps ).toMatchObject( { ok: true, latest: true, simulation: false } );
		expect( env.SNAPSHOTS.lireJSON( 'latest.json' ).snapshot_id ).toBe( s.manifeste.snapshot_id );
		expect( ( await times( env ) ).map( ( t ) => t.snapshot_id ) ).toEqual( [ s.manifeste.snapshot_id ] );

	} );

	it( 'panne après _commit.json, puis commit rejoué : index et latest rattrapés, idempotent', async () => {

		const s = charger( 'normal' );
		await deposer( env, s );
		env.SNAPSHOTS.panne = ( k ) => k.startsWith( 'index/times/' );
		vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		const r1 = await commit( env, s );
		expect( r1.status ).toBe( 500 );
		expect( env.SNAPSHOTS.objets.has( `snapshots/${ s.manifeste.snapshot_id }/_commit.json` ) ).toBe( true );
		expect( env.SNAPSHOTS.objets.has( 'latest.json' ) ).toBe( false );

		env.SNAPSHOTS.panne = null;
		const r2 = await commit( env, s );
		expect( r2.status ).toBe( 200 );
		expect( r2.corps ).toMatchObject( { ok: true, unchanged: true, latest: true } );
		const latest = env.SNAPSHOTS.lireJSON( 'latest.json' );
		const vt = encodeURIComponent( s.manifeste.valid_time as string );
		const index = await times( env, `?from=${ vt }&to=${ vt }` );
		expect( latest.snapshot_id ).toBe( s.manifeste.snapshot_id );
		expect( latest.published_at ).toBe( env.SNAPSHOTS.lireJSON( `snapshots/${ s.manifeste.snapshot_id }/_commit.json` ).published_at );
		expect( index ).toEqual( [ { snapshot_id: s.manifeste.snapshot_id, valid_time: s.manifeste.valid_time, open_alerts: 1 } ] ); // somme de snapshot.kpi.open_alerts (normal : 1)

		// Un troisième commit ne change rien (octets identiques).
		const cles = () => [ ...env.SNAPSHOTS.objets.keys() ].filter( ( k ) => k === 'latest.json' || k.startsWith( 'index/' ) ).sort();
		const avant = cles().map( ( k ) => `${ k } ${ sha256( env.SNAPSHOTS.objets.get( k )!.octets ) } ${ JSON.stringify( env.SNAPSHOTS.objets.get( k )!.customMetadata ) }` );
		expect( ( await commit( env, s ) ).status ).toBe( 200 );
		expect( cles().map( ( k ) => `${ k } ${ sha256( env.SNAPSHOTS.objets.get( k )!.octets ) } ${ JSON.stringify( env.SNAPSHOTS.objets.get( k )!.customMetadata ) }` ) ).toEqual( avant );

		const lu = await appel( env, 'GET', '/v1/latest' );
		expect( lu.status ).toBe( 200 );
		expect( lu.corps.snapshot_id ).toBe( s.manifeste.snapshot_id );

	} );

	it( 'index : open_alerts = somme de snapshot.kpi.open_alerts, null (jamais 0) si M4 est inactif', async () => {

		const base = charger( 'capteur_en_derive' ); // kpi.open_alerts = 1 + 1 + 1 + 0
		const sansM4 = variante( base, 'live_20250112_130000_e44d68da', ( snap ) => { snap.valid_time = '2025-01-12T13:00:00Z'; snap.kpi.open_alerts = null; } );
		const sansKpi = variante( base, 'live_20250112_140000_e44d68da', ( snap ) => { snap.valid_time = '2025-01-12T14:00:00Z'; snap.kpi = null; } );
		const zero = variante( base, 'live_20250112_150000_e44d68da', ( snap ) => { snap.valid_time = '2025-01-12T15:00:00Z'; snap.kpi.open_alerts = { information: 0, avertissement: 0, important: 0, critique: 0 }; } );
		for ( const s of [ base, sansM4, sansKpi, zero ] ) { await deposer( env, s ); expect( ( await commit( env, s ) ).status ).toBe( 200 ); }
		const parId = Object.fromEntries( ( await times( env ) ).map( ( t ) => [ t.snapshot_id, t.open_alerts ] ) );
		expect( parId ).toEqual( { [ base.manifeste.snapshot_id ]: 3, [ sansM4.manifeste.snapshot_id ]: null, [ sansKpi.manifeste.snapshot_id ]: null, [ zero.manifeste.snapshot_id ]: 0 } );

	} );

	it( 'commits concurrents : aucune entrée d’index perdue, latest = le plus récent, /v1/times paginé', async () => {

		const base = charger( 'normal' );
		await deposer( env, base );
		const heures = [ 13, 9, 17, 11, 15, 10, 16 ];
		const vs = heures.map( ( h ) => variante( base, `live_20250112_${ String( h ).padStart( 2, '0' ) }0000_e44d68da`, ( snap ) => { snap.valid_time = `2025-01-12T${ String( h ).padStart( 2, '0' ) }:00:00Z`; } ) );
		for ( const v of vs ) await deposer( env, v );
		env.SNAPSHOTS.entrelacer = true;
		for ( let tour = 0; tour < 3; tour ++ ) {

			const rs = await Promise.all( vs.map( ( v ) => commit( env, v ) ) );
			expect( rs.map( ( r ) => r.status ) ).toEqual( vs.map( () => 200 ) );

		}
		env.SNAPSHOTS.entrelacer = false;
		const index = await times( env );
		expect( index.map( ( t ) => t.valid_time ) ).toEqual( [ ...heures ].sort( ( a, b ) => b - a ).map( ( h ) => `2025-01-12T${ String( h ).padStart( 2, '0' ) }:00:00Z` ) );
		expect( env.SNAPSHOTS.lireJSON( 'latest.json' ).valid_time ).toBe( '2025-01-12T17:00:00Z' );
		expect( await times( env, '?from=2025-01-12T10:00:00Z&to=2025-01-12T13:00:00Z' ) ).toHaveLength( 3 );

	} );

	it( 'commit refusé : rien n’est écrit (ni _commit.json, ni index, ni latest)', async () => {

		const s = charger( 'capteur_en_derive' );
		await deposer( env, s );
		const altere = { ...s.manifeste, files: [ ...s.manifeste.files, { path: 'absent.json', bytes: 2, sha256: 'b'.repeat( 64 ) } ] };
		const r = await appel( env, 'POST', `/v1/publish/${ s.manifeste.snapshot_id }/commit`, JSON.stringify( altere ) );
		expect( r.status ).toBe( 422 );
		for ( const k of [ `snapshots/${ s.manifeste.snapshot_id }/_commit.json`, 'latest.json' ] ) expect( env.SNAPSHOTS.objets.has( k ), k ).toBe( false );
		expect( await times( env ) ).toEqual( [] );

	} );

	it( 'un commit rejoué d’un instantané plus ancien ne reprend pas latest', async () => {

		const a = charger( 'normal' ), b = charger( 'capteur_en_derive' ); // même valid_time
		await deposer( env, a ); await deposer( env, b );
		expect( ( await commit( env, a ) ).status ).toBe( 200 );
		await new Promise( ( ok ) => setTimeout( ok, 5 ) );
		expect( ( await commit( env, b ) ).status ).toBe( 200 );
		expect( env.SNAPSHOTS.lireJSON( 'latest.json' ).snapshot_id ).toBe( b.manifeste.snapshot_id );
		const r = await commit( env, a );
		expect( r.corps ).toMatchObject( { unchanged: true, latest: false } );
		expect( env.SNAPSHOTS.lireJSON( 'latest.json' ).snapshot_id ).toBe( b.manifeste.snapshot_id );
		expect( await times( env ) ).toHaveLength( 2 );

	} );

	it( 'simulation (scenario ≠ null) : lisible par son id, jamais dans latest ni dans l’index', async () => {

		const base = charger( 'normal' ), sim = simulation( base );
		await deposer( env, base );
		expect( ( await commit( env, base ) ).status ).toBe( 200 );
		await deposer( env, sim );
		const r = await commit( env, sim );
		expect( r.status, JSON.stringify( r.corps ) ).toBe( 200 );
		expect( r.corps ).toMatchObject( { simulation: true, latest: false } );
		expect( env.SNAPSHOTS.lireJSON( 'latest.json' ).snapshot_id ).toBe( base.manifeste.snapshot_id );
		expect( ( await times( env ) ).map( ( t ) => t.snapshot_id ) ).toEqual( [ base.manifeste.snapshot_id ] );
		const lu = await appel( env, 'GET', `/v1/snapshots/${ sim.manifeste.snapshot_id }` );
		expect( lu.status ).toBe( 200 );
		expect( lu.corps.scenario.kind ).toBe( 'panne_zone' );
		// Rejouée, elle ne bascule toujours pas.
		expect( ( await commit( env, sim ) ).corps ).toMatchObject( { simulation: true, latest: false } );
		expect( env.SNAPSHOTS.lireJSON( 'latest.json' ).snapshot_id ).toBe( base.manifeste.snapshot_id );

	} );

	it( 'simulation publiée seule : latest reste absent', async () => {

		const sim = simulation( charger( 'gpu_eteint' ) );
		await deposer( env, sim );
		expect( ( await commit( env, sim ) ).status ).toBe( 200 );
		expect( env.SNAPSHOTS.objets.has( 'latest.json' ) ).toBe( false );
		expect( ( await appel( env, 'GET', '/v1/latest' ) ).status ).toBe( 404 );

	} );

	it( 'instantané de test refusé sans ATOM_ALLOW_TEST_SNAPSHOTS (modèle et instantané)', async () => {

		const s = charger( 'normal' );
		await deposer( env, s ); // modèle commité avec l'autorisation
		delete env.ATOM_ALLOW_TEST_SNAPSHOTS;
		const r = await commit( env, s );
		expect( r.status ).toBe( 422 );
		expect( r.corps.error ).toBe( 'instantane_de_test' );
		expect( env.SNAPSHOTS.objets.has( `snapshots/${ s.manifeste.snapshot_id }/_commit.json` ) ).toBe( false );
		expect( env.SNAPSHOTS.objets.has( 'latest.json' ) ).toBe( false );

		const env2: Env = { SNAPSHOTS: new FauxR2(), PUBLISH_TOKEN: JETON };
		for ( const f of s.modele.manifeste.files ) await appel( env2, 'PUT', `/v1/publish/model/${ s.sha8 }/files/${ encodeURIComponent( f.path ) }`, s.modele.fichiers.get( f.path ), { 'x-content-sha256': f.sha256 } );
		const rm = await appel( env2, 'POST', `/v1/publish/model/${ s.sha8 }/commit`, JSON.stringify( s.modele.manifeste ) );
		expect( rm.status ).toBe( 422 );
		expect( rm.corps.error ).toBe( 'instantane_de_test' );

		// « 0 », « true » ou toute autre valeur que « 1 » n'autorise rien.
		env.ATOM_ALLOW_TEST_SNAPSHOTS = 'true';
		expect( ( await commit( env, s ) ).status ).toBe( 422 );

	} );

	it( 'PUT : Content-Length obligatoire, 8 Mo maximum, sha256 vérifié', async () => {

		const id = 'live_20260101_000000_ffffffff';
		const sansLongueur = new Request( new URL( `http://atom.local/v1/publish/${ id }/files/x.json` ), {
			method: 'PUT', headers: { authorization: `Bearer ${ JETON }`, 'x-content-sha256': 'a'.repeat( 64 ) }, body: '{}',
		} );
		expect( ( await handleV1( sansLongueur, env, new URL( sansLongueur.url ) ) ).status ).toBe( 411 );
		expect( ( await appel( env, 'PUT', `/v1/publish/${ id }/files/x.json`, '{}', { 'x-content-sha256': 'a'.repeat( 64 ), 'content-length': 'abc' } ) ).status ).toBe( 411 );
		expect( ( await appel( env, 'PUT', `/v1/publish/${ id }/files/x.json`, new Uint8Array( 8 * 1024 * 1024 + 1 ), { 'x-content-sha256': 'a'.repeat( 64 ) } ) ).status ).toBe( 413 );
		const faux = await appel( env, 'PUT', `/v1/publish/${ id }/files/x.json`, '{}', { 'x-content-sha256': 'a'.repeat( 64 ) } );
		expect( faux.status ).toBe( 422 );
		expect( faux.corps.error ).toBe( 'sha256_different' );
		expect( ( await appel( env, 'PUT', `/v1/publish/${ id }/files/${ encodeURIComponent( '../latest.json' ) }`, '{}', { 'x-content-sha256': sha256( '{}' ) } ) ).status ).toBe( 422 );
		expect( ( await appel( env, 'PUT', `/v1/publish/${ id }/files/x.json`, '{}', { 'x-content-sha256': sha256( '{}' ) } ) ).status ).toBe( 201 );

	} );

	it( '/v1/column : variables non publiées par le modèle (M2 inactif) présentes à null, comme l’exige le schéma', async () => {

		// Cas des vrais instantanés v7 publiés par M6 (lot F6) : meta.fields = u, v, w, speed.
		const s = charger( 'normal' );
		await deposer( env, s );
		await commit( env, s );
		const cle = `models/${ s.sha8 }/meta.json`, stocke = env.SNAPSHOTS.objets.get( cle )!;
		const meta = JSON.parse( new TextDecoder().decode( stocke.octets ) );
		meta.fields = [ 'u', 'v', 'w', 'speed' ];
		env.SNAPSHOTS.objets.set( cle, { ...stocke, octets: new TextEncoder().encode( JSON.stringify( meta ) ) } );
		vi.resetModules(); // cache des meta de l'isolat : module neuf
		const { handleV1: frais } = await import( '../src/v1.js' );
		const url = new URL( 'http://atom.local/v1/column/latest?i=10&j=10' );
		const r = await frais( new Request( url ), env, url );
		expect( r.status ).toBe( 200 );
		const corps = await r.json() as { levels: Record<string, unknown>[] };
		for ( const l of corps.levels ) {

			for ( const v of [ 'sigma_speed', 'coverage', 'reliability', 'status' ] ) {

				expect( l, v ).toHaveProperty( v );
				expect( l[ v ] ).toBeNull();

			}

		}
		expect( corps.levels.some( ( l ) => typeof l.speed === 'number' ) ).toBe( true );

	} );

	it( '/v1/column : 1 + len(meta.fields) lectures R2 au plus (< 50), valeurs identiques aux champs publiés', async () => {

		const s = charger( 'normal' );
		await deposer( env, s );
		await commit( env, s );
		const meta = JSON.parse( new TextDecoder().decode( s.modele.fichiers.get( 'meta.json' )! ) );
		const { nx, ny, nz, levels_asl_m: niveaux, min_agl_m } = meta.grid;
		const NN = nx * ny;
		const terrain = new Float32Array( s.modele.fichiers.get( 'terrain.f32' )!.slice().buffer );
		// Une colonne en plaine (tous niveaux ou presque) et la colonne au relief le plus haut.
		let haut = 0; for ( let k = 1; k < NN; k ++ ) if ( terrain[ k ] > terrain[ haut ] ) haut = k;
		let bas = 0; for ( let k = 1; k < NN; k ++ ) if ( terrain[ k ] < terrain[ bas ] ) bas = k;
		await appel( env, 'GET', '/v1/meta' ); // meta en cache dans l'isolat, comme en production après le 1er appel

		for ( const idx of [ bas, haut, 0, NN - 1, 2 * nx + 37 ] ) {

			const i = idx % nx, j = Math.floor( idx / nx );
			env.SNAPSHOTS.remettreCompteurs();
			const r = await appel( env, 'GET', `/v1/column/latest?i=${ i }&j=${ j }` );
			expect( r.status ).toBe( 200 );
			const lectures = env.SNAPSHOTS.appels.get + env.SNAPSHOTS.appels.head;
			expect( lectures, `colonne (${ i }, ${ j })` ).toBeLessThanOrEqual( 2 + 1 + meta.fields.length ); // latest + _commit + relief + 1 par variable
			expect( lectures ).toBeLessThan( 50 );
			expect( r.corps.levels ).toHaveLength( nz );
			for ( let k = 0; k < nz; k ++ ) {

				const l = r.corps.levels[ k ];
				expect( l.below_terrain ).toBe( niveaux[ k ] - terrain[ idx ] < min_agl_m );
				for ( const v of meta.fields as string[] ) {

					const enc = meta.encoding[ v ], octets = s.fichiers.get( enc.file )!;
					let attendu: number | null;
					if ( enc.dtype === 'uint8' ) { const q = octets[ k * NN + idx ]; attendu = q === 255 ? null : q * ( enc.scale ?? 1 ); }
					else { const x = new DataView( octets.buffer, octets.byteOffset ).getFloat32( ( k * NN + idx ) * 4, true ); attendu = Number.isNaN( x ) ? null : x; }
					expect( l[ v ], `${ v }[k=${ k }] colonne (${ i }, ${ j })` ).toBe( attendu );

				}

			}

		}

	} );

	it( 'erreur interne : message générique avec référence, détail seulement dans le journal', async () => {

		const journal = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		const casse = { ...env, SNAPSHOTS: Object.assign( new FauxR2(), { get: async () => { throw new Error( 'secret-interne-xyz' ); } } ) };
		const r = await appel( casse as unknown as Env, 'GET', '/v1/latest' );
		expect( r.status ).toBe( 500 );
		expect( JSON.stringify( r.corps ) ).not.toContain( 'secret-interne-xyz' );
		expect( r.corps.ref ).toMatch( /^[0-9a-f]{8}$/ );
		expect( String( journal.mock.calls[ 0 ]?.[ 0 ] ) ).toContain( r.corps.ref );
		expect( ( await appel( env, 'GET', '/v1/snapshots/%E0%A4%A' ) ).status ).toBe( 400 );

	} );

} );
