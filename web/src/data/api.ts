// Client de l'API /v1/* (servie par le Worker depuis R2 ; en dev, par les fixtures du contrat).
//
// Règle : jamais de données de démo. Une ressource absente ou invalide remonte comme
// une erreur typée (`ApiError`), que l'interface affiche « indisponible ».

import { decodeFloat32LE, decodeNiveau } from './binary';
import type {
	Alerts, Column, DataQuality, FieldVar, Latest, Meta, Profile, Quality, Snapshot, Stations, Times, WindFarm, WindRose,
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

	let r: Response | undefined;
	// Lecture idempotente : une seule nouvelle tentative sur erreur réseau (connexion keep-alive fermée
	// par le serveur entre deux requêtes, coupure brève).
	for ( let essai = 0; ! r; essai ++ ) {

		try { r = await fetch( url, { headers: { accept }, signal } ); }
		catch ( e ) {

			if ( ( e as Error )?.name === 'AbortError' ) throw e;
			if ( essai >= 1 ) throw new ApiError( 'reseau', `réseau : ${ ( e as Error )?.message ?? e }` );
			await new Promise( ( ok ) => setTimeout( ok, 250 ) );
			if ( signal?.aborted ) throw signal.reason ?? new DOMException( 'Aborted', 'AbortError' );

		}

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

/**
 * Binaire d'un niveau ou du relief, décodé en Float32Array (NaN = absent). Le type vient de
 * l'en-tête `x-atom-dtype` (float32 par défaut) ; `scale` = meta.encoding[var].scale pour uint8.
 */
export async function getFloat32( url: string, signal?: AbortSignal, scale?: number | null ): Promise<Float32Array> {

	const r = await requete( url, 'application/octet-stream', signal );
	const type = r.headers.get( 'content-type' ) ?? '';
	if ( type.includes( 'text/html' ) || type.includes( 'json' ) ) {

		await r.body?.cancel().catch( () => {} );
		throw new ApiError( 'invalide', `${ url } : binaire attendu (${ type })`, r.status );

	}

	const dtype = r.headers.get( 'x-atom-dtype' );
	try { return dtype ? decodeNiveau( await r.arrayBuffer(), dtype, scale ) : decodeFloat32LE( await r.arrayBuffer() ); }
	catch ( e ) { throw new ApiError( 'invalide', `${ url } : ${ ( e as Error ).message }`, r.status ); }

}

/**
 * Points d'accès de lecture du contrat v1 (révision 2). `base` = origine du serveur ('' = même
 * origine). `level` = indice du niveau (0..nz-1). Les liens d'un instantané sont aussi donnés par
 * `snapshot.assets` ; le relief par `meta.terrain.href`.
 */
export function creerApi( base = '' ) {

	const u = ( p: string ) => base + p;
	return {
		/** Meta du modèle de latest, ou d'un modèle précis (sha8). */
		meta: ( sha8?: string, s?: AbortSignal ) => getJSON<Meta>( u( sha8 ? `/v1/meta/${ enc( sha8 ) }` : '/v1/meta' ), s ),
		/** Relief : Float32 LE ny·nx, m au-dessus de la mer, sans NaN. `href` = meta.terrain.href. */
		terrain: ( href: string, s?: AbortSignal ) => getFloat32( u( href ), s ),
		latest: ( s?: AbortSignal ) => getJSON<Latest>( u( '/v1/latest' ), s ),
		times: ( params: Record<string, string> = {}, s?: AbortSignal ) => {

			const q = new URLSearchParams( params ).toString();
			return getJSON<Times>( u( `/v1/times${ q ? '?' + q : '' }` ), s );

		},
		snapshot: ( id: string, s?: AbortSignal ) => getJSON<Snapshot>( u( `/v1/snapshots/${ enc( id ) }` ), s ),
		/** Un niveau d'une variable ; `scale` = meta.encoding[var].scale (variables uint8). */
		field: ( id: string, level: number, variable: FieldVar, scale?: number | null, s?: AbortSignal ) =>
			getFloat32( u( `/v1/fields/${ enc( id ) }/${ level }/${ variable }` ), s, scale ),
		/** Valeurs brutes de la colonne (i, j) : base du profil au clic, calculé par le front. */
		column: ( id: string, i: number, j: number, s?: AbortSignal ) =>
			getJSON<Column>( u( `/v1/column/${ enc( id ) }?${ new URLSearchParams( { i: String( i ), j: String( j ) } ) }` ), s ),
		/** Profil précalculé en un point déclaré (snapshot.points[].profile). */
		profile: ( id: string, pointId: string, s?: AbortSignal ) =>
			getJSON<Profile>( u( `/v1/profiles/${ enc( id ) }/${ enc( pointId ) }` ), s ),
		quality: ( id: string, s?: AbortSignal ) => getJSON<Quality>( u( `/v1/quality/${ enc( id ) }` ), s ),
		alerts: ( id: string, s?: AbortSignal ) => getJSON<Alerts>( u( `/v1/alerts/${ enc( id ) }` ), s ),
		stations: ( id: string, s?: AbortSignal ) => getJSON<Stations>( u( `/v1/stations/${ enc( id ) }` ), s ),
		windFarm: ( id: string, s?: AbortSignal ) => getJSON<WindFarm>( u( `/v1/wind-farm/${ enc( id ) }` ), s ),
		/** Rapport de qualité des données d'entrée (M3). */
		dataQuality: ( id: string, s?: AbortSignal ) => getJSON<DataQuality>( u( `/v1/data-quality/${ enc( id ) }` ), s ),
		/** Rose des vents précalculée d'un site ou d'une éolienne déclarés (latest par défaut). */
		windrose: ( siteId: string, snapshotId?: string, s?: AbortSignal ) =>
			getJSON<WindRose>( u( `/v1/windrose/${ enc( siteId ) }${ snapshotId ? '?' + new URLSearchParams( { snapshot: snapshotId } ) : '' }` ), s ),
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
