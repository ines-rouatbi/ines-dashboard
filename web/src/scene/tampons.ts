// Tampons de la scène (Float32Array prêts pour des BufferAttribute), construits sans three.js.
//
// Repère LOCAL du groupe « monde » de la scène, en mètres : X = x_m − x0 (Est), Y = altitude au-dessus
// de la mer (exagérée par l'échelle du groupe, jamais ici), Z = −(y_m − y0) (le Nord vers −Z).
// Nœud (i, j) en X = i·dx, Z = −j·dy. Les couleurs sont en sRGB 0..1 (la scène convertit au besoin).

import { bilineaireTolerante, type Lignes } from '../domain/lignes';
import { trianglesValides } from '../domain/maillage';
import { couleur, NEUTRE, type Echelle } from '../domain/palettes';

export interface Grille {
	nx: number;
	ny: number;
	dx: number;
	dy: number;
	/** Relief du modèle, ny·nx, m au-dessus de la mer. */
	terrain: Float32Array;
	/** Altitudes des niveaux (m, mer). */
	altitudes: number[];
	minAgl: number;
}

/** Surface d'un plan horizontal : altitude constante (mode mer) ou relief + h (mode sol). */
export type Surface = { mode: 'mer'; z: number } | { mode: 'sol'; h: number };

export function altitudeSurface( g: Grille, s: Surface, fi: number, fj: number ): number {

	return s.mode === 'mer' ? s.z : bilineaireTolerante( g.terrain, g.nx, g.ny, fi, fj ) + s.h;

}

export interface TamponLignes {
	positions: Float32Array;
	couleurs: Float32Array;
	phases: Float32Array;
	sommets: number;
	/** Vitesse horizontale publiée (m/s) à chaque sommet, interpolée (traceurs animés, UI v2) ; absente si non fournie. */
	vitesses?: Float32Array | null;
}

/**
 * Lignes de courant (fi, fj) → sommets 3D colorés par la variable `valeurs` (NaN → neutre) ; `vitesse` (champ speed
 * du plan) donne la vitesse de chaque sommet pour l'animation des traceurs.
 */
export function tamponLignes( g: Grille, s: Surface, l: Lignes, valeurs: Float32Array | null, e: Echelle | null, vitesse: Float32Array | null = null ): TamponLignes {

	const n = l.segments * 2;
	const positions = new Float32Array( n * 3 ), couleurs = new Float32Array( n * 3 ), phases = new Float32Array( n );
	const vitesses = vitesse ? new Float32Array( n ) : null;
	for ( let k = 0; k < n; k ++ ) {

		const fi = l.points[ k * 2 ], fj = l.points[ k * 2 + 1 ];
		positions[ k * 3 ] = fi * g.dx;
		positions[ k * 3 + 1 ] = altitudeSurface( g, s, fi, fj );
		positions[ k * 3 + 2 ] = - fj * g.dy;
		const c = valeurs ? couleur( e, bilineaireTolerante( valeurs, g.nx, g.ny, fi, fj ) ) : NEUTRE;
		couleurs[ k * 3 ] = c[ 0 ]; couleurs[ k * 3 + 1 ] = c[ 1 ]; couleurs[ k * 3 + 2 ] = c[ 2 ];
		phases[ k ] = l.phases[ k ];
		if ( vitesses ) vitesses[ k ] = bilineaireTolerante( vitesse!, g.nx, g.ny, fi, fj );

	}

	return { positions, couleurs, phases, sommets: n, vitesses };

}

export interface TamponMaillage { positions: Float32Array; couleurs: Float32Array; index: Uint32Array }

/**
 * Coupe horizontale : un sommet par nœud, à l'altitude de la surface ; seuls les nœuds où le plan
 * existe (`existe[idx]` non NaN : u défini) sont reliés. Couleur = valeur, neutre si inconnue.
 */
export function tamponCoupeH( g: Grille, s: Surface, existe: Float32Array, valeurs: Float32Array | null, e: Echelle | null ): TamponMaillage {

	const n = g.nx * g.ny;
	const positions = new Float32Array( n * 3 ), couleurs = new Float32Array( n * 3 ), valide = new Uint8Array( n );
	for ( let j = 0; j < g.ny; j ++ ) for ( let i = 0; i < g.nx; i ++ ) {

		const idx = j * g.nx + i;
		positions[ idx * 3 ] = i * g.dx;
		positions[ idx * 3 + 1 ] = s.mode === 'mer' ? s.z : g.terrain[ idx ] + s.h;
		positions[ idx * 3 + 2 ] = - j * g.dy;
		valide[ idx ] = Number.isNaN( existe[ idx ] ) ? 0 : 1;
		const c = valeurs ? couleur( e, valeurs[ idx ] ) : NEUTRE;
		couleurs[ idx * 3 ] = c[ 0 ]; couleurs[ idx * 3 + 1 ] = c[ 1 ]; couleurs[ idx * 3 + 2 ] = c[ 2 ];

	}

	return { positions, couleurs, index: trianglesValides( g.nx, g.ny, valide ) };

}

export type AxeCoupe = 'est-ouest' | 'nord-sud';

/**
 * Coupe verticale le long de la ligne j (axe est-ouest) ou de la colonne i (axe nord-sud), sur tous
 * les niveaux. Un nœud existe ssi z − relief ≥ min_agl_m (règle du contrat, calculée sur le relief) ;
 * la coupe s'arrête donc au relief. Couleur = valeur du niveau (neutre si inconnue ou non chargée).
 */
export function tamponCoupeV( g: Grille, axe: AxeCoupe, indice: number, niveau: ( k: number ) => Float32Array | undefined, e: Echelle | null ): TamponMaillage {

	const ncol = axe === 'est-ouest' ? g.nx : g.ny, nz = g.altitudes.length;
	const positions = new Float32Array( ncol * nz * 3 ), couleurs = new Float32Array( ncol * nz * 3 ), valide = new Uint8Array( ncol * nz );
	for ( let k = 0; k < nz; k ++ ) {

		const f = niveau( k );
		for ( let c = 0; c < ncol; c ++ ) {

			const i = axe === 'est-ouest' ? c : indice, j = axe === 'est-ouest' ? indice : c;
			const idx = j * g.nx + i, v = k * ncol + c;
			positions[ v * 3 ] = i * g.dx;
			positions[ v * 3 + 1 ] = g.altitudes[ k ];
			positions[ v * 3 + 2 ] = - j * g.dy;
			valide[ v ] = g.altitudes[ k ] - g.terrain[ idx ] >= g.minAgl ? 1 : 0;
			const col = f ? couleur( e, f[ idx ] ) : NEUTRE;
			couleurs[ v * 3 ] = col[ 0 ]; couleurs[ v * 3 + 1 ] = col[ 1 ]; couleurs[ v * 3 + 2 ] = col[ 2 ];

		}

	}

	return { positions, couleurs, index: trianglesValides( ncol, nz, valide ) };

}

/** Teinte hypsométrique du relief (sRGB) : plaine sable clair → reliefs bruns. */
export function teinteRelief( t: number ): [ number, number, number ] {

	const a = [ 0.86, 0.80, 0.66 ], b = [ 0.72, 0.57, 0.35 ], c = [ 0.52, 0.42, 0.30 ];
	t = Math.min( 1, Math.max( 0, t ) );
	const [ p, q, f ] = t < 0.5 ? [ a, b, t * 2 ] : [ b, c, t * 2 - 1 ];
	return [ p[ 0 ] + ( q[ 0 ] - p[ 0 ] ) * f, p[ 1 ] + ( q[ 1 ] - p[ 1 ] ) * f, p[ 2 ] + ( q[ 2 ] - p[ 2 ] ) * f ];

}
