import { describe, expect, it } from 'vitest';
import { cardinal, dirFrom, kmhVersMs, msVersKmh, msVersNoeuds, vitesse3D, vitesseH } from './wind';

describe( 'dirFrom (direction d\'où vient le vent)', () => {

	it( 'vent du nord : u=0, v=-5 → 0°', () => expect( dirFrom( 0, -5 ) ).toBeCloseTo( 0, 9 ) );
	it( 'vent d\'est : u=-5, v=0 → 90°', () => expect( dirFrom( -5, 0 ) ).toBeCloseTo( 90, 9 ) );
	it( 'vent du sud : u=0, v=5 → 180°', () => expect( dirFrom( 0, 5 ) ).toBeCloseTo( 180, 9 ) );
	it( 'vent d\'ouest : u=5, v=0 → 270°', () => expect( dirFrom( 5, 0 ) ).toBeCloseTo( 270, 9 ) );

	it( 'diagonales (8 cas cardinaux)', () => {

		expect( dirFrom( -3, -3 ) ).toBeCloseTo( 45, 9 );   // du nord-est
		expect( dirFrom( -3, 3 ) ).toBeCloseTo( 135, 9 );   // du sud-est
		expect( dirFrom( 3, 3 ) ).toBeCloseTo( 225, 9 );    // du sud-ouest
		expect( dirFrom( 3, -3 ) ).toBeCloseTo( 315, 9 );   // du nord-ouest

	} );

	it( 'calme (< 0,2 m/s) → null', () => {

		expect( dirFrom( 0, 0 ) ).toBeNull();
		expect( dirFrom( 0.1, -0.1 ) ).toBeNull();
		expect( dirFrom( 0.19, 0 ) ).toBeNull();
		expect( dirFrom( 0.2, 0 ) ).not.toBeNull();

	} );

	it( 'NaN (sous le relief) → null', () => expect( dirFrom( NaN, 3 ) ).toBeNull() );

	it( 'reste dans [0, 360)', () => {

		for ( let a = 0; a < 360; a += 7 ) {

			const r = a * Math.PI / 180, d = dirFrom( Math.cos( r ) * 4, Math.sin( r ) * 4 )!;
			expect( d ).toBeGreaterThanOrEqual( 0 );
			expect( d ).toBeLessThan( 360 );

		}

	} );

} );

describe( 'vitesses et conversions', () => {

	it( 'vitesses', () => {

		expect( vitesseH( 3, 4 ) ).toBe( 5 );
		expect( vitesse3D( 2, 3, 6 ) ).toBe( 7 );

	} );

	it( 'conversions', () => {

		expect( msVersKmh( 10 ) ).toBeCloseTo( 36, 9 );
		expect( kmhVersMs( 36 ) ).toBeCloseTo( 10, 9 );
		expect( msVersNoeuds( 1852 / 3600 ) ).toBeCloseTo( 1, 9 );

	} );

	it( 'points cardinaux', () => {

		expect( cardinal( 0 ) ).toBe( 'N' );
		expect( cardinal( 90 ) ).toBe( 'E' );
		expect( cardinal( 225 ) ).toBe( 'SO' );
		expect( cardinal( 359 ) ).toBe( 'N' );
		expect( cardinal( null ) ).toBe( 'calme' );

	} );

} );
