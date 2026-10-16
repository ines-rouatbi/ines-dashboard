// Interface de test exposée par la page (implémentée dans F0 par rayen-audit-atom, message 304).
// Hypothèses de mahdi-claude (message 307 du salon), à confirmer :
//   • ready         : résolue après le premier rendu PEINT de la scène ;
//   • setAltitude   : résolue après la frame peinte qui montre le nouveau niveau ;
//   • pick          : résolue après la frame peinte qui montre le retour visuel du clic ;
//   • orbit         : facultatif ; sinon le banc fait tourner la caméra au glisser de souris.
import { expect, type Page } from '@playwright/test';

export interface AtomTestApi {
	ready: Promise<unknown>;
	scene: unknown;
	/** Niveau publié le plus proche de m mètres AU-DESSUS DE LA MER. */
	setAltitude( m: number ): Promise<unknown> | unknown;
	/** Plan à m mètres AU-DESSUS DU SOL (par colonne, relief du modèle ; F2). */
	setHauteurSol?( m: number ): Promise<unknown> | unknown;
	pick( x: number, y: number ): Promise<unknown> | unknown;
	orbit?( deg: number ): Promise<unknown> | unknown;
	/** F2 : réglages de la page (mode, coloration, coupes, couches…), résolue quand la scène les montre. */
	regler?( r: Record<string, unknown> ): Promise<unknown>;
	/** F2 : état observable de la scène (voir web/src/types/atom-hook.d.ts, AtomEtat). */
	etat?(): any;
}

/** Page de la scène 3D (le crochet ne se résout que sur « Exploration 3D »). */
export const SCENE_PATH = process.env.ATOM_SCENE_PATH ?? '/exploration';

declare global {
	interface Window { __atom?: AtomTestApi }
}

/** La page servie est-elle bien le tableau de bord ATOM ? (garde-fou : un autre wrangler dev peut occuper le port). */
export const EXPECT_TITLE = new RegExp( process.env.ATOM_EXPECT_TITLE ?? 'PC-FNO3D|ATOM', 'i' );

export async function assertIsAtom( page: Page ) {

	await expect( page, `la page servie à ${ page.url() } n'est pas le tableau de bord ATOM : vérifier ATOM_URL / le port` )
		.toHaveTitle( EXPECT_TITLE );

}

export const ATOM_ABSENT = 'window.__atom absent (F0 non livré)';

/**
 * ATOM_REQUIRE_API=1 (CI, et dès que F0 est sur main) : l'absence de window.__atom fait ÉCHOUER
 * le test au lieu de le sauter ou de mesurer la visionneuse historique.
 */
export const REQUIRE_API = process.env.ATOM_REQUIRE_API === '1';

export type AtomState = { ok: true } | { ok: false; reason: string };

/**
 * Attend window.__atom puis sa promesse ready. Ne lève jamais : renvoie la raison de l'échec
 * (interface absente, ou ready rejetée avec son message) pour que chaque métrique soit marquée
 * non_mesure avec cette raison, au lieu d'une erreur brute qui fait sauter les tests suivants.
 */
export async function waitForAtom( page: Page, timeoutMs = 15_000 ): Promise<AtomState> {

	const present = await page.waitForFunction( () => !! window.__atom, null, { timeout: timeoutMs } )
		.then( () => true, () => false );
	if ( ! present ) return { ok: false, reason: ATOM_ABSENT };
	const rejected = await page.evaluate( () => Promise.resolve( window.__atom!.ready ).then(
		() => null,
		( e ) => String( e?.message ?? e ),
	) );
	return rejected == null ? { ok: true } : { ok: false, reason: `window.__atom.ready rejetée : ${ rejected }` };

}

/** Avec ATOM_REQUIRE_API=1, une interface absente ou en échec est un échec du test. */
export function requireAtom( state: AtomState ) {

	if ( REQUIRE_API && ! state.ok ) expect( state.ok, `${ state.reason } (ATOM_REQUIRE_API=1)` ).toBe( true );

}

/** Rectangle du canvas de la scène 3D. */
export async function sceneBox( page: Page ) {

	const canvas = page.locator( process.env.ATOM_CANVAS ?? 'canvas#scene, canvas[data-testid="scene"], canvas[data-testid="scene-canvas"]' ).first();
	await expect( canvas ).toBeVisible();
	const box = await canvas.boundingBox();
	if ( ! box ) throw new Error( 'canvas de la scène sans boîte englobante' );
	return box;

}
