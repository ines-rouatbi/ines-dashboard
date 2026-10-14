// Intégration : les 3 instantanés de test du contrat (rév. 2), servis par le middleware de dev
// (= src/v1.js du Worker sur un faux R2), sont décodés par le client du front sans perte de sens :
//   - nœud absent (NaN / 255) ⇔ z − relief < min_agl_m, sur toutes les variables, float32 et uint8 ;
//   - vitesse = ‖(u, v)‖ ; uint8 dans [0, 1] (coverage, reliability), status ∈ {0, 1} ;
//   - le profil calculé par le front depuis /v1/column redonne le profil précalculé du contrat.

import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { middlewareFixtures } from './fixtures';
import { creerApi, CacheChamps, ApiError, type FieldVar } from '../web/src/data';
import { domaineDepuisMeta } from '../web/src/domain/field';
import { profilDepuisColonne } from '../web/src/domain/profile';
import { capteurProche } from '../web/src/domain/capteurs';
import { texteBandeau } from '../web/src/domain/freshness';

const racine = resolve( fileURLToPath( new URL( '..', import.meta.url ) ), 'contract/fixtures' );
const SCENARIOS = [ 'normal', 'capteur_en_derive', 'gpu_eteint' ] as const;

describe.skipIf( ! existsSync( racine ) )( 'instantanés de test du contrat via le middleware (src/v1.js)', () => {

	const serveurs = new Map<string, { srv: Server; base: string }>();
	const client = ( sc: string ) => creerApi( serveurs.get( sc )!.base );

	beforeAll( async () => {

		for ( const sc of [ ...SCENARIOS, 'inexistant' ] ) {

			const mw = middlewareFixtures( racine, sc );
			const srv = createServer( ( req, res ) => { mw( req, res, () => { res.statusCode = 418; res.end(); } ); } );
			await new Promise<void>( ( ok ) => srv.listen( 0, '127.0.0.1', ok ) );
			const addr = srv.address();
			if ( ! addr || typeof addr === 'string' ) throw new Error( 'adresse inattendue' );
			serveurs.set( sc, { srv, base: `http://127.0.0.1:${ addr.port }` } );

		}

	} );

	afterAll( async () => {

		for ( const { srv } of serveurs.values() ) await new Promise( ( ok ) => srv.close( ok ) );

	} );

	for ( const sc of SCENARIOS ) {

		it( `${ sc } : absents ⇔ z − relief < min_agl_m, vitesse et uint8 cohérents`, async () => {

			const c = client( sc );
			const meta = await c.meta();
			const latest = await c.latest();
			const dom = domaineDepuisMeta( meta );
			const n = dom.nx * dom.ny;
			const terrain = await c.terrain( meta.terrain.href );
			expect( terrain.length ).toBe( n );
			expect( terrain.some( Number.isNaN ) ).toBe( false );

			let valides = 0;
			for ( let k = 0; k < dom.nz; k ++ ) {

				const vars: FieldVar[] = [ 'u', 'v', 'speed', 'sigma_speed', 'coverage', 'reliability', 'status' ];
				const f = Object.fromEntries( await Promise.all( vars.map( async ( x ) => [ x, await c.field( latest.snapshot_id, k, x, meta.encoding[ x ]?.scale ) ] as const ) ) );
				// Comptage d'abord, une seule assertion par niveau (rapide et lisible en cas d'écart).
				const ecarts: string[] = [];
				for ( let idx = 0; idx < n && ecarts.length < 5; idx ++ ) {

					const absent = dom.altitudes[ k ] - terrain[ idx ] < dom.minAgl;
					for ( const x of vars ) if ( Number.isNaN( f[ x ][ idx ] ) !== absent ) ecarts.push( `${ x }[${ idx }] : NaN ${ ! absent } attendu ${ absent }` );
					if ( absent ) continue;
					valides ++;
					const e = Math.abs( Math.hypot( f.u[ idx ], f.v[ idx ] ) - f.speed[ idx ] );
					if ( ! ( e < 1e-3 ) ) ecarts.push( `index ${ idx } : |‖(u,v)‖ − speed| = ${ e }` );
					for ( const x of [ 'coverage', 'reliability' ] ) if ( ! ( f[ x ][ idx ] >= 0 && f[ x ][ idx ] <= 1 ) ) ecarts.push( `${ x }[${ idx }] = ${ f[ x ][ idx ] }` );
					if ( f.status[ idx ] !== 0 && f.status[ idx ] !== 1 ) ecarts.push( `status[${ idx }] = ${ f.status[ idx ] }` );
					if ( ! ( f.sigma_speed[ idx ] >= 0 ) ) ecarts.push( `sigma_speed[${ idx }] = ${ f.sigma_speed[ idx ] }` );

				}

				expect( ecarts, `niveau ${ k }` ).toEqual( [] );

			}

			expect( valides ).toBe( meta.grid.valid_nodes );

		} );

		it( `${ sc } : profil calculé par le front depuis /v1/column = profils précalculés`, async () => {

			const c = client( sc );
			const meta = await c.meta();
			const dom = domaineDepuisMeta( meta );
			const snap = await c.snapshot( ( await c.latest() ).snapshot_id );
			const stations = ( await c.stations( snap.snapshot_id ) ).items;
			const points = snap.points.filter( ( p ) => p.profile );
			expect( points.length ).toBeGreaterThan( 0 );
			for ( const pt of points ) {

				const ref = await c.profile( snap.snapshot_id, pt.id );
				const p = profilDepuisColonne( await c.column( snap.snapshot_id, ref.i, ref.j ) );
				expect( [ p.i, p.j, p.x_m, p.y_m ] ).toEqual( [ ref.i, ref.j, ref.x_m, ref.y_m ] );
				expect( p.z_terrain_m ).toBeCloseTo( ref.z_terrain_m, 2 );
				expect( p.levels ).toHaveLength( dom.nz );
				p.levels.forEach( ( l, k ) => {

					const r = ref.levels[ k ];
					expect( l.below_terrain, `${ pt.id } niveau ${ k }` ).toBe( r.below_terrain );
					expect( l.z_agl_m ).toBeCloseTo( r.z_agl_m, 2 );
					expect( l.status ).toBe( r.status );
					if ( r.below_terrain ) return;
					expect( l.speed! ).toBeCloseTo( r.speed!, 2 );
					// Direction : arrondie avant le modulo côté contrat ; on compare l'écart angulaire.
					expect( Math.abs( ( ( l.dir_from_deg! - r.dir_from_deg! ) + 540 ) % 360 - 180 ) ).toBeLessThan( 0.05 );
					for ( const q of [ 'p10', 'p50', 'p90' ] as const ) expect( l.speed_interval[ q ]! ).toBeCloseTo( r.speed_interval[ q ]!, 2 );

				} );
				const cap = capteurProche( snap.network.kind, stations, p.x_m, p.y_m, dom );
				if ( ref.nearest_sensor ) expect( cap?.id, pt.id ).toBe( ref.nearest_sensor.id );

			}

		} );

	}

	it( 'cache des champs : une requête par (instantané, niveau, variable)', async () => {

		const c = client( 'normal' );
		const meta = await c.meta();
		const { snapshot_id } = await c.latest();
		const cache = new CacheChamps( c );
		const a = cache.champ( snapshot_id, 3, 'coverage', meta.encoding.coverage?.scale );
		expect( cache.champ( snapshot_id, 3, 'coverage', meta.encoding.coverage?.scale ) ).toBe( a );
		expect( ( await a ).length ).toBe( meta.grid.nx * meta.grid.ny );
		expect( cache.taille ).toBe( 1 );

	} );

	it( 'bandeau seulement pour gpu_eteint ; data_kind = test ; absents → 404', async () => {

		for ( const sc of SCENARIOS ) {

			const l = await client( sc ).latest();
			expect( texteBandeau( l ) != null, sc ).toBe( sc === 'gpu_eteint' );
			expect( l.versions.data_kind ).toBe( 'test' );

		}

		const c = client( 'normal' );
		await expect( c.field( 'inconnu_00000000', 0, 'u' ) ).rejects.toMatchObject( { code: 'absent' } );
		await expect( client( 'inexistant' ).meta() ).rejects.toBeInstanceOf( ApiError );

	} );

} );
