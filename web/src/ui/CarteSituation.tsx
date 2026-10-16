// Carte de situation (V3D1, cahier §17.1) : estompage de la Tunisie (web/public/geo, tools/geo/build-tunisia.mjs),
// emprise du domaine calculée depuis la grille et le georef de /v1/meta (geo/tunisia.ts, jamais codée en dur),
// nord, échelle, et « position supposée » tant que georef.suppose vaut true.
//
// Seuls les fichiers légers sont lus (métadonnées, villes, image) : le relief national (1,3 Mo) n'est
// qu'un fond de carte et ne sert jamais au calcul de la hauteur au-dessus du sol (D6).

import { useEffect, useState } from 'react';
import { domainCorners, latLonToPixel, pixelsToKm, type TunisiaMeta, type Ville } from '../geo/tunisia';
import type { Meta } from '../data/contract';

let fond: Promise<{ meta: TunisiaMeta; villes: Ville[] }> | null = null;

function chargerFond() {

	if ( ! fond ) {

		const json = async <T, >( u: string ) => { const r = await fetch( u ); if ( ! r.ok ) throw new Error( `${ u } : HTTP ${ r.status }` ); return r.json() as Promise<T>; };
		fond = Promise.all( [ json<TunisiaMeta>( '/geo/tunisie-relief.json' ), json<{ villes: Ville[] }>( '/geo/villes.json' ) ] )
			.then( ( [ meta, v ] ) => ( { meta, villes: v.villes } ) );
		fond.catch( () => { fond = null; } );

	}

	return fond;

}

export function CarteSituation( { meta }: { meta: Meta | null } ) {

	const [ f, setF ] = useState<{ meta: TunisiaMeta; villes: Ville[] } | null>( null );
	const [ erreur, setErreur ] = useState<string | null>( null );
	useEffect( () => { chargerFond().then( setF, ( e ) => setErreur( String( e?.message ?? e ) ) ); }, [] );

	if ( erreur ) return <p className="muet petit">Carte de situation indisponible ({ erreur })</p>;
	if ( ! f || ! meta ) return <p className="muet petit">chargement…</p>;
	const img = f.meta.image;
	const coins = domainCorners( meta ).map( ( c ) => latLonToPixel( img, c.lat, c.lon ) );
	// Échelle : 100 km en pixels de l'image (m par pixel publié dans les métadonnées).
	const px100 = 100 / pixelsToKm( img, 1 );
	const villes = f.villes.filter( ( v ) => [ 'Tunis', 'Sfax', 'Sousse', 'Gabès', 'Bizerte', 'Kairouan', 'Gafsa' ].includes( v.nom ) );
	const suppose = meta.georef.suppose;
	return (
		<figure className="situation" data-testid="carte-situation">
			<svg viewBox={ `0 0 ${ img.largeur_px } ${ img.hauteur_px }` } role="img" aria-label="Situation du domaine en Tunisie">
				<image href={ `/geo/${ img.fichier }` } width={ img.largeur_px } height={ img.hauteur_px } />
				{ villes.map( ( v ) => {

					const p = latLonToPixel( img, v.lat, v.lon );
					return <g key={ v.nom }><circle cx={ p.x } cy={ p.y } r={ 6 } className="ville" /><text x={ p.x + 10 } y={ p.y + 8 } className="ville-nom">{ v.nom }</text></g>;

				} ) }
				<polygon points={ coins.map( ( p ) => `${ p.x },${ p.y }` ).join( ' ' ) } className={ `emprise${ suppose ? ' supposee' : '' }` } data-testid="emprise" />
				<g transform={ `translate(${ img.largeur_px - 70 }, 40)` }><path d="M0 50 L18 0 L36 50 L18 38 Z" className="fleche-nord" /><text x={ 18 } y={ 80 } textAnchor="middle" className="ville-nom">N</text></g>
				<g transform={ `translate(30, ${ img.hauteur_px - 50 })` }>
					<rect width={ px100 } height={ 10 } className="barre-echelle" />
					<text y={ - 10 } className="ville-nom">100 km</text>
				</g>
			</svg>
			<figcaption className="muet petit">
				Domaine du modèle{ suppose ? <b data-testid="position-supposee"> — position supposée</b> : '' } · fond : { f.meta.source.attribution }
			</figcaption>
		</figure>
	);

}
