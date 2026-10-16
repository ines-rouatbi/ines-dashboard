// Préférences d'affichage : thème clair / sombre et animations réduites.
//
// Thème : choix de l'utilisatrice (mémorisé dans le navigateur) ou, à défaut, `prefers-color-scheme`. Il est posé
// sur <html data-theme="light|dark"> (les couleurs sont des variables CSS de theme.css) ; un script de index.html le
// pose avant le premier rendu pour éviter un éclair du mauvais thème.
// Animations : `prefers-reduced-motion: reduce` OU le choix « réduire les animations » de la palette de commandes ;
// posé sur <html data-motion="reduit"> et lu par les canevas animés, la scène 3D, les compteurs et les graphiques.
// Le stockage local peut être indisponible (navigation privée, aperçu) : tout est protégé et a une valeur par défaut.

import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
export type ChoixMouvement = 'systeme' | 'reduit';

const CLE_THEME = 'atom:theme';
const CLE_MOUVEMENT = 'atom:mouvement';

/** Thème effectif : le choix mémorisé s'il est valide, sinon la préférence du système. */
export function themeResolu( stocke: string | null, systemeSombre: boolean ): Theme {

	if ( stocke === 'light' || stocke === 'dark' ) return stocke;
	return systemeSombre ? 'dark' : 'light';

}

/** Animations réduites : préférence du système OU choix explicite dans l'interface. */
export function mouvementResolu( stocke: string | null, systemeReduit: boolean ): boolean {

	return systemeReduit || stocke === 'reduit';

}

function lire( cle: string ): string | null {

	try { return typeof localStorage === 'undefined' ? null : localStorage.getItem( cle ); } catch { return null; }

}

function ecrire( cle: string, v: string | null ) {

	try { if ( v == null ) localStorage.removeItem( cle ); else localStorage.setItem( cle, v ); } catch { /* stockage indisponible */ }

}

const media = ( q: string ): MediaQueryList | null => ( typeof matchMedia === 'function' ? matchMedia( q ) : null );
const mqSombre = media( '(prefers-color-scheme: dark)' );
const mqReduit = media( '(prefers-reduced-motion: reduce)' );

interface Etat { theme: Theme; reduit: boolean; choixMouvement: ChoixMouvement }

function calculer(): Etat {

	const m = lire( CLE_MOUVEMENT ) === 'reduit' ? 'reduit' : 'systeme';
	return { theme: themeResolu( lire( CLE_THEME ), mqSombre?.matches ?? false ), reduit: mouvementResolu( m, mqReduit?.matches ?? false ), choixMouvement: m };

}

let etat: Etat = calculer();
const abonnes = new Set<() => void>();

function appliquer() {

	if ( typeof document === 'undefined' ) return;
	const r = document.documentElement;
	r.dataset.theme = etat.theme;
	if ( etat.reduit ) r.dataset.motion = 'reduit'; else delete r.dataset.motion;
	r.style.colorScheme = etat.theme;

}

function rafraichir() {

	const n = calculer();
	if ( n.theme === etat.theme && n.reduit === etat.reduit && n.choixMouvement === etat.choixMouvement ) return;
	etat = n;
	appliquer();
	abonnes.forEach( ( f ) => f() );

}

appliquer();
mqSombre?.addEventListener?.( 'change', rafraichir );
mqReduit?.addEventListener?.( 'change', rafraichir );
if ( typeof addEventListener === 'function' ) addEventListener( 'storage', rafraichir );

function abonner( f: () => void ) { abonnes.add( f ); return () => { abonnes.delete( f ); }; }

/** Animations réduites (lecture immédiate, hors React : canevas, scène 3D). */
export function mouvementReduit(): boolean { return etat.reduit; }

export function themeCourant(): Theme { return etat.theme; }

/** Abonnement hors React (canevas, scène) aux changements de préférences. */
export const surPreferences = abonner;

export function useTheme(): Theme { return useSyncExternalStore( abonner, () => etat.theme, () => 'light' ); }

export function useMouvementReduit(): boolean { return useSyncExternalStore( abonner, () => etat.reduit, () => false ); }

export function useChoixMouvement(): ChoixMouvement { return useSyncExternalStore( abonner, () => etat.choixMouvement, () => 'systeme' ); }

type DocumentVT = Document & { startViewTransition?: ( f: () => void ) => { ready: Promise<void> } };

/**
 * Change de thème. Avec l'API View Transitions (Chromium) et sans animations réduites : révélation circulaire depuis
 * `origine` (le bouton) ; sinon fondu court des couleurs (classe `theme-transition`) ou changement immédiat.
 */
export function choisirTheme( t: Theme, origine?: { x: number; y: number } ) {

	const faire = () => { ecrire( CLE_THEME, t ); rafraichir(); };
	if ( typeof document === 'undefined' || etat.reduit ) { faire(); return; }
	const d = document as DocumentVT;
	if ( d.startViewTransition && origine ) {

		const x = origine.x, y = origine.y;
		const rayon = Math.hypot( Math.max( x, innerWidth - x ), Math.max( y, innerHeight - y ) );
		const vt = d.startViewTransition( faire );
		vt.ready.then( () => {

			document.documentElement.animate(
				{ clipPath: [ `circle(0px at ${ x }px ${ y }px)`, `circle(${ rayon }px at ${ x }px ${ y }px)` ] },
				{ duration: 520, easing: 'cubic-bezier(.2,.7,.2,1)', pseudoElement: '::view-transition-new(root)' },
			);

		} ).catch( () => {} );
		return;

	}
	const r = document.documentElement;
	r.classList.add( 'theme-transition' );
	faire();
	setTimeout( () => r.classList.remove( 'theme-transition' ), 400 );

}

export function basculerTheme( origine?: { x: number; y: number } ) { choisirTheme( etat.theme === 'dark' ? 'light' : 'dark', origine ); }

/** « Réduire les animations » dans l'interface, en plus de la préférence du système. */
export function choisirMouvement( c: ChoixMouvement ) { ecrire( CLE_MOUVEMENT, c === 'reduit' ? 'reduit' : null ); rafraichir(); }
