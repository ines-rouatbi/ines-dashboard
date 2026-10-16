// Échelles de couleur des pages F3 (cartes et graphiques), alignées sur la charte §17.4 (lot F6, ui/couleurs.ts) :
// vitesse sur la rampe de la charte (bleu nuit → rouge), incertitude sur la rampe violette, grandeurs 0..1
// (couverture, fiabilité) en bleu séquentiel, états des capteurs en vert / orange / rouge (jamais une couleur
// seule : forme + libellé).

import type { StationState } from '../../data/contract';
import { COULEURS, RAMPE_INCERTITUDE, RAMPE_VITESSE } from '../../ui/couleurs';

export { RAMPE_VITESSE, RAMPE_INCERTITUDE };

/** Rampe séquentielle bleue, du clair (faible) au foncé (fort) : couverture et fiabilité (0..1). */
export const RAMPE_BLEUE = [ '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b' ];
/** Séries des graphiques (ordre fixe) : 1 accent bleu, 2 sable foncé (pas une couleur d'état). */
export const SERIE = [ COULEURS.accent, COULEURS.sableTexte ] as const;

/** Classes de fiabilité (ordinales) : élevée foncé → faible clair. */
export const CLASSES = { elevee: '#184f95', moyenne: '#3987e5', faible: '#9ec5f4' } as const;

/** Statut du nœud (catégoriel) : 1 = mesuré, 0 = estimé. */
export const STATUT = { mesure: COULEURS.sableTexte, estime: '#9ec5f4' } as const;

export const ETAT_CAPTEUR: Record<StationState, { couleur: string; forme: 'rond' | 'triangle' | 'croix' | 'carre' | 'losange'; libelle: string }> = {
	active: { couleur: COULEURS.ok, forme: 'rond', libelle: 'actif' },
	suspecte: { couleur: COULEURS.attention, forme: 'losange', libelle: 'suspect' },
	derive: { couleur: COULEURS.attentionTexte, forme: 'triangle', libelle: 'en dérive' },
	muette: { couleur: COULEURS.alerte, forme: 'croix', libelle: 'muet' },
	exclue: { couleur: COULEURS.neutre, forme: 'carre', libelle: 'exclu' },
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
