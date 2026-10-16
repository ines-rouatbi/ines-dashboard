// Chargement des pages du lot F3 (Vue d'ensemble, Fiabilité, Modèle) depuis l'API /v1.
//
// Règles : jamais de donnée de démo ; une ressource dont le lien snapshot.assets.* est null n'est PAS
// demandée (« non publiée », B5) ; une ressource en erreur est signalée « indisponible » sans masquer le
// reste de la page. Les cartes sont à une hauteur AU-DESSUS DU SOL, calculée par colonne (D6).

import { ApiError, CacheChamps, libelleErreur, type Api } from '../../data';
import type { Alerts, DataQuality, FieldVar, Meta, Quality, Snapshot, Stations, TimeItem } from '../../data/contract';
import { encadrer, resumer, valeursSol, type Encadrement, type Resume } from '../../domain/hauteurSol';
import { csvCarte, nomFichier, type Identite } from '../../domain/exportCsv';

/** Ressource facultative d'un instantané. */
export type Ressource<T> =
	| { etat: 'ok'; val: T }
	| { etat: 'non_publie' }
	| { etat: 'erreur'; message: string };

const estAbort = ( e: unknown ) => ( e as Error )?.name === 'AbortError';

/** Charge une ressource facultative : lien null → « non publiée » (aucune requête), erreur → message. */
export async function facultative<T>( lien: string | null, f: () => Promise<T> ): Promise<Ressource<T>> {

	if ( ! lien ) return { etat: 'non_publie' };
	try { return { etat: 'ok', val: await f() }; } catch ( e ) {

		if ( estAbort( e ) ) throw e;
		return { etat: 'erreur', message: libelleErreur( e ) };

	}

}

/** sha8 du modèle d'un instantané : suffixe de snapshot_id (contrat rév. 2, D1). */
export function sha8Modele( snapshotId: string ): string {

	const m = /_([0-9a-f]{8})$/.exec( snapshotId );
	if ( ! m ) throw new ApiError( 'invalide', `identifiant d'instantané sans sha8 de modèle : ${ snapshotId }` );
	return m[ 1 ];

}

export interface Base {
	snapshot: Snapshot;
	meta: Meta;
	/** Relief Float32 ny·nx, m au-dessus de la mer. */
	terrain: Float32Array;
	stations: Ressource<Stations>;
	alerts: Ressource<Alerts>;
	quality: Ressource<Quality>;
}

/** Instantané + meta + relief (indispensables) et ressources facultatives, en parallèle. */
export async function chargerBase( client: Api, snapshot: Snapshot, signal?: AbortSignal ): Promise<Base> {

	const id = snapshot.snapshot_id, a = snapshot.assets;
	const [ meta, terrain, stations, alerts, quality ] = await Promise.all( [
		client.meta( sha8Modele( id ), signal ),
		client.terrain( a.terrain, signal ),
		facultative( a.stations, () => client.stations( id, signal ) ),
		facultative( a.alerts, () => client.alerts( id, signal ) ),
		facultative( a.quality, () => client.quality( id, signal ) ),
	] );
	const n = meta.grid.nx * meta.grid.ny;
	if ( terrain.length !== n ) throw new ApiError( 'invalide', `relief de ${ terrain.length } valeurs, ${ n } attendues` );
	return { snapshot, meta, terrain, stations, alerts, quality };

}

/** Ressources de la page Modèle : meta du modèle, qualité des données d'entrée (D12). */
export async function chargerModele( client: Api, snapshot: Snapshot, signal?: AbortSignal ) {

	const id = snapshot.snapshot_id;
	const [ meta, dataQuality, quality ] = await Promise.all( [
		client.meta( sha8Modele( id ), signal ),
		facultative<DataQuality>( snapshot.assets.data_quality, () => client.dataQuality( id, signal ) ),
		facultative<Quality>( snapshot.assets.quality, () => client.quality( id, signal ) ),
	] );
	return { snapshot, meta, dataQuality, quality };

}

export type DonneesModele = Awaited<ReturnType<typeof chargerModele>>;

/** Identification d'un instantané pour les exports CSV (lot F6). */
export function identite( s: Pick<Snapshot, 'snapshot_id' | 'valid_time' | 'versions'> ): Identite {

	return { snapshot_id: s.snapshot_id, valid_time: s.valid_time, data_kind: s.versions.data_kind, model: s.versions.model };

}

/** Export CSV d'une carte affichée : nom du fichier et générateur (appelé au clic). */
export function exportCarte( base: Pick<Base, 'meta' | 'terrain'> & { snapshot: Pick<Snapshot, 'snapshot_id' | 'valid_time' | 'versions'> }, carte: CarteSol, unite: string ) {

	return {
		nom: nomFichier( base.snapshot.snapshot_id, 'carte', `${ carte.hauteur }m-sol`, carte.variable ),
		generer: () => csvCarte( identite( base.snapshot ), base.meta, { variable: carte.variable, unite, surface: { mode: 'sol', h: carte.hauteur }, valeurs: carte.valeurs, terrain: base.terrain } ),
	};

}

/** Une carte à une hauteur au-dessus du sol. */
export interface CarteSol {
	hauteur: number;
	variable: FieldVar;
	enc: Encadrement;
	/** ny·nx valeurs, NaN = absent. */
	valeurs: Float32Array;
	resume: Resume;
}

/** Variables catégorielles : niveau le plus proche, jamais interpolées. */
const CATEGORIELLES = new Set<FieldVar>( [ 'status' ] );

/**
 * Cartes d'une variable à plusieurs hauteurs au-dessus du sol (D6). Ne charge que les niveaux
 * nécessaires (union des encadrements). `scale` vient de meta.encoding (uint8 : 255 → NaN).
 */
export async function chargerCartes(
	cache: CacheChamps,
	base: Pick<Base, 'meta' | 'terrain'> & { snapshot: Pick<Snapshot, 'snapshot_id'> },
	variable: FieldVar,
	hauteurs: readonly number[],
): Promise<CarteSol[]> {

	const { grid } = base.meta;
	if ( ! base.meta.fields.includes( variable ) ) throw new ApiError( 'absent', `variable ${ variable } non publiée par ce modèle` );
	const encs = hauteurs.map( ( h ) => encadrer( base.terrain, grid.levels_asl_m, h, grid.min_agl_m ) );
	const niveaux = [ ...new Set( encs.flatMap( ( e ) => e.niveaux ) ) ].sort( ( a, b ) => a - b );
	const scale = base.meta.encoding[ variable ]?.scale ?? null;
	const champs = new Map( await Promise.all( niveaux.map( async ( k ) =>
		[ k, await cache.champ( base.snapshot.snapshot_id, k, variable, scale ) ] as const ) ) );
	const mode = CATEGORIELLES.has( variable ) ? 'proche' : 'lineaire';
	return encs.map( ( enc ) => {

		const valeurs = valeursSol( enc, champs, mode );
		return { hauteur: enc.hauteur, variable, enc, valeurs, resume: resumer( enc, valeurs ) };

	} );

}

/** Un point de la série au moyeu (TB4). null = « non disponible » : un trou, jamais 0. */
export interface PointMoyeu {
	snapshot_id: string;
	valid_time: string;
	moyenne: number | null;
	max: number | null;
	hauteur: number | null;
	/** Autres indicateurs publiés de l'instantané (tendances de la Vue d'ensemble, UI v2) ; null = non disponible. */
	fiabilite?: number | null;
	reconstruction_ms?: number | null;
	alertes?: number | null;
	capteurs?: number | null;
	/** Raison de l'absence de l'instantané (erreur de chargement). */
	erreur?: string;
}

export function pointMoyeu( item: Pick<TimeItem, 'snapshot_id' | 'valid_time'>, snap: Pick<Snapshot, 'kpi'> & Partial<Pick<Snapshot, 'network'>> | null, erreur?: string ): PointMoyeu {

	const k = snap?.kpi;
	return {
		snapshot_id: item.snapshot_id,
		valid_time: item.valid_time,
		moyenne: k?.hub_wind_mean_ms ?? null,
		max: k?.hub_wind_max_ms ?? null,
		hauteur: k?.hub_height_agl_m ?? null,
		fiabilite: k?.share_high_reliability ?? null,
		reconstruction_ms: k?.reconstruction_ms ?? null,
		alertes: k?.open_alerts ? k.open_alerts.critique + k.open_alerts.important + k.open_alerts.avertissement + k.open_alerts.information : null,
		capteurs: snap && 'network' in snap ? ( snap as Pick<Snapshot, 'network'> ).network.sensors_visible : null,
		...( erreur ? { erreur } : {} ),
	};

}

/** Applique `f` à chaque élément avec au plus `n` appels simultanés, dans l'ordre. */
export async function mapLimite<T, R>( items: readonly T[], n: number, f: ( x: T ) => Promise<R> ): Promise<R[]> {

	const out = new Array<R>( items.length );
	let suivant = 0;
	const ouvrier = async () => { while ( suivant < items.length ) { const i = suivant ++; out[ i ] = await f( items[ i ] ); } };
	await Promise.all( Array.from( { length: Math.min( n, items.length ) }, ouvrier ) );
	return out;

}

/** Nombre d'instants affichés dans la série au moyeu. */
export const MAX_POINTS_SERIE = 48;

/**
 * Série au moyeu (TB4) : les instants de /v1/times (première page, du plus récent au plus ancien),
 * puis hub_wind_* de chaque instantané (D10). Un instantané illisible donne un trou, pas un 0.
 * Les simulations n'entrent pas dans /v1/times (src/v1.js).
 */
export async function chargerSerie( client: Api, signal?: AbortSignal, max = MAX_POINTS_SERIE ): Promise<{ points: PointMoyeu[]; total: number }> {

	const times = await client.times( {}, signal );
	const items = [ ...times.items ].sort( ( a, b ) => a.valid_time.localeCompare( b.valid_time ) ).slice( - max );
	const points = await mapLimite( items, 6, async ( it ) => {

		try { return pointMoyeu( it, await client.snapshot( it.snapshot_id, signal ) ); } catch ( e ) {

			if ( estAbort( e ) ) throw e;
			return pointMoyeu( it, null, libelleErreur( e ) );

		}

	} );
	return { points, total: times.total };

}

/** Identifiant d'instantané valide (même motif que le Worker). */
export const ID_INSTANTANE = /^[0-9A-Za-z_]+_[0-9a-f]{8}$/;

export type Simulation =
	| { etat: 'aucune' }
	| { etat: 'invalide'; id: string; message: string }
	| { etat: 'ok'; snapshot: Snapshot; baseline: Ressource<Snapshot>; quality: Ressource<Quality> };

/**
 * Panne simulée (TB6, BF45, BF46). Les simulations ne sont ni dans latest ni dans /v1/times : seul
 * leur identifiant permet de les lire (`?simulation=<id>`). Un instantané dont scenario est null
 * n'est PAS une simulation et n'est jamais présenté comme tel.
 */
export async function chargerSimulation( client: Api, id: string | null, signal?: AbortSignal ): Promise<Simulation> {

	if ( ! id ) return { etat: 'aucune' };
	if ( ! ID_INSTANTANE.test( id ) ) return { etat: 'invalide', id, message: 'identifiant d’instantané invalide' };
	let snapshot: Snapshot;
	try { snapshot = await client.snapshot( id, signal ); } catch ( e ) {

		if ( estAbort( e ) ) throw e;
		return { etat: 'invalide', id, message: e instanceof ApiError && e.code === 'absent' ? 'simulation introuvable (non publiée)' : libelleErreur( e ) };

	}
	if ( snapshot.scenario == null ) return { etat: 'invalide', id, message: 'cet instantané est une reconstruction nominale (scenario = null), pas une simulation' };
	const ref = snapshot.scenario.baseline_snapshot_id ?? null;
	const [ baseline, quality ] = await Promise.all( [
		facultative( ref, () => client.snapshot( ref!, signal ) ),
		facultative( snapshot.assets.quality, () => client.quality( id, signal ) ),
	] );
	return { etat: 'ok', snapshot, baseline, quality };

}
