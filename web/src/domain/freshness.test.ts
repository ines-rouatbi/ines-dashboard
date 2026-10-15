import { describe, expect, it } from 'vitest';
import { calculArrete, texteBandeau } from './freshness';

describe( 'bandeau de fraîcheur', () => {

	it( 'aucun bandeau quand le calcul est en ligne, même avec des dates anciennes', () => {

		expect( calculArrete( { compute_status: 'online' } ) ).toBe( false );
		expect( texteBandeau( { compute_status: 'online', generated_at: '2020-01-01T00:00:00Z' } ) ).toBeNull();

	} );

	it( 'bandeau dès que compute_status n\'est pas « online »', () => {

		expect( calculArrete( { compute_status: 'offline' } ) ).toBe( true );
		expect( calculArrete( { compute_status: 'degraded' } ) ).toBe( true );
		const t = texteBandeau( { compute_status: 'offline', generated_at: '2026-10-14T10:30:00Z' }, 'fr-FR', 'UTC' );
		expect( t ).toMatch( /^Dernier état réel calculé le 14 octobre 2026/ );
		expect( t ).toContain( '10:30' );
		expect( t ).toMatch( /— nouvelles reconstructions indisponibles$/ );

	} );

} );
