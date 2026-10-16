// Squelettes de chargement animés (shimmer) : la forme de ce qui arrive, au lieu d'un texte « chargement… ».
// Chaque squelette garde un texte pour les lecteurs d'écran (role="status", classe sr-only) ; en mouvement réduit le
// reflet s'arrête (theme.css).

import type { CSSProperties, ReactNode } from 'react';

export function Squelette( { className = '', style }: { className?: string; style?: CSSProperties } ) {

	return <span className={ `squelette ${ className }` } style={ style } aria-hidden="true" />;

}

/** Bloc en attente avec son texte accessible. */
export function EnAttente( { texte = 'chargement…', children, testid }: { texte?: string; children: ReactNode; testid?: string } ) {

	return (
		<div className="squelette-groupe" role="status" aria-busy="true" data-testid={ testid }>
			<span className="sr-only">{ texte }</span>
			{ children }
		</div>
	);

}

/** Quelques lignes de texte. */
export function SqueletteLignes( { n = 3, texte }: { n?: number; texte?: string } ) {

	return (
		<EnAttente texte={ texte }>
			{ Array.from( { length: n }, ( _, k ) => <Squelette key={ k } className="squelette-ligne" style={ { width: `${ 92 - ( k * 17 ) % 40 }%` } } /> ) }
		</EnAttente>
	);

}

/** Carte (raster) en attente, au rapport du domaine si connu. */
export function SqueletteCarte( { texte, ratio }: { texte?: string; ratio?: string } ) {

	return (
		<EnAttente texte={ texte }>
			<Squelette className="squelette-ligne" style={ { width: '40%' } } />
			<Squelette className="squelette-carte" style={ ratio ? { aspectRatio: ratio } : undefined } />
		</EnAttente>
	);

}

/** Graphique en attente. */
export function SqueletteBloc( { texte, hauteur = 240 }: { texte?: string; hauteur?: number } ) {

	return <EnAttente texte={ texte }><Squelette className="squelette-bloc" style={ { height: hauteur } } /></EnAttente>;

}

/** Page entière en attente (chargement du code de la page ou de son instantané). */
export function SquelettePage( { texte = 'chargement de la page…', testid }: { texte?: string; testid?: string } ) {

	return (
		<div className="squelette-page" role="status" aria-busy="true" data-testid={ testid }>
			<span className="sr-only">{ texte }</span>
			<Squelette className="squelette-titre" />
			<Squelette className="squelette-ligne" style={ { width: '45%' } } />
			<div className="squelette-kpis">{ Array.from( { length: 6 }, ( _, k ) => <Squelette key={ k } className="squelette-kpi" /> ) }</div>
			<Squelette className="squelette-bloc" />
		</div>
	);

}
