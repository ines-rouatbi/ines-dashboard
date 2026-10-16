// Frise temporelle (UI v2) : positions, curseur aimanté aux instants publiés, voisins, départ de lecture, vitesses.

import { describe, expect, it } from 'vitest';
import { delaiLecture, departLecture, indiceProche, positionsFrise, voisin } from './frise';

const it3 = [
	{ snapshot_id: 'a_00000000', valid_time: '2025-02-28T00:00:00Z' },
	{ snapshot_id: 'b_00000000', valid_time: '2025-02-28T03:00:00Z' },
	{ snapshot_id: 'c_00000000', valid_time: '2025-02-28T12:00:00Z' },
];

describe( 'frise', () => {

	it( 'positions sur l’axe du temps (un seul instant : au milieu)', () => {

		expect( positionsFrise( it3 ) ).toEqual( [ 0, 0.25, 1 ] );
		expect( positionsFrise( [ it3[ 0 ] ] ) ).toEqual( [ 0.5 ] );

	} );

	it( 'le curseur glissé s’aimante à l’instant publié le plus proche (jamais un instant inventé)', () => {

		expect( indiceProche( it3, 0.1 ) ).toBe( 0 );
		expect( indiceProche( it3, 0.2 ) ).toBe( 1 );
		expect( indiceProche( it3, 0.7 ) ).toBe( 2 );
		expect( indiceProche( it3, - 3 ) ).toBe( 0 );
		expect( indiceProche( [], 0.5 ) ).toBe( - 1 );

	} );

	it( 'voisins, début et fin ; null au bord', () => {

		expect( voisin( it3, 'b_00000000', 1 ) ).toBe( 'c_00000000' );
		expect( voisin( it3, 'b_00000000', - 1 ) ).toBe( 'a_00000000' );
		expect( voisin( it3, 'c_00000000', 1 ) ).toBeNull();
		expect( voisin( it3, 'a_00000000', 'debut' ) ).toBeNull();
		expect( voisin( it3, 'a_00000000', 'fin' ) ).toBe( 'c_00000000' );
		expect( voisin( it3, 'inconnu', 1 ) ).toBe( 'a_00000000' );

	} );

	it( 'lecture : départ du plus ancien au bout de la frise ; indisponible avec un seul instant', () => {

		expect( departLecture( it3, 'c_00000000' ) ).toBe( 'a_00000000' );
		expect( departLecture( it3, 'b_00000000' ) ).toBe( 'b_00000000' );
		expect( departLecture( [ it3[ 0 ] ], 'a_00000000' ) ).toBeNull();

	} );

	it( 'vitesse ×1, ×2, ×4', () => {

		expect( delaiLecture( 1, 1800 ) ).toBe( 1800 );
		expect( delaiLecture( 2, 1800 ) ).toBe( 900 );
		expect( delaiLecture( 4, 1800 ) ).toBe( 450 );

	} );

} );
