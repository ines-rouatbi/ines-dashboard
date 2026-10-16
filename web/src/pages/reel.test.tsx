// Branchement réel (lot F6) : le front sur les VRAIS instantanés publiés par M6, lus sur /v1 d'un Worker
// (par défaut le déploiement local, wrangler dev sur le R2 local : http://127.0.0.1:8787).
//
// Lecture seule. Si le Worker ne répond pas en quelques secondes (CI, poste sans déploiement local), toute la
// suite est SAUTÉE proprement. ATOM_REEL_URL=<origine> pour viser un autre Worker, ATOM_REEL=0 pour la couper.
//
// Ce qu'on vérifie : les réponses respectent le contrat (schémas JSON) ; la grille et les champs ont la bonne
// taille ; NaN ⇔ z − relief < min_agl_m sur un niveau entier ; une variable non publiée (M2 inactif) n'est
// jamais servie ni inventée ; les cartes « au-dessus du sol » retrouvent hub_wind_* publié ; les pages affichent
// « non disponible » pour ce qui n'est pas calculé (alertes, parc vide, classes de fiabilité) ; la comparaison
// de deux instants et les exports CSV tiennent sur des données de 500 × 250 × 12.

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError, CacheChamps, creerApi } from '../data';
import type { Alerts, DataQuality, Latest, Meta, Quality, Snapshot, Stations, Times, WindFarm } from '../data/contract';
import { encadrer } from '../domain/hauteurSol';
import { csvCarte, csvComparaison, csvProfil } from '../domain/exportCsv';
import { profilDepuisColonne } from '../domain/profile';
import { AlertesPage } from './alertes/AlertesPage';
import { chargerComparaison, chargerInstants } from './comparaison/donnees';
import { EolienPage } from './eolien/EolienPage';
import { Repartition, VariableNonPubliee } from './f3/Fiabilite';
import { chargerBase, chargerCartes, identite } from './f3/donnees';

const env = ( globalThis as { process?: { env: Record<string, string | undefined> } } ).process?.env ?? {};
const BASE = ( env.ATOM_REEL_URL ?? 'http://127.0.0.1:8787' ).replace( /\/+$/, '' );

async function sonder(): Promise<Latest | null> {

	if ( env.ATOM_REEL === '0' ) return null;
	try {

		const r = await fetch( `${ BASE }/v1/latest`, { signal: AbortSignal.timeout( 3000 ), headers: { accept: 'application/json' } } );
		if ( ! r.ok || ! ( r.headers.get( 'content-type' ) ?? '' ).includes( 'json' ) ) return null;
		return await r.json() as Latest;

	} catch { return null; }

}

const latest = await sonder();
const LENT = 60_000;

const SCHEMAS = import.meta.glob( '../../../contract/schemas/*.schema.json', { eager: true, import: 'default' } );
const ajv = new Ajv2020( { allErrors: true, strict: true, strictRequired: false, strictTypes: false, allowUnionTypes: true } );
addFormats( ajv );
for ( const [ chemin, s ] of Object.entries( SCHEMAS ) ) ajv.addSchema( s as object, chemin.split( '/' ).pop()! );
function conforme( schema: string, donnee: unknown ) {

	const v = ajv.getSchema( `${ schema }.schema.json` );
	if ( ! v ) throw new Error( `schéma ${ schema } introuvable` );
	const ok = v( donnee );
	expect( ok, `${ schema } : ${ JSON.stringify( v.errors?.slice( 0, 3 ) ) }` ).toBe( true );

}

const texte = ( html: string ) => html.replace( /<[^>]+>/g, ' ' ).replace( /&#x27;|&#39;/g, '\'' ).replace( /\s+/g, ' ' );

describe.skipIf( ! latest )( `instantanés réels publiés (${ BASE }/v1)`, () => {

	const api = creerApi( BASE );
	let snap: Snapshot, meta: Meta, times: Times;

	it( 'latest, times, instantané et meta respectent le contrat', async () => {

		conforme( 'latest', latest );
		times = await api.times();
		conforme( 'times', times );
		expect( times.items.map( ( x ) => x.snapshot_id ) ).toContain( latest!.snapshot_id );
		snap = await api.snapshot( latest!.snapshot_id );
		conforme( 'snapshot', snap );
		meta = await api.meta( latest!.snapshot_id.slice( - 8 ) );
		conforme( 'meta', meta );
		expect( snap.versions.model_sha256 ).toBe( meta.versions.model_sha256 );
		expect( [ 'synthetique', 'reel' ] ).toContain( snap.versions.data_kind ); // jamais « test » sur un Worker réel

	}, LENT );

	it( 'ressources facultatives : conformes quand elles sont publiées', async () => {

		const id = snap.snapshot_id, a = snap.assets;
		const lire = async <T, >( lien: string | null, f: () => Promise<T>, schema: string ) => { if ( lien ) conforme( schema, await f() ); };
		await lire<Quality>( a.quality, () => api.quality( id ), 'quality' );
		await lire<Alerts>( a.alerts, () => api.alerts( id ), 'alerts' );
		await lire<Stations>( a.stations, () => api.stations( id ), 'stations' );
		await lire<WindFarm>( a.wind_farm, () => api.windFarm( id ), 'wind-farm' );
		await lire<DataQuality>( a.data_quality, () => api.dataQuality( id ), 'data-quality' );

	}, LENT );

	it( 'champs : un niveau = nx·ny valeurs, NaN ⇔ z − relief < min_agl_m (niveau entier)', async () => {

		const { nx, ny, levels_asl_m: L, min_agl_m } = meta.grid;
		const terrain = await api.terrain( meta.terrain.href );
		expect( terrain.length ).toBe( nx * ny );
		const k = L.findIndex( ( z ) => z >= 300 );
		const speed = await api.field( snap.snapshot_id, k, 'speed' );
		expect( speed.length ).toBe( nx * ny );
		let ecarts = 0, valides = 0;
		for ( let c = 0; c < speed.length; c ++ ) {

			const absent = Number.isNaN( speed[ c ] ), attendu = L[ k ] - terrain[ c ] < min_agl_m;
			if ( absent !== attendu ) ecarts ++;
			if ( ! absent ) { valides ++; expect( speed[ c ] ).toBeGreaterThanOrEqual( 0 ); }

		}
		expect( ecarts ).toBe( 0 );
		expect( valides / speed.length ).toBeCloseTo( meta.grid.valid_fraction_by_level[ k ], 3 );

	}, LENT );

	it( 'variable non publiée (absente de meta.fields) : refusée par le Worker, jamais inventée', async () => {

		const absentes = ( [ 'sigma_speed', 'coverage', 'reliability', 'status' ] as const ).filter( ( v ) => ! meta.fields.includes( v ) );
		for ( const v of absentes ) {

			const e = await api.field( snap.snapshot_id, 0, v ).then( () => null, ( x ) => x );
			expect( e, v ).toBeInstanceOf( ApiError );
			const cache = new CacheChamps( api );
			await expect( chargerCartes( cache, { snapshot: snap, meta, terrain: new Float32Array( meta.grid.nx * meta.grid.ny ) }, v, [ 100 ] ) ).rejects.toBeInstanceOf( ApiError );

		}
		if ( absentes.length ) expect( renderToStaticMarkup( <VariableNonPubliee libelle="Écart-type σ de la vitesse" methode="aucune" /> ) ).toContain( 'non disponible' );

	}, LENT );

	it( 'cartes au-dessus du sol : la carte à la hauteur du moyeu retrouve hub_wind_* publié (D10)', async () => {

		const base = await chargerBase( api, snap );
		const h = snap.kpi.hub_height_agl_m;
		const [ carte ] = await chargerCartes( new CacheChamps( api ), base, 'speed', [ h ] );
		// hub_wind_* est publié arrondi au centième : même règle (interpolation par colonne, D6/D10) à l'arrondi près.
		if ( snap.kpi.hub_wind_mean_ms != null ) expect( Math.abs( carte.resume.moyenne! - snap.kpi.hub_wind_mean_ms ) ).toBeLessThanOrEqual( 0.0051 );
		if ( snap.kpi.hub_wind_max_ms != null ) expect( Math.abs( carte.resume.max! - snap.kpi.hub_wind_max_ms ) ).toBeLessThanOrEqual( 0.0051 );
		// Au-dessus du sommet du modèle partout dès que le relief dépasse 0 m : jamais une valeur inventée.
		const sommet = meta.grid.levels_asl_m.at( - 1 )!;
		const [ haut ] = await chargerCartes( new CacheChamps( api ), base, 'speed', [ sommet ] );
		const enc = encadrer( base.terrain, meta.grid.levels_asl_m, sommet, meta.grid.min_agl_m );
		if ( base.terrain.reduce( ( m, z ) => Math.min( m, z ), Infinity ) > 0 ) {

			expect( enc.niveaux ).toHaveLength( 0 );
			expect( haut.resume.disponibles ).toBe( 0 );
			expect( haut.resume.max ).toBeNull();

		}

		// Export CSV de la carte affichée : une ligne par nœud avec une valeur, identification sur chaque ligne.
		const csv = csvCarte( identite( snap ), meta, { variable: 'speed', unite: 'm/s', surface: { mode: 'sol', h }, valeurs: carte.valeurs, terrain: base.terrain } );
		const lignes = csv.trimEnd().split( '\r\n' );
		expect( lignes.length - 1 ).toBe( carte.resume.disponibles );
		expect( lignes[ 1 ].startsWith( `${ snap.snapshot_id },${ snap.valid_time.replace( '.000Z', 'Z' ) },${ snap.versions.data_kind },` ) ).toBe( true );

	}, LENT );

	it( 'pages : ce qui n’est pas calculé s’affiche « non disponible » (alertes, parc, classes de fiabilité)', async () => {

		const id = snap.snapshot_id;
		if ( snap.assets.alerts ) {

			const alerts = await api.alerts( id );
			const html = renderToStaticMarkup( <AlertesPage alerts={ alerts } decompte={ snap.kpi.open_alerts } /> );
			if ( ! alerts.items.length && snap.kpi.open_alerts == null ) {

				expect( html ).toContain( 'data-testid="alerts-not-computed"' );
				expect( html ).not.toContain( 'Aucune alerte ouverte' );

			}

		}
		if ( snap.assets.wind_farm ) {

			const wf = await api.windFarm( id );
			const html = renderToStaticMarkup( <EolienPage data={ { windFarm: wf, windroses: [] } } /> );
			if ( ! wf.turbines.length ) {

				expect( html ).toContain( 'data-testid="farm-empty"' );
				expect( texte( html ) ).not.toMatch( /\b0 kW\b/ );

			}

		}
		if ( snap.assets.quality ) {

			const q = await api.quality( id );
			const html = renderToStaticMarkup( <Repartition q={ q } /> );
			if ( q.by_level.every( ( l ) => l.share_elevee == null && l.share_moyenne == null && l.share_faible == null ) ) expect( html ).toContain( 'repartition-non-disponible' );

		}

	}, LENT );

	it( 'profil au clic sur une vraie colonne, et son export CSV', async () => {

		const { nx, ny, nz } = { ...meta.grid, nz: meta.grid.levels_asl_m.length };
		const col = await api.column( snap.snapshot_id, Math.floor( nx / 2 ), Math.floor( ny / 2 ) );
		conforme( 'column', col );
		const p = profilDepuisColonne( col );
		expect( p.levels ).toHaveLength( nz );
		for ( const l of p.levels ) if ( ! meta.fields.includes( 'sigma_speed' ) ) expect( l.speed_interval.p10 ).toBeNull();
		const csv = csvProfil( identite( snap ), meta, p );
		expect( csv.trimEnd().split( '\r\n' ) ).toHaveLength( nz + 1 );

	}, LENT );

	it( 'comparaison de deux instants publiés : différence seulement sur les nœuds communs', async () => {

		const { items } = await chargerInstants( api );
		if ( items.length < 2 ) return;
		const a = items[ items.length - 2 ].snapshot_id, b = items[ items.length - 1 ].snapshot_id;
		const c = await chargerComparaison( api, a, b, 100, undefined, new CacheChamps( api ), new CacheChamps( api ) );
		expect( c.stats.communs ).toBeGreaterThan( 0 );
		let communs = 0;
		for ( let k = 0; k < c.diff.length; k ++ ) {

			const absent = Number.isNaN( c.a.carte.valeurs[ k ] ) || Number.isNaN( c.b.carte.valeurs[ k ] );
			expect( Number.isNaN( c.diff[ k ] ) ).toBe( absent );
			if ( ! absent ) communs ++;

		}
		expect( communs ).toBe( c.stats.communs );
		const csv = csvComparaison( identite( c.a.base.snapshot ), identite( c.b.base.snapshot ), c.a.base.meta, 100, c.a.carte.valeurs, c.b.carte.valeurs, c.a.base.terrain );
		expect( csv.trimEnd().split( '\r\n' ).length - 1 ).toBe( communs );

	}, LENT );

} );

describe( 'branchement réel : sonde', () => {

	it( latest ? `Worker joignable : ${ BASE }` : `Worker injoignable (${ BASE }) : suite réelle sautée`, () => {

		expect( true ).toBe( true );

	} );

} );
