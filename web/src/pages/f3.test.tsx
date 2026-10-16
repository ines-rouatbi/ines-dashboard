// Pages F3 (Vue d'ensemble, Fiabilité, Modèle) sur les 3 instantanés de test du contrat, plus un
// instantané dont les blocs facultatifs sont null (B5) : « non disponible », jamais 0 ; simulation
// étiquetée « SIMULATION » ; position « supposée » ; rendu statique (sans navigateur).

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DataQuality, Meta, Quality, Snapshot } from '../data/contract';
import { encadrer, resumer } from '../domain/hauteurSol';
import { NA } from './shared/format';
import { bornesEchelle, rasteriser, Legende, LegendeCapteurs } from './f3/Carte';
import { pourcent, scientifique } from './f3/commun';
import { pointMoyeu, sha8Modele, mapLimite, type Base } from './f3/donnees';
import { Dso, Indicateurs, texteAbsences, texteCarteVide } from './f3/Ensemble';
import { echelleVariable, Methode, Repartition, Simulee } from './f3/Fiabilite';
import { donneesSerie, partPct } from './f3/graphiques';
import { Modele } from './f3/Modele';
import { debutVis1, finVis1, SEUIL_VIS1_MS } from './f3/vis1';

const FICHIERS = import.meta.glob( '../../../contract/fixtures/*/{snapshot,quality,data-quality,stations}.json', { eager: true, import: 'default' } );
const METAS = import.meta.glob( '../../../contract/fixtures/*/models/*/meta.json', { eager: true, import: 'default' } );
const SCENARIOS = [ 'normal', 'capteur_en_derive', 'gpu_eteint' ] as const;
const fixture = <T, >( sc: string, f: string ): T => {

	const v = f === 'meta.json'
		? Object.entries( METAS ).find( ( [ k ] ) => k.startsWith( `../../../contract/fixtures/${ sc }/models/` ) )?.[ 1 ]
		: FICHIERS[ `../../../contract/fixtures/${ sc }/${ f }` ];
	if ( v === undefined ) throw new Error( `fixture absente : ${ sc }/${ f }` );
	return structuredClone( v ) as T;

};
const texte = ( html: string ) => html.replace( /<[^>]+>/g, ' ' ).replace( /&#x27;|&#39;/g, '\'' ).replace( /&amp;/g, '&' ).replace( /&gt;/g, '>' ).replace( /&lt;/g, '<' ).replace( /[  \s]+/g, ' ' );
const fr = ( x: number, d = 0 ) => x.toLocaleString( 'fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d } ).replace( /[  ]/g, ' ' );
/** Contenu de l'élément data-testid (premier niveau de texte). */
const champ = ( html: string, id: string ) => {

	const m = new RegExp( `data-testid="${ id }"[^>]*>(.*?)</(dd|span|p|div)>` ).exec( html );
	return m ? texte( m[ 1 ] ).trim() : null;

};

/** Instantané où tous les blocs facultatifs sont null (lots pas encore livrés, B5). */
function instantaneNull(): Snapshot {

	const s = fixture<Snapshot>( 'normal', 'snapshot.json' );
	s.kpi = { share_high_reliability: null, reconstruction_ms: null, open_alerts: null, hub_wind_mean_ms: null, hub_wind_max_ms: null, hub_height_agl_m: 120 };
	s.physics = null;
	s.stations_summary = null;
	for ( const k of [ 'quality', 'alerts', 'stations', 'wind_farm', 'data_quality', 'profile_template', 'windrose_template' ] as const ) s.assets[ k ] = null;
	return s;

}

const baseDe = ( sc: string, quality: Quality | null ): Base => ( {
	snapshot: fixture( sc, 'snapshot.json' ), meta: fixture( sc, 'meta.json' ), terrain: new Float32Array( 0 ),
	stations: { etat: 'ok', val: fixture( sc, 'stations.json' ) }, alerts: { etat: 'non_publie' },
	quality: quality ? { etat: 'ok', val: quality } : { etat: 'non_publie' },
} );

describe( 'Vue d’ensemble : indicateurs clés (TB1) et DSO (TB5)', () => {

	for ( const sc of SCENARIOS ) {

		it( `${ sc } : indicateurs fidèles à snapshot.kpi`, () => {

			const s = fixture<Snapshot>( sc, 'snapshot.json' );
			const html = renderToStaticMarkup( <Indicateurs snapshot={ s } /> );
			const oa = s.kpi.open_alerts!;
			expect( champ( html, 'kpi-hub-mean-valeur' ) ).toBe( `${ fr( s.kpi.hub_wind_mean_ms!, 1 ) } m/s` );
			expect( champ( html, 'kpi-hub-max-valeur' ) ).toBe( `${ fr( s.kpi.hub_wind_max_ms!, 1 ) } m/s` );
			expect( champ( html, 'kpi-fiabilite-valeur' ) ).toBe( `${ fr( s.kpi.share_high_reliability! * 100, 1 ) } %` );
			expect( champ( html, 'kpi-alertes-valeur' ) ).toBe( fr( oa.critique + oa.important + oa.avertissement + oa.information ) );
			expect( champ( html, 'kpi-capteurs-valeur' ) ).toBe( `${ fr( s.network.sensors_visible ) } / ${ fr( s.network.sensors_total ) }` );
			expect( champ( html, 'kpi-reconstruction-valeur' ) ).toBe( `${ fr( s.kpi.reconstruction_ms! ) } ms` );
			expect( texte( html ) ).toContain( '120 m au-dessus du sol' );

		} );

		it( `${ sc } : DSO de l’instant depuis physics et quality.calibration`, () => {

			const s = fixture<Snapshot>( sc, 'snapshot.json' ), q = fixture<Quality>( sc, 'quality.json' );
			const html = renderToStaticMarkup( <Dso snapshot={ s } base={ baseDe( sc, q ) } /> );
			if ( s.physics ) {

				expect( champ( html, 'dso-masse-ok' ) ).toBe( s.physics.mass_residual_ok ? 'oui (cet instant)' : 'non (cet instant)' );
				expect( champ( html, 'dso-masse' ) ).toBe( `${ scientifique( s.physics.mass_residual_rms ) } / ${ scientifique( s.physics.mass_residual_p95 ) } kg·m⁻³·s⁻¹` );
				expect( champ( html, 'dso-sol' ) ).toBe( `${ fr( s.physics.ground_condition_rms_ms, 3 ) } m/s` );

			} else {

				// gpu_eteint : physics = null → « non disponible », jamais « non » ni 0.
				expect( champ( html, 'dso-masse-ok' ) ).toBe( NA );
				expect( champ( html, 'dso-masse' ) ).toBe( NA );
				expect( champ( html, 'dso-sol' ) ).toBe( NA );
				expect( html ).toContain( 'data-testid="physics-na"' );

			}
			expect( champ( html, 'dso6' ) ).toBe( `atteint (couverture à 80 % : ${ fr( 81, 1 ) } %, corrélation erreur / σ : ${ fr( 0.42, 2 ) })` );

		} );

	}

	it( 'blocs null (B5) : « non disponible » partout, aucun 0 inventé', () => {

		const s = instantaneNull();
		const html = renderToStaticMarkup( <Indicateurs snapshot={ s } /> );
		for ( const id of [ 'kpi-hub-mean', 'kpi-hub-max', 'kpi-fiabilite', 'kpi-alertes', 'kpi-reconstruction' ] ) expect( champ( html, `${ id }-valeur` ), id ).toBe( NA );
		const dso = renderToStaticMarkup( <Dso snapshot={ s } base={ { ...baseDe( 'normal', null ), snapshot: s } } /> );
		expect( champ( dso, 'dso-masse-ok' ) ).toBe( NA );
		expect( champ( dso, 'dso6' ) ).toBe( NA );
		expect( texte( html + dso ) ).not.toMatch( /(^|\s)0(,0)? (m\/s|%|ms)/ );

	} );

	it( 'quality.calibration = null : « non calibré », jamais « non atteint »', () => {

		const q = fixture<Quality>( 'normal', 'quality.json' );
		q.calibration = null;
		const s = fixture<Snapshot>( 'normal', 'snapshot.json' );
		expect( champ( renderToStaticMarkup( <Dso snapshot={ s } base={ baseDe( 'normal', q ) } /> ), 'dso6' ) ).toBe( 'non calibré' );
		expect( champ( renderToStaticMarkup( <Methode q={ q } /> ), 'calibration' ) ).toBe( 'non calibré' );

	} );

} );

describe( 'cartes au-dessus du sol (TB2)', () => {

	it( 'raster nord en haut, absent (NaN) transparent : jamais une couleur de valeur', () => {

		// 2 × 2 : j = 0 au sud. Ligne 0 du raster = j = 1 (nord).
		const px = rasteriser( Float32Array.from( [ 0, NaN, 10, 5 ] ), 2, 2, echelleVariable( 'speed', 10 ) );
		expect( px[ 3 ] ).toBe( 255 ); // (i 0, j 1) = 10, en haut à gauche
		expect( px[ 2 * 4 + 3 ] ).toBe( 255 ); // (i 0, j 0) = 0 : une vraie valeur 0 reste colorée
		expect( px[ 3 * 4 + 3 ] ).toBe( 0 ); // (i 1, j 0) = NaN : transparent
		const st = rasteriser( Float32Array.from( [ 1, 0, NaN, 1 ] ), 2, 2, echelleVariable( 'status', null ) );
		expect( [ st[ 3 ], st[ 7 ], st[ 11 ], st[ 15 ] ] ).toEqual( [ 0, 255, 255, 255 ] );

	} );

	it( 'légende chiffrée avec unité et entrée « absent » ; échelles par variable', () => {

		const e = echelleVariable( 'speed', 11.9 );
		expect( e ).toMatchObject( { kind: 'continue', min: 0, max: 12, unite: 'm/s' } );
		const html = texte( renderToStaticMarkup( <Legende echelle={ e } titre="Vitesse horizontale du vent" /> ) );
		expect( html ).toContain( 'Vitesse horizontale du vent (m/s)' );
		for ( const t of [ 0, 3, 6, 9, 12 ] ) expect( html ).toContain( fr( t, 1 ) );
		expect( html ).toContain( 'absent' );
		expect( echelleVariable( 'coverage', null ) ).toMatchObject( { min: 0, max: 1, unite: '0–1' } );
		expect( echelleVariable( 'reliability', 0.4 ) ).toMatchObject( { min: 0, max: 1 } );
		expect( echelleVariable( 'sigma_speed', 0.78 ) ).toMatchObject( { min: 0, max: 1, unite: 'm/s' } );
		expect( bornesEchelle( null, 2 ) ).toEqual( { min: 0, max: 2 } );

	} );

	it( 'couche capteurs (B4) : en treillis, seuls les capteurs signalés', () => {

		const s = fixture<Snapshot>( 'capteur_en_derive', 'snapshot.json' );
		const st = fixture<{ items: [] }>( 'capteur_en_derive', 'stations.json' ).items;
		const html = texte( renderToStaticMarkup( <LegendeCapteurs reseau={ s.network } stations={ st } /> ) );
		expect( html ).toContain( `Treillis synthétique de ${ fr( 486581 ) } capteurs` );
		expect( html ).toContain( 'seuls les 2 capteurs signalés sont affichés' );
		expect( html ).toContain( 'en dérive' );
		expect( html ).toContain( 'muet' );
		expect( texte( renderToStaticMarkup( <LegendeCapteurs reseau={ s.network } stations={ null } /> ) ) ).toContain( `Capteurs : ${ NA }` );

	} );

	it( 'carte vide : raison explicite (sommet du modèle), décompte des absences', () => {

		const meta = fixture<Meta>( 'normal', 'meta.json' );
		const enc = encadrer( [ 19, 300 ], meta.grid.levels_asl_m, 1000, meta.grid.min_agl_m );
		const r = resumer( enc, Float32Array.from( [ NaN, NaN ] ) );
		expect( texte( texteCarteVide( r, meta ) ) ).toBe( `hors du domaine vertical du modèle partout (sommet à ${ fr( 1000 ) } m au-dessus de la mer)` );
		const enc10 = encadrer( [ 30, 20 ], meta.grid.levels_asl_m, 10, meta.grid.min_agl_m );
		expect( texteAbsences( resumer( enc10, Float32Array.from( [ NaN, 4 ] ) ) ) ).toBe( 'Colonnes absentes : 1 sous le premier nœud valide.' );

	} );

} );

describe( 'série au moyeu (TB4)', () => {

	it( 'null reste un trou (jamais 0)', () => {

		const p1 = pointMoyeu( { snapshot_id: 'a_e44d68da', valid_time: '2025-01-12T12:00:00Z' }, fixture( 'normal', 'snapshot.json' ) );
		const p2 = pointMoyeu( { snapshot_id: 'b_e44d68da', valid_time: '2025-01-12T13:00:00Z' }, instantaneNull() );
		const p3 = pointMoyeu( { snapshot_id: 'c_e44d68da', valid_time: '2025-01-12T14:00:00Z' }, null, 'indisponible' );
		expect( [ p1.moyenne, p1.max ] ).toEqual( [ 10.33, 11.9 ] );
		expect( [ p2.moyenne, p2.max, p3.moyenne, p3.max ] ).toEqual( [ null, null, null, null ] );
		expect( donneesSerie( [ p1, p2, p3 ], 'moyenne' ).map( ( d ) => d[ 1 ] ) ).toEqual( [ 10.33, null, null ] );
		expect( partPct( null ) ).toBeNull();
		expect( partPct( 0.339 ) ).toBe( 33.9 );

	} );

	it( 'mapLimite : ordre conservé, parallélisme borné', async () => {

		let actifs = 0, pic = 0;
		const r = await mapLimite( [ 1, 2, 3, 4, 5, 6, 7 ], 3, async ( x ) => {

			actifs ++; pic = Math.max( pic, actifs );
			await new Promise( ( ok ) => setTimeout( ok, 5 ) );
			actifs --;
			return x * 2;

		} );
		expect( r ).toEqual( [ 2, 4, 6, 8, 10, 12, 14 ] );
		expect( pic ).toBe( 3 );

	} );

} );

describe( 'Fiabilité', () => {

	for ( const sc of SCENARIOS ) {

		it( `${ sc } : méthode, calibration et répartition fidèles à quality.json`, () => {

			const q = fixture<Quality>( sc, 'quality.json' );
			const html = renderToStaticMarkup( <><Methode q={ q } /><Repartition q={ q } /></> );
			expect( champ( html, 'incertitude-calibree' ) ).toBe( 'oui' );
			expect( champ( html, 'calibration-coverage' ) ).toBe( pourcent( q.calibration!.coverage_80 ).replace( /[  ]/g, ' ' ) );
			expect( champ( html, 'calibration-dso6' ) ).toBe( 'atteint' );
			const lignes = html.split( '<tr>' ).slice( 2 );
			expect( lignes ).toHaveLength( q.by_level.length );
			expect( texte( lignes[ 0 ] ) ).toContain( fr( q.by_level[ 0 ].valid_nodes ) );

		} );

	}

	it( 'part de classe null : « non disponible » dans le tableau, pas 0 %', () => {

		const q = fixture<Quality>( 'normal', 'quality.json' );
		q.by_level[ 0 ].share_faible = null;
		const html = texte( renderToStaticMarkup( <Repartition q={ q } /> ) );
		expect( html ).toContain( NA );

	} );

	it( 'panne simulée (TB6) : étiquetée SIMULATION, comparée à sa référence', () => {

		const ref = fixture<Snapshot>( 'normal', 'snapshot.json' );
		const sim = structuredClone( ref );
		sim.snapshot_id = 'test_normal_panne_e44d68da';
		sim.scenario = { kind: 'part_stations', keep_fraction: 0.5, baseline_snapshot_id: ref.snapshot_id };
		sim.network.sensors_visible = 243290;
		const html = renderToStaticMarkup( <Simulee s={ { etat: 'ok', snapshot: sim, baseline: { etat: 'ok', val: ref }, quality: { etat: 'non_publie' } } } /> );
		const t = texte( html );
		expect( t ).toContain( 'SIMULATION — ce n’est pas l’état courant du vent' );
		expect( t ).toContain( 'part des capteurs conservée' );
		expect( t ).toContain( `${ fr( 50, 1 ) } %` );
		expect( t ).toContain( fr( 243290 ) );
		expect( t ).toContain( fr( 486581 ) );

	} );

} );

describe( 'Modèle', () => {

	for ( const sc of SCENARIOS ) {

		it( `${ sc } : versions, grille, géoréférencement supposé, physique, qualité des données`, () => {

			const snapshot = fixture<Snapshot>( sc, 'snapshot.json' ), meta = fixture<Meta>( sc, 'meta.json' );
			const html = renderToStaticMarkup( <Modele d={ {
				snapshot, meta,
				dataQuality: { etat: 'ok', val: fixture<DataQuality>( sc, 'data-quality.json' ) },
				quality: { etat: 'ok', val: fixture<Quality>( sc, 'quality.json' ) },
			} } /> );
			const v = snapshot.versions;
			expect( champ( html, 'version-model' ) ).toBe( v.model );
			expect( champ( html, 'version-sha256' ) ).toBe( v.model_sha256 );
			expect( champ( html, 'version-norm' ) ).toBe( v.norm );
			expect( champ( html, 'version-data' ) ).toBe( v.data );
			expect( champ( html, 'version-data-kind' ) ).toMatch( /^test/ );
			expect( champ( html, 'grille-taille' ) ).toBe( `${ meta.grid.nx } × ${ meta.grid.ny } × ${ meta.grid.nz }` );
			expect( champ( html, 'grille-min-agl' ) ).toBe( `${ fr( 5, 1 ) } m au-dessus du sol` );
			expect( meta.georef.suppose ).toBe( true );
			expect( texte( html ) ).toContain( 'Position supposée' );
			expect( texte( html ) ).toContain( '(supposé)' );
			if ( snapshot.physics ) expect( champ( html, 'physique-rho' ) ).toBe( 'atmosphère standard' );
			else expect( html ).toContain( 'data-testid="physique-na"' );
			const dq = fixture<DataQuality>( sc, 'data-quality.json' );
			expect( champ( html, 'dq-fichiers' ) ).toBe( `${ dq.files.received } reçus, ${ dq.files.accepted } acceptés, ${ dq.files.rejected } rejetés, ${ dq.files.quarantined } en quarantaine` );
			expect( html.split( '<tr>' ).length ).toBeGreaterThan( meta.grid.nz );

		} );

	}

	it( 'data-quality et quality non publiés : « non disponible »', () => {

		const html = texte( renderToStaticMarkup( <Modele d={ {
			snapshot: instantaneNull(), meta: fixture( 'normal', 'meta.json' ),
			dataQuality: { etat: 'non_publie' }, quality: { etat: 'erreur', message: 'indisponible (HTTP 500)' },
		} } /> ) );
		expect( html ).toContain( `Qualité des données : ${ NA }` );
		expect( html ).toContain( 'Incertitude : indisponible (HTTP 500)' );
		expect( html ).toContain( `Contrôles physiques : ${ NA }` );

	} );

	it( 'sha8 du modèle = suffixe de snapshot_id (D1)', () => {

		expect( sha8Modele( 'test_normal_e44d68da' ) ).toBe( 'e44d68da' );
		expect( () => sha8Modele( 'sans_sha' ) ).toThrow();

	} );

} );

describe( 'VIS1', () => {

	it( 'mesure performance.measure entre le début et l’affichage, comparée au seuil de 3 s', async () => {

		const j = debutVis1();
		const m = await new Promise<{ duree_ms: number; ok: boolean; snapshot_id: string }>( ( ok ) => finVis1( j, 'test_normal_e44d68da', ok ) );
		expect( m.snapshot_id ).toBe( 'test_normal_e44d68da' );
		expect( m.duree_ms ).toBeGreaterThanOrEqual( 0 );
		expect( m.ok ).toBe( m.duree_ms < SEUIL_VIS1_MS );
		expect( performance.getEntriesByName( 'atom:vis1', 'measure' ).length ).toBeGreaterThan( 0 );

	} );

} );
