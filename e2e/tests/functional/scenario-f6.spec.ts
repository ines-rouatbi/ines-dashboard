// Scénario de démonstration (cahier des charges §23, lot F6), joué de bout en bout sur le tableau de bord,
// GPU ÉTEINT puis GPU ALLUMÉ. Pas à pas détaillé : docs/SCENARIO_DEMO.md.
//
// Serveur visé : de préférence le Worker local sur le R2 où M6 publie les vrais instantanés
//   ATOM_URL=http://127.0.0.1:8787 npx playwright test --project=headless tests/functional/scenario-f6.spec.ts
// Il tourne aussi sur le Vite des fixtures (ATOM_SERVER=vite, défaut) : les étapes qui demandent le Worker
// complet (/api) s'adaptent ou sont sautées en le disant.
//
// GPU éteint (défaut) : le service de calcul ne répond pas. Pour que l'état soit toujours celui-là, même si un
// service tourne sur le poste, /api/** est intercepté et répond 503 service_asleep (ce que fait le Worker quand
// l'origine dort) ; /v1/latest est lu tel quel, et si le service publie encore son battement de cœur, la réponse
// est réécrite en compute_status « offline » (dernier battement trop vieux). Le tableau de bord doit rester
// utilisable sur le DERNIER ÉTAT PUBLIÉ, avec le bandeau « Dernier état réel calculé le … ».
// GPU allumé : ATOM_GPU_ON=1, le service tourne vraiment et publie (battement de cœur) : aucune interception ;
// pastille « calcul en ligne », pas de bandeau, /api/health joignable.
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { assertIsAtom, waitForAtom } from '../../lib/atom';

const GPU_ON = process.env.ATOM_GPU_ON === '1';
const NA = 'non disponible';

async function eteindreGpu( page: Page ) {

	await page.route( '**/api/**', ( r ) => r.fulfill( { status: 503, contentType: 'application/json', body: JSON.stringify( { error: 'service_asleep', message: 'Service de calcul endormi (GPU éteint).' } ) } ) );
	await page.route( '**/v1/latest', async ( r ) => {

		const res = await r.fetch();
		const latest = await res.json();
		await r.fulfill( { response: res, json: { ...latest, compute_status: latest.compute_status === 'online' ? 'offline' : latest.compute_status } } );

	} );

}

/** Lit le CSV téléchargé par un clic sur `bouton` et renvoie ses lignes (BOM retiré). */
async function telecharger( page: Page, bouton: ReturnType<Page[ 'getByTestId' ]> ) {

	const [ dl ] = await Promise.all( [ page.waitForEvent( 'download' ), bouton.click() ] );
	expect( dl.suggestedFilename() ).toMatch( /^atom_[A-Za-z0-9_.-]+\.csv$/ );
	const chemin = await dl.path();
	const contenu = ( await readFile( chemin!, 'utf8' ) ).replace( /^﻿/, '' );
	return { nom: dl.suggestedFilename(), lignes: contenu.trimEnd().split( '\r\n' ) };

}

async function scenario( page: Page, gpu: 'eteint' | 'allume' ) {

	const latest = await ( await page.request.get( '/v1/latest' ) ).json();
	const id: string = latest.snapshot_id;
	const snap = await ( await page.request.get( `/v1/snapshots/${ id }` ) ).json();
	const meta = await ( await page.request.get( `/v1/meta/${ id.slice( - 8 ) }` ) ).json();
	const errors: string[] = [];
	page.on( 'pageerror', ( e ) => errors.push( e.message ) );

	await test.step( '1. Vue d’ensemble : dernier état publié, nature des données, bandeau de fraîcheur', async () => {

		await page.goto( '/' );
		await assertIsAtom( page );
		await expect( page.getByTestId( 'page-ensemble' ) ).toBeVisible( { timeout: 20_000 } );
		await expect( page.getByTestId( 'data-kind' ) ).toContainText( 'données :' );
		if ( gpu === 'eteint' ) {

			await expect( page.getByTestId( 'status-pill' ) ).toContainText( 'calcul arrêté' );
			await expect( page.getByTestId( 'freshness-banner' ) ).toContainText( 'Dernier état réel calculé le' );

		} else {

			await expect( page.getByTestId( 'status-pill' ) ).toContainText( 'calcul en ligne' );
			await expect( page.getByTestId( 'freshness-banner' ) ).toHaveCount( 0 );

		}
		await expect( page.getByTestId( 'kpis' ) ).toBeVisible();
		for ( const h of [ 10, 100, 300, 1000 ] ) await expect( page.getByTestId( `carte-${ h }` ) ).toBeVisible();
		// Ce qui n'est pas calculé est dit « non disponible », jamais 0.
		const alertes = page.getByTestId( 'alertes-ouvertes' );
		await expect( alertes ).toBeVisible();
		if ( snap.kpi.open_alerts == null ) {

			await expect( page.getByTestId( 'kpi-alertes-valeur' ) ).toHaveText( NA );
			if ( snap.assets.alerts ) await expect( alertes.getByTestId( 'alertes-non-calculees' ) ).toBeVisible();

		}

	} );

	await test.step( '2. Exports : liens NetCDF / CSV publiés ou « non disponible », CSV d’une carte affichée', async () => {

		const pub = page.getByTestId( 'exports-publies' ).first();
		await expect( pub ).toBeVisible();
		if ( snap.assets.export_netcdf ) await expect( pub.getByTestId( 'export-netcdf' ) ).toHaveAttribute( 'href', snap.assets.export_netcdf );
		else await expect( pub.getByTestId( 'export-netcdf' ) ).toContainText( NA );
		const { nom, lignes } = await telecharger( page, page.getByTestId( 'carte-100-export' ) );
		expect( nom ).toContain( id );
		expect( lignes[ 0 ] ).toBe( 'snapshot_id,valid_time_utc,data_kind,model,plan,i,j,x_m,y_m,lat_deg,lon_deg,georef_suppose,z_terrain_m,z_asl_m,z_agl_m,speed_m_s' );
		expect( lignes.length ).toBeGreaterThan( 1 );
		expect( lignes[ 1 ].startsWith( `${ id },` ) ).toBe( true );
		expect( lignes[ 1 ] ).toMatch( /,hauteur_sol,/ );

	} );

	await test.step( '3. Exploration 3D : vent au-dessus du relief (120 m sol), clic → profil, export du profil', async () => {

		await page.goto( '/exploration' );
		const etat = await waitForAtom( page, 30_000 );
		expect( etat.ok, etat.ok ? '' : etat.reason ).toBe( true );
		const e = await page.evaluate( () => window.__atom!.etat!() );
		expect( e.snapshot_id ).toBe( id );
		expect( e.reglages.mode ).toBe( 'sol' );
		expect( e.reglages.hauteurSol ).toBe( 120 );
		expect( e.noeuds_valides ).toBeGreaterThan( 0 );
		expect( e.lignes.lignes ).toBeGreaterThan( 0 );
		const box = ( await page.getByTestId( 'scene-canvas' ).boundingBox() )!;
		await page.evaluate( ( [ x, y ] ) => window.__atom!.pick( x, y ), [ box.width / 2, box.height / 2 ] );
		await expect( page.getByTestId( 'tableau-profil' ) ).toBeVisible( { timeout: 15_000 } );
		const { lignes } = await telecharger( page, page.getByTestId( 'export-profil' ) );
		expect( lignes[ 0 ] ).toContain( 'speed_p10_m_s' );
		expect( lignes.length - 1 ).toBe( meta.grid.levels_asl_m.length ); // un niveau par ligne

	} );

	await test.step( '4. Fiabilité : carte de confiance, ou « non publiée » tant que M2 est inactif', async () => {

		await page.goto( '/fiabilite' );
		await expect( page.getByTestId( 'page-fiabilite' ) ).toBeVisible( { timeout: 20_000 } );
		await expect( page.getByTestId( 'carte-vent' ) ).toBeVisible();
		if ( meta.fields.includes( 'sigma_speed' ) ) await expect( page.getByTestId( 'carte-incertitude' ) ).toBeVisible();
		else await expect( page.getByTestId( 'carte-incertitude-non-publiee' ) ).toContainText( NA );

	} );

	await test.step( '5. Éolien et Alertes : parc et alertes publiés, sinon « non disponible »', async () => {

		await page.goto( '/eolien' );
		await expect( page.getByTestId( 'page-eolien' ) ).toBeVisible( { timeout: 20_000 } );
		await expect( page.getByText( /\b0 kW\b/ ) ).toHaveCount( 0 );
		await page.goto( '/alertes' );
		await expect( page.getByTestId( 'page-alertes' ) ).toBeVisible( { timeout: 20_000 } );

	} );

	await test.step( '6. Comparaison de deux instants à la même hauteur au-dessus du sol, export', async () => {

		const times = await ( await page.request.get( '/v1/times' ) ).json();
		await page.goto( '/comparaison?h=100' );
		if ( times.items.length < 2 ) {

			await expect( page.getByTestId( 'comparaison-impossible' ) ).toBeVisible( { timeout: 20_000 } );
			return;

		}
		await expect( page.getByTestId( 'comparaison-diff' ) ).toBeVisible( { timeout: 30_000 } );
		await expect( page.getByTestId( 'instant-b' ) ).toHaveValue( id );
		await expect( page.getByTestId( 'comparaison-a' ) ).toBeVisible();
		await expect( page.getByTestId( 'comparaison-b' ) ).toBeVisible();
		await expect( page.getByTestId( 'stats-communs' ) ).not.toContainText( NA );
		await page.getByTestId( 'comparaison-hauteur-300' ).click();
		await expect( page ).toHaveURL( /h=300/ );
		await expect( page.getByTestId( 'comparaison-diff' ) ).toContainText( '300 m au-dessus du sol', { timeout: 30_000 } );
		const { lignes } = await telecharger( page, page.getByTestId( 'comparaison-export' ) );
		expect( lignes[ 0 ] ).toContain( 'diff_b_moins_a_m_s' );
		const communs = Number( ( await page.getByTestId( 'stats-communs' ).textContent() )!.split( '(' )[ 0 ].replace( /\D/g, '' ) );
		expect( lignes.length - 1 ).toBe( communs );

	} );

	await test.step( '7. Modèle : versions, qualité des données d’entrée, état du service de calcul', async () => {

		await page.goto( '/modele' );
		await expect( page.getByTestId( 'page-modele' ) ).toBeVisible( { timeout: 20_000 } );
		const service = page.getByTestId( 'service-calcul' );
		await expect( service ).not.toHaveAttribute( 'data-etat', 'attente', { timeout: 15_000 } );
		if ( gpu === 'allume' ) await expect( service ).toHaveAttribute( 'data-etat', 'joignable' );
		else await expect( service ).toHaveAttribute( 'data-etat', /endormi|injoignable/ );

	} );

	expect( errors ).toEqual( [] );

}

test.describe( 'scénario §23 (lot F6)', () => {

	test.describe.configure( { timeout: 240_000 } );

	test( 'GPU éteint : le tableau de bord reste utilisable sur le dernier état publié', async ( { page } ) => {

		test.skip( GPU_ON, 'ATOM_GPU_ON=1 : on joue le scénario GPU allumé' );
		await eteindreGpu( page );
		await scenario( page, 'eteint' );

	} );

	test( 'GPU allumé : calcul en ligne, /api joignable par le Worker', async ( { page } ) => {

		test.skip( ! GPU_ON, 'ATOM_GPU_ON=1 requis : service de calcul allumé et publiant son battement de cœur' );
		test.skip( process.env.ATOM_SERVER === 'vite', 'serveur Vite des fixtures : pas de proxy /api ni de battement de cœur' );
		await scenario( page, 'allume' );

	} );

} );
