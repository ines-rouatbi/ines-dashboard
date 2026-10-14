// Intégration : les 3 instantanés de test du contrat, servis par le middleware de dev,
// sont décodés par le client du front (web/src/data) sans perte de sens :
// NaN exactement sous le relief, vitesse = ‖(u, v)‖, profil client cohérent.

import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { middlewareFixtures } from './fixtures';
import { creerApi, CacheChamps, ApiError } from '../web/src/data';
import { domaineDepuisMeta } from '../web/src/domain/field';
import { profilColonne, VARS_PROFIL } from '../web/src/domain/profile';
import { dirFrom } from '../web/src/domain/wind';
import { texteBandeau } from '../web/src/domain/freshness';

const racine = resolve( fileURLToPath( new URL( '..', import.meta.url ) ), 'contract/fixtures' );
const SCENARIOS = [ 'normal', 'capteur_en_derive', 'gpu_eteint' ] as const;

describe.skipIf( ! existsSync( racine ) )( 'instantanés de test du contrat via le middleware', () => {

	const serveurs = new Map<string, { srv: Server; base: string }>();

	beforeAll( async () => {

		for ( const sc of SCENARIOS ) {

			const mw = middlewareFixtures( racine, sc );
			const srv = createServer( ( req, res ) => mw( req, res, () => { res.statusCode = 418; res.end(); } ) );
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

		it( `${ sc } : NaN sous le relief et vitesse cohérente à chaque niveau`, async () => {

			const client = creerApi( serveurs.get( sc )!.base );
			const meta = await client.meta();
			const latest = await client.latest();
			const dom = domaineDepuisMeta( meta );
			const n = dom.nx * dom.ny;
			const terrain = await client.terrain();
			expect( terrain.length ).toBe( n );
			expect( terrain.some( Number.isNaN ) ).toBe( false );

			let valides = 0;
			for ( let k = 0; k < dom.nz; k ++ ) {

				const [ u, v, speed ] = await Promise.all( [ 'u', 'v', 'speed' ].map( ( x ) => client.field( latest.snapshot_id, k, x as 'u' ) ) );
				for ( const f of [ u, v, speed ] ) expect( f.length ).toBe( n );
				// Comptage d'abord, une seule assertion par niveau (rapide et lisible en cas d'écart).
				const ecarts: string[] = [];
				for ( let idx = 0; idx < n && ecarts.length < 5; idx ++ ) {

					const sous = dom.altitudes[ k ] <= terrain[ idx ];
					const nan = [ u[ idx ], v[ idx ], speed[ idx ] ].map( Number.isNaN );
					if ( nan.some( ( x ) => x !== sous ) ) { ecarts.push( `index ${ idx } : NaN ${ nan } / sous le relief ${ sous }` ); continue; }
					if ( sous ) continue;
					valides ++;
					const e = Math.abs( Math.hypot( u[ idx ], v[ idx ] ) - speed[ idx ] );
					if ( ! ( e < 1e-3 ) ) ecarts.push( `index ${ idx } : |‖(u,v)‖ − speed| = ${ e }` );

				}

				expect( ecarts, `niveau ${ k }` ).toEqual( [] );

			}

			expect( valides ).toBe( meta.grid.valid_nodes );

		} );

		it( `${ sc } : profil calculé côté client à une maille`, async () => {

			const client = creerApi( serveurs.get( sc )!.base );
			const meta = await client.meta();
			const { snapshot_id } = await client.latest();
			const dom = domaineDepuisMeta( meta );
			const cache = new CacheChamps( client );
			const i = 24, j = 16; // maille du point (12 000 m, 8 000 m)
			const champs = await Promise.all( dom.altitudes.map( async ( _, k ) => Object.fromEntries(
				await Promise.all( VARS_PROFIL.map( async ( x ) => [ x, await cache.champ( snapshot_id, k, x ) ] as const ) ) ) ) );
			expect( cache.taille ).toBe( dom.nz * VARS_PROFIL.length );
			const p = profilColonne( dom, i, j, champs, await cache.terrain() );
			expect( p.levels ).toHaveLength( dom.nz );
			for ( const l of p.levels ) {

				expect( l.below_terrain ).toBe( l.agl_m <= 0 );
				if ( l.below_terrain ) continue;
				expect( l.dir_from_deg ).toBe( dirFrom( l.u!, l.v! ) );
				const { p10, p50, p90 } = l.speed_interval;
				expect( p10! ).toBeGreaterThanOrEqual( 0 );
				expect( p10! ).toBeLessThanOrEqual( p50! );
				expect( p50! ).toBeLessThan( p90! );
				expect( [ 'mesure', 'estime' ] ).toContain( l.status );

			}

		} );

	}

	it( 'bandeau seulement pour gpu_eteint ; ressource inconnue → 404 absent', async () => {

		for ( const sc of SCENARIOS ) {

			const l = await creerApi( serveurs.get( sc )!.base ).latest();
			expect( texteBandeau( l ) != null ).toBe( sc === 'gpu_eteint' );

		}

		const client = creerApi( serveurs.get( 'normal' )!.base );
		await expect( client.field( 'inconnu_00000000', 99, 'u' ) ).rejects.toMatchObject( { code: 'absent' } );
		await expect( client.field( 'inconnu_00000000', 99, 'u' ) ).rejects.toBeInstanceOf( ApiError );

	} );

} );
