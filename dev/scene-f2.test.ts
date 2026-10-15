// Lot F2 (scène 3D) sur les 3 instantanés de test du contrat, servis par le vrai code du Worker
// (src/v1.js sur un faux R2) :
//   - mode « hauteur au-dessus du sol » (D6) : le plan de `speed` à 120 m sol, calculé par colonne avec
//     /v1/terrain/{sha8}, redonne snapshot.kpi.hub_wind_mean_ms / hub_wind_max_ms (D10) ;
//   - classe de fiabilité du profil calculé par le front = profils précalculés, et parts par classe
//     de chaque niveau = quality.json (by_level.share_*) ;
//   - lignes de courant : aucun sommet dans une maille touchant un nœud absent (sous le relief).

import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { middlewareFixtures } from './fixtures';
import { creerApi, type Api, type FieldVar, type Meta } from '../web/src/data';
import { domaineDepuisMeta } from '../web/src/domain/field';
import { profilDepuisColonne } from '../web/src/domain/profile';
import { classeFiabilite } from '../web/src/domain/fiabilite';
import { moyenneMax, niveauxUtiles, planHauteurSol } from '../web/src/domain/hauteurSolScene';
import { bilineaireStricte, lignesDeCourant } from '../web/src/domain/lignes';

const racine = resolve( fileURLToPath( new URL( '..', import.meta.url ) ), 'contract/fixtures' );
const SCENARIOS = [ 'normal', 'capteur_en_derive', 'gpu_eteint' ] as const;

async function niveaux( c: Api, meta: Meta, id: string, variable: FieldVar, ks: number[] ) {

	const m = new Map<number, Float32Array>();
	for ( const k of ks ) m.set( k, await c.field( id, k, variable, meta.encoding[ variable ]?.scale ) );
	return m;

}

describe.skipIf( ! existsSync( racine ) )( 'scène 3D (F2) sur les instantanés de test du contrat', () => {

	const serveurs = new Map<string, { srv: Server; base: string }>();
	const client = ( sc: string ) => creerApi( serveurs.get( sc )!.base );

	beforeAll( async () => {

		for ( const sc of SCENARIOS ) {

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

		it( `${ sc } : vent à 120 m au-dessus du sol (par colonne, relief du modèle) = kpi.hub_wind_*`, async () => {

			const c = client( sc );
			const id = ( await c.latest() ).snapshot_id;
			const meta = await c.meta( id.slice( - 8 ) );
			const snap = await c.snapshot( id );
			const terrain = await c.terrain( meta.terrain.href );
			const dom = domaineDepuisMeta( meta );
			const h = snap.kpi.hub_height_agl_m;
			let zMin = Infinity, zMax = - Infinity;
			for ( const z of terrain ) { zMin = Math.min( zMin, z ); zMax = Math.max( zMax, z ); }
			const ks = niveauxUtiles( dom.altitudes, zMin, zMax, h, dom.minAgl );
			expect( ks.length ).toBeGreaterThan( 1 );
			const speed = await niveaux( c, meta, id, 'speed', ks );
			const plan = planHauteurSol( { altitudes: dom.altitudes, terrain, minAgl: dom.minAgl, h, niveau: ( k ) => speed.get( k ) } );
			const { moyenne, max } = moyenneMax( plan );
			expect( snap.kpi.hub_wind_mean_ms ).not.toBeNull();
			expect( moyenne! ).toBeCloseTo( snap.kpi.hub_wind_mean_ms!, 2 );
			expect( max! ).toBeCloseTo( snap.kpi.hub_wind_max_ms!, 2 );
			// Sous min_agl_m : tout absent, jamais 0.
			const bas = planHauteurSol( { altitudes: dom.altitudes, terrain, minAgl: dom.minAgl, h: dom.minAgl - 1, niveau: ( k ) => speed.get( k ) } );
			expect( bas.every( Number.isNaN ) ).toBe( true );

		} );

		it( `${ sc } : classe de fiabilité = profils précalculés et quality.json (parts par niveau)`, async () => {

			const c = client( sc );
			const id = ( await c.latest() ).snapshot_id;
			const meta = await c.meta( id.slice( - 8 ) );
			const snap = await c.snapshot( id );
			for ( const pt of snap.points.filter( ( p ) => p.profile ) ) {

				const ref = await c.profile( id, pt.id );
				const p = profilDepuisColonne( await c.column( id, ref.i, ref.j ) );
				p.levels.forEach( ( l, k ) => expect( l.reliability_class, `${ pt.id } niveau ${ k }` ).toBe( ref.levels[ k ].reliability_class ) );

			}

			const q = await c.quality( id );
			const dom = domaineDepuisMeta( meta );
			const rel = await niveaux( c, meta, id, 'reliability', dom.altitudes.map( ( _, k ) => k ) );
			for ( const [ k, lv ] of q.by_level.entries() ) {

				const n = { elevee: 0, moyenne: 0, faible: 0 };
				let valides = 0;
				for ( const r of rel.get( k )! ) { const cl = classeFiabilite( r ); if ( cl ) { n[ cl ] ++; valides ++; } }
				expect( valides, `niveau ${ k }` ).toBe( lv.valid_nodes );
				if ( ! valides ) continue;
				expect( n.elevee / valides ).toBeCloseTo( lv.share_elevee!, 3 );
				expect( n.moyenne / valides ).toBeCloseTo( lv.share_moyenne!, 3 );
				expect( n.faible / valides ).toBeCloseTo( lv.share_faible!, 3 );

			}

		} );

	}

	it( 'normal : lignes de courant au niveau le plus bas — aucun sommet près d\'un nœud absent', async () => {

		const c = client( 'normal' );
		const id = ( await c.latest() ).snapshot_id;
		const meta = await c.meta( id.slice( - 8 ) );
		const dom = domaineDepuisMeta( meta );
		const u = await c.field( id, 0, 'u' ), v = await c.field( id, 0, 'v' );
		expect( u.some( Number.isNaN ) ).toBe( true ); // le niveau 25 m coupe le relief
		const r = lignesDeCourant( { nx: dom.nx, ny: dom.ny, dx: dom.dx, dy: dom.dy, u, v }, { pas: 3 } );
		expect( r.segments ).toBeGreaterThan( 0 );
		for ( let s = 0; s < r.segments * 2; s ++ ) {

			const fi = r.points[ s * 2 ], fj = r.points[ s * 2 + 1 ];
			expect( Number.isNaN( bilineaireStricte( u, dom.nx, dom.ny, fi, fj ) ), `sommet (${ fi }, ${ fj })` ).toBe( false );

		}

	} );

} );
