import { describe, expect, it } from 'vitest';
import { cibleFixture } from './fixtures';

describe( 'cibleFixture', () => {

	it( 'associe chaque point d\'accès à son fichier', () => {

		expect( cibleFixture( '/v1/meta' )?.fichier ).toBe( 'meta.json' );
		expect( cibleFixture( '/v1/latest' )?.fichier ).toBe( 'latest.json' );
		expect( cibleFixture( '/v1/snapshots/2026-10-14T12Z' )?.fichier ).toBe( 'snapshot.json' );
		expect( cibleFixture( '/v1/profiles/abc' )?.fichier ).toBe( 'profile.json' );
		expect( cibleFixture( '/v1/quality/abc' )?.fichier ).toBe( 'quality.json' );
		expect( cibleFixture( '/v1/alerts/abc' )?.fichier ).toBe( 'alerts.json' );
		expect( cibleFixture( '/v1/stations/abc' )?.fichier ).toBe( 'stations.json' );
		expect( cibleFixture( '/v1/wind-farm/abc' )?.fichier ).toBe( 'wind-farm.json' );
		expect( cibleFixture( '/v1/windrose' )?.fichier ).toBe( 'windrose.json' );
		expect( cibleFixture( '/v1/times' )?.fichier ).toBe( 'times.json' );
		expect( cibleFixture( '/v1/terrain' ) ).toEqual( { fichier: 'terrain.f32', type: 'application/octet-stream' } );

	} );

	it( 'sert les champs binaires', () => {

		const c = cibleFixture( '/v1/fields/abc/3/speed' );
		expect( c ).toEqual( { fichier: 'fields/3_speed.f32', type: 'application/octet-stream' } );

	} );

	it( 'refuse les routes inconnues et les chemins douteux', () => {

		expect( cibleFixture( '/v1/heartbeat' ) ).toBeNull();
		expect( cibleFixture( '/v1/fields/abc/3' ) ).toBeNull();
		expect( cibleFixture( '/v1/fields/abc/../meta' ) ).toBeNull();
		expect( cibleFixture( '/api/meta' ) ).toBeNull();

	} );

} );
