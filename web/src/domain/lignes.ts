// Lignes de courant d'un plan horizontal (niveau au-dessus de la mer, ou hauteur au-dessus du sol).
//
// Entrée : u, v natifs (nx·ny, index j·nx + i, j = 0 au sud), NaN = nœud absent. Le pas de grille
// (dx, dy) convertit la vitesse en cellules : di/dt = u/dx, dj/dt = v/dy (x vers l'Est, y vers le Nord).
// Intégration RK2 (point milieu) à pas constant en cellules, dans les deux sens depuis chaque germe.
// Arrêt : sortie du domaine, nœud absent (aucune extrapolation sous le relief), vitesse < 0,2 m/s
// (direction indéfinie, comme dirFrom), cellule déjà occupée par une autre ligne, longueur maximale.
//
// Décimation (performance, V3D10) : germes tous les `pas` nœuds, grille d'occupation qui empêche deux
// lignes de se superposer, plafond de segments. Sortie directement exploitable par un LineSegments :
// 2 sommets par segment, en coordonnées de grille fractionnaires (fi, fj), et la phase (abscisse
// curviligne, en cellules) de chaque sommet pour l'animation du sens d'écoulement.

import { SEUIL_CALME } from './wind';

export interface ChampHorizontal {
	nx: number;
	ny: number;
	dx: number;
	dy: number;
	u: Float32Array;
	v: Float32Array;
}

export interface OptionsLignes {
	/** Espacement des germes, en nœuds (≥ 1). */
	pas: number;
	/** Pas d'intégration, en cellules. */
	h?: number;
	/** Nombre maximal de pas dans chaque sens. */
	maxPas?: number;
	/** Plafond de segments (décimation). */
	maxSegments?: number;
}

export interface Lignes {
	/** Nombre de segments (2 sommets chacun). */
	segments: number;
	lignes: number;
	/** (fi, fj) de chaque sommet : 4 nombres par segment. */
	points: Float32Array;
	/** Abscisse curviligne (cellules) de chaque sommet : 2 nombres par segment. */
	phases: Float32Array;
}

/** Valeur bilinéaire d'un champ nx·ny en (fi, fj) ; NaN si l'un des 4 nœuds est absent ou hors domaine. */
export function bilineaireStricte( f: Float32Array, nx: number, ny: number, fi: number, fj: number ): number {

	if ( ! ( fi >= 0 && fj >= 0 && fi <= nx - 1 && fj <= ny - 1 ) ) return NaN;
	const i = Math.min( Math.floor( fi ), nx - 2 ), j = Math.min( Math.floor( fj ), ny - 2 );
	const a = fi - i, b = fj - j, k = j * nx + i;
	// Un nœud de poids nul n'intervient pas (un point sur une arête ne dépend que de ses 2 nœuds) ;
	// sinon un nœud absent propage NaN.
	const ligne = ( k0: number ) => ( a === 0 ? f[ k0 ] : a === 1 ? f[ k0 + 1 ] : f[ k0 ] * ( 1 - a ) + f[ k0 + 1 ] * a );
	if ( b === 0 ) return ligne( k );
	if ( b === 1 ) return ligne( k + nx );
	return ligne( k ) * ( 1 - b ) + ligne( k + nx ) * b;

}

/** Valeur bilinéaire pondérée par les seuls nœuds définis ; NaN si aucun des 4 ne l'est. */
export function bilineaireTolerante( f: Float32Array, nx: number, ny: number, fi: number, fj: number ): number {

	fi = Math.min( nx - 1, Math.max( 0, fi ) ); fj = Math.min( ny - 1, Math.max( 0, fj ) );
	const i = Math.min( Math.floor( fi ), Math.max( 0, nx - 2 ) ), j = Math.min( Math.floor( fj ), Math.max( 0, ny - 2 ) );
	const a = fi - i, b = fj - j, k = j * nx + i;
	const w = [ ( 1 - a ) * ( 1 - b ), a * ( 1 - b ), ( 1 - a ) * b, a * b ];
	const x = [ f[ k ], nx > 1 ? f[ k + 1 ] : NaN, ny > 1 ? f[ k + nx ] : NaN, nx > 1 && ny > 1 ? f[ k + nx + 1 ] : NaN ];
	let s = 0, sw = 0;
	for ( let q = 0; q < 4; q ++ ) if ( ! Number.isNaN( x[ q ] ) && x[ q ] !== undefined && w[ q ] > 0 ) { s += x[ q ] * w[ q ]; sw += w[ q ]; }
	if ( sw > 0 ) return s / sw;
	// Point exactement sur un nœud défini dont le poids est 1 : déjà couvert ; sinon inconnu.
	return NaN;

}

export function lignesDeCourant( c: ChampHorizontal, o: OptionsLignes ): Lignes {

	const { nx, ny, dx, dy, u, v } = c;
	const h = o.h ?? 0.5, maxPas = o.maxPas ?? 80, maxSeg = o.maxSegments ?? 60_000;
	const pas = Math.max( 1, Math.floor( o.pas ) );
	// Occupation : une case par demi-espacement de germes (lignes espacées d'environ pas/2 nœuds).
	const tc = Math.max( 0.5, pas / 2 ), ox = Math.ceil( nx / tc ) + 1, oy = Math.ceil( ny / tc ) + 1;
	const occ = new Int32Array( ox * oy );
	const caseDe = ( fi: number, fj: number ) => Math.floor( fj / tc ) * ox + Math.floor( fi / tc );

	const points = new Float32Array( maxSeg * 4 ), phases = new Float32Array( maxSeg * 2 );
	let nSeg = 0, nLignes = 0;

	// Direction (en cellules par unité de temps) normalisée ; null si absente ou trop faible.
	const vitesse = ( fi: number, fj: number ): [ number, number ] | null => {

		const a = bilineaireStricte( u, nx, ny, fi, fj ), b = bilineaireStricte( v, nx, ny, fi, fj );
		if ( Number.isNaN( a ) || Number.isNaN( b ) || Math.hypot( a, b ) < SEUIL_CALME ) return null;
		const ci = a / dx, cj = b / dy, n = Math.hypot( ci, cj );
		return [ ci / n, cj / n ];

	};

	const tracer = ( fi: number, fj: number, sens: number, id: number ): number[] => {

		const out: number[] = [];
		let x = fi, y = fj, d1 = vitesse( x, y );
		for ( let s = 0; s < maxPas && d1; s ++ ) {

			const mx = x + sens * d1[ 0 ] * h / 2, my = y + sens * d1[ 1 ] * h / 2;
			const d2 = vitesse( mx, my );
			if ( ! d2 ) break;
			const nxp = x + sens * d2[ 0 ] * h, nyp = y + sens * d2[ 1 ] * h;
			// Le nouveau sommet doit lui-même être défini : jamais de sommet entre des nœuds absents.
			const d3 = vitesse( nxp, nyp );
			if ( ! d3 ) break;
			const cOcc = caseDe( nxp, nyp ), occupant = occ[ cOcc ];
			if ( occupant !== 0 && occupant !== id ) break;
			occ[ cOcc ] = id;
			x = nxp; y = nyp; d1 = d3;
			out.push( x, y );

		}

		return out;

	};

	for ( let j0 = Math.floor( pas / 2 ); j0 < ny && nSeg < maxSeg; j0 += pas ) {

		for ( let i0 = Math.floor( pas / 2 ); i0 < nx && nSeg < maxSeg; i0 += pas ) {

			// Germe décalé d'un quart de pas une ligne sur deux : moins d'alignements visibles.
			const fi = Math.min( nx - 1, i0 + ( ( j0 / pas ) % 2 ? pas / 4 : 0 ) ), fj = j0;
			if ( occ[ caseDe( fi, fj ) ] !== 0 || ! vitesse( fi, fj ) ) continue;
			const id = nLignes + 1;
			occ[ caseDe( fi, fj ) ] = id;
			const arriere = tracer( fi, fj, - 1, id ), avant = tracer( fi, fj, 1, id );
			// Polyligne dans le sens de l'écoulement : arrière inversé, germe, avant.
			const poly: number[] = [];
			for ( let k = arriere.length - 2; k >= 0; k -= 2 ) poly.push( arriere[ k ], arriere[ k + 1 ] );
			poly.push( fi, fj, ...avant );
			if ( poly.length < 6 ) continue; // moins de 2 segments : bruit
			nLignes ++;
			let abs = 0;
			for ( let k = 0; k + 3 < poly.length && nSeg < maxSeg; k += 2 ) {

				const l = Math.hypot( poly[ k + 2 ] - poly[ k ], poly[ k + 3 ] - poly[ k + 1 ] );
				points.set( [ poly[ k ], poly[ k + 1 ], poly[ k + 2 ], poly[ k + 3 ] ], nSeg * 4 );
				phases[ nSeg * 2 ] = abs; abs += l; phases[ nSeg * 2 + 1 ] = abs;
				nSeg ++;

			}

		}

	}

	return { segments: nSeg, lignes: nLignes, points: points.subarray( 0, nSeg * 4 ), phases: phases.subarray( 0, nSeg * 2 ) };

}
