// Client de l'API /v1/* (servie par le Worker depuis R2 ; en dev, par les fixtures du contrat).
//
// Règle : jamais de données de démo. Une ressource absente ou invalide remonte comme
// une erreur typée (`ApiError`), que l'interface affiche « indisponible ».

import { decodeFloat32LE } from './binary';
import type {
	Alerts, FieldVar, Latest, Meta, Profile, Quality, Snapshot, Stations, Times, WindFarm, WindRose,
} from './contract';

export type CodeErreur = 'absent' | 'http' | 'reseau' | 'invalide';

export class ApiError extends Error {

	readonly code: CodeErreur;
	readonly status: number | null;

	constructor( code: CodeErreur, message: string, status: number | null = null ) {

		super( message );
		this.name = 'ApiError';
		this.code = code;
		this.status = status;

	}

}

const enc = encodeURIComponent;

async function requete( url: string, accept: string, signal?: AbortSignal ): Promise<Response> {

	let r: Response;
	try { r = await fetch( url, { headers: { accept }, signal } ); }
	catch ( e ) {

		if ( ( e as Error )?.name === 'AbortError' ) throw e;
		throw new ApiError( 'reseau', `réseau : ${ ( e as Error )?.message ?? e }` );

	}

	if ( r.status === 404 ) {

		await r.body?.cancel().catch( () => {} );
		throw new ApiError( 'absent', `${ url } : absent`, 404 );

	}

	if ( ! r.ok ) {

		const body = await r.json().catch( () => null ) as { error?: string; message?: string } | null;
		throw new ApiError( 'http', body?.message || body?.error || `HTTP ${ r.status }`, r.status );

	}

	return r;

}

export async function getJSON<T>( url: string, signal?: AbortSignal ): Promise<T> {

	const r = await requete( url, 'application/json', signal );
	// Le repli SPA d'un serveur mal configuré peut renvoyer index.html : on le refuse.
	const type = r.headers.get( 'content-type' ) ?? '';
	if ( ! type.includes( 'json' ) ) {

		await r.body?.cancel().catch( () => {} );
		throw new ApiError( 'invalide', `${ url } : réponse non JSON (${ type || 'type inconnu' })`, r.status );

	}

	try { return await r.json() as T; }
	catch { throw new ApiError( 'invalide', `${ url } : JSON illisible`, r.status ); }

}

export async function getFloat32( url: string, signal?: AbortSignal ): Promise<Float32Array> {

	const r = await requete( url, 'application/octet-stream', signal );
	const type = r.headers.get( 'content-type' ) ?? '';
	if ( type.includes( 'text/html' ) || type.includes( 'json' ) ) {

		await r.body?.cancel().catch( () => {} );
		throw new ApiError( 'invalide', `${ url } : binaire attendu (${ type })`, r.status );

	}

	try { return decodeFloat32LE( await r.arrayBuffer() ); }
	catch ( e ) { throw new ApiError( 'invalide', `${ url } : ${ ( e as Error ).message }`, r.status ); }

}

/**
 * Points d'accès du contrat v1. `base` = origine du serveur ('' = même origine).
 * `level` = indice du niveau (0..nz-1).
 */
export function creerApi( base = '' ) {

	const u = ( p: string ) => base + p;
	return {
		meta: ( s?: AbortSignal ) => getJSON<Meta>( u( '/v1/meta' ), s ),
		/** Relief : Float32 LE ny*nx, m au-dessus de la mer, sans NaN. */
		terrain: ( s?: AbortSignal ) => getFloat32( u( '/v1/terrain' ), s ),
		latest: ( s?: AbortSignal ) => getJSON<Latest>( u( '/v1/latest' ), s ),
		times: ( params: Record<string, string> = {}, s?: AbortSignal ) => {

			const q = new URLSearchParams( params ).toString();
			return getJSON<Times>( u( `/v1/times${ q ? '?' + q : '' }` ), s );

		},
		snapshot: ( id: string, s?: AbortSignal ) => getJSON<Snapshot>( u( `/v1/snapshots/${ enc( id ) }` ), s ),
		field: ( id: string, level: number, variable: FieldVar, s?: AbortSignal ) =>
			getFloat32( u( `/v1/fields/${ enc( id ) }/${ level }/${ variable }` ), s ),
		profile: ( id: string, xM: number, yM: number, s?: AbortSignal ) =>
			getJSON<Profile>( u( `/v1/profiles/${ enc( id ) }?${ new URLSearchParams( { x_m: String( Math.round( xM ) ), y_m: String( Math.round( yM ) ) } ) }` ), s ),
		quality: ( id: string, s?: AbortSignal ) => getJSON<Quality>( u( `/v1/quality/${ enc( id ) }` ), s ),
		alerts: ( id: string, s?: AbortSignal ) => getJSON<Alerts>( u( `/v1/alerts/${ enc( id ) }` ), s ),
		stations: ( id: string, s?: AbortSignal ) => getJSON<Stations>( u( `/v1/stations/${ enc( id ) }` ), s ),
		windFarm: ( id: string, s?: AbortSignal ) => getJSON<WindFarm>( u( `/v1/wind-farm/${ enc( id ) }` ), s ),
		windrose: ( params: { x_m: number; y_m: number; hub_agl_m: number; from?: string; to?: string }, s?: AbortSignal ) => {

			const q = new URLSearchParams( Object.entries( params ).filter( ( [ , v ] ) => v != null ).map( ( [ k, v ] ): [ string, string ] => [ k, String( v ) ] ) );
			return getJSON<WindRose>( u( `/v1/windrose?${ q }` ), s );

		},
	};

}

export type Api = ReturnType<typeof creerApi>;

/** Client de même origine, utilisé par l'interface. */
export const api = creerApi();

/** Message court pour l'interface. */
export function libelleErreur( e: unknown ): string {

	if ( e instanceof ApiError ) return e.code === 'absent' ? 'indisponible' : `indisponible (${ e.message })`;
	return `indisponible (${ ( e as Error )?.message ?? String( e ) })`;

}
