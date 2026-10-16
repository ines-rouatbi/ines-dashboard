// Compteur animé (count-up) et mini-graphique (sparkline) des indicateurs clés, UI v2.
//
// Compteur : l'élément porteur du data-testid contient TOUJOURS la valeur publiée finale (lecteurs d'écran, tests,
// copier-coller) ; pendant l'animation il est rendu transparent et un calque aria-hidden affiche le décompte, puis
// disparaît. Valeur inconnue (null) : « non disponible », jamais animée, jamais 0. Animations réduites : rien ne bouge.
// Sparkline : une valeur null est un TROU dans la courbe (jamais 0) ; tracé dessiné à l'apparition.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { NA } from '../pages/shared/format';
import { mouvementReduit } from './preferences';

/** Courbe d'animation du compteur (départ rapide, arrivée douce). */
export const sortieCubique = ( t: number ) => 1 - ( 1 - Math.min( 1, Math.max( 0, t ) ) ) ** 3;

/** Valeur affichée du compteur au temps t (0..1) entre `de` et `a`. */
export function valeurCompteur( de: number, a: number, t: number ): number { return de + ( a - de ) * sortieCubique( t ); }

const DUREE_MS = 900;

export function Compteur( { valeur, format, className, testid }: { valeur: number | null; format: ( x: number ) => string; className?: string; testid?: string } ) {

	const final = valeur == null || ! Number.isFinite( valeur ) ? NA : format( valeur );
	const [ visuel, setVisuel ] = useState<string | null>( null );
	const precedent = useRef<number | null>( null );

	useEffect( () => {

		const de = precedent.current ?? 0;
		precedent.current = valeur;
		if ( valeur == null || ! Number.isFinite( valeur ) || mouvementReduit() || de === valeur ) { setVisuel( null ); return; }
		let raf = 0;
		const t0 = performance.now();
		const pas = () => {

			const t = ( performance.now() - t0 ) / DUREE_MS;
			if ( t >= 1 ) { setVisuel( null ); return; }
			setVisuel( format( valeurCompteur( de, valeur, t ) ) );
			raf = requestAnimationFrame( pas );

		};
		raf = requestAnimationFrame( pas );
		// Garde-fou : sans image (onglet caché), la valeur finale réapparaît quand même.
		const fin = setTimeout( () => { cancelAnimationFrame( raf ); setVisuel( null ); }, DUREE_MS + 150 );
		return () => { cancelAnimationFrame( raf ); clearTimeout( fin ); };

	}, [ valeur ] ); // eslint-disable-line react-hooks/exhaustive-deps

	return (
		<span className={ `compteur${ visuel != null ? ' anime' : '' }` }>
			<span className={ className } data-testid={ testid }>{ final }</span>
			{ visuel != null ? <span className={ `compteur-visuel ${ className ?? '' }` } aria-hidden="true">{ visuel }</span> : null }
		</span>
	);

}

/**
 * Segments d'une sparkline dans un cadre l × h : un segment par suite de valeurs connues (null coupe la courbe).
 * Échelle verticale min..max des valeurs connues (plate au milieu si elles sont toutes égales).
 */
export function segmentsSparkline( valeurs: ( number | null )[], l = 100, h = 30, marge = 3 ): { x: number; y: number }[][] {

	const connues = valeurs.filter( ( v ): v is number => v != null && Number.isFinite( v ) );
	if ( ! connues.length ) return [];
	const lo = Math.min( ...connues ), hi = Math.max( ...connues );
	const x = ( k: number ) => ( valeurs.length > 1 ? k / ( valeurs.length - 1 ) : 0.5 ) * l;
	const y = ( v: number ) => ( hi > lo ? marge + ( 1 - ( v - lo ) / ( hi - lo ) ) * ( h - 2 * marge ) : h / 2 );
	const out: { x: number; y: number }[][] = [];
	let cour: { x: number; y: number }[] = [];
	valeurs.forEach( ( v, k ) => {

		if ( v == null || ! Number.isFinite( v ) ) { if ( cour.length ) out.push( cour ); cour = []; return; }
		cour.push( { x: x( k ), y: y( v ) } );

	} );
	if ( cour.length ) out.push( cour );
	return out;

}

export function Sparkline( { valeurs, titre }: { valeurs: ( number | null )[]; titre: string } ) {

	const segs = segmentsSparkline( valeurs );
	if ( ! segs.length || valeurs.length < 2 ) return null;
	const dernier = valeurs[ valeurs.length - 1 ] != null ? segs[ segs.length - 1 ][ segs[ segs.length - 1 ].length - 1 ] : null;
	return (
		<svg className="sparkline dessine" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={ titre } style={ { '--long': 100 } as CSSProperties }>
			{ segs.map( ( s, k ) => s.length > 1 ? (
				<g key={ k }>
					<path className="aire" d={ `M${ s[ 0 ].x },30 ${ s.map( ( p ) => `L${ p.x },${ p.y }` ).join( ' ' ) } L${ s[ s.length - 1 ].x },30 Z` } />
					<path className="trace" pathLength={ 100 } vectorEffect="non-scaling-stroke" d={ `M${ s.map( ( p ) => `${ p.x },${ p.y }` ).join( ' L' ) }` } />
				</g>
			) : <circle key={ k } className="dernier" cx={ s[ 0 ].x } cy={ s[ 0 ].y } r="1.6" /> ) }
			{ dernier ? <circle className="dernier" cx={ dernier.x } cy={ dernier.y } r="2.2" vectorEffect="non-scaling-stroke" /> : null }
		</svg>
	);

}
