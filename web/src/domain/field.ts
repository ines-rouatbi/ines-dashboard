// Préparation d'un plan (un niveau) pour la scène : échantillonnage et masque du relief.
//
// Entrée : grilles natives Float32 [j][i] (j = sud→nord, i = ouest→est), NaN = sous le relief.
// Contrat v1 rév. 2 : le nœud (i, j) est en x = x0 + i·dx, y = y0 + j·dy ; le domaine va du
// nœud (0, 0) au nœud (nx−1, ny−1). Un nœud existe ssi z_asl − relief ≥ grid.min_agl_m.
// Sortie : grille échantillonnée (pas `stride`), même convention d'index j * nx + i.

import type { Meta } from '../data/contract';

export interface Plan {
	altitude: number;
	/** Taille de la grille échantillonnée. */
	nx: number;
	ny: number;
	/** Taille de la grille native (pour placer chaque nœud échantillonné). */
	nxNatif: number;
	nyNatif: number;
	dx: number;
	dy: number;
	stride: number;
	u: Float32Array;
	v: Float32Array;
	w: Float32Array;
	/** 1 = nœud valide, 0 = sous le relief (NaN). */
	mask: Uint8Array;
}

/** Géométrie du domaine utile à la scène (dérivée de /v1/meta, jamais codée en dur). */
export interface Domaine {
	nx: number;
	ny: number;
	nz: number;
	dx: number;
	dy: number;
	/** Position du nœud (0, 0), en m. */
	x0: number;
	y0: number;
	/** Hauteur minimale au-dessus du sol d'un nœud existant, en m. */
	minAgl: number;
	/** Étendue Est (m) et Nord (m) entre le premier et le dernier nœud : (n − 1)·d. */
	sizeX: number;
	sizeY: number;
	/** Altitudes des niveaux, m au-dessus de la mer ; l'indice est le {level} de /v1/fields. */
	altitudes: number[];
}

export function domaineDepuisMeta( meta: Meta ): Domaine {

	const { nx, ny, nz, dx_m, dy_m, x0_m, y0_m, min_agl_m, levels_asl_m } = meta.grid;
	return {
		nx, ny, nz: nz ?? levels_asl_m.length, dx: dx_m, dy: dy_m, x0: x0_m, y0: y0_m, minAgl: min_agl_m,
		sizeX: ( nx - 1 ) * dx_m, sizeY: ( ny - 1 ) * dy_m, altitudes: [ ...levels_asl_m ],
	};

}

/** Nœud natif le plus proche du point (x_m, y_m), borné au domaine. */
export function noeudProche( dom: Pick<Domaine, 'nx' | 'ny' | 'dx' | 'dy' | 'x0' | 'y0'>, xM: number, yM: number ): { i: number; j: number } {

	const c = ( v: number, n: number ) => Math.min( n - 1, Math.max( 0, Math.round( v ) ) );
	return { i: c( ( xM - dom.x0 ) / dom.dx, dom.nx ), j: c( ( yM - dom.y0 ) / dom.dy, dom.ny ) };

}

/** Position (m) du nœud natif (i, j). */
export function positionNoeud( dom: Pick<Domaine, 'dx' | 'dy' | 'x0' | 'y0'>, i: number, j: number ): { x_m: number; y_m: number } {

	return { x_m: dom.x0 + i * dom.dx, y_m: dom.y0 + j * dom.dy };

}

/** Cibles de densité (nombre approximatif de flèches) proposées à l'utilisateur. */
export const DENSITES = [ 500, 1000, 2000, 4000, 8000 ] as const;

/** Pas d'échantillonnage pour viser environ `cible` flèches sur une grille nx × ny. */
export function strideCible( nx: number, ny: number, cible: number ): number {

	return Math.max( 1, Math.ceil( Math.sqrt( ( nx * ny ) / Math.max( 1, cible ) ) ) );

}

/** Échantillonne u, v, w natifs avec un pas `stride` ; NaN → masque 0. `w` absent → 0. */
export function echantillonner(
	dom: Pick<Domaine, 'nx' | 'ny' | 'dx' | 'dy'>,
	altitude: number,
	u: Float32Array,
	v: Float32Array,
	w: Float32Array | null,
	stride: number,
): Plan {

	const { nx: NX, ny: NY } = dom;
	if ( u.length !== NX * NY || v.length !== NX * NY ) throw new Error( `champ de taille ${ u.length } / ${ v.length }, attendu ${ NX * NY } (${ NX } × ${ NY })` );
	if ( w && w.length !== NX * NY ) w = null;
	const s = Math.max( 1, Math.floor( stride ) );
	const nx = Math.ceil( NX / s ), ny = Math.ceil( NY / s ), n = nx * ny;
	const ou = new Float32Array( n ), ov = new Float32Array( n ), ow = new Float32Array( n ), mask = new Uint8Array( n );
	for ( let j = 0; j < ny; j ++ ) {

		const J = j * s;
		for ( let i = 0; i < nx; i ++ ) {

			const src = J * NX + i * s, idx = j * nx + i;
			const a = u[ src ], b = v[ src ];
			if ( Number.isNaN( a ) || Number.isNaN( b ) ) continue;
			const c = w ? w[ src ] : 0;
			ou[ idx ] = a; ov[ idx ] = b; ow[ idx ] = Number.isNaN( c ) ? 0 : c; mask[ idx ] = 1;

		}

	}

	return { altitude, nx, ny, nxNatif: NX, nyNatif: NY, dx: dom.dx * s, dy: dom.dy * s, stride: s, u: ou, v: ov, w: ow, mask };

}

/**
 * Statistiques de vitesse HORIZONTALE ‖(u, v)‖ d'un plan (hors relief), comme `speed` du contrat.
 * Plan entièrement sous le relief : min, moy et max valent null (« non disponible », jamais 0).
 */
export function statsPlan( p: Plan ): { min: number | null; moy: number | null; max: number | null; couverture: number } {

	let lo = Infinity, hi = - Infinity, sum = 0, n = 0;
	for ( let i = 0; i < p.mask.length; i ++ ) if ( p.mask[ i ] ) {

		const s = Math.hypot( p.u[ i ], p.v[ i ] );
		if ( s < lo ) lo = s; if ( s > hi ) hi = s; sum += s; n ++;

	}

	if ( ! n ) return { min: null, moy: null, max: null, couverture: 0 };
	return { min: lo, moy: sum / n, max: hi, couverture: n / p.mask.length };

}
