import { describe, expect, it } from 'vitest';
import { domaineDepuisMeta, echantillonner, statsPlan, strideCible } from './field';
import type { Meta } from '../data/contract';

const meta: Meta = { grid: { nx: 4, ny: 3, nz: 2, dx_m: 500, dy_m: 500 }, levels_m_asl: [ 100, 650 ] };

describe( 'champ', () => {

	it( 'dérive le domaine de /v1/meta', () => {

		const d = domaineDepuisMeta( meta );
		expect( d ).toMatchObject( { nx: 4, ny: 3, nz: 2, sizeX: 1500, sizeY: 1000, altitudes: [ 100, 650 ] } );

	} );

	it( 'échantillonne et masque les NaN (sous le relief)', () => {

		const u = Float32Array.from( { length: 12 }, ( _, k ) => k );
		const v = new Float32Array( 12 ).fill( 1 );
		u[ 0 ] = NaN;
		const p = echantillonner( domaineDepuisMeta( meta ), 650, u, v, null, 2 );
		expect( [ p.nx, p.ny, p.dx ] ).toEqual( [ 2, 2, 1000 ] );
		// Points natifs pris : (0,0) (2,0) (0,2) (2,2) → index 0, 2, 8, 10.
		expect( Array.from( p.mask ) ).toEqual( [ 0, 1, 1, 1 ] );
		expect( Array.from( p.u ) ).toEqual( [ 0, 2, 8, 10 ] );
		expect( statsPlan( p ).couverture ).toBe( 0.75 );

	} );

	it( 'refuse un champ de mauvaise taille', () => {

		expect( () => echantillonner( domaineDepuisMeta( meta ), 0, new Float32Array( 3 ), new Float32Array( 3 ), null, 1 ) ).toThrow();

	} );

	it( 'pas cible', () => {

		expect( strideCible( 500, 250, 4000 ) ).toBe( 6 );
		expect( strideCible( 100, 50, 8000 ) ).toBe( 1 );

	} );

} );
