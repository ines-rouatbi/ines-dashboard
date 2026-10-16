// Page Comparaison (lot F6) : liste des instants (pagination de /v1/times), choix par défaut, refus de deux
// instants non comparables, rendu des exports publiés / non publiés.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Api } from '../../data';
import type { Snapshot, Times } from '../../data/contract';
import { ExportsPublies } from '../../ui/Exports';
import { etatDepuisSante } from '../../ui/ServiceCalcul';
import { HAUTEURS_COMPARAISON } from './Comparaison';
import { chargerInstants, choixParDefaut } from './donnees';

const item = ( h: number ) => ( { snapshot_id: `017_${ String( h ).padStart( 2, '0' ) }0000_b2529442`, valid_time: `2025-02-28T${ String( h ).padStart( 2, '0' ) }:00:00Z` } );

function fausseApi( pages: Times[] ): Api {

	return { times: async ( p: Record<string, string> = {} ) => pages[ Number( p.cursor ?? 0 ) ] } as unknown as Api;

}

describe( 'comparaison : instants disponibles', () => {

	it( 'suit la pagination de /v1/times, dédoublonne et trie du plus ancien au plus récent', async () => {

		const api = fausseApi( [
			{ total: 4, next: '1', items: [ item( 21 ), item( 18 ) ] },
			{ total: 4, next: null, items: [ item( 15 ), item( 18 ), item( 12 ) ] },
		] );
		const r = await chargerInstants( api );
		expect( r.items.map( ( x ) => x.valid_time.slice( 11, 13 ) ) ).toEqual( [ '12', '15', '18', '21' ] );
		expect( r.tronque ).toBe( false );

	} );

	it( 's’arrête au nombre de pages maximal et le signale', async () => {

		const pages: Times[] = Array.from( { length: 5 }, ( _, k ) => ( { total: 5, next: String( k + 1 ), items: [ item( k ) ] } ) );
		const r = await chargerInstants( fausseApi( pages ), undefined, 2 );
		expect( r.items ).toHaveLength( 2 );
		expect( r.tronque ).toBe( true );

	} );

	it( 'choix par défaut : B = latest, A = l’instant précédent', () => {

		const items = [ item( 0 ), item( 3 ), item( 6 ) ];
		expect( choixParDefaut( items, item( 6 ).snapshot_id ) ).toEqual( { a: item( 3 ).snapshot_id, b: item( 6 ).snapshot_id } );
		expect( choixParDefaut( items, item( 3 ).snapshot_id ) ).toEqual( { a: item( 0 ).snapshot_id, b: item( 3 ).snapshot_id } );
		expect( choixParDefaut( items, null ) ).toEqual( { a: item( 3 ).snapshot_id, b: item( 6 ).snapshot_id } );
		expect( choixParDefaut( [ item( 0 ) ], null ) ).toEqual( { a: item( 0 ).snapshot_id, b: item( 0 ).snapshot_id } );
		expect( choixParDefaut( [], null ) ).toEqual( { a: null, b: null } );

	} );

	it( 'hauteurs proposées : 10, 100, 120 (moyeu), 300 et 1 000 m au-dessus du sol', () => {

		expect( HAUTEURS_COMPARAISON ).toEqual( [ 10, 100, 120, 300, 1000 ] );

	} );

} );

describe( 'exports publiés et service de calcul', () => {

	const assets = ( nc: string | null, csv: string | null ) => ( { snapshot_id: 'x_b2529442', assets: { export_netcdf: nc, export_csv: csv } } as unknown as Pick<Snapshot, 'assets' | 'snapshot_id'> );

	it( 'liens NetCDF / CSV quand M6 les publie, « non disponible » sinon', () => {

		const avec = renderToStaticMarkup( <ExportsPublies snapshot={ assets( '/v1/exports/x/x.nc', '/v1/exports/x/x.csv' ) } /> );
		expect( avec ).toContain( 'href="/v1/exports/x/x.nc"' );
		expect( avec ).toContain( 'href="/v1/exports/x/x.csv"' );
		const sans = renderToStaticMarkup( <ExportsPublies snapshot={ assets( null, null ) } /> );
		expect( sans ).not.toContain( 'href=' );
		expect( sans ).toContain( 'NetCDF : non disponible' );
		expect( sans ).toContain( 'CSV : non disponible' );

	} );

	it( '/api/health : joignable, endormi (503 du Worker), injoignable', () => {

		expect( etatDepuisSante( 200, 'application/json', { status: 'ok', modele: 'best_dso_v7.pt', device: 'cpu' } ) ).toMatchObject( { etat: 'joignable', modele: 'best_dso_v7.pt', device: 'cpu' } );
		expect( etatDepuisSante( 503, 'application/json', { error: 'service_asleep' } ) ).toEqual( { etat: 'endormi', detail: 'service_asleep' } );
		expect( etatDepuisSante( 200, 'text/html', null ).etat ).toBe( 'injoignable' );
		expect( etatDepuisSante( 502, 'application/json', {} ).etat ).toBe( 'injoignable' );

	} );

} );
