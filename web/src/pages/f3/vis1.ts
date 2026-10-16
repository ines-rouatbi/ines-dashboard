// Critère VIS1 (plan, lot F3) : moins de 3 s pour afficher une reconstruction et ses indicateurs.
//
// Mesure « reconstruction + indicateurs affichés » sur la Vue d'ensemble, par performance.mark/measure :
//   - début : origine de navigation si la Vue d'ensemble est la page d'arrivée (chargement complet),
//     sinon le montage de la page (navigation interne) ;
//   - fin : indicateurs clés ET cartes des 4 hauteurs peints (deux requestAnimationFrame après le rendu).
// Exposée aux tests via le crochet window.__atom (propriété `vis1`, ajoutée s'il existe) ; le crochet
// lui-même (web/src/scene/hook.ts) n'est pas modifié.

export const SEUIL_VIS1_MS = 3000;
export const MARQUE_DEBUT = 'atom:vis1:debut';
export const MARQUE_FIN = 'atom:vis1:fin';
export const MESURE = 'atom:vis1';

export interface MesureVis1 {
	/** Durée en ms entre le début et l'affichage. */
	duree_ms: number;
	/** Point de départ : chargement de la page ou montage (navigation interne). */
	depuis: 'navigation' | 'montage';
	snapshot_id: string;
	/** true si duree_ms < SEUIL_VIS1_MS. */
	ok: boolean;
}

export interface CrochetVis1 {
	readonly seuil_ms: number;
	/** Toutes les mesures depuis le chargement (une par affichage de la Vue d'ensemble). */
	readonly mesures: readonly MesureVis1[];
	/** Résolue à la prochaine mesure (ou tout de suite avec la dernière si `derniere` vaut true). */
	attendre( derniere?: boolean ): Promise<MesureVis1>;
}

declare module '../../types/atom-hook' {
	interface AtomHook {
		/** Mesure VIS1 de la Vue d'ensemble (pages F3). */
		vis1?: CrochetVis1;
	}
}

const CHEMIN_ENSEMBLE = '/';
const cheminInitial = typeof location !== 'undefined' ? location.pathname.replace( /\/+$/, '' ) || '/' : null;
// Une navigation interne (popstate, émis aussi par naviguer()) fait partir la mesure du montage.
let navigationInterne = false;
if ( typeof addEventListener === 'function' ) addEventListener( 'popstate', () => { navigationInterne = true; } );
let enCours: { depuis: MesureVis1[ 'depuis' ]; jeton: number } | null = null;
let jetons = 0;
const mesures: MesureVis1[] = [];
let attentes: ( ( m: MesureVis1 ) => void )[] = [];

const crochet: CrochetVis1 = {
	seuil_ms: SEUIL_VIS1_MS,
	get mesures() { return mesures; },
	attendre( derniere = false ) {

		if ( derniere && mesures.length ) return Promise.resolve( mesures[ mesures.length - 1 ] );
		return new Promise( ( ok ) => attentes.push( ok ) );

	},
};

function installer() {

	if ( typeof window === 'undefined' || ! window.__atom ) return;
	if ( window.__atom.vis1 === crochet ) return;
	try { Object.defineProperty( window.__atom, 'vis1', { value: crochet, enumerable: true, configurable: true } ); } catch { /* crochet figé : tant pis */ }

}

/** Au montage de la Vue d'ensemble ; renvoie un jeton à passer à `finVis1`. */
export function debutVis1(): number {

	installer();
	// Le double montage de React (StrictMode) ne change pas le point de départ : rien n'est encore mesuré.
	const depuis = ! mesures.length && ! navigationInterne && cheminInitial === CHEMIN_ENSEMBLE ? 'navigation' : 'montage';
	const jeton = ++ jetons;
	enCours = { depuis, jeton };
	if ( typeof performance !== 'undefined' ) {

		performance.clearMarks( MARQUE_DEBUT );
		performance.mark( MARQUE_DEBUT, depuis === 'navigation' ? { startTime: 0 } : undefined );

	}
	return jeton;

}

/** Quand les indicateurs et les cartes sont rendus : mesure après la peinture (double rAF). */
export function finVis1( jeton: number, snapshotId: string, apres: ( m: MesureVis1 ) => void = () => {} ) {

	if ( ! enCours || enCours.jeton !== jeton ) return;
	const { depuis } = enCours;
	enCours = null;
	const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : ( f: () => void ) => setTimeout( f, 0 );
	raf( () => raf( () => {

		performance.mark( MARQUE_FIN );
		const m = performance.measure( MESURE, MARQUE_DEBUT, MARQUE_FIN );
		const mesure: MesureVis1 = { duree_ms: Math.round( m.duration ), depuis, snapshot_id: snapshotId, ok: m.duration < SEUIL_VIS1_MS };
		mesures.push( mesure );
		installer();
		const a = attentes; attentes = [];
		a.forEach( ( f ) => f( mesure ) );
		apres( mesure );

	} ) );

}

/** Abandon (démontage avant la fin) : aucune mesure n'est enregistrée. */
export function annulerVis1( jeton: number ) { if ( enCours?.jeton === jeton ) enCours = null; }
