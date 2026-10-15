// Choix du scénario de dev à l'exécution (middlewareFixturesParScenario) : ?scenario=<nom> pose le cookie
// atom_fixture et sert ce scénario ; le cookie est suivi ; un nom inconnu est ignoré (scénario par défaut).

import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { middlewareFixturesParScenario } from './fixtures';

const racine = resolve( fileURLToPath( new URL( '..', import.meta.url ) ), 'contract/fixtures' );

describe.skipIf( ! existsSync( racine ) )( 'scénario de dev (?scenario=, cookie atom_fixture)', () => {

	let srv: Server;
	let base = '';
	beforeAll( async () => {

		const mw = middlewareFixturesParScenario( racine, 'normal' );
		srv = createServer( ( req, res ) => { mw( req, res, () => { res.statusCode = 418; res.end(); } ); } );
		await new Promise<void>( ( ok ) => srv.listen( 0, '127.0.0.1', ok ) );
		const a = srv.address();
		if ( ! a || typeof a === 'string' ) throw new Error( 'adresse inattendue' );
		base = `http://127.0.0.1:${ a.port }`;

	} );
	afterAll( async () => { await new Promise( ( ok ) => srv.close( ok ) ); } );

	it( '?scenario= pose le cookie et sert ce scénario ; le cookie est suivi ; nom inconnu ignoré', async () => {

		const r1 = await fetch( `${ base }/v1/latest?scenario=gpu_eteint` );
		expect( r1.headers.get( 'set-cookie' ) ).toMatch( /^atom_fixture=gpu_eteint;/ );
		expect( ( await r1.json() as { snapshot_id: string } ).snapshot_id ).toBe( 'test_gpu_eteint_e44d68da' );
		const r2 = await fetch( `${ base }/v1/alerts/test_capteur_en_derive_e44d68da`, { headers: { cookie: 'atom_fixture=capteur_en_derive' } } );
		expect( r2.status ).toBe( 200 );
		expect( ( await r2.json() as { items: unknown[] } ).items.length ).toBe( 4 );
		const r3 = await fetch( `${ base }/v1/latest?scenario=..%2Fetc`, { headers: { cookie: 'atom_fixture=inexistant' } } );
		expect( r3.headers.get( 'set-cookie' ) ).toBeNull();
		expect( ( await r3.json() as { snapshot_id: string } ).snapshot_id ).toBe( 'test_normal_e44d68da' );
		// Une page (hors /v1) avec ?scenario= pose aussi le cookie, puis passe la main (repli SPA de Vite).
		const r4 = await fetch( `${ base }/alertes?scenario=capteur_en_derive` );
		expect( r4.status ).toBe( 418 );
		expect( r4.headers.get( 'set-cookie' ) ).toMatch( /^atom_fixture=capteur_en_derive;/ );

	} );

} );
