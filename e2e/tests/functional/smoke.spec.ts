// Tests fonctionnels headless (projet « headless ») : npm test.
// Fumée sur l'existant ; les scénarios sur les 3 instantanés de test du contrat arrivent avec contract/ (16/10).
import { test, expect } from '@playwright/test';
import { assertIsAtom, sceneBox, SCENE_PATH } from '../../lib/atom';

test( 'la page servie est le tableau de bord ATOM, sans erreur JavaScript', async ( { page } ) => {

	const errors: string[] = [];
	page.on( 'pageerror', ( e ) => errors.push( e.message ) );
	page.on( 'console', ( m ) => { if ( m.type() === 'error' ) errors.push( m.text() ); } );

	const res = await page.goto( SCENE_PATH );
	expect( res?.status() ).toBe( 200 );
	await assertIsAtom( page );
	await sceneBox( page );
	await page.waitForTimeout( 2_000 );
	// Le 503 de /api quand le GPU dort est attendu ; toute autre erreur ne l'est pas.
	expect( errors.filter( ( e ) => ! /503|Service Unavailable/i.test( e ) ) ).toEqual( [] );

} );

test( 'la scène 3D a un contexte WebGL', async ( { page } ) => {

	await page.goto( SCENE_PATH );
	await assertIsAtom( page );
	await sceneBox( page );
	const hasGl = await page.evaluate( () => {

		const c = document.querySelector( 'canvas' ) as HTMLCanvasElement | null;
		return !! c && !! ( c.getContext( 'webgl2' ) ?? c.getContext( 'webgl' ) );

	} );
	expect( hasGl ).toBe( true );

} );

test( 'GPU éteint : /api répond 503 service_asleep en JSON, jamais une page d’erreur HTML', async ( { request } ) => {

	test.skip( !! process.env.ATOM_GPU_ON, 'ATOM_GPU_ON défini : le service tourne' );
	test.skip( process.env.ATOM_SERVER === 'vite', 'serveur Vite des fixtures : pas de proxy /api (ATOM_SERVER=wrangler pour ce test)' );
	const res = await request.get( '/api/meta' );
	expect( res.status() ).toBe( 503 );
	expect( res.headers()[ 'content-type' ] ).toMatch( /json/ );
	expect( ( await res.json() ).error ).toBe( 'service_asleep' );

} );

// Les 3 instantanés de test sont couverts par scene-f2.spec.ts (critères V3D1 à V3D8).
