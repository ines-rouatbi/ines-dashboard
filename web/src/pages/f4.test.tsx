// Pages F4 (Éolien, Alertes) sur les 3 instantanés de test du contrat, plus un instantané dont
// assets.wind_farm, assets.alerts et assets.windrose_template sont null : « non disponible », jamais une
// erreur ni un 0. Le réseau est simulé : chaque URL de snapshot.assets est servie depuis le fichier du
// contrat correspondant (le chemin complet par src/v1.js est couvert par dev/fixtures-contrat.test.ts,
// dev/scenario.test.ts et les e2e de pages-f4.spec.ts).

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../data';
import { AlertesPage, sortAlerts } from './alertes/AlertesPage';
import { EolienPage } from './eolien/EolienPage';
import { loadAlerts, loadEolien, type SnapshotLite } from './shared/api';
import { NA } from './shared/format';
import type { Alerts, WindFarm } from './shared/types';

const FICHIERS = import.meta.glob( '../../../contract/fixtures/*/{snapshot,wind-farm,alerts}.json', { eager: true, import: 'default' } );
const ROSES = import.meta.glob( '../../../contract/fixtures/*/windrose/*.json', { eager: true, import: 'default' } );
const SCENARIOS = [ 'normal', 'capteur_en_derive', 'gpu_eteint' ] as const;
// Fixture du contrat, typée à la demande par l'appelant.
const fixture = ( sc: string, f: string ): any => {

	const v = ( f.startsWith( 'windrose/' ) ? ROSES : FICHIERS )[ `../../../contract/fixtures/${ sc }/${ f }` ];
	if ( v === undefined ) throw new Error( `fixture absente : ${ sc }/${ f }` );
	return structuredClone( v );

};
/** Texte visible, espaces fines et insécables normalisées. */
const texte = ( html: string ) => html.replace( /<[^>]+>/g, ' ' ).replace( /&#x27;|&#39;/g, '\'' ).replace( /&amp;/g, '&' ).replace( /[  \s]+/g, ' ' );
const fr = ( x: number, d = 0 ) => x.toLocaleString( 'fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d } ).replace( /[  ]/g, ' ' );

afterEach( () => { vi.unstubAllGlobals(); } );

/** Réseau simulé : les URL /v1 de snapshot.assets du scénario → fichiers du contrat, en JSON. */
function navigateur( sc: string ) {

	const id = `test_${ sc }_e44d68da`;
	const espion = vi.fn( async ( url: string | URL | Request ) => {

		const u = new URL( String( url ), 'http://atom.local' );
		const rose = /^\/v1\/windrose\/([A-Za-z0-9_-]+)$/.exec( u.pathname );
		const f = u.pathname === `/v1/wind-farm/${ id }` ? 'wind-farm.json'
			: u.pathname === `/v1/alerts/${ id }` ? 'alerts.json'
				: rose && u.searchParams.get( 'snapshot' ) === id ? `windrose/${ rose[ 1 ] }.json` : null;
		if ( ! f ) return new Response( '{"error":"absent"}', { status: 404, headers: { 'content-type': 'application/json' } } );
		return new Response( JSON.stringify( fixture( sc, f ) ), { headers: { 'content-type': 'application/json; charset=utf-8' } } );

	} );
	vi.stubGlobal( 'fetch', espion );
	return espion;

}

const instantane = ( sc: string ): SnapshotLite => fixture( sc, 'snapshot.json' );

describe( 'pages F4 sur les instantanés de test', () => {

	for ( const sc of SCENARIOS ) {

		it( `${ sc } : Éolien fidèle à wind-farm.json et windrose/*.json`, async () => {

			navigateur( sc );
			const data = await loadEolien( instantane( sc ) );
			const wf: WindFarm = fixture( sc, 'wind-farm.json' );
			expect( data.windFarm ).toEqual( wf );
			const roses = instantane( sc ).points.filter( ( p ) => p.windrose );
			expect( data.windroses.map( ( r ) => r.point.id ) ).toEqual( roses.map( ( p ) => p.id ) );
			for ( const r of data.windroses ) expect( r.rose ).toEqual( fixture( sc, `windrose/${ r.point.id }.json` ) );

			const html = renderToStaticMarkup( <EolienPage data={ data } /> );
			const t = texte( html );
			const p = wf.farm.power_kw;
			expect( t ).toContain( `${ fr( p.p50! ) } kW [${ fr( p.p10! ) } – ${ fr( p.p90! ) }]` );
			expect( html.match( /data-testid="turbine"/g ) ).toHaveLength( wf.turbines.length );
			// n_valid = 36 < 100 dans les 3 fixtures : « statistiquement faible » affiché.
			expect( html ).toContain( 'data-testid="windrose-weak"' );
			expect( html ).not.toContain( 'data-testid="no-wind-farm"' );

		} );

		it( `${ sc } : Alertes fidèles à alerts.json (comptes, ordre, historique)`, async () => {

			navigateur( sc );
			const alerts = await loadAlerts( instantane( sc ) );
			const attendu: Alerts = fixture( sc, 'alerts.json' );
			expect( alerts ).toEqual( attendu );
			const html = renderToStaticMarkup( <AlertesPage alerts={ alerts } /> );
			const ouvertes = sortAlerts( attendu.items.filter( ( a ) => a.status === 'ouverte' ) ).map( ( a ) => a.id );
			const closes = sortAlerts( attendu.items.filter( ( a ) => a.status === 'close' ) ).map( ( a ) => a.id );
			const ids = [ ...html.matchAll( /data-alert-id="([0-9a-f]{8})"/g ) ].map( ( m ) => m[ 1 ] );
			expect( ids ).toEqual( [ ...ouvertes, ...closes ] );
			expect( texte( html ) ).toContain( `Ouvertes (${ ouvertes.length })` );

		} );

	}

	it( 'les 3 scénarios se distinguent', async () => {

		const vus = new Set<string>();
		for ( const sc of SCENARIOS ) {

			navigateur( sc );
			vus.add( JSON.stringify( ( await loadAlerts( instantane( sc ) ) )?.items.map( ( a ) => a.id ).sort() ) );

		}
		expect( vus.size ).toBe( 3 );

	} );

} );

describe( 'instantané dont les ressources F4 ne sont pas publiées (assets.* = null)', () => {

	const nul: SnapshotLite = { ...instantane( 'normal' ), assets: { ...instantane( 'normal' ).assets, wind_farm: null, alerts: null, windrose_template: null } };

	it( 'aucune requête vers « null », données null, roses « non publiée »', async () => {

		const espion = navigateur( 'normal' );
		const data = await loadEolien( nul );
		expect( data.windFarm ).toBeNull();
		expect( data.windroses.every( ( r ) => r.rose === null && r.error === 'non publiée' ) ).toBe( true );
		expect( await loadAlerts( nul ) ).toBeNull();
		expect( espion ).not.toHaveBeenCalled();

	} );

	it( 'Éolien et Alertes affichent « non disponible », jamais 0', async () => {

		navigateur( 'normal' );
		const eol = renderToStaticMarkup( <EolienPage data={ await loadEolien( nul ) } /> );
		expect( eol ).toContain( 'data-testid="no-wind-farm"' );
		expect( eol ).toContain( 'data-testid="windrose-missing"' );
		expect( texte( eol ) ).toContain( NA );
		expect( eol ).not.toContain( 'data-testid="turbine"' );
		const al = renderToStaticMarkup( <AlertesPage alerts={ await loadAlerts( nul ) } /> );
		expect( al ).toContain( 'data-testid="no-alerts"' );
		expect( texte( al ) ).toContain( NA );
		expect( texte( al ) ).not.toMatch( /\b0\b/ );

	} );

} );

describe( 'getJSON des pages F4', () => {

	it( 'repli SPA (index.html en 200) : erreur typée « invalide », pas un JSON illisible', async () => {

		vi.stubGlobal( 'fetch', vi.fn( async () => new Response( '<!doctype html><title>ATOM</title>', { status: 200, headers: { 'content-type': 'text/html' } } ) ) );
		const e = await loadAlerts( instantane( 'normal' ) ).catch( ( x ) => x );
		expect( e ).toBeInstanceOf( ApiError );
		expect( ( e as ApiError ).code ).toBe( 'invalide' );

	} );

	it( 'statut HTTP vérifié : 404 → « absent », 500 → « http »', async () => {

		vi.stubGlobal( 'fetch', vi.fn( async () => new Response( '{"error":"absent"}', { status: 404, headers: { 'content-type': 'application/json' } } ) ) );
		expect( ( await loadAlerts( instantane( 'normal' ) ).catch( ( x ) => x ) ).code ).toBe( 'absent' );
		vi.stubGlobal( 'fetch', vi.fn( async () => new Response( '{"error":"erreur_interne"}', { status: 500, headers: { 'content-type': 'application/json' } } ) ) );
		expect( ( await loadAlerts( instantane( 'normal' ) ).catch( ( x ) => x ) ).code ).toBe( 'http' );

	} );

} );
