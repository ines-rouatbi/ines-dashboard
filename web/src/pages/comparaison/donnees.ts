// Chargement de la comparaison de deux instants (lot F6) : instantanés de /v1/times, puis, pour chaque côté,
// instantané + meta + relief et la carte de vitesse à la même hauteur au-dessus du sol (D6).
// Chaque côté a son propre cache de champs (CacheChamps ne garde qu'un instantané à la fois).

import { ApiError, CacheChamps, type Api } from '../../data';
import type { Snapshot, TimeItem } from '../../data/contract';
import { incompatibilite, statistiques, difference, type StatsComparaison } from '../../domain/comparaison';
import { chargerBase, chargerCartes, type Base, type CarteSol } from '../f3/donnees';

/** Pages de /v1/times lues au plus (200 instantanés par page). */
export const MAX_PAGES_TIMES = 10;

/** Tous les instantanés publiés (en suivant `next`), du plus ancien au plus récent. */
export async function chargerInstants( client: Api, signal?: AbortSignal, maxPages = MAX_PAGES_TIMES ): Promise<{ items: TimeItem[]; total: number; tronque: boolean }> {

	const items: TimeItem[] = [];
	let cursor: string | null = null, total = 0, pages = 0;
	do {

		const t = await client.times( cursor ? { cursor } : {}, signal );
		items.push( ...t.items );
		total = t.total;
		cursor = t.next;
		pages ++;

	} while ( cursor && pages < maxPages );
	const vus = new Set<string>();
	const uniques = items.filter( ( x ) => ( vus.has( x.snapshot_id ) ? false : ( vus.add( x.snapshot_id ), true ) ) );
	uniques.sort( ( a, b ) => a.valid_time.localeCompare( b.valid_time ) || a.snapshot_id.localeCompare( b.snapshot_id ) );
	return { items: uniques, total, tronque: cursor != null };

}

/** Choix par défaut : B = le plus récent (latest s'il est listé), A = l'instant qui le précède. */
export function choixParDefaut( items: TimeItem[], latestId: string | null ): { a: string | null; b: string | null } {

	if ( ! items.length ) return { a: null, b: null };
	const kb = latestId ? items.findIndex( ( x ) => x.snapshot_id === latestId ) : - 1;
	const ib = kb >= 0 ? kb : items.length - 1;
	return { a: items[ Math.max( 0, ib - 1 ) ].snapshot_id, b: items[ ib ].snapshot_id };

}

export interface Cote { base: Base; carte: CarteSol }

export interface Comparaison {
	a: Cote;
	b: Cote;
	hauteur: number;
	/** B − A, NaN si un côté est absent. */
	diff: Float32Array;
	stats: StatsComparaison;
}

const caches = { a: null as CacheChamps | null, b: null as CacheChamps | null };

async function cote( client: Api, cache: CacheChamps, id: string, hauteur: number, signal?: AbortSignal ): Promise<Cote> {

	const snap: Snapshot = await client.snapshot( id, signal );
	const base = await chargerBase( client, snap, signal );
	const [ carte ] = await chargerCartes( cache, base, 'speed', [ hauteur ] );
	return { base, carte };

}

/**
 * Charge les deux côtés à la même hauteur au-dessus du sol et calcule la différence. Refuse (ApiError
 * « invalide ») deux instants dont la grille ou le relief diffèrent : la différence nœud à nœud n'aurait pas
 * de sens. `cacheA` / `cacheB` : caches de champs (un par côté).
 */
export async function chargerComparaison( client: Api, idA: string, idB: string, hauteur: number, signal?: AbortSignal,
	cacheA = caches.a ??= new CacheChamps( client ), cacheB = caches.b ??= new CacheChamps( client ) ): Promise<Comparaison> {

	const [ a, b ] = await Promise.all( [ cote( client, cacheA, idA, hauteur, signal ), cote( client, cacheB, idB, hauteur, signal ) ] );
	const raison = incompatibilite( a.base.meta, b.base.meta );
	if ( raison ) throw new ApiError( 'invalide', `instants non comparables nœud à nœud : ${ raison }` );
	return { a, b, hauteur, diff: difference( a.carte.valeurs, b.carte.valeurs ), stats: statistiques( a.carte.valeurs, b.carte.valeurs ) };

}
