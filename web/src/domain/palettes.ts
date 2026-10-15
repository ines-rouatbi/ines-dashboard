// Coloration de la scène (lignes de courant, coupes) et légende chiffrée.
//
// Trois variables, toutes lues dans les champs publiés (jamais recalculées) :
//   vitesse     → `speed` (norme horizontale, m/s), palette viridis, échelle min..max du plan affiché ;
//   incertitude → `sigma_speed` (écart-type calibré, m/s), palette « magma », échelle 0..max du plan ;
//   fiabilité   → `reliability` (0..1), échelle fixe 0..1, classes aux seuils du contrat (0,5 ; 0,75).
// Une valeur inconnue (NaN) prend la couleur NEUTRE, signalée « non disponible » dans la légende.

import { SEUIL_ELEVEE, SEUIL_MOYENNE } from './fiabilite';
import type { FieldVar } from '../data/contract';

export type Coloration = 'vitesse' | 'incertitude' | 'fiabilite';

export const VARIABLE_COLORATION: Record<Coloration, FieldVar> = { vitesse: 'speed', incertitude: 'sigma_speed', fiabilite: 'reliability' };

export const LIBELLE_COLORATION: Record<Coloration, { titre: string; unite: string; decimales: number }> = {
	vitesse: { titre: 'Vitesse horizontale', unite: 'm/s', decimales: 1 },
	incertitude: { titre: 'Incertitude (σ de la vitesse)', unite: 'm/s', decimales: 2 },
	fiabilite: { titre: 'Fiabilité', unite: '', decimales: 2 },
};

type RGB = [ number, number, number ];

const VIRIDIS: RGB[] = [
	[ 0.267, 0.005, 0.329 ], [ 0.283, 0.141, 0.458 ], [ 0.254, 0.265, 0.530 ],
	[ 0.207, 0.372, 0.553 ], [ 0.164, 0.471, 0.558 ], [ 0.128, 0.567, 0.551 ],
	[ 0.135, 0.659, 0.518 ], [ 0.267, 0.749, 0.441 ], [ 0.478, 0.821, 0.318 ],
	[ 0.741, 0.873, 0.150 ], [ 0.993, 0.906, 0.144 ],
];

const MAGMA: RGB[] = [
	[ 0.001, 0.000, 0.014 ], [ 0.078, 0.054, 0.212 ], [ 0.232, 0.059, 0.437 ],
	[ 0.390, 0.100, 0.502 ], [ 0.550, 0.161, 0.506 ], [ 0.716, 0.215, 0.475 ],
	[ 0.868, 0.288, 0.409 ], [ 0.967, 0.439, 0.360 ], [ 0.994, 0.624, 0.427 ],
	[ 0.995, 0.807, 0.571 ], [ 0.987, 0.991, 0.750 ],
];

// Fiabilité : rouge (faible) → ocre (moyenne) → vert (élevée), ruptures aux seuils du contrat.
const FIAB: { t: number; c: RGB }[] = [
	{ t: 0, c: [ 0.70, 0.13, 0.13 ] },
	{ t: SEUIL_MOYENNE - 1e-6, c: [ 0.93, 0.45, 0.25 ] },
	{ t: SEUIL_MOYENNE, c: [ 0.85, 0.66, 0.20 ] },
	{ t: SEUIL_ELEVEE - 1e-6, c: [ 0.95, 0.85, 0.35 ] },
	{ t: SEUIL_ELEVEE, c: [ 0.40, 0.75, 0.40 ] },
	{ t: 1, c: [ 0.10, 0.50, 0.30 ] },
];

/** Couleur neutre des valeurs inconnues (« non disponible »). */
export const NEUTRE: RGB = [ 0.55, 0.58, 0.62 ];

function rampe( p: RGB[], t: number ): RGB {

	t = Math.min( 1, Math.max( 0, t ) );
	const x = t * ( p.length - 1 ), i = Math.floor( x ), f = x - i;
	const a = p[ i ], b = p[ Math.min( i + 1, p.length - 1 ) ];
	return [ a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * f, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * f, a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * f ];

}

function rampeFiab( v: number ): RGB {

	v = Math.min( 1, Math.max( 0, v ) );
	for ( let k = 0; k + 1 < FIAB.length; k ++ ) {

		const a = FIAB[ k ], b = FIAB[ k + 1 ];
		if ( v >= a.t && v <= b.t ) {

			const f = b.t > a.t ? ( v - a.t ) / ( b.t - a.t ) : 0;
			return [ a.c[ 0 ] + ( b.c[ 0 ] - a.c[ 0 ] ) * f, a.c[ 1 ] + ( b.c[ 1 ] - a.c[ 1 ] ) * f, a.c[ 2 ] + ( b.c[ 2 ] - a.c[ 2 ] ) * f ];

		}

	}

	return FIAB[ FIAB.length - 1 ].c;

}

export function viridis( t: number ): RGB { return rampe( VIRIDIS, t ); }

/** Échelle d'une coloration : [min, max] des valeurs, ou null si aucune valeur définie. */
export interface Echelle { coloration: Coloration; min: number; max: number }

/** Échelle d'un plan : vitesse min..max, incertitude 0..max, fiabilité 0..1 (fixe). */
export function echelle( coloration: Coloration, valeurs: ArrayLike<number> ): Echelle | null {

	let lo = Infinity, hi = - Infinity;
	for ( let i = 0; i < valeurs.length; i ++ ) { const x = valeurs[ i ]; if ( Number.isNaN( x ) ) continue; if ( x < lo ) lo = x; if ( x > hi ) hi = x; }
	if ( coloration === 'fiabilite' ) return { coloration, min: 0, max: 1 };
	if ( ! Number.isFinite( lo ) ) return null;
	if ( coloration === 'incertitude' ) lo = 0;
	if ( hi - lo < 1e-6 ) hi = lo + 1e-6;
	return { coloration, min: lo, max: hi };

}

/** Couleur RVB (0..1) d'une valeur ; NEUTRE si inconnue. */
export function couleur( e: Echelle | null, v: number ): RGB {

	if ( ! e || Number.isNaN( v ) ) return NEUTRE;
	if ( e.coloration === 'fiabilite' ) return rampeFiab( v );
	const t = ( v - e.min ) / ( e.max - e.min );
	return e.coloration === 'vitesse' ? rampe( VIRIDIS, t ) : rampe( MAGMA, 0.15 + 0.85 * t );

}

export function rgbCss( c: RGB ): string { return `rgb(${ c.map( ( x ) => Math.round( x * 255 ) ).join( ',' ) })`; }

/** Dégradé CSS de la légende (gauche = min, droite = max). */
export function degradeCss( e: Echelle | null, coloration: Coloration, n = 24 ): string {

	const ech = e ?? { coloration, min: 0, max: 1 };
	const pas = Array.from( { length: n }, ( _, i ) => {

		const v = ech.min + ( ech.max - ech.min ) * i / ( n - 1 );
		return `${ rgbCss( couleur( ech, v ) ) } ${ ( 100 * i / ( n - 1 ) ).toFixed( 1 ) }%`;

	} );
	return `linear-gradient(90deg, ${ pas.join( ',' ) })`;

}

/** Pas « rond » (1, 2, 2,5, 5 × 10^n) pour environ `cible` intervalles. */
export function pasRond( etendue: number, cible = 4 ): number {

	if ( ! ( etendue > 0 ) ) return 1;
	const brut = etendue / cible, p = 10 ** Math.floor( Math.log10( brut ) ), m = brut / p;
	return ( m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10 ) * p;

}

/** Graduations de la légende : bornes exactes + valeurs rondes intermédiaires, avec leur position 0..1. */
export function graduations( e: Echelle ): { valeur: number; position: number }[] {

	if ( e.coloration === 'fiabilite' ) return [ 0, SEUIL_MOYENNE, SEUIL_ELEVEE, 1 ].map( ( valeur ) => ( { valeur, position: valeur } ) );
	const { min, max } = e, pas = pasRond( max - min );
	const out = [ { valeur: min, position: 0 } ];
	for ( let v = Math.ceil( min / pas ) * pas; v < max - pas * 0.4; v += pas ) if ( v > min + pas * 0.4 ) out.push( { valeur: v, position: ( v - min ) / ( max - min ) } );
	out.push( { valeur: max, position: 1 } );
	return out;

}
