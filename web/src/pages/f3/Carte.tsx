// Carte 2D d'un champ à une hauteur (raster d'un pixel par nœud, nord en haut) avec couche capteurs.
//
// Le raster est dessiné dans un canevas nx × ny agrandi en CSS (rendu « pixelated ») : 125 000 nœuds en
// v7, trop pour des éléments SVG d'ECharts dans le budget VIS1. Les nœuds absents (NaN) restent
// transparents sur un fond hachuré : « absent », jamais une couleur de valeur. Légende chiffrée avec
// unité, résumé textuel (min, moyenne, max, colonnes disponibles) pour les lecteurs d'écran.
//
// UI v2 : changement de valeurs (autre instant, autre hauteur) en FONDU d'affichage (l'ancienne image s'efface sur
// la nouvelle : aucune valeur interpolée n'est calculée ni affichée) ; calque facultatif de particules qui suivent
// (u, v) publiés ; infobulle avec la direction d'où vient le vent (flèche dans le sens où il va).

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { Snapshot, Station } from '../../data/contract';
import type { Resume } from '../../domain/hauteurSol';
import { NA, num } from '../shared/format';
import { ETAT_CAPTEUR, couleurRampe, hexVersRgb } from './couleurs';
import { BoutonCsv } from '../../ui/Exports';
import { ChampParticules, type PaletteParticules } from '../../ui/ChampParticules';
import { mouvementReduit } from '../../ui/preferences';
import type { ChampVent } from '../../domain/particules';
import { cardinal, dirAffichee, dirFrom } from '../../domain/wind';

export type Echelle =
	| { kind: 'continue'; min: number; max: number; rampe: readonly string[]; unite: string; decimales: number }
	| { kind: 'categories'; categories: { valeur: number; libelle: string; couleur: string }[] };

export interface Grille { nx: number; ny: number; dx: number; dy: number; x0: number; y0: number }

/** Couleur RVBA (Uint8ClampedArray nx·ny·4) du raster, nord en haut (ligne 0 = j = ny − 1). */
export function rasteriser( valeurs: ArrayLike<number>, nx: number, ny: number, e: Echelle ): Uint8ClampedArray<ArrayBuffer> {

	const px = new Uint8ClampedArray( nx * ny * 4 );
	const cat = e.kind === 'categories' ? new Map( e.categories.map( ( c ) => [ c.valeur, hexVersRgb( c.couleur ) ] ) ) : null;
	for ( let j = 0; j < ny; j ++ ) for ( let i = 0; i < nx; i ++ ) {

		const v = valeurs[ j * nx + i ];
		if ( Number.isNaN( v ) ) continue; // absent : transparent (fond hachuré)
		let c: [ number, number, number ] | undefined;
		if ( e.kind === 'continue' ) c = couleurRampe( e.rampe, e.max > e.min ? ( v - e.min ) / ( e.max - e.min ) : 0 );
		else c = cat!.get( v );
		if ( ! c ) continue;
		const o = ( ( ny - 1 - j ) * nx + i ) * 4;
		px[ o ] = c[ 0 ]; px[ o + 1 ] = c[ 1 ]; px[ o + 2 ] = c[ 2 ]; px[ o + 3 ] = 255;

	}
	return px;

}

/** Bornes « rondes » d'une échelle continue partagée (0 en bas pour les grandeurs positives). */
export function bornesEchelle( max: number | null, pas = 1 ): { min: number; max: number } {

	if ( max == null || ! Number.isFinite( max ) || max <= 0 ) return { min: 0, max: pas };
	return { min: 0, max: Math.ceil( max / pas ) * pas };

}

function valeurTexte( v: number, e: Echelle ): string {

	if ( Number.isNaN( v ) ) return 'absent';
	if ( e.kind === 'continue' ) return `${ num( v, e.decimales ) } ${ e.unite }`;
	return e.categories.find( ( c ) => c.valeur === v )?.libelle ?? NA;

}

function Marqueur( { s, g }: { s: Station; g: Grille } ) {

	const etat = ETAT_CAPTEUR[ s.state ];
	const left = ( ( s.x_m - g.x0 ) / g.dx + 0.5 ) / g.nx * 100, top = ( 1 - ( ( s.y_m - g.y0 ) / g.dy + 0.5 ) / g.ny ) * 100;
	const style = { left: `${ left }%`, top: `${ top }%`, '--c': etat.couleur } as CSSProperties;
	const titre = `Capteur ${ s.id } : ${ etat.libelle }`;
	return <span className={ `f3-capteur f3-forme-${ etat.forme }` } style={ style } title={ titre } aria-label={ titre } role="img" data-testid="carte-capteur" data-station={ s.id } data-state={ s.state } />;

}

export interface PropsCarte {
	titre: string;
	/** Texte sous le titre (hauteur, référence). */
	detail?: string;
	valeurs: Float32Array;
	grille: Grille;
	echelle: Echelle;
	resume: Resume;
	stations?: Station[];
	testid: string;
	/** Message affiché sur la carte si aucune colonne n'a de valeur. */
	videTexte?: string;
	onPeinte?: () => void;
	/** Export CSV des valeurs affichées (lot F6) : nom du fichier et générateur appelé au clic. */
	exporter?: { nom: string; generer: () => string };
	/** Vent horizontal publié à la même hauteur : direction dans l'infobulle et, si `particules`, calque animé. */
	vent?: ChampVent | null;
	particules?: boolean;
	palette?: PaletteParticules;
	/** Classe CSS supplémentaire de la figure (ex. grande carte de la Vue d'ensemble). */
	classe?: string;
}

/** Direction affichée d'un nœud : « vient du NO (315°) » et angle de la flèche (sens où VA le vent), ou null (calme, absent). */
export function directionNoeud( vent: ChampVent | null | undefined, k: number ): { texte: string; versDeg: number } | null {

	if ( ! vent ) return null;
	const d = dirFrom( vent.u[ k ], vent.v[ k ] );
	if ( d == null ) return Number.isNaN( vent.u[ k ] ) || Number.isNaN( vent.v[ k ] ) ? null : { texte: 'calme', versDeg: NaN };
	return { texte: `vient du ${ cardinal( d ) } (${ dirAffichee( d ) }°)`, versDeg: ( d + 180 ) % 360 };

}

export function Carte( { titre, detail, valeurs, grille, echelle, resume, stations = [], testid, videTexte, onPeinte, exporter, vent, particules, palette, classe }: PropsCarte ) {

	const ref = useRef<HTMLCanvasElement | null>( null );
	const fantome = useRef<HTMLCanvasElement | null>( null );
	const peinte = useRef( false );
	const [ survol, setSurvol ] = useState<{ x: number; y: number; texte: string; dir: { texte: string; versDeg: number } | null } | null>( null );
	const px = useMemo( () => rasteriser( valeurs, grille.nx, grille.ny, echelle ), [ valeurs, grille.nx, grille.ny, echelle ] );

	useEffect( () => {

		const c = ref.current, ctx = c?.getContext( '2d' );
		if ( ! c || ! ctx ) { onPeinte?.(); return; }
		// Fondu d'affichage : l'image précédente passe sur un canevas « fantôme » qui s'efface au-dessus de la nouvelle.
		const f = fantome.current, fctx = f?.getContext( '2d' );
		if ( peinte.current && f && fctx && ! mouvementReduit() && typeof f.animate === 'function' ) {

			f.width = c.width; f.height = c.height;
			fctx.drawImage( c, 0, 0 );
			f.animate( [ { opacity: 1 }, { opacity: 0 } ], { duration: 550, easing: 'ease-in-out', fill: 'forwards' } );

		}
		peinte.current = true;
		c.width = grille.nx; c.height = grille.ny;
		ctx.putImageData( new ImageData( px, grille.nx, grille.ny ), 0, 0 );
		onPeinte?.();

	}, [ px, grille.nx, grille.ny, onPeinte ] );

	const pct = resume.total ? resume.disponibles / resume.total : 0;
	const unite = echelle.kind === 'continue' ? ` ${ echelle.unite }` : '';
	const d = echelle.kind === 'continue' ? echelle.decimales : 2;
	const resumeTexte = resume.disponibles
		? `min ${ num( resume.min, d ) }${ unite }, moyenne ${ num( resume.moyenne, d ) }${ unite }, max ${ num( resume.max, d ) }${ unite } ; ${ num( pct * 100, 0 ) } % des colonnes disponibles`
		: `aucune valeur : ${ videTexte ?? 'aucune colonne disponible à cette hauteur' }`;

	const deplacer = ( ev: MouseEvent<HTMLDivElement> ) => {

		const r = ev.currentTarget.getBoundingClientRect();
		const fx = ( ev.clientX - r.left ) / r.width, fy = ( ev.clientY - r.top ) / r.height;
		const i = Math.min( grille.nx - 1, Math.max( 0, Math.floor( fx * grille.nx ) ) );
		const j = Math.min( grille.ny - 1, Math.max( 0, grille.ny - 1 - Math.floor( fy * grille.ny ) ) );
		const x = grille.x0 + i * grille.dx, y = grille.y0 + j * grille.dy;
		const k = j * grille.nx + i;
		setSurvol( { x: fx * 100, y: fy * 100, texte: `x ${ num( x / 1000, 1 ) } km · y ${ num( y / 1000, 1 ) } km : ${ valeurTexte( valeurs[ k ], echelle ) }`, dir: Number.isNaN( valeurs[ k ] ) ? null : directionNoeud( vent, k ) } );

	};

	const largeurKm = ( grille.nx - 1 ) * grille.dx / 1000, hauteurKm = ( grille.ny - 1 ) * grille.dy / 1000;
	return (
		<figure className={ `f3-carte${ classe ? ` ${ classe }` : '' }` } data-testid={ testid } data-disponibles={ resume.disponibles }>
			<figcaption>
				<strong>{ titre }</strong>{ detail ? <span className="muet"> · { detail }</span> : null }
			</figcaption>
			<div className="f3-carte-cadre" style={ { aspectRatio: `${ grille.nx * grille.dx } / ${ grille.ny * grille.dy }` } }
				onMouseMove={ deplacer } onMouseLeave={ () => setSurvol( null ) }>
				<canvas ref={ ref } role="img" aria-label={ `${ titre } : ${ resumeTexte }` } />
				<canvas ref={ fantome } className="f3-fantome" aria-hidden="true" />
				{ particules && vent ? <ChampParticules champ={ vent } palette={ palette } vmaxCouleur={ echelle.kind === 'continue' ? echelle.max : null } testid={ `${ testid }-particules` } /> : null }
				{ stations.map( ( s ) => <Marqueur key={ s.id } s={ s } g={ grille } /> ) }
				{ ! resume.disponibles ? <div className="f3-carte-vide" data-testid={ `${ testid }-vide` }>{ videTexte ?? 'aucune valeur à cette hauteur' }</div> : null }
				{ survol ? (
					<div className="f3-infobulle" style={ { left: `${ survol.x }%`, top: `${ survol.y }%` } } role="status">
						{ survol.texte }
						{ survol.dir ? (
							<span className="f3-infobulle-dir">
								{ Number.isFinite( survol.dir.versDeg ) ? <svg viewBox="0 0 16 16" aria-hidden="true" style={ { transform: `rotate(${ survol.dir.versDeg }deg)` } }><path d="M8 1 13 9H9.5v6h-3V9H3z" fill="currentColor" /></svg> : null }
								{ survol.dir.texte }
							</span>
						) : null }
					</div>
				) : null }
				<span className="f3-nord" aria-hidden="true">N ↑</span>
			</div>
			<p className="f3-carte-resume petit" data-testid={ `${ testid }-resume` }>{ resumeTexte }</p>
			<p className="f3-carte-axes petit muet">{ num( largeurKm, 1 ) } km (Est) × { num( hauteurKm, 1 ) } km (Nord), nœud (0, 0) au sud-ouest</p>
			{ exporter && resume.disponibles ? <BoutonCsv nom={ exporter.nom } generer={ exporter.generer } testid={ `${ testid }-export` } /> : null }
		</figure>
	);

}

/** Légende chiffrée : dégradé + graduations avec unité, ou catégories ; « absent » toujours présent. */
export function Legende( { echelle, titre, absent = 'absent (sous le relief ou hors du domaine vertical)' }: { echelle: Echelle; titre: string; absent?: string } ) {

	if ( echelle.kind === 'categories' ) {

		return (
			<div className="f3-legende" role="group" aria-label={ `Légende : ${ titre }` } data-testid="legende">
				<span className="f3-legende-titre">{ titre }</span>
				{ echelle.categories.map( ( c ) => <span key={ c.valeur } className="f3-legende-item"><i style={ { background: c.couleur } } />{ c.libelle }</span> ) }
				<span className="f3-legende-item"><i className="f3-hachure" />{ absent }</span>
			</div>
		);

	}
	const n = 5, ticks = Array.from( { length: n }, ( _, k ) => echelle.min + ( echelle.max - echelle.min ) * k / ( n - 1 ) );
	const fond = `linear-gradient(to right, ${ echelle.rampe.join( ', ' ) })`;
	return (
		<div className="f3-legende" role="group" aria-label={ `Légende : ${ titre }, de ${ num( echelle.min, echelle.decimales ) } à ${ num( echelle.max, echelle.decimales ) } ${ echelle.unite }` } data-testid="legende">
			<span className="f3-legende-titre">{ titre } ({ echelle.unite })</span>
			<span className="f3-legende-barre">
				<i style={ { background: fond } } />
				<span className="f3-legende-ticks">{ ticks.map( ( t, k ) => <span key={ k }>{ num( t, echelle.decimales ) }</span> ) }</span>
			</span>
			<span className="f3-legende-item"><i className="f3-hachure" />{ absent }</span>
		</div>
	);

}

/** Légende de la couche capteurs (B4) : en treillis synthétique, seuls les capteurs signalés. */
export function LegendeCapteurs( { reseau, stations }: { reseau: Snapshot[ 'network' ]; stations: Station[] | null } ) {

	const etats = [ ...new Set( ( stations ?? [] ).map( ( s ) => s.state ) ) ];
	const texte = reseau.kind === 'treillis_synthetique'
		? `Treillis synthétique de ${ num( reseau.sensors_total ) } capteurs (pas de 50 m), ${ num( reseau.sensors_visible ) } visibles : seuls les ${ num( stations?.length ?? null ) } capteurs signalés sont affichés.`
		: `Stations ANEO : ${ num( stations?.length ?? null ) } affichées sur ${ num( reseau.sensors_total ) }, ${ num( reseau.sensors_visible ) } visibles.`;
	return (
		<div className="f3-legende" role="group" aria-label="Légende des capteurs" data-testid="legende-capteurs">
			<span className="f3-legende-titre">Capteurs</span>
			{ etats.map( ( e ) => (
				<span key={ e } className="f3-legende-item">
					<span className={ `f3-capteur f3-capteur-legende f3-forme-${ ETAT_CAPTEUR[ e ].forme }` } style={ { '--c': ETAT_CAPTEUR[ e ].couleur } as CSSProperties } aria-hidden="true" />
					{ ETAT_CAPTEUR[ e ].libelle }
				</span>
			) ) }
			<span className="petit muet" data-testid="reseau">{ stations ? texte : `Capteurs : ${ NA }.` }</span>
		</div>
	);

}
