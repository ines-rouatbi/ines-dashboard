// Pages F3 sur les 3 instantanés de test du contrat, servis par le middleware de dev (= src/v1.js du
// Worker sur un faux R2) : chargement des pages, cartes à une hauteur AU-DESSUS DU SOL (D6), série au
// moyeu, simulation. Vérifie la justesse contre les fichiers bruts du contrat (lus ici directement) :
//   - valeur ⇔ deux niveaux encadrants valides, égale à l'interpolation linéaire ; sinon NaN, jamais 0 ;
//   - à 120 m au-dessus du sol, moyenne et maximum = kpi.hub_wind_* de l'instantané (même règle, D10) ;
//   - à 1 000 m au-dessus du sol, le domaine vertical (sommet 1 000 m au-dessus de la mer) est dépassé partout ;
//   - status ∈ {0, 1}, couverture et fiabilité dans [0, 1], absents (255) en NaN.

import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { middlewareFixtures } from './fixtures';
import { CacheChamps, creerApi, decodeFloat32LE } from '../web/src/data';
import type { Snapshot } from '../web/src/data/contract';
import { HAUTEURS_SOL_M, MOTIF } from '../web/src/domain/hauteurSol';
import { chargerBase, chargerCartes, chargerModele, chargerSerie, chargerSimulation } from '../web/src/pages/f3/donnees';

const racine = resolve( fileURLToPath( new URL( '..', import.meta.url ) ), 'contract/fixtures' );
const SCENARIOS = [ 'normal', 'capteur_en_derive', 'gpu_eteint' ] as const;
const r2 = ( x: number ) => Math.round( x * 100 ) / 100;

describe.skipIf( ! existsSync( racine ) )( 'pages F3 sur les instantanés de test (middleware src/v1.js)', () => {

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

	const instantane = async ( sc: string ) => {

		const c = client( sc );
		const latest = await c.latest();
		return { c, snapshot: await c.snapshot( latest.snapshot_id ) as Snapshot };

	};

	for ( const sc of SCENARIOS ) {

		it( `${ sc } : cartes vitesse à 10, 100, 300, 1 000 et 120 m au-dessus du sol`, async () => {

			const { c, snapshot } = await instantane( sc );
			const base = await chargerBase( c, snapshot );
			const { nx, ny, levels_asl_m: L } = base.meta.grid, n = nx * ny;
			// Champ brut tous niveaux du contrat (k·ny·nx + j·nx + i), lu sans passer par le front.
			const brut = decodeFloat32LE( readFileSync( resolve( racine, sc, 'fields/speed.f32' ) ).buffer.slice( 0 ) as ArrayBuffer );
			const relief = base.terrain;
			const cartes = await chargerCartes( new CacheChamps( c ), base, 'speed', [ ...HAUTEURS_SOL_M, 120 ] );
			for ( const carte of cartes ) {

				const ecarts: string[] = [];
				for ( let idx = 0; idx < n && ecarts.length < 5; idx ++ ) {

					const z = relief[ idx ] + carte.hauteur;
					let attendu = NaN;
					for ( let k = 0; k + 1 < L.length; k ++ ) {

						if ( L[ k ] > z || L[ k + 1 ] < z ) continue;
						const a = brut[ k * n + idx ], b = brut[ ( k + 1 ) * n + idx ];
						if ( ! Number.isNaN( a ) && ! Number.isNaN( b ) ) attendu = a + ( b - a ) * ( z - L[ k ] ) / ( L[ k + 1 ] - L[ k ] );
						break;

					}
					const v = carte.valeurs[ idx ];
					if ( Number.isNaN( attendu ) !== Number.isNaN( v ) || ( ! Number.isNaN( v ) && Math.abs( v - attendu ) > 1e-4 ) ) ecarts.push( `h=${ carte.hauteur } idx=${ idx } : ${ v } au lieu de ${ attendu }` );

				}
				expect( ecarts, ecarts.join( '\n' ) ).toEqual( [] );
				expect( carte.resume.disponibles + Object.values( carte.resume.absentes ).reduce( ( a, b ) => a + b, 0 ) ).toBe( n );

			}

			const [ c10, c100, c300, c1000, c120 ] = cartes;
			// 1 000 m au-dessus du sol : au-dessus du sommet du modèle (1 000 m au-dessus de la mer) partout.
			expect( c1000.resume.disponibles ).toBe( 0 );
			expect( c1000.resume.absentes.au_dessus_sommet ).toBe( n );
			expect( c1000.resume.moyenne ).toBeNull();
			expect( [ ...c1000.enc.motif ].every( ( m ) => m === MOTIF.AU_DESSUS_SOMMET ) ).toBe( true );
			// 100 et 300 m : presque toutes les colonnes ont deux niveaux encadrants valides.
			expect( c100.resume.disponibles ).toBeGreaterThan( 0.9 * n );
			expect( c300.resume.disponibles ).toBeGreaterThan( 0.9 * n );
			// 10 m : une partie seulement (le niveau bas est souvent sous le premier nœud valide), jamais 0 inventé.
			expect( c10.resume.disponibles ).toBeGreaterThan( 0 );
			expect( c10.resume.disponibles ).toBeLessThan( n );
			expect( c10.resume.absentes.sous_relief ).toBeGreaterThan( 0 );
			// D10 : même statistique que hub_wind_* de l'instantané.
			expect( snapshot.kpi.hub_height_agl_m ).toBe( 120 );
			expect( r2( c120.resume.moyenne! ) ).toBe( snapshot.kpi.hub_wind_mean_ms );
			expect( r2( c120.resume.max! ) ).toBe( snapshot.kpi.hub_wind_max_ms );

		} );

		it( `${ sc } : incertitude et statut à 100 m au-dessus du sol (uint8 → 0..1, 255 → NaN)`, async () => {

			const { c, snapshot } = await instantane( sc );
			const base = await chargerBase( c, snapshot );
			const cache = new CacheChamps( c );
			for ( const v of [ 'coverage', 'reliability', 'status', 'sigma_speed' ] as const ) {

				const [ carte ] = await chargerCartes( cache, base, v, [ 100 ] );
				const vals = [ ...carte.valeurs ].filter( ( x ) => ! Number.isNaN( x ) );
				expect( vals.length, v ).toBeGreaterThan( 0 );
				if ( v === 'status' ) expect( vals.every( ( x ) => x === 0 || x === 1 ) ).toBe( true );
				else if ( v === 'sigma_speed' ) expect( vals.every( ( x ) => x >= 0 ) ).toBe( true );
				else expect( vals.every( ( x ) => x >= 0 && x <= 1 ) ).toBe( true );
				// 1 000 m : tout absent, y compris en uint8.
				const [ haut ] = await chargerCartes( cache, base, v, [ 1000 ] );
				expect( haut.resume.disponibles ).toBe( 0 );

			}

		} );

		it( `${ sc } : ressources de la page (capteurs signalés B4, alertes, qualité, modèle, série, simulation)`, async () => {

			const { c, snapshot } = await instantane( sc );
			const base = await chargerBase( c, snapshot );
			expect( base.stations.etat ).toBe( 'ok' );
			const stations = base.stations.etat === 'ok' ? base.stations.val.items : [];
			// Treillis synthétique : seuls les capteurs signalés (état ≠ active) sont listés.
			expect( snapshot.network.kind ).toBe( 'treillis_synthetique' );
			expect( stations.every( ( s ) => s.state !== 'active' && /^c\d+_\d+$/.test( s.id ) ) ).toBe( true );
			expect( stations.length ).toBe( { normal: 0, capteur_en_derive: 2, gpu_eteint: 1 }[ sc ] );
			expect( base.alerts.etat ).toBe( 'ok' );
			expect( base.quality.etat ).toBe( 'ok' );

			const m = await chargerModele( c, snapshot );
			expect( m.meta.versions.model_sha256 ).toBe( snapshot.versions.model_sha256 );
			expect( m.dataQuality.etat ).toBe( 'ok' );

			const serie = await chargerSerie( c );
			expect( serie.points.map( ( p ) => [ p.snapshot_id, p.moyenne, p.max ] ) )
				.toEqual( [ [ snapshot.snapshot_id, snapshot.kpi.hub_wind_mean_ms, snapshot.kpi.hub_wind_max_ms ] ] );

			// Aucune simulation : rien n'est présenté comme tel ; une reconstruction nominale est refusée.
			expect( await chargerSimulation( c, null ) ).toEqual( { etat: 'aucune' } );
			const nominal = await chargerSimulation( c, snapshot.snapshot_id );
			expect( nominal.etat ).toBe( 'invalide' );
			expect( nominal.etat === 'invalide' && nominal.message ).toMatch( /pas une simulation/ );
			const absente = await chargerSimulation( c, 'test_panne_e44d68da' );
			expect( absente.etat === 'invalide' && absente.message ).toMatch( /introuvable/ );
			expect( ( await chargerSimulation( c, '../latest' ) ).etat ).toBe( 'invalide' );

		} );

	}

} );
