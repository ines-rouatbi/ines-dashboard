// Constats 8 à 11 de la vérification des fusions (relecture du 15/10) :
//   8. niveau entièrement sous le relief : statistiques null (« non disponible »), jamais 0 ;
//   9. valeur null au-dessus du relief : « non disponible », pas « sous le relief » ;
//  10. direction arrondie AVANT le modulo 360 (359,996 → 0 ; affichage 359,6 → « 0 ») ;
//  11. statistiques du niveau sur la vitesse HORIZONTALE ‖(u, v)‖, comme speed.

import { describe, expect, it } from 'vitest';
import { echantillonner, statsPlan } from './field';
import { niveauDepuisColonne } from './profile';
import { arrondirAngle, dirAffichee, dirFrom } from './wind';
import type { ColumnLevel } from '../data/contract';

const dom = { nx: 2, ny: 2, dx: 100, dy: 100 };

describe( 'constats 8 et 11 : statistiques du niveau', () => {

	it( 'niveau entièrement sous le relief : min, moy, max null et couverture 0', () => {

		const nan = new Float32Array( 4 ).fill( NaN );
		const s = statsPlan( echantillonner( dom, 25, nan, nan, null, 1 ) );
		expect( s ).toEqual( { min: null, moy: null, max: null, couverture: 0 } );

	} );

	it( 'vitesse horizontale ‖(u, v)‖, w ignoré', () => {

		const u = Float32Array.from( [ 3, 0, 6, 0 ] ), v = Float32Array.from( [ 4, 1, 8, 2 ] ), w = Float32Array.from( [ 10, 10, 10, 10 ] );
		const s = statsPlan( echantillonner( dom, 650, u, v, w, 1 ) );
		expect( s.min ).toBeCloseTo( 1, 6 );
		expect( s.max ).toBeCloseTo( 10, 6 );
		expect( s.moy ).toBeCloseTo( ( 5 + 1 + 10 + 2 ) / 4, 6 );

	} );

} );

describe( 'constat 9 : null au-dessus du relief', () => {

	const niveau = ( o: Partial<ColumnLevel> ): ColumnLevel => ( {
		z_asl_m: 650, z_agl_m: 500, below_terrain: false,
		u: null, v: null, w: null, speed: null, sigma_speed: null, coverage: null, reliability: null, status: null, ...o,
	} );

	it( 'below_terrain reste false, toutes les valeurs null', () => {

		const l = niveauDepuisColonne( niveau( {} ) );
		expect( l.below_terrain ).toBe( false );
		expect( [ l.speed, l.dir_from_deg, l.speed_interval.p50, l.status ] ).toEqual( [ null, null, null, null ] );

	} );

	it( 'sous le relief : below_terrain true', () => {

		expect( niveauDepuisColonne( niveau( { z_asl_m: 25, z_agl_m: - 100, below_terrain: true } ) ).below_terrain ).toBe( true );

	} );

} );

describe( 'constat 10 : arrondi avant le modulo', () => {

	it( 'arrondirAngle', () => {

		expect( arrondirAngle( 359.996, 2 ) ).toBe( 0 );
		expect( arrondirAngle( 359.994, 2 ) ).toBe( 359.99 );
		expect( arrondirAngle( 359.6, 0 ) ).toBe( 0 );
		expect( arrondirAngle( - 0.001, 2 ) ).toBe( 0 );
		expect( Object.is( arrondirAngle( - 0.001, 2 ), - 0 ) ).toBe( false );

	} );

	it( 'dirFrom : 0,01° près, 359,996 → 0 (comme le contrat)', () => {

		// Vent venant de 359,996° : direction vers 179,996°, (u, v) = 5·(sin, cos) de 179,996°.
		const a = 179.996 * Math.PI / 180;
		expect( dirFrom( 5 * Math.sin( a ), 5 * Math.cos( a ) ) ).toBe( 0 );
		const b = 179.6 * Math.PI / 180;
		expect( dirFrom( 5 * Math.sin( b ), 5 * Math.cos( b ) ) ).toBe( 359.6 );

	} );

	it( 'affichage au degré : 359,6 → « 0 », 359,4 → « 359 », calme', () => {

		expect( dirAffichee( 359.6 ) ).toBe( '0' );
		expect( dirAffichee( 359.4 ) ).toBe( '359' );
		expect( dirAffichee( 45.5 ) ).toBe( '46' );
		expect( dirAffichee( null ) ).toBe( 'calme' );

	} );

} );
