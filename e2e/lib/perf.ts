// Banc de mesure réutilisable (F5-b). Toutes les durées sont prises DANS la page, sur l'horloge
// performance.now() du navigateur : la latence du pilotage Playwright n'entre pas dans les chiffres.
import type { Page } from '@playwright/test';
import { sceneBox } from './atom';

/** Percentile par rang le plus proche (méthode déclarée dans le rapport). */
export function percentile( xs: number[], p: number ): number | null {

	if ( ! xs.length ) return null;
	const s = [ ...xs ].sort( ( a, b ) => a - b );
	const rank = Math.ceil( ( p / 100 ) * s.length );
	return s[ Math.min( s.length - 1, Math.max( 0, rank - 1 ) ) ];

}

const round = ( x: number | null, d = 1 ) => x == null ? null : Math.round( x * 10 ** d ) / 10 ** d;

// ─── FPS ────────────────────────────────────────────────────────────────────

export interface FpsResult {
	frames: number;
	durationMs: number;
	fpsMean: number | null;
	/** 5e centile des FPS instantanés = 1000 / 95e centile des durées de frame. */
	fpsP5: number | null;
	frameMsP95: number | null;
	frameMsMax: number | null;
	camera: 'orbit' | 'souris';
}

/** Fait tourner la caméra pendant `durationMs` et enregistre chaque frame (requestAnimationFrame). */
export async function measureFps( page: Page, durationMs = 10_000 ): Promise<FpsResult> {

	await page.evaluate( () => {

		const w = window as any;
		w.__bench = { frames: [] as number[], on: true };
		const loop = ( t: number ) => { if ( ! w.__bench.on ) return; w.__bench.frames.push( t ); requestAnimationFrame( loop ); };
		requestAnimationFrame( loop );

	} );

	const hasOrbit = await page.evaluate( () => typeof window.__atom?.orbit === 'function' );
	const t0 = Date.now();
	if ( hasOrbit ) {

		while ( Date.now() - t0 < durationMs ) await page.evaluate( () => window.__atom!.orbit!( 2 ) );

	} else {

		// Glisser horizontal continu sur le canvas (OrbitControls), aller-retour.
		const box = await sceneBox( page );
		const cx = box.x + box.width / 2, cy = box.y + box.height / 2, amp = Math.min( 300, box.width / 3 );
		await page.mouse.move( cx, cy );
		await page.mouse.down();
		let dir = 1;
		while ( Date.now() - t0 < durationMs ) {

			await page.mouse.move( cx + dir * amp, cy, { steps: 60 } );
			dir = - dir;

		}

		await page.mouse.up();

	}

	const frames: number[] = await page.evaluate( () => { const b = ( window as any ).__bench; b.on = false; return b.frames; } );
	const dts = frames.slice( 1 ).map( ( t, k ) => t - frames[ k ] );
	const span = frames.length > 1 ? frames[ frames.length - 1 ] - frames[ 0 ] : 0;
	const p95 = percentile( dts, 95 );
	return {
		frames: frames.length,
		durationMs: round( span, 0 )!,
		fpsMean: span ? round( ( frames.length - 1 ) / span * 1000 ) : null,
		fpsP5: p95 ? round( 1000 / p95 ) : null,
		frameMsP95: round( p95 ),
		frameMsMax: round( dts.length ? Math.max( ...dts ) : null ),
		camera: hasOrbit ? 'orbit' : 'souris',
	};

}

// ─── Clic → retour visuel ───────────────────────────────────────────────────

export interface LatencyResult {
	n: number;
	p50: number | null;
	p95: number | null;
	max: number | null;
	samples: number[];
	method: string;
	misses: number;
}

const summarize = ( samples: number[], method: string, misses: number ): LatencyResult => ( {
	n: samples.length,
	p50: round( percentile( samples, 50 ) ),
	p95: round( percentile( samples, 95 ) ),
	max: round( samples.length ? Math.max( ...samples ) : null ),
	samples: samples.map( ( x ) => round( x )! ),
	method, misses,
} );

/**
 * REPLI pour la visionneuse historique seulement (pas de window.__atom.pick) : vrai clic souris,
 * mesuré de l'événement pointerdown (event.timeStamp) à la frame peinte qui suit la première
 * mutation du panneau observé (MutationObserver + double rAF). Limite connue : n'importe quelle
 * mutation du panneau arrête la mesure. Dès que pick existe, le banc utilise measurePick.
 */
export async function measureClickFeedback( page: Page, feedbackSelector: string, n = 20, maxAttempts = 4 * n ): Promise<LatencyResult> {

	const box = await sceneBox( page );
	const samples: number[] = [];
	let misses = 0;
	// Les clics hors du domaine (ciel, socle) ne donnent aucun retour : on continue jusqu'à n retours.
	for ( let k = 0; samples.length < n && k < maxAttempts; k ++ ) {

		// Grille 9 × 9 sur la moitié centrale de la scène, parcourue dans un ordre mélangé (pas de 37).
		const cell = ( k * 37 ) % 81;
		const x = box.x + box.width * ( 0.25 + 0.5 * ( cell % 9 ) / 8 ), y = box.y + box.height * ( 0.25 + 0.5 * Math.floor( cell / 9 ) / 8 );
		const armed = page.evaluate( ( sel ) => new Promise<number | null>( ( resolve ) => {

			const target = document.querySelector( sel );
			if ( ! target ) return resolve( null );
			let t0: number | null = null;
			const onDown = ( e: Event ) => { t0 = e.timeStamp; };
			window.addEventListener( 'pointerdown', onDown, { capture: true, once: true } );
			const mo = new MutationObserver( () => {

				mo.disconnect();
				requestAnimationFrame( () => requestAnimationFrame( () => resolve( t0 == null ? null : performance.now() - t0 ) ) );

			} );
			mo.observe( target, { subtree: true, childList: true, characterData: true, attributes: true } );
			setTimeout( () => { mo.disconnect(); resolve( null ); }, 1_500 );

		} ), feedbackSelector );
		// Laisse le temps au listener d'être posé avant de cliquer.
		await page.evaluate( () => new Promise( ( r ) => requestAnimationFrame( r ) ) );
		await page.mouse.click( x, y );
		const dt = await armed;
		if ( dt == null ) misses ++; else samples.push( dt );

	}

	return summarize( samples, `clic souris → mutation de ${ feedbackSelector } → frame peinte (double rAF)`, misses );

}

/** Variante par l'interface de test : durée de window.__atom.pick(x, y) (résolue après la frame peinte). */
export async function measurePick( page: Page, n = 20, maxAttempts = 4 * n ): Promise<LatencyResult> {

	const box = await sceneBox( page );
	const samples: number[] = [];
	let misses = 0;
	for ( let k = 0; samples.length < n && k < maxAttempts; k ++ ) {

		// Même grille que measureClickFeedback ; pixels CSS relatifs au canvas (contrat de pick, F0).
		const cell = ( k * 37 ) % 81;
		const x = box.width * ( 0.25 + 0.5 * ( cell % 9 ) / 8 ), y = box.height * ( 0.25 + 0.5 * Math.floor( cell / 9 ) / 8 );
		const dt = await page.evaluate( async ( [ px, py ] ) => {

			const t0 = performance.now();
			const hit = await window.__atom!.pick( px, py );
			// Même fin de mesure que measureAltitude : la frame peinte qui suit (double rAF).
			await new Promise( ( r ) => requestAnimationFrame( () => requestAnimationFrame( r ) ) );
			return hit == null ? null : performance.now() - t0;

		}, [ x, y ] );
		if ( dt == null ) misses ++; else samples.push( dt );

	}

	return summarize( samples, 'window.__atom.pick(x, y) + double rAF, pixels CSS relatifs au canvas ; pick nul = hors domaine', misses );

}

// ─── Changement d'altitude ──────────────────────────────────────────────────

export async function measureAltitude( page: Page, levels: number[], rounds = 5 ): Promise<LatencyResult> {

	const samples: number[] = [];
	for ( let r = 0; r < rounds; r ++ ) {

		for ( const m of levels ) {

			samples.push( await page.evaluate( async ( alt ) => {

				const t0 = performance.now();
				await window.__atom!.setAltitude( alt );
				// Si setAltitude ne garantit pas la frame peinte, cette attente la garantit (surcoût ≤ 1 frame).
				await new Promise( ( r ) => requestAnimationFrame( () => requestAnimationFrame( r ) ) );
				return performance.now() - t0;

			}, m ) );

		}

	}

	return summarize( samples, `window.__atom.setAltitude(m) + double rAF, niveaux ${ levels.join( ', ' ) } m, ${ rounds } tours`, 0 );

}

// ─── Premier rendu, mémoire, environnement ──────────────────────────────────

/**
 * À appeler AVANT page.goto : note dans la page l'instant de la frame peinte qui suit
 * window.__atom.ready, sur l'horloge de navigation (0 = début du chargement).
 */
export async function installReadyProbe( page: Page ) {

	await page.addInitScript( () => {

		const w = window as any;
		const poll = () => {

			if ( ! w.__atom ) return void setTimeout( poll, 10 );
			Promise.resolve( w.__atom.ready ).then( () => requestAnimationFrame( () => requestAnimationFrame( () => { w.__atomReadyAt = performance.now(); } ) ) );

		};

		poll();

	} );

}

/** Premier rendu mesuré par installReadyProbe (à lire après waitForAtom). */
export async function measureFirstRender( page: Page ) {

	await page.waitForFunction( () => ( window as any ).__atomReadyAt != null );
	return page.evaluate( () => {

		const nav = performance.getEntriesByType( 'navigation' )[ 0 ] as PerformanceNavigationTiming | undefined;
		return {
			sceneReadyMs: Math.round( ( window as any ).__atomReadyAt ),
			domContentLoadedMs: nav ? Math.round( nav.domContentLoadedEventEnd ) : null,
			loadMs: nav ? Math.round( nav.loadEventEnd ) : null,
		};

	} );

}

export async function jsMemory( page: Page ) {

	return page.evaluate( () => {

		const m = ( performance as any ).memory;
		return m ? { usedMB: Math.round( m.usedJSHeapSize / 1048576 * 10 ) / 10, totalMB: Math.round( m.totalJSHeapSize / 1048576 * 10 ) / 10 } : null;

	} );

}

/** Moteur de rendu WebGL réellement utilisé : SwiftShader = rendu logiciel, FPS non représentatifs. */
export async function gpuInfo( page: Page ) {

	return page.evaluate( () => {

		const gl = document.createElement( 'canvas' ).getContext( 'webgl2' ) ?? document.createElement( 'canvas' ).getContext( 'webgl' );
		if ( ! gl ) return { renderer: null, vendor: null, software: true };
		const ext = gl.getExtension( 'WEBGL_debug_renderer_info' );
		const renderer = ext ? gl.getParameter( ext.UNMASKED_RENDERER_WEBGL ) : gl.getParameter( gl.RENDERER );
		const vendor = ext ? gl.getParameter( ext.UNMASKED_VENDOR_WEBGL ) : gl.getParameter( gl.VENDOR );
		return { renderer, vendor, software: /swiftshader|llvmpipe|software|basic render/i.test( String( renderer ) ) };

	} );

}
