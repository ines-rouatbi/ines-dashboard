// Implémentation du crochet de test `window.__atom` (interface : types/atom-hook.d.ts).
//
// La page « Exploration 3D » s'y enregistre via `brancherScene`, signale son premier rendu
// (`signalerPremierRendu`) ou un échec de chargement (`signalerEchec`). `ready` est rejetée
// au bout de DELAI_READY_MS si aucune scène n'a été rendue.

import type { AtomHook, AtomPick } from '../types/atom-hook';
import type { Viz } from './viz';

export type { AtomHook, AtomPick };

export const DELAI_READY_MS = 15_000;

/** Ce qu'une page 3D montée fournit au crochet. */
export interface ControleurScene {
	viz: Viz;
	setAltitude( m: number ): Promise<void>;
	pick( x: number, y: number ): Promise<AtomPick | null>;
}

let courant: ControleurScene | null = null;
let regle = false;
let derniereErreur: string | null = null;
let resoudre!: () => void;
let rejeter!: ( e: Error ) => void;
let minuterie: ReturnType<typeof setTimeout> | null = null;

const ready = new Promise<void>( ( ok, ko ) => { resoudre = ok; rejeter = ko; } );
// Évite un « unhandledrejection » si personne n'attend `ready` (usage normal hors tests).
ready.catch( () => {} );

function regler( f: () => void ) {

	if ( regle ) return;
	regle = true;
	if ( minuterie ) clearTimeout( minuterie );
	f();

}

function controleur(): ControleurScene {

	if ( ! courant ) throw new Error( 'scène non montée : ouvrir la page « Exploration 3D » (/exploration)' );
	return courant;

}

export function installerCrochet( delaiMs = DELAI_READY_MS ): AtomHook {

	minuterie = setTimeout( () => regler( () => rejeter( new Error(
		`window.__atom.ready : aucune scène rendue en ${ Math.round( delaiMs / 1000 ) } s`
		+ ( derniereErreur ? ` (dernière erreur : ${ derniereErreur })` : courant ? ' (données toujours en chargement)' : ' (page « Exploration 3D » non ouverte)' ),
	) ) ), delaiMs );

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
export function signalerPremierRendu() { regler( resoudre ); }

/**
 * Échec de chargement d'une donnée. `definitif` : la scène ne pourra pas s'afficher
 * (ressource indispensable absente ou invalide) → `ready` est rejetée tout de suite.
 */
export function signalerEchec( message: string, definitif: boolean ) {

	derniereErreur = message;
	if ( definitif ) regler( () => rejeter( new Error( `window.__atom.ready : ${ message }` ) ) );

}
