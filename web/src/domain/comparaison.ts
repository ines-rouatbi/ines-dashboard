// Comparaison de deux instants (lot F6) : deux cartes à la MÊME hauteur au-dessus du sol (D6, hauteurSol.ts)
// et la carte de leur différence B − A.
//
// Règles :
//   - la différence n'existe que sur les nœuds présents des DEUX côtés : un nœud absent d'un côté (NaN : sous le
//     relief, hors du domaine vertical) donne NaN, jamais une différence avec 0 ;
//   - les deux instants doivent partager la même grille et le même relief (même modèle publié) : sinon la
//     comparaison nœud à nœud n'a pas de sens et elle est refusée avec sa raison ;
//   - les statistiques ne portent que sur les nœuds communs ; les absences sont décomptées, par côté.
// Aucun calcul scientifique nouveau (D4) : une soustraction et des moyennes de valeurs publiées.

import type { Meta } from '../data/contract';

/** B − A nœud par nœud ; NaN si l'une des deux valeurs est absente. */
export function difference( a: ArrayLike<number>, b: ArrayLike<number> ): Float32Array {

	if ( a.length !== b.length ) throw new Error( `cartes de tailles différentes : ${ a.length } et ${ b.length }` );
	const out = new Float32Array( a.length );
	for ( let k = 0; k < a.length; k ++ ) {

		const x = a[ k ], y = b[ k ];
		out[ k ] = Number.isNaN( x ) || Number.isNaN( y ) ? NaN : y - x;

	}
	return out;

}

export interface StatsComparaison {
	total: number;
	/** Nœuds présents des deux côtés : seuls à entrer dans la différence et les moyennes. */
	communs: number;
	seulementA: number;
	seulementB: number;
	absentsDesDeux: number;
	/** Moyennes sur les nœuds communs (null si aucun nœud commun : « non disponible », jamais 0). */
	moyenneA: number | null;
	moyenneB: number | null;
	/** Moyenne de B − A, moyenne de |B − A|, écart quadratique moyen, extrêmes. */
	moyenneDiff: number | null;
	moyenneAbsDiff: number | null;
	rmsDiff: number | null;
	minDiff: number | null;
	maxDiff: number | null;
}

export function statistiques( a: ArrayLike<number>, b: ArrayLike<number> ): StatsComparaison {

	if ( a.length !== b.length ) throw new Error( `cartes de tailles différentes : ${ a.length } et ${ b.length }` );
	let n = 0, sa = 0, sb = 0, sd = 0, sad = 0, sq = 0, lo = Infinity, hi = - Infinity, onlyA = 0, onlyB = 0, aucun = 0;
	for ( let k = 0; k < a.length; k ++ ) {

		const x = a[ k ], y = b[ k ], ax = ! Number.isNaN( x ), by = ! Number.isNaN( y );
		if ( ! ax || ! by ) { if ( ax ) onlyA ++; else if ( by ) onlyB ++; else aucun ++; continue; }
		const d = y - x;
		n ++; sa += x; sb += y; sd += d; sad += Math.abs( d ); sq += d * d;
		if ( d < lo ) lo = d;
		if ( d > hi ) hi = d;

	}
	const m = ( s: number ) => ( n ? s / n : null );
	return {
		total: a.length, communs: n, seulementA: onlyA, seulementB: onlyB, absentsDesDeux: aucun,
		moyenneA: m( sa ), moyenneB: m( sb ), moyenneDiff: m( sd ), moyenneAbsDiff: m( sad ),
		rmsDiff: n ? Math.sqrt( sq / n ) : null, minDiff: n ? lo : null, maxDiff: n ? hi : null,
	};

}

/** Maximum des valeurs présentes de plusieurs cartes (échelle commune), null si aucune valeur. */
export function maxCommun( ...cartes: ArrayLike<number>[] ): number | null {

	let hi = - Infinity;
	for ( const c of cartes ) for ( let k = 0; k < c.length; k ++ ) { const v = c[ k ]; if ( v > hi ) hi = v; }
	return Number.isFinite( hi ) ? hi : null;

}

/** Échelle divergente symétrique [−M, M] de la différence, M arrondi au pas supérieur (au moins un pas). */
export function bornesDifference( s: Pick<StatsComparaison, 'minDiff' | 'maxDiff'>, pas = 0.5 ): { min: number; max: number } {

	const m = Math.max( Math.abs( s.minDiff ?? 0 ), Math.abs( s.maxDiff ?? 0 ) );
	const M = Math.max( pas, Math.ceil( m / pas ) * pas );
	return { min: - M, max: M };

}

/**
 * Raison pour laquelle deux instants ne sont pas comparables nœud à nœud (grille ou relief différents), ou
 * null s'ils le sont. Le relief est comparé par son sha256 publié dans meta (D3).
 */
export function incompatibilite( a: Pick<Meta, 'grid' | 'terrain'>, b: Pick<Meta, 'grid' | 'terrain'> ): string | null {

	const ga = a.grid, gb = b.grid;
	for ( const k of [ 'nx', 'ny', 'dx_m', 'dy_m', 'x0_m', 'y0_m' ] as const ) {

		if ( ga[ k ] !== gb[ k ] ) return `grilles différentes (${ k } : ${ ga[ k ] } et ${ gb[ k ] })`;

	}
	if ( a.terrain.sha256 !== b.terrain.sha256 ) return 'reliefs différents (sha256 du relief)';
	return null;

}
