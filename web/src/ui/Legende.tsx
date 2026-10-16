// Légende chiffrée de la coloration de la scène (V3D7) : dégradé, graduations en valeurs réelles,
// classes de fiabilité aux seuils du contrat, couleur neutre « non disponible ».

import { degradeCss, graduations, LIBELLE_COLORATION, NEUTRE, rgbCss, type Coloration, type Echelle } from '../domain/palettes';
import { SEUIL_ELEVEE, SEUIL_MOYENNE } from '../domain/fiabilite';

const nombre = ( v: number, d: number ) => v.toLocaleString( 'fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d } );

export function Legende( { coloration, echelle, absente }: { coloration: Coloration; echelle: Echelle | null; absente?: string | null } ) {

	const lib = LIBELLE_COLORATION[ coloration ];
	const g = echelle ? graduations( echelle ) : [];
	return (
		<div className="legende" data-testid="legende" data-coloration={ coloration }>
			<div className="legende-titre">{ lib.titre }{ lib.unite ? ` (${ lib.unite })` : '' }</div>
			<div className="legende-barre" style={ { background: degradeCss( echelle, coloration ) } } />
			{ echelle ? (
				<div className="legende-graduations num" data-testid="legende-graduations">
					{ g.map( ( x, k ) => (
						<span key={ k } style={ { left: `${ x.position * 100 }%` } } data-valeur={ x.valeur }>{ nombre( x.valeur, lib.decimales ) }</span>
					) ) }
				</div>
			) : <div className="legende-echelle num" data-testid="legende-nd">{ absente ?? 'non disponible' }</div> }
			{ coloration === 'fiabilite' && (
				<div className="legende-classes">
					<span>faible &lt; { nombre( SEUIL_MOYENNE, 2 ) }</span>
					<span>moyenne</span>
					<span>élevée ≥ { nombre( SEUIL_ELEVEE, 2 ) }</span>
				</div>
			) }
			<div className="legende-nd"><i style={ { background: rgbCss( NEUTRE ) } } /> non disponible</div>
		</div>
	);

}
