// Développement sans GPU : sert GET /v1/* avec le VRAI code du Worker (src/v1.js), branché
// sur un faux binding R2 qui lit un dossier de scénario de contract/fixtures/.
//
// Une seule implémentation de /v1 (celle de production) : le front de dev voit exactement les
// mêmes réponses, en-têtes compris (x-atom-dtype, lectures partielles, 404 JSON…).
//
// Correspondance clé R2 → fichier du scénario (disposition décrite dans contract/tools/make-fixtures.mjs) :
//   latest.json                   → <sc>/latest.json   (réponse calculée, relue comme pointeur)
//   heartbeat.json                → synthétisé : « maintenant » si le scénario est en ligne, sinon
//                                   le heartbeat_at figé du scénario (donc compute_status = offline)
//   index/times/ (list)           → <sc>/times.json (items), une entrée par instantané
//   models/<sha8>/_commit.json    → <sc>/models/<sha8>/model-manifest.json
//   models/<sha8>/<chemin>        → <sc>/models/<sha8>/<chemin>
//   snapshots/<id>/_commit.json   → <sc>/publish-manifest.json   (si <id> est l'instantané du scénario)
//   snapshots/<id>/<chemin>       → <sc>/<chemin>
// Le faux binding est en lecture seule : la publication (/v1/publish) est refusée (pas de jeton).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleV1 } from '../src/v1.js';

// Segments autorisés dans une clé : pas de « .. », pas de séparateurs exotiques.
const SEG = /^[A-Za-z0-9_.-]+$/;
const sur = ( s: string ) => SEG.test( s ) && s !== '.' && s !== '..';

export interface ObjetR2 {
	readonly key: string;
	readonly size: number;
	readonly httpEtag: string;
	readonly customMetadata: Record<string, string>;
	readonly body: Uint8Array;
	arrayBuffer(): Promise<ArrayBuffer>;
	text(): Promise<string>;
	json(): Promise<unknown>;
}

export interface FauxR2 {
	get( key: string, opts?: { range?: { offset?: number; length?: number } } ): Promise<ObjetR2 | null>;
	head( key: string ): Promise<ObjetR2 | null>;
	put(): Promise<never>;
	list( opts?: { prefix?: string } ): Promise<{ objects: { key: string; customMetadata: Record<string, string> }[]; truncated: false }>;
	delete(): Promise<never>;
}

// Cache des fichiers lus, invalidé par la date de modification : /v1/column fait ~130 lectures
// partielles du même fichier, qu'on ne relit pas à chaque fois (régénérer les fixtures reste pris en compte).
const cacheFichiers = new Map<string, { mtimeMs: number; octets: Uint8Array }>();
function lireFichier( f: string ): Uint8Array | null {

	if ( ! existsSync( f ) ) return null;
	const st = statSync( f );
	if ( ! st.isFile() ) return null;
	const c = cacheFichiers.get( f );
	if ( c && c.mtimeMs === st.mtimeMs ) return c.octets;
	const octets = new Uint8Array( readFileSync( f ) );
	cacheFichiers.set( f, { mtimeMs: st.mtimeMs, octets } );
	return octets;

}
const lireJSON = ( f: string ) => { const o = lireFichier( f ); return o ? JSON.parse( new TextDecoder().decode( o ) ) : null; };

function objet( key: string, octets: Uint8Array ): ObjetR2 {

	const copie = () => octets.buffer.slice( octets.byteOffset, octets.byteOffset + octets.byteLength ) as ArrayBuffer;
	return {
		key, size: octets.byteLength, httpEtag: `"${ octets.byteLength }"`, customMetadata: {}, body: octets,
		arrayBuffer: async () => copie(),
		text: async () => new TextDecoder().decode( octets ),
		json: async () => JSON.parse( new TextDecoder().decode( octets ) ),
	};

}

/**
 * Chemin du fichier qui représente une clé R2 dans le dossier du scénario, ou un contenu
 * synthétisé (heartbeat, index). null = clé absente.
 */
export function resoudreCle( dossier: string, key: string, maintenant = () => new Date() ): { fichier: string } | { contenu: string } | null {

	const parts = key.split( '/' );
	if ( ! parts.every( sur ) ) return null;
	const latestF = join( dossier, 'latest.json' );
	const latest = lireJSON( latestF ) as { snapshot_id?: string; compute_status?: string; heartbeat_at?: string | null } | null;

	if ( key === 'latest.json' ) return latest ? { fichier: latestF } : null;
	if ( key === 'heartbeat.json' ) {

		if ( ! latest || latest.compute_status === 'unknown' ) return null;
		const at = latest.compute_status === 'online' ? maintenant().toISOString() : latest.heartbeat_at;
		return at ? { contenu: JSON.stringify( { at } ) } : null;

	}
	if ( parts[ 0 ] === 'models' && parts.length >= 3 ) {

		const reste = parts.slice( 2 ).join( '/' );
		return { fichier: join( dossier, 'models', parts[ 1 ], reste === '_commit.json' ? 'model-manifest.json' : reste ) };

	}
	if ( parts[ 0 ] === 'snapshots' && parts.length >= 3 ) {

		if ( ! latest || parts[ 1 ] !== latest.snapshot_id ) return null;
		const reste = parts.slice( 2 ).join( '/' );
		if ( reste.startsWith( 'models/' ) ) return null; // les fichiers par modèle ne sont pas dans l'instantané
		return { fichier: join( dossier, reste === '_commit.json' ? 'publish-manifest.json' : reste ) };

	}
	return null;

}

/** Faux binding R2 (lecture seule) sur un dossier de scénario. */
export function fauxR2( dossier: string ): FauxR2 {

	const racine = resolve( dossier );
	const lire = ( key: string ): Uint8Array | null => {

		const r = resoudreCle( racine, key );
		if ( ! r ) return null;
		if ( 'contenu' in r ) return new TextEncoder().encode( r.contenu );
		const f = resolve( r.fichier );
		if ( ! f.startsWith( racine + sep ) ) return null;
		return lireFichier( f );

	};
	const lectureSeule = async (): Promise<never> => { throw new Error( 'faux R2 en lecture seule (fixtures)' ); };

	return {
		async get( key, opts ) {

			const o = lire( key );
			if ( ! o ) return null;
			const off = opts?.range?.offset ?? 0;
			const len = opts?.range?.length ?? o.byteLength - off;
			if ( off > o.byteLength ) return null;
			return objet( key, o.subarray( off, Math.min( o.byteLength, off + len ) ) );

		},
		async head( key ) { const o = lire( key ); return o ? objet( key, new Uint8Array( 0 ) ) : null; },
		put: lectureSeule,
		delete: lectureSeule,
		// Index des instantanés (src/v1.js : index/times/<valid_time>~<id>, données en customMetadata),
		// synthétisé depuis <sc>/times.json. Aucun autre préfixe n'est listé.
		async list( opts ) {

			if ( opts?.prefix !== 'index/times/' ) return { objects: [], truncated: false };
			const t = lireJSON( join( racine, 'times.json' ) ) as { items?: { snapshot_id: string; valid_time: string; open_alerts?: number | null }[] } | null;
			const objects = ( t?.items ?? [] ).map( ( x ) => ( {
				key: `index/times/${ x.valid_time }~${ x.snapshot_id }`,
				customMetadata: { snapshot_id: x.snapshot_id, valid_time: x.valid_time, open_alerts: x.open_alerts == null ? '' : String( x.open_alerts ) },
			} ) ).sort( ( a, b ) => ( a.key < b.key ? - 1 : a.key > b.key ? 1 : 0 ) );
			return { objects, truncated: false };

		},
	};

}

function absent( res: ServerResponse ) {

	res.statusCode = 404;
	res.setHeader( 'content-type', 'application/json; charset=utf-8' );
	res.setHeader( 'cache-control', 'no-store' );
	res.end( JSON.stringify( { error: 'absent' } ) );

}

/** Middleware (Connect) pour Vite : /v1/* → src/v1.js sur le faux R2 du scénario. */
export function middlewareFixtures( racineFixtures: string, scenario: string ) {

	const env = sur( scenario ) && existsSync( join( racineFixtures, scenario ) ) ? { SNAPSHOTS: fauxR2( join( racineFixtures, scenario ) ) } : null;

	return async ( req: IncomingMessage, res: ServerResponse, next: () => void ) => {

		const url = new URL( req.url ?? '/', 'http://localhost' );
		if ( url.pathname !== '/v1' && ! url.pathname.startsWith( '/v1/' ) ) return next();
		// Scénario inexistant : tout est absent (le front doit l'afficher « indisponible »).
		if ( ! env ) return absent( res );

		try {

			const r: Response = await handleV1( new Request( url, { method: req.method } ), env, url );
			res.statusCode = r.status;
			r.headers.forEach( ( v, k ) => res.setHeader( k, v ) );
			res.setHeader( 'x-atom-fixture', scenario );
			res.end( req.method === 'HEAD' ? undefined : Buffer.from( await r.arrayBuffer() ) );

		} catch ( e ) {

			res.statusCode = 500;
			res.setHeader( 'content-type', 'application/json; charset=utf-8' );
			res.end( JSON.stringify( { error: 'erreur_interne', message: String( ( e as Error )?.message ?? e ) } ) );

		}

	};

}
