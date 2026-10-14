import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { fauxR2, resoudreCle } from './fixtures';

const racine = resolve( fileURLToPath( new URL( '..', import.meta.url ) ), 'contract/fixtures' );
const normal = resolve( racine, 'normal' );

describe.skipIf( ! existsSync( normal ) )( 'faux binding R2 sur les fixtures', () => {

	it( 'associe les clés R2 aux fichiers du scénario', () => {

		const f = ( k: string ) => { const r = resoudreCle( normal, k ); return r && 'fichier' in r ? r.fichier.slice( normal.length + 1 ).replace( /\\/g, '/' ) : r; };
		expect( f( 'latest.json' ) ).toBe( 'latest.json' );
		expect( f( 'models/e44d68da/_commit.json' ) ).toBe( 'models/e44d68da/model-manifest.json' );
		expect( f( 'models/e44d68da/terrain.f32' ) ).toBe( 'models/e44d68da/terrain.f32' );
		expect( f( 'snapshots/test_normal_e44d68da/_commit.json' ) ).toBe( 'publish-manifest.json' );
		expect( f( 'snapshots/test_normal_e44d68da/fields/u.f32' ) ).toBe( 'fields/u.f32' );
		expect( f( 'snapshots/autre_e44d68da/fields/u.f32' ) ).toBeNull();
		expect( f( 'snapshots/test_normal_e44d68da/../latest.json' ) ).toBeNull();

	} );

	it( 'battement synthétisé : maintenant si en ligne, figé sinon', () => {

		const r = resoudreCle( normal, 'heartbeat.json', () => new Date( '2030-01-01T00:00:00Z' ) );
		expect( r ).toEqual( { contenu: JSON.stringify( { at: '2030-01-01T00:00:00.000Z' } ) } );
		const g = resoudreCle( resolve( racine, 'gpu_eteint' ), 'heartbeat.json' );
		expect( g && 'contenu' in g && JSON.parse( g.contenu ).at ).toBe( '2025-01-12T12:01:00Z' );

	} );

	it( 'lecture partielle et clé absente', async () => {

		const b = fauxR2( normal );
		const o = await b.get( 'snapshots/test_normal_e44d68da/fields/status.u8', { range: { offset: 10, length: 4 } } );
		expect( o?.size ).toBe( 4 );
		expect( await b.head( 'snapshots/test_normal_e44d68da/absent.json' ) ).toBeNull();

	} );

} );
