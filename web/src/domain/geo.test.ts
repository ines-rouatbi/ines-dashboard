import { describe, expect, it } from 'vitest';
import { latLon } from './geo';
import type { Meta } from '../data/contract';

const meta = ( rotation_deg: number ) => ( {
	grid: { x0_m: 0, y0_m: 0 },
	georef: { lat0: 36, lon0: 9.7, rotation_deg, m_per_deg_lat: 110574, m_per_deg_lon: 90059.772 },
} ) as unknown as Meta;

describe( 'géoréférencement', () => {

	it( 'nœud (0, 0) = (lat0, lon0) et bornes du domaine de test', () => {

		expect( latLon( meta( 0 ), 0, 0 ) ).toEqual( { lat: 36, lon: 9.7 } );
		// Bornes publiées dans meta.georef.bounds des fixtures : 36,221571 / 10,249635.
		const p = latLon( meta( 0 ), 49500, 24500 );
		expect( p.lat ).toBeCloseTo( 36.221571, 5 );
		expect( p.lon ).toBeCloseTo( 10.249635, 5 );

	} );

	it( 'rotation antihoraire de l\'axe x', () => {

		// θ = 90° : l'axe x pointe vers le Nord.
		const p = latLon( meta( 90 ), 110574, 0 );
		expect( p.lat ).toBeCloseTo( 37, 9 );
		expect( p.lon ).toBeCloseTo( 9.7, 9 );

	} );

} );
