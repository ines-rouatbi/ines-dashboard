// Jauge animée (arc de 270°) d'une part 0..1 publiée (fiabilité, couverture), UI v2.
// null = « non disponible » : arc vide et texte explicite, jamais 0 %. L'arc se remplit à l'apparition (CSS,
// coupé en animations réduites). Un seuil facultatif (objectif) est marqué d'un trait et dit dans le texte.

import type { CSSProperties } from 'react';
import { NA } from '../pages/shared/format';

const R = 42, C = 2 * Math.PI * R, ARC = C * 0.75;

/** Longueur d'arc visible (0..ARC) d'une part ; null si inconnue. */
export function longueurArc( x: number | null | undefined ): number | null {

	if ( x == null || ! Number.isFinite( x ) ) return null;
	return ARC * Math.min( 1, Math.max( 0, x ) );

}

export function Jauge( { valeur, libelle, seuil, testid, detail }: { valeur: number | null | undefined; libelle: string; seuil?: number; testid: string; detail?: string } ) {

	const l = longueurArc( valeur );
	const texte = l == null ? NA : `${ ( valeur! * 100 ).toLocaleString( 'fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 } ) } %`;
	const atteint = seuil != null && valeur != null && valeur >= seuil;
	const angleSeuil = seuil != null ? 135 + 270 * seuil : null;
	return (
		<figure className={ `jauge${ l == null ? ' jauge-na' : '' }${ seuil != null ? ( atteint ? ' jauge-ok' : ' jauge-sous' ) : '' }` } data-testid={ testid }>
			<svg viewBox="0 0 100 100" role="img" aria-label={ `${ libelle } : ${ texte }${ seuil != null ? ` (objectif ${ Math.round( seuil * 100 ) } %)` : '' }` }>
				<circle className="jauge-fond" cx="50" cy="50" r={ R } strokeDasharray={ `${ ARC } ${ C }` } transform="rotate(135 50 50)" />
				{ l != null ? (
					<circle className="jauge-arc" cx="50" cy="50" r={ R } strokeDasharray={ `${ ARC } ${ C }` }
						style={ { strokeDashoffset: ARC - l, '--plein': `${ ARC }` } as CSSProperties } transform="rotate(135 50 50)" />
				) : null }
				{ angleSeuil != null ? <line className="jauge-seuil" x1="50" y1="3" x2="50" y2="13" transform={ `rotate(${ angleSeuil + 90 } 50 50)` } /> : null }
				<text x="50" y="52" textAnchor="middle" className="jauge-valeur" data-testid={ `${ testid }-valeur` }>{ texte }</text>
				{ seuil != null ? <text x="50" y="66" textAnchor="middle" className="jauge-objectif">objectif { Math.round( seuil * 100 ) } %</text> : null }
			</svg>
			<figcaption>{ libelle }{ detail ? <span className="muet petit"> · { detail }</span> : null }</figcaption>
		</figure>
	);

}
