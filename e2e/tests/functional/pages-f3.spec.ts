// Pages du lot F3 (Vue d'ensemble, Fiabilité, Modèle) sur les 3 instantanés de test du contrat, et
// critère VIS1 : reconstruction + indicateurs affichés en moins de 3 s (window.__atom.vis1).
//
// ATOM_F3_ROUTE : gabarit d'URL avec {page} ('' pour la Vue d'ensemble, fiabilite, modele) et {scenario} ;
// par défaut celui des pages F4 (ATOM_F4_ROUTE, posé d'office avec le serveur Vite). Sans gabarit, les
// tests navigateur sont sautés en le disant.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '../../../contract/fixtures' );
const SCENARIOS = [ 'normal', 'capteur_en_derive', 'gpu_eteint' ] as const;
const ROUTE = process.env.ATOM_F3_ROUTE ?? process.env.ATOM_F4_ROUTE;
const NA = 'non disponible';
const SEUIL_VIS1_MS = 3000;
const HAUTEURS = [ 10, 100, 300, 1000 ];

const fixture = ( s: string, f: string ) => JSON.parse( readFileSync( path.join( FIX, s, f ), 'utf8' ) );
const meta = ( s: string ) => {

	const sha8 = readdirSync( path.join( FIX, s, 'models' ) )[ 0 ];
	return fixture( s, `models/${ sha8 }/meta.json` );

};
const norm = ( s: string | null ) => ( s ?? '' ).replace( /[  ]/g, ' ' ).replace( /\s+/g, ' ' ).trim();
const fr = ( x: number, d = 0 ) => norm( x.toLocaleString( 'fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d } ) );
const text = async ( page: Page, id: string ) => norm( await page.getByTestId( id ).first().textContent() );

async function open( page: Page, name: '' | 'fiabilite' | 'modele', scenario: string, extra = '' ) {

	await page.goto( ROUTE!.replace( '{page}', name ).replace( '{scenario}', scenario ) + extra );
	await expect( page.getByTestId( `page-${ name || 'ensemble' }` ) ).toBeVisible();

}

test.describe( 'pages F3 (navigateur)', () => {

	test.skip( ! ROUTE, 'ATOM_F3_ROUTE / ATOM_F4_ROUTE non défini : pas de gabarit d’URL des pages' );

	for ( const s of SCENARIOS ) {

		test( `Vue d’ensemble « ${ s } » : indicateurs, cartes au-dessus du sol, capteurs, alertes, DSO`, async ( { page } ) => {

			const snap = fixture( s, 'snapshot.json' ), stations = fixture( s, 'stations.json' ).items;
			await open( page, '', s );
			const k = snap.kpi;
			expect( await text( page, 'kpi-hub-mean-valeur' ) ).toBe( k.hub_wind_mean_ms == null ? NA : `${ fr( k.hub_wind_mean_ms, 1 ) } m/s` );
			expect( await text( page, 'kpi-hub-max-valeur' ) ).toBe( k.hub_wind_max_ms == null ? NA : `${ fr( k.hub_wind_max_ms, 1 ) } m/s` );
			expect( await text( page, 'kpi-fiabilite-valeur' ) ).toBe( k.share_high_reliability == null ? NA : `${ fr( k.share_high_reliability * 100, 1 ) } %` );
			expect( await text( page, 'kpi-capteurs-valeur' ) ).toBe( `${ fr( snap.network.sensors_visible ) } / ${ fr( snap.network.sensors_total ) }` );

			// TB2 : 4 cartes à une hauteur au-dessus du sol ; 1 000 m dépasse le sommet du modèle (1 000 m mer) partout.
			for ( const h of HAUTEURS ) await expect( page.getByTestId( `carte-${ h }` ) ).toBeVisible();
			await expect( page.getByTestId( 'carte-1000-vide' ) ).toContainText( 'sommet' );
			expect( await page.getByTestId( 'carte-1000' ).getAttribute( 'data-disponibles' ) ).toBe( '0' );
			expect( Number( await page.getByTestId( 'carte-100' ).getAttribute( 'data-disponibles' ) ) ).toBeGreaterThan( 0 );
			await expect( page.getByTestId( 'legende' ).first() ).toContainText( 'm/s' );
			// B4 : en treillis, seuls les capteurs signalés, sur chacune des 4 cartes.
			await expect( page.getByTestId( 'carte-capteur' ) ).toHaveCount( stations.length * HAUTEURS.length );

			// TB3, TB5
			await expect( page.getByTestId( 'alerte-ouverte' ) ).toHaveCount( Math.min( 5, fixture( s, 'alerts.json' ).items.filter( ( a: any ) => a.status === 'ouverte' ).length ) );
			if ( snap.physics == null ) await expect( page.getByTestId( 'physics-na' ) ).toBeVisible();
			else expect( await text( page, 'dso-masse-ok' ) ).toBe( snap.physics.mass_residual_ok ? 'oui (cet instant)' : 'non (cet instant)' );
			// TB4
			await expect( page.getByTestId( 'serie-moyeu' ).locator( 'svg' ).first() ).toBeVisible();

			// Nature des données et bandeau GPU éteint conservés.
			await expect( page.getByTestId( 'data-kind' ) ).toContainText( 'test' );
			await expect( page.getByTestId( 'freshness-banner' ) ).toHaveCount( fixture( s, 'latest.json' ).compute_status === 'online' ? 0 : 1 );

		} );

		test( `VIS1 « ${ s } » : reconstruction et indicateurs affichés en moins de 3 s`, async ( { page } ) => {

			await open( page, '', s );
			await page.waitForFunction( () => ( ( window as any ).__atom?.vis1?.mesures?.length ?? 0 ) > 0, null, { timeout: 15_000 } );
			const m = await page.evaluate( () => ( window as any ).__atom.vis1.mesures[ 0 ] );
			test.info().annotations.push( { type: 'VIS1', description: `${ s } : ${ m.duree_ms } ms (${ m.depuis })` } );
			expect( m.depuis ).toBe( 'navigation' );
			expect( m.duree_ms ).toBeLessThan( SEUIL_VIS1_MS );
			expect( await page.getByTestId( 'vis1' ).getAttribute( 'data-vis1-ms' ) ).toBe( String( m.duree_ms ) );

		} );

		test( `Fiabilité « ${ s } » : cartes vent et incertitude, répartition, pas de simulation`, async ( { page } ) => {

			const q = fixture( s, 'quality.json' );
			await open( page, 'fiabilite', s );
			await expect( page.getByTestId( 'carte-vent' ) ).toBeVisible();
			await expect( page.getByTestId( 'carte-incertitude' ) ).toBeVisible();
			for ( const v of [ 'coverage', 'reliability', 'status' ] ) {

				await page.getByTestId( 'variable-incertitude' ).selectOption( v );
				await expect( page.getByTestId( 'carte-incertitude' ) ).toBeVisible();

			}
			await page.getByTestId( 'hauteur-1000' ).click();
			await expect( page.getByTestId( 'carte-vent-vide' ) ).toBeVisible();
			await expect( page.getByTestId( 'repartition' ).locator( 'svg' ).first() ).toBeVisible();
			expect( await text( page, 'calibration-dso6' ) ).toBe( q.calibration?.dso6_pass ? 'atteint' : 'non atteint' );
			await expect( page.getByTestId( 'aucune-simulation' ) ).toBeVisible();
			await expect( page.getByTestId( 'simulation-ok' ) ).toHaveCount( 0 );

		} );

		test( `Fiabilité « ${ s } » : une reconstruction nominale n’est jamais présentée comme une simulation`, async ( { page } ) => {

			await open( page, 'fiabilite', s, `&simulation=${ fixture( s, 'snapshot.json' ).snapshot_id }` );
			await expect( page.getByTestId( 'simulation-invalide' ) ).toContainText( 'pas une simulation' );
			await expect( page.getByTestId( 'simulation-ok' ) ).toHaveCount( 0 );
			await expect( page.locator( '.f3-etiquette-sim' ) ).toHaveCount( 0 );

		} );

		test( `Modèle « ${ s } » : versions, grille, position supposée`, async ( { page } ) => {

			const snap = fixture( s, 'snapshot.json' ), m = meta( s );
			await open( page, 'modele', s );
			expect( await text( page, 'version-sha256' ) ).toBe( snap.versions.model_sha256 );
			expect( await text( page, 'version-norm' ) ).toBe( snap.versions.norm );
			expect( await text( page, 'grille-taille' ) ).toBe( `${ fr( m.grid.nx ) } × ${ fr( m.grid.ny ) } × ${ fr( m.grid.nz ) }` );
			await expect( page.getByTestId( 'georef-suppose' ) ).toHaveCount( m.georef.suppose ? 1 : 0 );
			await expect( page.getByTestId( 'data-quality' ) ).toBeVisible();

		} );

	}

	test( 'le lien « Toutes les alertes » ouvre la page Alertes (F4)', async ( { page } ) => {

		await open( page, '', 'capteur_en_derive' );
		await page.getByTestId( 'lien-alertes' ).click();
		await expect( page ).toHaveURL( /\/alertes/ );
		await expect( page.getByTestId( 'page-alertes' ) ).toBeVisible();

	} );

} );
