import { describe, expect, it } from 'vitest';
import { decodeFloat32LE, encodeFloat32LE } from './binary';

describe( 'decodeFloat32LE', () => {

	it( 'lit les Float32 little-endian, NaN compris', () => {

		const buf = new ArrayBuffer( 12 ), dv = new DataView( buf );
		dv.setFloat32( 0, 1.5, true );
		dv.setFloat32( 4, -3.25, true );
		dv.setFloat32( 8, NaN, true );
		const f = decodeFloat32LE( buf );
		expect( f.length ).toBe( 3 );
		expect( f[ 0 ] ).toBe( 1.5 );
		expect( f[ 1 ] ).toBe( -3.25 );
		expect( Number.isNaN( f[ 2 ] ) ).toBe( true );

	} );

	it( 'fait l\'aller-retour avec encodeFloat32LE', () => {

		expect( Array.from( decodeFloat32LE( encodeFloat32LE( [ 0, 2, -7.5 ] ) ) ) ).toEqual( [ 0, 2, -7.5 ] );

	} );

	it( 'refuse une taille qui n\'est pas multiple de 4', () => {

		expect( () => decodeFloat32LE( new ArrayBuffer( 6 ) ) ).toThrow();

	} );

} );
