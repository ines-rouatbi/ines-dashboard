import { describe, expect, it } from 'vitest';
import { intervalle80, niveauProfil, profilColonne, sigmaVitesse, Z80, type ValeursNoeud } from './profile';

const noeud = ( o: Partial<ValeursNoeud> ): ValeursNoeud => ( {
	u: NaN, v: NaN, w: NaN, speed: NaN, sigma_u: NaN, sigma_v: NaN, coverage: NaN, reliability: NaN, status: NaN, ...o,
} );

describe( 'profil calculé côté client', () => {

	it( 'σ propagé depuis σu, σv', () => {

		// Vent d'ouest pur : σ = σu.
		expect( sigmaVitesse( 5, 0, 0.4, 0.9, 5 ) ).toBeCloseTo( 0.4, 12 );
		// Vent du sud pur : σ = σv.
		expect( sigmaVitesse( 0, 5, 0.4, 0.9, 5 ) ).toBeCloseTo( 0.9, 12 );
		// Calme : moyenne quadratique.
		expect( sigmaVitesse( 0, 0, 0.3, 0.4, 0 ) ).toBeCloseTo( Math.sqrt( 0.125 ), 12 );

	} );

	it( 'intervalle à 80 % borné à 0', () => {

		expect( intervalle80( 5, 1 ) ).toEqual( { p10: 5 - Z80, p50: 5, p90: 5 + Z80 } );
		expect( intervalle80( 0.5, 1 ).p10 ).toBe( 0 );

	} );

	it( 'niveau valide : direction, statut, intervalle ordonné, hauteur sol', () => {

		const l = niveauProfil( 650, 150, noeud( { u: 0, v: -5, w: 0.1, speed: 5, sigma_u: 0.3, sigma_v: 0.5, coverage: 0.8, reliability: 0.7, status: 1 } ) );
		expect( l.below_terrain ).toBe( false );
		expect( l.agl_m ).toBe( 500 );
		expect( l.dir_from_deg ).toBeCloseTo( 0, 9 );
		expect( l.status ).toBe( 'mesure' );
		expect( l.speed_interval.p50 ).toBe( 5 );
		expect( l.speed_interval.p10! ).toBeCloseTo( 5 - Z80 * 0.5, 9 );
		expect( l.speed_interval.p90! ).toBeCloseTo( 5 + Z80 * 0.5, 9 );
		expect( l.reliability_class ).toBeNull();

	} );

	it( 'NaN = sous le relief', () => {

		const l = niveauProfil( 25, 150, noeud( {} ) );
		expect( l.below_terrain ).toBe( true );
		expect( l.agl_m ).toBe( -125 );
		expect( l.speed ).toBeNull();
		expect( l.dir_from_deg ).toBeNull();

	} );

	it( 'assemble une colonne au centre de la maille', () => {

		const dom = { nx: 2, ny: 1, dx: 500, dy: 500, altitudes: [ 100, 200 ] };
		const f = ( a: number[] ) => Float32Array.from( a );
		const champs = [
			{ u: f( [ NaN, NaN ] ), v: f( [ NaN, NaN ] ), speed: f( [ NaN, NaN ] ) },
			{ u: f( [ 1, 3 ] ), v: f( [ 0, 4 ] ), speed: f( [ 1, 5 ] ), status: f( [ 0, 0 ] ) },
		];
		const p = profilColonne( dom, 1, 0, champs, f( [ 120, 150 ] ) );
		expect( [ p.x_m, p.y_m, p.z_terrain_m ] ).toEqual( [ 750, 250, 150 ] );
		expect( p.levels.map( ( l ) => l.below_terrain ) ).toEqual( [ true, false ] );
		expect( p.levels[ 1 ].speed ).toBe( 5 );
		expect( p.levels[ 1 ].status ).toBe( 'estime' );

	} );

} );
