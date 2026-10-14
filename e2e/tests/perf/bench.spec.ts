// Banc de performance (F5-b), projet « headed-gpu » : npm run perf.
// Seuils : V3D10 (≥ 30 FPS au 5e centile), clic → retour visuel p95 < 150 ms,
// changement d'altitude p95 < 500 ms, VIS1 (reconstruction affichée en moins de 3 s).
//
// Avec window.__atom (F0) : toutes les mesures passent par l'interface de test.
// Sans elle : FPS et clic sont mesurés sur la visionneuse historique, en le disant dans le rapport ;
// le reste est non_mesure. ATOM_REQUIRE_API=1 transforme ce cas en échec (CI, et dès F0).
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertIsAtom, waitForAtom, requireAtom, type AtomState } from '../../lib/atom';
import { measureFps, measureClickFeedback, measurePick, measureAltitude, measureFirstRender, installReadyProbe, jsMemory, gpuInfo } from '../../lib/perf';
import { PerfReport } from '../../lib/report';

const REPORTS = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '../../reports' );
const FPS_MS = Number( process.env.ATOM_FPS_MS ?? 10_000 );
const ALTITUDES = ( process.env.ATOM_ALTITUDES ?? '10,100,300,1000' ).split( ',' ).map( Number );
// Visionneuse historique seulement (pas de pick) : panneau observé pour dater le retour visuel.
const LEGACY_FEEDBACK = process.env.ATOM_FEEDBACK ?? '#profile-card';
const LEGACY = 'visionneuse historique, sans window.__atom';

const T = {
	fps: { value: 30, unit: 'FPS', rule: '>=' as const, source: 'V3D10' },
	click: { value: 150, unit: 'ms', rule: '<' as const, source: 'F5 (p95)' },
	altitude: { value: 500, unit: 'ms', rule: '<' as const, source: 'F5 (p95)' },
	firstRender: { value: 3000, unit: 'ms', rule: '<' as const, source: 'VIS1' },
};

test.describe.configure( { mode: 'serial' } );

const report = new PerfReport();

test.afterAll( async () => {

	const { file, verdict } = report.write( REPORTS );
	console.log( `\nRapport de performance : ${ file }\nVerdict : ${ verdict }` );

} );

/** Ouvre la page, vérifie que c'est ATOM, attend l'interface ; échoue si ATOM_REQUIRE_API=1 et qu'elle manque. */
async function open( page: import( '@playwright/test' ).Page ): Promise<AtomState> {

	await installReadyProbe( page );
	await page.goto( '/' );
	await assertIsAtom( page );
	const state = await waitForAtom( page );
	requireAtom( state );
	if ( ! state.ok ) {

		// Pas de signal « prêt » : on laisse 3 s à la visionneuse historique, et on le dit.
		await page.waitForTimeout( 3_000 );
		test.info().annotations.push( { type: 'note', description: `${ state.reason } — ${ LEGACY }, prêt = 3 s fixes` } );

	}

	return state;

}

test( 'environnement et premier rendu', async ( { page, browser } ) => {

	const state = await open( page );
	const gpu = await gpuInfo( page );
	report.env = { ...report.env, browser: `${ browser.browserType().name() } ${ browser.version() }`, gpu, windowAtom: state.ok ? 'présent' : state.reason };
	test.info().annotations.push( { type: 'gpu', description: String( gpu.renderer ) } );

	if ( state.ok ) {

		const fr = await measureFirstRender( page );
		report.measured( 'premier_rendu_ms', fr.sceneReadyMs, T.firstRender, fr );

	} else report.notMeasured( 'premier_rendu_ms', state.reason, T.firstRender );
	report.measured( 'memoire_js_initiale_mo', ( await jsMemory( page ) )?.usedMB ?? null, undefined, 'performance.memory (Chrome)' );
	expect( gpu.software, `rendu WebGL logiciel (${ gpu.renderer }) : FPS non représentatifs` ).toBe( false );

} );

test( 'FPS pendant 10 s de rotation de caméra', async ( { page } ) => {

	const state = await open( page );
	const fps = await measureFps( page, FPS_MS );
	report.measured( 'fps_p5', fps.fpsP5, T.fps, { ...fps, page: state.ok ? 'window.__atom' : LEGACY } );
	report.measured( 'memoire_js_apres_rotation_mo', ( await jsMemory( page ) )?.usedMB ?? null, undefined );
	expect.soft( fps.fpsP5 ?? 0, `FPS au 5e centile (moyenne ${ fps.fpsMean })` ).toBeGreaterThanOrEqual( T.fps.value );

} );

test( 'clic sur la scène → retour visuel (p95)', async ( { page } ) => {

	const state = await open( page );
	let r;
	if ( state.ok ) r = await measurePick( page );
	else if ( await page.locator( LEGACY_FEEDBACK ).count() ) r = await measureClickFeedback( page, LEGACY_FEEDBACK );
	else {

		report.notMeasured( 'clic_retour_p95_ms', `${ state.reason } et aucun panneau ${ LEGACY_FEEDBACK }`, T.click );
		test.skip( true, state.reason );
		return;

	}

	report.measured( 'clic_retour_p95_ms', r.p95, T.click, r, { n: r.n, min: 20 } );
	expect( r.n, `aucun clic n'a produit de retour visuel (${ r.misses } sans effet)` ).toBeGreaterThan( 0 );
	expect.soft( r.p95 ?? Infinity ).toBeLessThan( T.click.value );

} );

test( 'changement d’altitude (p95)', async ( { page } ) => {

	const state = await open( page );
	if ( ! state.ok ) {

		report.notMeasured( 'altitude_p95_ms', state.reason, T.altitude );
		test.skip( true, state.reason );
		return;

	}

	const r = await measureAltitude( page, ALTITUDES );
	report.measured( 'altitude_p95_ms', r.p95, T.altitude, r, { n: r.n, min: 20 } );
	expect.soft( r.p95 ?? Infinity ).toBeLessThan( T.altitude.value );

} );
