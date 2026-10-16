// Coquille UI v2 : notifications (nouvel instantané, calcul, alertes graves), palette de commandes, horloge UTC,
// squelettes accessibles. Rendu statique (sans navigateur).

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Latest, Snapshot } from '../data/contract';
import { evenementAlertes, evenementsLatest } from './notifications';
import { commandes, filtrerCommandes, normaliser } from './Palette';
import { texteHorloge } from './App';
import { SquelettePage } from './Squelette';
import { fermerToast, notifier, toastsCourants } from './toasts';

const latest = ( p: Partial<Latest> ): Latest => ( {
	snapshot_id: 'a_b2529442', valid_time: '2025-02-28T21:00:00Z', generated_at: '2026-10-16T12:00:00Z', published_at: '2026-10-16T12:00:00Z',
	last_observation_at: null, data_status: 'complete', compute_status: 'offline', href: '/v1/snapshots/a_b2529442',
	versions: { model: 'v7', model_sha256: 'x'.repeat( 64 ), norm: '7bae6748', data: 'd', data_kind: 'synthetique', contract: '1.0' },
	...p,
} as Latest );

describe( 'notifications', () => {

	it( 'rien à la première lecture, puis nouvel instantané et changement d’état du calcul', () => {

		const a = latest( {} );
		expect( evenementsLatest( null, a ) ).toEqual( [] );
		expect( evenementsLatest( a, latest( {} ) ) ).toEqual( [] );
		const b = latest( { snapshot_id: 'b_b2529442', valid_time: '2025-03-01T00:00:00Z', compute_status: 'online' } );
		const ev = evenementsLatest( a, b );
		expect( ev.map( ( e ) => e.cle ) ).toEqual( [ 'instantane:b_b2529442', 'calcul' ] );
		expect( ev[ 0 ].texte ).toContain( '01/03/2025' );
		expect( ev[ 1 ].titre ).toBe( 'Calcul en ligne' );
		expect( evenementsLatest( b, latest( { snapshot_id: 'b_b2529442' } ) )[ 0 ].titre ).toBe( 'Calcul arrêté' );

	} );

	it( 'alertes : seulement les critiques et importantes ; décompte null = non calculées, aucun toast', () => {

		const s = ( open_alerts: Snapshot[ 'kpi' ][ 'open_alerts' ] ) => ( { snapshot_id: 'x_b2529442', kpi: { open_alerts } } as Pick<Snapshot, 'snapshot_id' | 'kpi'> );
		expect( evenementAlertes( s( null ) ) ).toBeNull();
		expect( evenementAlertes( s( { critique: 0, important: 0, avertissement: 3, information: 1 } ) ) ).toBeNull();
		const e = evenementAlertes( s( { critique: 1, important: 2, avertissement: 0, information: 0 } ) )!;
		expect( e.genre ).toBe( 'alerte' );
		expect( e.titre ).toBe( '3 alertes graves ouvertes' );
		expect( e.texte ).toBe( '1 critique, 2 importantes' );
		expect( e.lien?.chemin ).toBe( '/alertes' );

	} );

	it( 'file des toasts : déduplication par clé, au plus 4, fermeture', () => {

		const a = notifier( { genre: 'info', titre: 'A', cle: 'k' } );
		const b = notifier( { genre: 'info', titre: 'B', cle: 'k' } );
		expect( toastsCourants().filter( ( t ) => t.cle === 'k' ).map( ( t ) => t.titre ) ).toEqual( [ 'B' ] );
		for ( let i = 0; i < 6; i ++ ) notifier( { genre: 'ok', titre: `n${ i }` } );
		expect( toastsCourants().length ).toBe( 4 );
		for ( const t of [ ...toastsCourants() ] ) fermerToast( t.id );
		fermerToast( a ); fermerToast( b );
		expect( toastsCourants().length ).toBe( 0 );

	} );

} );

describe( 'palette de commandes', () => {

	const cmds = commandes( {
		page: 'fiabilite', theme: 'light', mouvement: 'systeme', latestId: 'b_b2529442',
		instants: [ { snapshot_id: 'a_b2529442', valid_time: '2025-02-28T18:00:00Z', open_alerts: 1 }, { snapshot_id: 'b_b2529442', valid_time: '2025-02-28T21:00:00Z', open_alerts: 0 } ],
	} );

	it( 'pages, instants publiés (du plus récent au plus ancien), thème et animations', () => {

		expect( cmds.filter( ( c ) => c.groupe === 'Pages' ).length ).toBe( 7 );
		const instants = cmds.filter( ( c ) => c.groupe === 'Instants publiés' );
		expect( instants.map( ( c ) => c.id ) ).toEqual( [ 'instant:b_b2529442', 'instant:a_b2529442' ] );
		expect( instants[ 0 ].detail ).toMatch( /^dernier/ );
		expect( instants[ 1 ].detail ).toContain( '1 alerte' );
		expect( cmds.find( ( c ) => c.id === 'theme' )?.titre ).toBe( 'Passer au thème sombre' );

	} );

	it( 'recherche sans accents, tous les mots', () => {

		expect( normaliser( 'Éolien' ) ).toBe( 'eolien' );
		expect( filtrerCommandes( cmds, 'eol' ).map( ( c ) => c.id ) ).toEqual( [ 'page:eolien' ] );
		expect( filtrerCommandes( cmds, 'theme sombre' ).map( ( c ) => c.id ) ).toEqual( [ 'theme' ] );
		expect( filtrerCommandes( cmds, '21:00' ).map( ( c ) => c.id ) ).toEqual( [ 'instant:b_b2529442' ] );
		expect( filtrerCommandes( cmds, '' ).length ).toBe( cmds.length );

	} );

} );

describe( 'horloge et squelettes', () => {

	it( 'heure UTC (pas celle du navigateur)', () => {

		expect( texteHorloge( new Date( '2025-02-28T21:05:09Z' ) ).heure ).toBe( '21:05:09' );

	} );

	it( 'un squelette garde un texte accessible et l’identifiant de l’état de la page', () => {

		const html = renderToStaticMarkup( <SquelettePage texte="Alertes : chargement…" testid="page-alertes-attente" /> );
		expect( html ).toContain( 'role="status"' );
		expect( html ).toContain( 'data-testid="page-alertes-attente"' );
		expect( html ).toContain( 'Alertes : chargement…' );

	} );

} );
