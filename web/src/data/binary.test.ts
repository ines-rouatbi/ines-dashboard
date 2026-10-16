import { describe, expect, it } from 'vitest';
import { decodeFloat32LE, decodeNiveau, decodeUint8, encodeFloat32LE } from './binary';

describe( 'décodage des niveaux', () => {

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

	it( 'uint8 : octet × scale, 255 = absent', () => {

		const f = decodeUint8( Uint8Array.from( [ 0, 127, 254, 255 ] ).buffer, 1 / 254 );
		expect( f[ 0 ] ).toBe( 0 );
		expect( f[ 1 ] ).toBeCloseTo( 0.5, 6 );
		expect( f[ 2 ] ).toBeCloseTo( 1, 6 );
		expect( Number.isNaN( f[ 3 ] ) ).toBe( true );
		// status : scale 1 (ou null), 1 = mesuré, 0 = estimé.
		expect( Array.from( decodeNiveau( Uint8Array.from( [ 1, 0 ] ).buffer, 'uint8', null ) ) ).toEqual( [ 1, 0 ] );

	} );

	it( 'type inconnu refusé, absence d\'en-tête = float32', () => {

		expect( () => decodeNiveau( new ArrayBuffer( 4 ), 'int16' ) ).toThrow();
		expect( decodeNiveau( encodeFloat32LE( [ 3 ] ), null )[ 0 ] ).toBe( 3 );

	} );

} );
