// Crochet de test exposé sur `window.__atom` (tests E2E Playwright, lot F5).
//
//   ready              : résolue quand la PREMIÈRE scène avec un champ est rendue ;
//   scene              : la scène courante (Viz) ou null si la page 3D n'est pas montée ;
//   setAltitude(m)     : choisit le niveau le plus proche de m (m au-dessus de la mer),
//                        résout quand le champ de ce niveau est rendu ;
//   pick(x, y)         : picking à (x, y) en px RELATIFS au coin haut-gauche du canevas,
//                        résout avec { ix, iy, fx, fy, x_m, y_m } ou null hors domaine.
//
// L'interface est stable : la scène s'y enregistre via `brancherScene`.

import type { PickResult, Viz } from './viz';

export interface AtomPick extends PickResult {
	/** Position en mètres depuis le coin sud-ouest du domaine. */
	x_m: number;
	y_m: number;
}

export interface AtomHook {
	ready: Promise<void>;
	readonly scene: Viz | null;
	setAltitude( m: number ): Promise<void>;
	pick( x: number, y: number ): Promise<unknown>;
}

declare global {
	interface Window { __atom: AtomHook }
}

/** Ce qu'une page 3D montée fournit au crochet. */
export interface ControleurScene {
	viz: Viz;
	setAltitude( m: number ): Promise<void>;
	pick( x: number, y: number ): Promise<AtomPick | null>;
}

let courant: ControleurScene | null = null;
let resoudreReady!: () => void;
const ready = new Promise<void>( ( r ) => { resoudreReady = r; } );

function controleur(): ControleurScene {

	if ( ! courant ) throw new Error( 'scène non montée : ouvrir la page « Exploration 3D »' );
	return courant;

}

export function installerCrochet(): AtomHook {

	const hook: AtomHook = {
		ready,
		get scene() { return courant?.viz ?? null; },
		setAltitude: async ( m ) => controleur().setAltitude( m ),
		pick: async ( x, y ) => controleur().pick( x, y ),
	};
	if ( typeof window !== 'undefined' ) window.__atom = hook;
	return hook;

}

/** Enregistre la scène montée ; renvoie la fonction de désenregistrement. */
export function brancherScene( c: ControleurScene ): () => void {

	courant = c;
	return () => { if ( courant === c ) courant = null; };

}

/** À appeler quand une scène avec champ vient d'être rendue (idempotent). */
export function signalerPremierRendu() { resoudreReady(); }
