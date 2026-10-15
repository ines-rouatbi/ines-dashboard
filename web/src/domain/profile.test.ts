import { describe, expect, it } from 'vitest';
import { intervalle80, niveauDepuisColonne, profilDepuisColonne, Z80 } from './profile';
import type { Column, ColumnLevel } from '../data/contract';

const niveau = ( o: Partial<ColumnLevel> ): ColumnLevel => ( {
	z_asl_m: 650, z_agl_m: 500, below_terrain: false,
	u: null, v: null, w: null, speed: null, sigma_speed: null, coverage: null, reliability: null, status: null, ...o,
} );

describe( 'profil calculé par le front depuis /v1/column', () => {

	it( 'intervalle à 80 % = speed ± 1,2816·sigma_speed, borné à 0', () => {

		expect( intervalle80( 5, 1 ) ).toEqual( { p10: 5 - Z80, p50: 5, p90: 5 + Z80 } );
		expect( intervalle80( 0.5, 1 ).p10 ).toBe( 0 );
		expect( intervalle80( 5, null ) ).toEqual( { p10: null, p50: null, p90: null } );

	} );

	it( 'niveau valide : direction, statut, intervalle', () => {

		const l = niveauDepuisColonne( niveau( { u: 0, v: -5, w: 0.1, speed: 5, sigma_speed: 0.5, coverage: 0.8, reliability: 0.7, status: 1 } ) );
		expect( l.below_terrain ).toBe( false );
		expect( l.z_agl_m ).toBe( 500 );
		expect( l.dir_from_deg ).toBeCloseTo( 0, 9 );
		expect( l.status ).toBe( 'mesure' );
		expect( l.speed_interval.p50 ).toBe( 5 );
		expect( l.speed_interval.p10! ).toBeCloseTo( 5 - Z80 * 0.5, 9 );
		expect( l.speed_interval.p90! ).toBeCloseTo( 5 + Z80 * 0.5, 9 );
		expect( l.reliability_class ).toBeNull();

	} );

	it( 'sans sigma : p50 = speed, bornes inconnues ; statut estimé', () => {

		const l = niveauDepuisColonne( niveau( { u: 3, v: 4, speed: 5, status: 0 } ) );
		expect( l.speed_interval ).toEqual( { p10: null, p50: 5, p90: null } );
		expect( l.status ).toBe( 'estime' );

	} );

	it( 'sous le relief : tout null', () => {

		const l = niveauDepuisColonne( niveau( { z_asl_m: 25, z_agl_m: -125, below_terrain: true } ) );
		expect( l.below_terrain ).toBe( true );
		expect( l.speed ).toBeNull();
		expect( l.dir_from_deg ).toBeNull();
		expect( l.speed_interval ).toEqual( { p10: null, p50: null, p90: null } );

	} );

	it( 'profil complet', () => {

		const c = { i: 2, j: 1, x_m: 1000, y_m: 500, z_terrain_m: 150, levels: [ niveau( { below_terrain: true } ), niveau( { u: 1, v: 0, speed: 1, sigma_speed: 0.1 } ) ] } as unknown as Column;
		const p = profilDepuisColonne( c );
		expect( [ p.i, p.j, p.x_m, p.y_m, p.z_terrain_m ] ).toEqual( [ 2, 1, 1000, 500, 150 ] );
		expect( p.levels.map( ( l ) => l.below_terrain ) ).toEqual( [ true, false ] );
		expect( p.levels[ 1 ].dir_from_deg ).toBeCloseTo( 270, 9 );

	} );

} );
