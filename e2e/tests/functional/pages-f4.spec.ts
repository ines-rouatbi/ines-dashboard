// Fidélité des pages Éolien et Alertes (lot F4) sur les 3 instantanés de test du contrat.
// Chaque valeur affichée est comparée au fichier de contract/fixtures/<scénario>/ ; les oracles
// vérifient en plus la cohérence interne des instantanés (puissance = courbe(REWS), id = sha8).
//
// ATOM_F4_ROUTE : gabarit d'URL des pages, avec {page} (eolien | alertes) et {scenario}.
// Tant que F0 ne monte pas les pages dans l'application, ces tests sont sautés en le disant.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { powerAt } from '../../oracles/wind';

const FIX = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '../../../contract/fixtures' );
const SCENARIOS = [ 'normal', 'capteur_en_derive', 'gpu_eteint' ] as const;
const ROUTE = process.env.ATOM_F4_ROUTE;
const NA = 'non disponible';

const fixture = ( s: string, f: string ) => JSON.parse( readFileSync( path.join( FIX, s, f ), 'utf8' ) );
/** Espaces fines et insécables du format français → espace simple. */
const norm = ( s: string | null ) => ( s ?? '' ).replace( /[  ]/g, ' ' ).replace( /\s+/g, ' ' ).trim();
const fr = ( x: number, d = 0 ) => norm( x.toLocaleString( 'fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d } ) );
const iv = ( o: any, unit: string, d = 0 ) => o?.p50 == null ? NA
	: `${ fr( o.p50, d ) } ${ unit } [${ o.p10 == null ? NA : fr( o.p10, d ) } – ${ o.p90 == null ? NA : fr( o.p90, d ) }]`;
const text = async ( page: Page, sel: string ) => norm( await page.locator( sel ).first().textContent() );

async function open( page: Page, name: 'eolien' | 'alertes', scenario: string ) {

	await page.goto( ROUTE!.replace( '{page}', name ).replace( '{scenario}', scenario ) );
	await expect( page.getByTestId( `page-${ name }` ) ).toBeVisible();

}

test.describe( 'cohérence des instantanés de test (oracles, sans navigateur)', () => {

	for ( const s of SCENARIOS ) {

		test( `${ s } : puissance publiée = courbe(REWS) ; id d’alerte = sha8(kind|cible)`, () => {

			const wf = fixture( s, 'wind-farm.json' );
			for ( const t of wf.turbines ) {

				const c = wf.power_curves[ t.model ];
				const curve = { speeds: c.speed_ms, power: c.power_kw, cutIn: t.cut_in_ms, cutOut: t.cut_out_ms };
				const rho = t.air_density ?? 1.225;
				// p50 au kW près ; p10 / p90 calculés sur les membres (D9) : tolérance 0,25 % de la puissance nominale.
				expect( Math.abs( powerAt( curve, t.rews.p50, rho ) - t.power_kw.p50 ), `${ t.id } p50` ).toBeLessThanOrEqual( 1 );
				for ( const q of [ 'p10', 'p90' ] ) {

					expect( Math.abs( powerAt( curve, t.rews[ q ], rho ) - t.power_kw[ q ] ), `${ t.id } ${ q }` ).toBeLessThanOrEqual( 0.0025 * t.rated_kw );

				}

			}

			for ( const a of fixture( s, 'alerts.json' ).items ) {

				expect( createHash( 'sha256' ).update( `${ a.kind }|${ a.target }` ).digest( 'hex' ).slice( 0, 8 ), a.title ).toBe( a.id );

			}

		} );

	}

} );

test.describe( 'pages F4 (navigateur)', () => {

	test.skip( ! ROUTE, 'ATOM_F4_ROUTE non défini : pages F4 pas encore montées dans l’application (F0)' );

	for ( const s of SCENARIOS ) {

		test( `Éolien « ${ s } » : parc et éoliennes fidèles à wind-farm.json`, async ( { page } ) => {

			const wf = fixture( s, 'wind-farm.json' );
			await open( page, 'eolien', s );
			expect( await text( page, '[data-testid=farm-power] .atom-kpi-value' ) ).toBe( iv( wf.farm.power_kw, 'kW' ) );
			expect( await text( page, '[data-testid=farm-rated] .atom-kpi-value' ) ).toBe( `${ fr( wf.farm.rated_kw ) } kW` );
			expect( await text( page, '[data-testid=farm-states] .atom-kpi-value' ) ).toBe( `${ wf.farm.n_production } / ${ wf.farm.n_arret }` );

			await expect( page.getByTestId( 'turbine' ) ).toHaveCount( wf.turbines.length );
			for ( const t of wf.turbines ) {

				const row = `[data-testid=turbine][data-turbine-id="${ t.id }"]`;
				expect( await text( page, `${ row } [data-testid=turbine-power]` ), t.id ).toBe( iv( t.power_kw, 'kW' ) );
				expect( await text( page, `${ row } [data-testid=turbine-rews]` ), t.id ).toBe( iv( t.rews, 'm/s', 2 ) );
				expect( await text( page, `${ row } [data-testid=turbine-hub-speed]` ), t.id ).toBe( iv( t.hub_speed, 'm/s', 2 ) );
				expect( await text( page, `${ row } [data-testid=turbine-shear]` ), t.id ).toBe( t.shear_alpha == null ? NA : fr( t.shear_alpha, 3 ) );
				const veer = await text( page, `${ row } [data-testid=turbine-veer]` );
				if ( t.veer_deg == null ) expect( veer ).toBe( NA );
				else expect( veer, `${ t.id } : signe et sens explicites` ).toBe( `${ t.veer_deg > 0 ? '+' : t.veer_deg < 0 ? '−' : '' }${ fr( Math.abs( t.veer_deg ), 1 ) }°${ t.veer_deg > 0 ? ' (horaire)' : t.veer_deg < 0 ? ' (antihoraire)' : '' }` );
				// L'état est un libellé français, jamais l'énumération brute.
				expect( await text( page, `${ row } [data-testid=turbine-state]` ) ).not.toBe( t.state );
				await expect( page.locator( `${ row } [data-testid=turbine-virtual]` ) ).toHaveCount( t.virtual ? 1 : 0 );

			}

			await expect( page.getByTestId( 'power-curve-chart' ).locator( 'svg' ) ).toHaveCount( 1 );

		} );

		test( `Éolien « ${ s } » : roses des vents et Weibull fidèles à windrose/*.json`, async ( { page } ) => {

			const points = fixture( s, 'snapshot.json' ).points.filter( ( p: any ) => p.windrose );
			await open( page, 'eolien', s );
			await expect( page.getByTestId( 'windrose-tab' ) ).toHaveCount( points.length );
			for ( const p of points ) {

				const rose = fixture( s, `windrose/${ p.id }.json` );
				await page.locator( `[data-testid=windrose-tab][data-site-id="${ p.id }"]` ).click();
				const card = `[data-testid=windrose][data-site-id="${ p.id }"]`;
				await expect( page.locator( card ) ).toBeVisible();
				expect( await text( page, `${ card } [data-testid=windrose-n-valid]` ) ).toBe( fr( rose.n_valid ) );
				// Contrat : n_valid < 100 DOIT être signalé comme statistiquement faible.
				await expect( page.locator( `${ card } [data-testid=windrose-weak]` ) ).toHaveCount( rose.n_valid < 100 ? 1 : 0 );
				const w = rose.weibull;
				expect( await text( page, `${ card } [data-testid=weibull-k]` ) ).toBe( w ? fr( w.k, 2 ) : NA );
				expect( await text( page, `${ card } [data-testid=weibull-c]` ) ).toBe( w ? `${ fr( w.c_ms, 2 ) } m/s` : NA );
				expect( await text( page, `${ card } [data-testid=weibull-aep]` ) ).toBe( w?.aep_mwh == null ? NA : `${ fr( w.aep_mwh ) } MWh` );
				expect( await text( page, `${ card } [data-testid=weibull-cf]` ) ).toBe( w?.capacity_factor == null ? NA : `${ fr( w.capacity_factor * 100, 1 ) } %` );
				const rows = page.locator( `${ card } [data-testid=windrose-sector]` );
				await expect( rows ).toHaveCount( rose.sectors.length );
				for ( const [ k, sec ] of rose.sectors.entries() ) {

					expect( await rows.nth( k ).getAttribute( 'data-dir' ) ).toBe( String( sec.dir_center_deg ) );
					expect( norm( await rows.nth( k ).locator( 'td' ).nth( 1 ).textContent() ) ).toBe( `${ fr( sec.frequency * 100, 1 ) } %` );

				}

				await expect( page.locator( `${ card } [data-testid=windrose-chart] svg` ) ).toHaveCount( 1 );

			}

		} );

		test( `Alertes « ${ s } » : comptes, ordre, historique et contenu fidèles à alerts.json`, async ( { page } ) => {

			const items = fixture( s, 'alerts.json' ).items as any[];
			const rank: Record<string, number> = { critique: 0, important: 1, avertissement: 2, information: 3 };
			const order = ( xs: any[] ) => [ ...xs ].sort( ( a, b ) => rank[ a.level ] - rank[ b.level ] || b.raised_at.localeCompare( a.raised_at ) || a.id.localeCompare( b.id ) ).map( ( a ) => a.id );
			const open_ = items.filter( ( a ) => a.status === 'ouverte' ), closed = items.filter( ( a ) => a.status === 'close' );
			await open( page, 'alertes', s );

			for ( const l of Object.keys( rank ) ) {

				expect( await text( page, `[data-testid=count-${ l }] .atom-kpi-value` ), l ).toBe( String( open_.filter( ( a ) => a.level === l ).length ) );

			}

			const ids = async ( list: string ) => page.locator( `[data-testid=${ list }] [data-testid=alert]` ).evaluateAll( ( els ) => els.map( ( e ) => e.getAttribute( 'data-alert-id' ) ) );
			expect( open_.length ? await ids( 'alerts-open' ) : [], 'ouvertes : du plus grave au moins grave' ).toEqual( order( open_ ) );
			expect( closed.length ? await ids( 'alerts-closed' ) : [], 'closes : dans l’historique' ).toEqual( order( closed ) );

			for ( const a of items ) {

				const card = `[data-testid=alert][data-alert-id="${ a.id }"]`;
				expect( await text( page, `${ card } [data-testid=alert-title]` ) ).toBe( norm( a.title ) );
				expect( await text( page, `${ card } [data-testid=alert-target]` ) ).toBe( a.target );
				expect( await text( page, `${ card } [data-testid=alert-cause]` ) ).toBe( norm( a.cause ) );
				expect( await text( page, `${ card } [data-testid=alert-recommendation]` ) ).toBe( norm( a.recommendation ) );
				const q = ( x: number | null ) => x == null ? NA : norm( `${ x.toLocaleString( 'fr-FR', { maximumFractionDigits: 2 } ) }${ a.unit ? ' ' + a.unit : '' }` );
				expect( await text( page, `${ card } [data-testid=alert-value]` ) ).toBe( q( a.value ) );
				expect( await text( page, `${ card } [data-testid=alert-threshold]` ) ).toBe( q( a.threshold ) );
				expect( await page.locator( card ).getAttribute( 'data-level' ) ).toBe( a.level );

			}

		} );

	}

	test( 'Alertes : les 3 scénarios se distinguent (la page lit bien l’instantané demandé)', async ( { page } ) => {

		const seen: string[] = [];
		for ( const s of SCENARIOS ) {

			await open( page, 'alertes', s );
			seen.push( ( await page.getByTestId( 'alert' ).evaluateAll( ( els ) => els.map( ( e ) => e.getAttribute( 'data-alert-id' ) ) ) ).sort().join( ',' ) );

		}

		expect( new Set( seen ).size, 'les 3 instantanés de test ont des listes d’alertes différentes' ).toBe( 3 );

	} );

} );
