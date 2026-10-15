// Tampons de la scène (lot F2) : positions en mètres, surface sol / mer, coupes arrêtées au relief,
// couleur neutre pour l'inconnu.

import { describe, expect, it } from 'vitest';
import { altitudeSurface, tamponCoupeH, tamponCoupeV, tamponLignes, type Grille } from './tampons';
import { NEUTRE, echelle } from '../domain/palettes';

// 3 × 2 nœuds à 500 m ; relief 100 m sauf le nœud (2, 1) à 400 m.
const g: Grille = { nx: 3, ny: 2, dx: 500, dy: 500, terrain: Float32Array.from( [ 100, 100, 100, 100, 100, 400 ] ), altitudes: [ 150, 300, 600 ], minAgl: 5 };

describe( 'tampons de la scène', () => {

	it( 'surface : altitude constante (mer) ou relief + h (sol)', () => {

		expect( altitudeSurface( g, { mode: 'mer', z: 300 }, 1, 1 ) ).toBe( 300 );
		expect( altitudeSurface( g, { mode: 'sol', h: 120 }, 0, 0 ) ).toBe( 220 );
		expect( altitudeSurface( g, { mode: 'sol', h: 120 }, 2, 1 ) ).toBe( 520 );

	} );

	it( 'lignes : X = fi·dx, Z = −fj·dy ; valeur inconnue → couleur neutre', () => {

		const l = { segments: 1, lignes: 1, points: Float32Array.from( [ 0, 0, 1, 1 ] ), phases: Float32Array.from( [ 0, 1.41 ] ) };
		const val = Float32Array.from( [ NaN, 5, 5, 5, NaN, 5 ] );
		const t = tamponLignes( g, { mode: 'mer', z: 600 }, l, val, echelle( 'vitesse', Float32Array.from( [ 0, 10 ] ) ) );
		expect( [ ...t.positions ] ).toEqual( [ 0, 600, - 0, 500, 600, - 500 ] );
		expect( [ ...t.couleurs.subarray( 0, 3 ) ] ).toEqual( NEUTRE.map( Math.fround ) );
		expect( [ ...t.couleurs.subarray( 3, 6 ) ] ).toEqual( NEUTRE.map( Math.fround ) );

	} );

	it( 'coupe horizontale : aucun triangle sur un nœud où le plan n\'existe pas', () => {

		const existe = Float32Array.from( [ 1, 1, 1, 1, 1, NaN ] );
		const t = tamponCoupeH( g, { mode: 'sol', h: 120 }, existe, null, null );
		expect( t.index.length ).toBe( 6 ); // seul le quadrilatère de gauche
		expect( [ ...t.index ].includes( 5 ) ).toBe( false );
		expect( t.positions[ 5 * 3 + 1 ] ).toBe( 520 );

	} );

	it( 'coupe verticale : un nœud existe ssi z − relief ≥ min_agl_m (s\'arrête au relief)', () => {

		// Ligne j = 1, est-ouest : à 150 m et 300 m, le nœud (2, 1) (relief 400 m) n'existe pas.
		const t = tamponCoupeV( g, 'est-ouest', 1, () => Float32Array.from( [ 1, 2, 3, 4, 5, 6 ] ), echelle( 'vitesse', Float32Array.from( [ 0, 10 ] ) ) );
		const sommetsUtilises = new Set( t.index );
		// Sommet (c = 2, k = 0) = 2 et (c = 2, k = 1) = 5 : jamais reliés.
		expect( sommetsUtilises.has( 2 ) ).toBe( false );
		expect( sommetsUtilises.has( 5 ) ).toBe( false );
		expect( t.index.length ).toBe( 12 ); // 2 quadrilatères, tous deux à l'ouest (c 0-1)
		expect( t.positions[ 8 * 3 + 1 ] ).toBe( 600 );

	} );

} );
