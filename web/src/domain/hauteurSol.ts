// Mode « hauteur au-dessus du sol » (contrat v1 rév. 2, D6 et README « Altitudes ») :
// les niveaux publiés sont au-dessus de la MER ; une hauteur au-dessus du SOL se calcule par
// colonne avec le relief du modèle (/v1/terrain/{sha8}, terrain[j·nx + i]) :
//
//   z_cible = terrain[j][i] + h ;  on cherche k tel que L[k] ≤ z_cible ≤ L[k+1] ;
//   valeur = interpolation linéaire entre les nœuds (k, j, i) et (k+1, j, i).
//
// NaN (« sous le relief » / « non disponible », jamais 0) si :
//   - h < grid.min_agl_m (aucun nœud n'existe si près du sol) ;
//   - z_cible hors de [L[0], L[nz−1]] ;
//   - l'un des deux nœuds encadrants est absent (NaN : z − relief < min_agl_m), sauf si z_cible
//     tombe exactement sur un niveau dont le nœud existe.
// C'est la règle du vent au moyeu du contrat (kpi.hub_wind_*, D10) : la moyenne de ce plan pour
// `speed` à 120 m redonne snapshot.kpi.hub_wind_mean_ms (test : dev/scene-f2.test.ts).

/** Indices de niveaux nécessaires pour une hauteur h sur un relief compris entre zMin et zMax. */
export function niveauxUtiles( altitudes: number[], zMin: number, zMax: number, h: number, minAgl = 0 ): number[] {

	const nz = altitudes.length;
	if ( ! nz || h < minAgl || ! Number.isFinite( h ) ) return [];
	const bas = zMin + h, haut = zMax + h;
	let k0 = 0, k1 = nz - 1;
	// Dernier niveau ≤ bas, premier niveau ≥ haut (bornés au domaine vertical).
	for ( let k = 0; k < nz; k ++ ) if ( altitudes[ k ] <= bas ) k0 = k;
	for ( let k = nz - 1; k >= 0; k -- ) if ( altitudes[ k ] >= haut ) k1 = k;
	if ( bas > altitudes[ nz - 1 ] || haut < altitudes[ 0 ] ) return [];
	const out: number[] = [];
	for ( let k = k0; k <= k1; k ++ ) out.push( k );
	return out;

}

/** Fraction et niveaux encadrant z ; null si z est hors du domaine vertical. */
export function encadrer( altitudes: number[], z: number ): { k: number; t: number } | null {

	const nz = altitudes.length;
	if ( ! Number.isFinite( z ) || ! nz || z < altitudes[ 0 ] || z > altitudes[ nz - 1 ] ) return null;
	if ( nz === 1 ) return { k: 0, t: 0 };
	for ( let k = 0; k + 1 < nz; k ++ ) {

		const a = altitudes[ k ], b = altitudes[ k + 1 ];
		if ( z >= a && z <= b ) return { k, t: ( z - a ) / ( b - a ) };

	}

	return null;

}

/** Valeur interpolée à z dans une colonne (valeur(k) = NaN si le nœud est absent). */
export function interpolerColonne( altitudes: number[], valeur: ( k: number ) => number, z: number ): number {

	const e = encadrer( altitudes, z );
	if ( ! e ) return NaN;
	const a = valeur( e.k );
	if ( e.t === 0 ) return Number.isNaN( a ) ? NaN : a;
	const b = valeur( e.k + 1 );
	if ( e.t === 1 ) return Number.isNaN( b ) ? NaN : b;
	if ( Number.isNaN( a ) || Number.isNaN( b ) ) return NaN;
	return a + ( b - a ) * e.t;

}

export interface EntreeHauteurSol {
	/** Altitudes des niveaux, m au-dessus de la mer, croissantes. */
	altitudes: number[];
	/** Relief du modèle, ny·nx, m au-dessus de la mer. */
	terrain: Float32Array;
	/** grid.min_agl_m. */
	minAgl: number;
	/** Hauteur au-dessus du sol, m. */
	h: number;
	/** Champ d'un niveau (nx·ny, NaN = absent) ; undefined si non chargé (→ NaN). */
	niveau: ( k: number ) => Float32Array | undefined;
}

/** Plan d'une variable à h m au-dessus du sol (nx·ny, NaN = absent). `out` est réutilisé s'il est fourni. */
export function planHauteurSol( e: EntreeHauteurSol, out?: Float32Array ): Float32Array {

	const n = e.terrain.length;
	const res = out && out.length === n ? out : new Float32Array( n );
	if ( e.h < e.minAgl || ! Number.isFinite( e.h ) ) { res.fill( NaN ); return res; }
	const L = e.altitudes;
	for ( let idx = 0; idx < n; idx ++ ) {

		res[ idx ] = interpolerColonne( L, ( k ) => {

			const f = e.niveau( k );
			return f ? f[ idx ] : NaN;

		}, e.terrain[ idx ] + e.h );

	}

	return res;

}

/** Moyenne et maximum des valeurs définies d'un plan ; null si aucune (jamais 0 pour l'inconnu). */
export function moyenneMax( p: Float32Array ): { moyenne: number | null; max: number | null; n: number } {

	let s = 0, m = - Infinity, n = 0;
	for ( let i = 0; i < p.length; i ++ ) { const x = p[ i ]; if ( Number.isNaN( x ) ) continue; s += x; n ++; if ( x > m ) m = x; }
	return n ? { moyenne: s / n, max: m, n } : { moyenne: null, max: null, n: 0 };

}
