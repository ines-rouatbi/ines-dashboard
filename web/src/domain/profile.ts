// Profil vertical CALCULÉ CÔTÉ CLIENT à partir des champs publiés d'une maille.
//
// /v1/profiles n'est publié que pour un point par défaut : pour une maille quelconque,
// on relit les binaires des nz niveaux (u, v, w, speed, sigma_u, sigma_v, coverage,
// reliability, status) et on assemble un profil au format du contrat.
//
// Intervalle à 80 % de la vitesse : p50 = speed, p10/p90 = speed ∓ 1,2816·σ, où σ est
// l'écart type de la vitesse propagé depuis (σu, σv) au premier ordre :
//     σ = √((u·σu)² + (v·σv)²) / speed      (si speed ≈ 0 : σ = √((σu² + σv²) / 2))
// p10 est borné à 0. La classe de fiabilité n'est pas recalculée (seuils non publiés
// dans le contrat, D4 : les calculs scientifiques vivent en Python) : elle vaut null.

import type { ProfileLevel } from '../data/contract';
import { dirFrom } from './wind';

/** Quantile 0,9 de la loi normale : ±Z80·σ encadre 80 % des valeurs. */
export const Z80 = 1.2816;

export const VARS_PROFIL = [ 'u', 'v', 'w', 'speed', 'sigma_u', 'sigma_v', 'coverage', 'reliability', 'status' ] as const;
export type VarProfil = typeof VARS_PROFIL[ number ];

/** Valeurs brutes d'un nœud (NaN = sous le relief ou absent). */
export type ValeursNoeud = Record<VarProfil, number>;

export interface ProfilCalcule {
	i: number;
	j: number;
	x_m: number;
	y_m: number;
	z_terrain_m: number | null;
	levels: ProfileLevel[];
}

const fini = ( x: number ) => ( Number.isFinite( x ) ? x : null );

/** Écart type de la vitesse horizontale, propagé depuis σu et σv. */
export function sigmaVitesse( u: number, v: number, su: number, sv: number, speed: number ): number {

	if ( ! ( speed > 1e-6 ) ) return Math.sqrt( ( su * su + sv * sv ) / 2 );
	return Math.sqrt( ( u * su ) ** 2 + ( v * sv ) ** 2 ) / speed;

}

/** Intervalle à 80 % (p10 borné à 0). */
export function intervalle80( speed: number, sigma: number ): { p10: number; p50: number; p90: number } {

	return { p10: Math.max( 0, speed - Z80 * sigma ), p50: speed, p90: speed + Z80 * sigma };

}

/** Un niveau du profil, au format du contrat. */
export function niveauProfil( zAsl: number, terrain: number | null, n: ValeursNoeud ): ProfileLevel {

	const agl = terrain == null ? NaN : zAsl - terrain;
	const sous = Number.isNaN( n.u ) || Number.isNaN( n.v ) || Number.isNaN( n.speed );
	if ( sous ) {

		return {
			z_asl_m: zAsl, agl_m: agl, below_terrain: true,
			u: null, v: null, w: null, speed: null, dir_from_deg: null,
			speed_interval: { p10: null, p50: null, p90: null },
			status: null, coverage: null, reliability: null, reliability_class: null,
		};

	}

	const speed = n.speed;
	const su = Number.isNaN( n.sigma_u ) ? NaN : n.sigma_u, sv = Number.isNaN( n.sigma_v ) ? NaN : n.sigma_v;
	const sigma = sigmaVitesse( n.u, n.v, su, sv, speed );
	const iv = Number.isFinite( sigma ) ? intervalle80( speed, sigma ) : { p10: null, p50: speed, p90: null };
	return {
		z_asl_m: zAsl,
		agl_m: agl,
		below_terrain: false,
		u: n.u, v: n.v, w: fini( n.w ), speed,
		dir_from_deg: dirFrom( n.u, n.v ),
		speed_interval: iv,
		status: n.status === 1 ? 'mesure' : n.status === 0 ? 'estime' : null,
		coverage: fini( n.coverage ),
		reliability: fini( n.reliability ),
		reliability_class: null,
	};

}

/**
 * Assemble le profil de la maille (i, j) à partir des champs de chaque niveau.
 * `champs[k][var]` = binaire natif du niveau k ; `terrain` = relief natif (ou null).
 */
export function profilColonne(
	dom: { nx: number; ny: number; dx: number; dy: number; altitudes: number[] },
	i: number,
	j: number,
	champs: Partial<Record<VarProfil, Float32Array>>[],
	terrain: Float32Array | null,
): ProfilCalcule {

	const idx = j * dom.nx + i;
	const zt = terrain && terrain.length === dom.nx * dom.ny ? terrain[ idx ] : NaN;
	const lire = ( k: number, v: VarProfil ) => champs[ k ]?.[ v ]?.[ idx ] ?? NaN;
	const levels = dom.altitudes.map( ( z, k ) => niveauProfil( z, Number.isFinite( zt ) ? zt : null,
		Object.fromEntries( VARS_PROFIL.map( ( v ) => [ v, lire( k, v ) ] ) ) as ValeursNoeud ) );
	return { i, j, x_m: ( i + 0.5 ) * dom.dx, y_m: ( j + 0.5 ) * dom.dy, z_terrain_m: Number.isFinite( zt ) ? zt : null, levels };

}
