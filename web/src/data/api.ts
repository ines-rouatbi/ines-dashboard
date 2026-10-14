// Client de l'API /v1/* (servie par le Worker depuis R2 ; en dev, par les fixtures du contrat).
//
// Règle : jamais de données de démo. Une ressource absente ou invalide remonte comme
// une erreur typée (`ApiError`), que l'interface affiche « indisponible ».

import { decodeFloat32LE } from './binary';
import type {
	Alerts, FieldVar, Latest, Meta, Profile, Quality, Snapshot, Stations, WindFarm, WindRose,
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

async function requete( path: string, accept: string, signal?: AbortSignal ): Promise<Response> {

	let r: Response;
	try { r = await fetch( path, { headers: { accept }, signal } ); }
	catch ( e ) {

		if ( ( e as Error )?.name === 'AbortError' ) throw e;
		throw new ApiError( 'reseau', `réseau : ${ ( e as Error )?.message ?? e }` );

	}

	if ( r.status === 404 ) throw new ApiError( 'absent', `${ path } : absent`, 404 );
	if ( ! r.ok ) {

		const body = await r.json().catch( () => null ) as { error?: string; message?: string } | null;
		throw new ApiError( 'http', body?.message || body?.error || `HTTP ${ r.status }`, r.status );

	}

	return r;

}

export async function getJSON<T>( path: string, signal?: AbortSignal ): Promise<T> {

	const r = await requete( path, 'application/json', signal );
	// Tant que le Worker ne sert pas /v1 (lot F1), le repli SPA peut renvoyer index.html.
	const type = r.headers.get( 'content-type' ) ?? '';
	if ( ! type.includes( 'json' ) ) throw new ApiError( 'invalide', `${ path } : réponse non JSON (${ type || 'type inconnu' })`, r.status );
	try { return await r.json() as T; }
	catch { throw new ApiError( 'invalide', `${ path } : JSON illisible`, r.status ); }

}

export async function getFloat32( path: string, signal?: AbortSignal ): Promise<Float32Array> {

	const r = await requete( path, 'application/octet-stream', signal );
	const type = r.headers.get( 'content-type' ) ?? '';
	if ( type.includes( 'text/html' ) || type.includes( 'json' ) ) throw new ApiError( 'invalide', `${ path } : binaire attendu (${ type })`, r.status );
	try { return decodeFloat32LE( await r.arrayBuffer() ); }
	catch ( e ) { throw new ApiError( 'invalide', `${ path } : ${ ( e as Error ).message }`, r.status ); }

}

/** Points d'accès du contrat v1. `level` = indice du niveau (0..nz-1). */
export const api = {
	meta: ( s?: AbortSignal ) => getJSON<Meta>( '/v1/meta', s ),
	latest: ( s?: AbortSignal ) => getJSON<Latest>( '/v1/latest', s ),
	snapshot: ( id: string, s?: AbortSignal ) => getJSON<Snapshot>( `/v1/snapshots/${ enc( id ) }`, s ),
	field: ( id: string, level: number, variable: FieldVar, s?: AbortSignal ) =>
		getFloat32( `/v1/fields/${ enc( id ) }/${ level }/${ variable }`, s ),
	profile: ( id: string, xM: number, yM: number, s?: AbortSignal ) =>
		getJSON<Profile>( `/v1/profiles/${ enc( id ) }?${ new URLSearchParams( { x: String( Math.round( xM ) ), y: String( Math.round( yM ) ) } ) }`, s ),
	quality: ( id: string, s?: AbortSignal ) => getJSON<Quality>( `/v1/quality/${ enc( id ) }`, s ),
	alerts: ( id: string, s?: AbortSignal ) => getJSON<Alerts>( `/v1/alerts/${ enc( id ) }`, s ),
	stations: ( id: string, s?: AbortSignal ) => getJSON<Stations>( `/v1/stations/${ enc( id ) }`, s ),
	windFarm: ( id: string, s?: AbortSignal ) => getJSON<WindFarm>( `/v1/wind-farm/${ enc( id ) }`, s ),
	windrose: ( params: Record<string, string> = {}, s?: AbortSignal ) => {

		const q = new URLSearchParams( params ).toString();
		return getJSON<WindRose>( `/v1/windrose${ q ? '?' + q : '' }`, s );

	},
};

/** Message court pour l'interface. */
export function libelleErreur( e: unknown ): string {

	if ( e instanceof ApiError ) return e.code === 'absent' ? 'indisponible' : `indisponible (${ e.message })`;
	return `indisponible (${ ( e as Error )?.message ?? String( e ) })`;

}
