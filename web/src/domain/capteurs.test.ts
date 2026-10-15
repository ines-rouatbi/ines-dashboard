import { describe, expect, it } from 'vitest';
import { capteurProche } from './capteurs';
import type { Station } from '../data/contract';

const st = ( id: string, x_m: number, y_m: number, state: Station[ 'state' ] ) => ( { id, x_m, y_m, state } ) as Station;

describe( 'capteur le plus proche', () => {

	it( 'treillis synthétique : c<i>_<j> à 50 m, capteur visible le plus proche', () => {

		expect( capteurProche( 'treillis_synthetique', [], 12000, 8000 ) ).toEqual( { id: 'c240_160', distance_m: 0, state: 'active' } );
		// Capteur muet sous le point : on prend le voisin, d'abord à l'Est (comme les profils précalculés).
		const p = capteurProche( 'treillis_synthetique', [ st( 'c880_420', 44000, 21000, 'muette' ) ], 44000, 21000 );
		expect( p ).toEqual( { id: 'c881_420', distance_m: 50, state: 'active' } );
		// Un capteur en dérive reste visible : il est retenu avec son état.
		expect( capteurProche( 'treillis_synthetique', [ st( 'c340_200', 17000, 10000, 'derive' ) ], 17000, 10000 )?.state ).toBe( 'derive' );

	} );

	it( 'stations ANEO : la plus proche, ni muette ni exclue', () => {

		const l = [ st( 'A', 0, 0, 'muette' ), st( 'B', 300, 0, 'active' ), st( 'C', 1000, 0, 'derive' ) ];
		expect( capteurProche( 'stations_aneo', l, 10, 0 )?.id ).toBe( 'B' );
		expect( capteurProche( 'stations_aneo', [], 0, 0 ) ).toBeNull();

	} );

} );
