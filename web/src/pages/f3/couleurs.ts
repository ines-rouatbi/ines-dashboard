// Échelles de couleur des pages F3 (cartes et graphiques).
// Séquentiel = une seule teinte, du clair au foncé (jamais d'arc-en-ciel) : bleu pour le vent et les
// grandeurs 0..1, orangé pour l'incertitude (deuxième contexte séquentiel affiché en même temps).
// Les états des capteurs reprennent la palette d'état (jamais une couleur seule : forme + libellé).

import type { StationState } from '../../data/contract';

/** Rampe séquentielle bleue, du clair (faible) au foncé (fort). */
export const RAMPE_BLEUE = [ '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b' ];
/** Rampe séquentielle orangée (incertitude). */
export const RAMPE_ORANGE = [ '#fde3d4', '#f9c09f', '#f39a6b', '#eb6834', '#c9501f', '#9c3d15', '#6e2a0d' ];

/** Séries des graphiques (ordre fixe) : 1 bleu, 2 orangé. */
export const SERIE = [ '#2a78d6', '#eb6834' ] as const;

/** Classes de fiabilité (ordinales) : élevée foncé → faible clair. */
export const CLASSES = { elevee: '#184f95', moyenne: '#3987e5', faible: '#9ec5f4' } as const;

/** Statut du nœud (catégoriel) : 1 = mesuré, 0 = estimé. */
export const STATUT = { mesure: '#eb6834', estime: '#9ec5f4' } as const;

export const ETAT_CAPTEUR: Record<StationState, { couleur: string; forme: 'rond' | 'triangle' | 'croix' | 'carre' | 'losange'; libelle: string }> = {
	active: { couleur: '#0ca30c', forme: 'rond', libelle: 'actif' },
	suspecte: { couleur: '#fab219', forme: 'losange', libelle: 'suspect' },
	derive: { couleur: '#ec835a', forme: 'triangle', libelle: 'en dérive' },
	muette: { couleur: '#d03b3b', forme: 'croix', libelle: 'muet' },
	exclue: { couleur: '#6b7d8d', forme: 'carre', libelle: 'exclu' },
};

const rgb = ( hex: string ): [ number, number, number ] => [ 1, 3, 5 ].map( ( k ) => parseInt( hex.slice( k, k + 2 ), 16 ) ) as [ number, number, number ];

/** Couleur RVB d'une rampe en t ∈ [0, 1] (interpolation linéaire entre les paliers, t borné). */
export function couleurRampe( rampe: readonly string[], t: number ): [ number, number, number ] {

	const x = Math.min( 1, Math.max( 0, Number.isFinite( t ) ? t : 0 ) ) * ( rampe.length - 1 );
	const k = Math.min( rampe.length - 2, Math.floor( x ) ), f = x - k;
	const a = rgb( rampe[ k ] ), b = rgb( rampe[ k + 1 ] );
	return [ 0, 1, 2 ].map( ( c ) => Math.round( a[ c ] + ( b[ c ] - a[ c ] ) * f ) ) as [ number, number, number ];

}

export const hexVersRgb = rgb;
