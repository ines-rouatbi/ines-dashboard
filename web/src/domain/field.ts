// Préparation d'un plan (un niveau) pour la scène : échantillonnage et masque du relief.
//
// Entrée : grilles natives Float32 [j][i] (j = sud→nord, i = ouest→est), NaN = sous le relief.
// Les nœuds sont au CENTRE des mailles : x_i = (i + 0,5)·dx, y_j = (j + 0,5)·dy, et le
// domaine couvre [0, nx·dx] × [0, ny·dy] depuis le coin sud-ouest (contrat v1).
// Sortie : grille échantillonnée (pas `stride`), même convention d'index j * nx + i.

import type { Meta } from '../data/contract';

export interface Plan {
	altitude: number;
	/** Taille de la grille échantillonnée. */
	nx: number;
	ny: number;
	/** Taille de la grille native (pour placer chaque nœud au centre de sa maille). */
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
	/** Étendue Est (m) et Nord (m) du domaine, depuis le coin sud-ouest. */
	sizeX: number;
	sizeY: number;
	/** Altitudes des niveaux, m au-dessus de la mer ; l'indice est le {level} de /v1/fields. */
	altitudes: number[];
}

export function domaineDepuisMeta( meta: Meta ): Domaine {

	const { nx, ny, nz, dx_m, dy_m, levels_asl_m } = meta.grid;
	return { nx, ny, nz: nz ?? levels_asl_m.length, dx: dx_m, dy: dy_m, sizeX: nx * dx_m, sizeY: ny * dy_m, altitudes: [ ...levels_asl_m ] };

}

/** Maille native contenant le point (x_m, y_m), bornée au domaine. */
export function mailleDe( dom: Pick<Domaine, 'nx' | 'ny' | 'dx' | 'dy'>, xM: number, yM: number ): { i: number; j: number } {

	const c = ( v: number, n: number ) => Math.min( n - 1, Math.max( 0, Math.floor( v ) ) );
	return { i: c( xM / dom.dx, dom.nx ), j: c( yM / dom.dy, dom.ny ) };

}

/** Centre (m) de la maille native (i, j). */
export function centreMaille( dom: Pick<Domaine, 'dx' | 'dy'>, i: number, j: number ): { x_m: number; y_m: number } {

	return { x_m: ( i + 0.5 ) * dom.dx, y_m: ( j + 0.5 ) * dom.dy };

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

/** Statistiques de vitesse 3D d'un plan (hors relief). */
export function statsPlan( p: Plan ): { min: number; moy: number; max: number; couverture: number } {

	let lo = Infinity, hi = - Infinity, sum = 0, n = 0;
	for ( let i = 0; i < p.mask.length; i ++ ) if ( p.mask[ i ] ) {

		const s = Math.hypot( p.u[ i ], p.v[ i ], p.w[ i ] );
		if ( s < lo ) lo = s; if ( s > hi ) hi = s; sum += s; n ++;

	}

	if ( ! n ) return { min: 0, moy: 0, max: 0, couverture: 0 };
	return { min: lo, moy: sum / n, max: hi, couverture: n / p.mask.length };

}
