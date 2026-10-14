import { describe, expect, it } from 'vitest';
import { domaineDepuisMeta, echantillonner, noeudProche, positionNoeud, statsPlan, strideCible } from './field';
import type { Meta } from '../data/contract';

// Seuls les champs lus par domaineDepuisMeta comptent ici.
const meta = { grid: { nx: 4, ny: 3, nz: 2, dx_m: 500, dy_m: 500, x0_m: 1000, y0_m: 0, min_agl_m: 5, levels_asl_m: [ 100, 650 ] } } as unknown as Meta;

describe( 'champ', () => {

	it( 'dérive le domaine de /v1/meta (nœuds en x0 + i·dx)', () => {

		const d = domaineDepuisMeta( meta );
		expect( d ).toMatchObject( { nx: 4, ny: 3, nz: 2, x0: 1000, y0: 0, minAgl: 5, sizeX: 1500, sizeY: 1000, altitudes: [ 100, 650 ] } );

	} );

	it( 'nœud le plus proche et position d\'un nœud', () => {

		const d = domaineDepuisMeta( meta );
		expect( noeudProche( d, 1000, 0 ) ).toEqual( { i: 0, j: 0 } );
		expect( noeudProche( d, 2240, 760 ) ).toEqual( { i: 2, j: 2 } );
		expect( noeudProche( d, 99999, -5 ) ).toEqual( { i: 3, j: 0 } );
		expect( positionNoeud( d, 2, 1 ) ).toEqual( { x_m: 2000, y_m: 500 } );

	} );

	it( 'échantillonne et masque les NaN (nœuds absents)', () => {

		const u = Float32Array.from( { length: 12 }, ( _, k ) => k );
		const v = new Float32Array( 12 ).fill( 1 );
		u[ 0 ] = NaN;
		const p = echantillonner( domaineDepuisMeta( meta ), 650, u, v, null, 2 );
		expect( [ p.nx, p.ny, p.nxNatif, p.nyNatif, p.dx ] ).toEqual( [ 2, 2, 4, 3, 1000 ] );
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
