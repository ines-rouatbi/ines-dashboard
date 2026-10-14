// Préparation d'un plan (un niveau) pour la scène : échantillonnage et masque du relief.
//
// Entrée : grilles natives Float32 [j][i] (j = sud→nord, i = ouest→est), NaN = sous le relief.
// Sortie : grille échantillonnée (pas `stride`), même convention d'index j * nx + i.

import type { Meta } from '../data/contract';

export interface Plan {
	altitude: number;
	nx: number;
	ny: number;
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
	/** Étendue Est (m) et Nord (m) depuis le coin sud-ouest. */
	sizeX: number;
	sizeY: number;
	altitudes: number[];
}

export function domaineDepuisMeta( meta: Meta ): Domaine {

	const { nx, ny, dx_m, dy_m } = meta.grid;
	const altitudes = meta.levels_m_asl ?? [];
	const d = meta.domain;
	const sizeX = d?.x_max_m != null && d?.x_min_m != null ? d.x_max_m - d.x_min_m : ( nx - 1 ) * dx_m;
	const sizeY = d?.y_max_m != null && d?.y_min_m != null ? d.y_max_m - d.y_min_m : ( ny - 1 ) * dy_m;
	return { nx, ny, nz: meta.grid.nz ?? altitudes.length, dx: dx_m, dy: dy_m, sizeX, sizeY, altitudes };

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

	return { altitude, nx, ny, dx: dom.dx * s, dy: dom.dy * s, stride: s, u: ou, v: ov, w: ow, mask };

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
