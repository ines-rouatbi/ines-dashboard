// Comparaison « avant / après » (UI v2) : les cartes A et B superposées, à la même échelle de couleur ; un curseur
// (glisser la poignée, ou flèches du clavier) découvre B par-dessus A. Ce sont les deux cartes publiées telles
// quelles : aucune valeur intermédiaire n'est calculée.

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { rasteriser, type Echelle, type Grille } from '../f3/Carte';
import { num } from '../shared/format';

/** Position du curseur (0..100 %) bornée. */
export const bornerPourcent = ( x: number ) => Math.min( 100, Math.max( 0, Number.isFinite( x ) ? x : 50 ) );

function Raster( { valeurs, grille, echelle, className }: { valeurs: Float32Array; grille: Grille; echelle: Echelle; className?: string } ) {

	const ref = useRef<HTMLCanvasElement>( null );
	useEffect( () => {

		const c = ref.current, ctx = c?.getContext( '2d' );
		if ( ! c || ! ctx ) return;
		c.width = grille.nx; c.height = grille.ny;
		ctx.putImageData( new ImageData( rasteriser( valeurs, grille.nx, grille.ny, echelle ), grille.nx, grille.ny ), 0, 0 );

	}, [ valeurs, grille.nx, grille.ny, echelle ] );
	return <canvas ref={ ref } className={ className } aria-hidden="true" />;

}

export function AvantApres( { a, b, titreA, titreB, grille, echelle, hauteur }: {
	a: Float32Array; b: Float32Array; titreA: string; titreB: string; grille: Grille; echelle: Echelle; hauteur: number;
} ) {

	const [ x, setX ] = useState( 50 );
	const cadre = useRef<HTMLDivElement>( null );
	const [ glisse, setGlisse ] = useState( false );
	const depuis = ( e: PointerEvent<HTMLDivElement> ) => {

		const r = cadre.current!.getBoundingClientRect();
		setX( bornerPourcent( ( e.clientX - r.left ) / r.width * 100 ) );

	};
	return (
		<figure className="avant-apres f3-carte" data-testid="avant-apres">
			<figcaption><strong>Avant / après à { num( hauteur ) } m au-dessus du sol</strong><span className="muet"> · glisser la poignée : A à gauche, B à droite</span></figcaption>
			<div ref={ cadre } className={ `f3-carte-cadre avant-apres-cadre${ glisse ? ' glisse' : '' }` } style={ { aspectRatio: `${ grille.nx * grille.dx } / ${ grille.ny * grille.dy }` } }
				onPointerDown={ ( e ) => { e.currentTarget.setPointerCapture( e.pointerId ); setGlisse( true ); depuis( e ); } }
				onPointerMove={ ( e ) => { if ( glisse ) depuis( e ); } }
				onPointerUp={ () => setGlisse( false ) } onPointerCancel={ () => setGlisse( false ) }>
				<Raster valeurs={ a } grille={ grille } echelle={ echelle } />
				<div className="avant-apres-b" style={ { clipPath: `inset(0 0 0 ${ x }%)` } }><Raster valeurs={ b } grille={ grille } echelle={ echelle } /></div>
				<span className="avant-apres-etiquette gauche">A · { titreA }</span>
				<span className="avant-apres-etiquette droite">B · { titreB }</span>
				<div className="avant-apres-poignee" style={ { left: `${ x }%` } }>
					<input type="range" min={ 0 } max={ 100 } step={ 1 } value={ Math.round( x ) } onChange={ ( e ) => setX( bornerPourcent( Number( e.target.value ) ) ) }
						aria-label="Part de la carte A visible (glisser vers la droite pour voir plus de A)" data-testid="avant-apres-curseur" />
					<span aria-hidden="true">◀ ▶</span>
				</div>
			</div>
		</figure>
	);

}
