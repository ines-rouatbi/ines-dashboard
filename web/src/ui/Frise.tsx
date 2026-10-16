// Frise temporelle des instantanés publiés (/v1/times) et lecture automatique (V3D8, UI v2).
//
// Les instantanés sont placés à leur instant de validité ; un clic, le glissement du curseur (aimanté aux instants
// publiés) ou le clavier en charge un. La lecture les parcourt du plus ancien au plus récent à ×1, ×2 ou ×4, en
// attendant que chacun soit affiché ; une barre montre l'attente avant le suivant. Avec un seul instantané publié, la
// lecture est indisponible (et le dit) : on n'invente aucun instant. Le passage d'un instant à l'autre est un fondu
// d'AFFICHAGE : aucune valeur n'est interpolée entre deux instants.
//
// Raccourcis (hors champs de saisie) : Espace lecture / pause, ← → instant précédent / suivant, Début / Fin,
// 1 / 2 / 4 vitesse.

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { TimeItem } from '../data/contract';
import { delaiLecture, departLecture, indiceProche, positionsFrise, VITESSES, voisin, type VitesseLecture } from '../domain/frise';

const date = ( iso: string ) => new Date( iso ).toLocaleString( 'fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' } ) + ' UTC';

export interface ProprietesFrise {
	items: TimeItem[] | null;
	erreur: string | null;
	courant: string | null;
	latest: string | null;
	lecture: boolean;
	onChoisir: ( id: string | null ) => void;
	onLecture: ( on: boolean ) => void;
	vitesse?: VitesseLecture;
	onVitesse?: ( v: VitesseLecture ) => void;
	/** Attente (ms) avant l'instant suivant pendant la lecture, une fois l'instant courant affiché ; null = en chargement. */
	attenteMs?: number | null;
	testid?: string;
}

export function Frise( { items, erreur, courant, latest, lecture, onChoisir, onLecture, vitesse = 1, onVitesse, attenteMs = null, testid = 'frise' }: ProprietesFrise ) {

	const piste = useRef<HTMLDivElement>( null );
	const [ glisse, setGlisse ] = useState( false );
	if ( erreur ) return <div className="frise" data-testid={ testid }><span className="muet">Frise temporelle { erreur }</span></div>;
	if ( ! items ) return <div className="frise" data-testid={ testid } role="status"><span className="squelette squelette-ligne" style={ { gridColumn: '1 / -1' } } /><span className="sr-only">Frise : chargement…</span></div>;

	const pos = positionsFrise( items );
	const k = items.findIndex( ( x ) => x.snapshot_id === courant );
	const courantItem = k >= 0 ? items[ k ] : null;
	const choisir = ( id: string ) => onChoisir( id === latest ? null : id );
	const depuisPointeur = ( e: PointerEvent<HTMLDivElement> ) => {

		const r = piste.current!.getBoundingClientRect();
		const i = indiceProche( items, ( e.clientX - r.left ) / r.width );
		if ( i >= 0 && items[ i ].snapshot_id !== courant ) choisir( items[ i ].snapshot_id );

	};

	return (
		<div className={ `frise${ lecture ? ' en-lecture' : '' }` } data-testid={ testid } data-instantanes={ items.length }>
			<div className="frise-commandes">
				<button
					type="button" className="bouton bouton-lecture" data-testid="rejeu"
					disabled={ items.length < 2 } onClick={ () => onLecture( ! lecture ) }
					aria-pressed={ lecture }
					title={ items.length < 2 ? 'Un seul instantané publié : rien à rejouer' : lecture ? 'Pause (Espace)' : 'Lire les instantanés du plus ancien au plus récent (Espace)' }
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">{ lecture ? <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" /> : <path d="M4 2.5v11l9-5.5z" fill="currentColor" /> }</svg>
					{ lecture ? 'Pause' : 'Lecture' }
				</button>
				{ onVitesse ? (
					<div className="frise-vitesses" role="group" aria-label="Vitesse de lecture">
						{ VITESSES.map( ( v ) => <button key={ v } type="button" aria-pressed={ v === vitesse } onClick={ () => onVitesse( v ) } title={ `Vitesse ×${ v } (touche ${ v })` }>×{ v }</button> ) }
					</div>
				) : null }
			</div>
			<div
				className={ `frise-piste${ glisse ? ' glisse' : '' }` } ref={ piste } role="listbox" aria-label="Instantanés publiés (← → pour changer)"
				onPointerDown={ ( e ) => { if ( ( e.target as HTMLElement ).closest( '.frise-repere' ) ) return; e.currentTarget.setPointerCapture( e.pointerId ); setGlisse( true ); depuisPointeur( e ); } }
				onPointerMove={ ( e ) => { if ( glisse ) depuisPointeur( e ); } }
				onPointerUp={ () => setGlisse( false ) } onPointerCancel={ () => setGlisse( false ) }
			>
				<span className="frise-rail" aria-hidden="true" />
				<span className="frise-rempli" aria-hidden="true" style={ { width: `${ ( k >= 0 ? pos[ k ] : 0 ) * 100 }%` } } />
				{ lecture && attenteMs != null && k >= 0 && k < items.length - 1 ? (
					<span key={ `${ courant }:${ attenteMs }` } className="frise-attente" aria-hidden="true"
						style={ { left: `${ pos[ k ] * 100 }%`, width: `${ ( pos[ k + 1 ] - pos[ k ] ) * 100 }%`, animationDuration: `${ attenteMs }ms` } } />
				) : null }
				{ items.map( ( x, i ) => (
					<button
						key={ x.snapshot_id } type="button" role="option"
						aria-selected={ x.snapshot_id === courant }
						className={ `frise-repere${ x.snapshot_id === courant ? ' actif' : '' }${ x.open_alerts ? ' alerte' : '' }` }
						style={ { left: `${ pos[ i ] * 100 }%` } }
						title={ `${ date( x.valid_time ) } · ${ x.snapshot_id }${ x.open_alerts != null ? ` · ${ x.open_alerts } alerte(s) ouverte(s)` : '' }` }
						onClick={ () => choisir( x.snapshot_id ) }
					/>
				) ) }
				{ k >= 0 ? <span className="frise-curseur" aria-hidden="true" style={ { left: `${ pos[ k ] * 100 }%` } }><span>{ date( items[ k ].valid_time ).slice( 6 ) }</span></span> : null }
			</div>
			<div className="frise-texte num" data-testid="frise-courant">
				{ courantItem ? date( courantItem.valid_time ) : '—' }
				{ courant && courant !== latest ? ' · historique' : ' · dernier' }
				{ ' · ' }{ items.length } instantané{ items.length > 1 ? 's' : '' }
				{ items.length < 2 ? ' (rejeu indisponible)' : '' }
				{ courant && courant !== latest && <button type="button" className="lien" onClick={ () => onChoisir( null ) }>revenir au dernier</button> }
				<span className="frise-aide muet"> · fondu d’affichage entre instants publiés, aucune valeur interpolée · <kbd>Espace</kbd> <kbd>←</kbd> <kbd>→</kbd></span>
			</div>
		</div>
	);

}

const estSaisie = ( t: EventTarget | null ) => {

	const el = t as HTMLElement | null;
	if ( ! el || ! el.closest ) return false;
	return !! el.closest( 'input, select, textarea, [contenteditable="true"], [role="dialog"]' );

};

/**
 * Lecture automatique et raccourcis clavier d'une frise. `pret` : l'instant courant est affiché (la lecture n'avance
 * qu'ensuite). `onChoisir(id)` reçoit l'identifiant publié choisi (null = le dernier).
 */
export function useLectureFrise( { items, courant, latest, pret, onChoisir, clavier = true }: {
	items: TimeItem[] | null; courant: string | null; latest: string | null; pret: boolean; onChoisir: ( id: string | null ) => void; clavier?: boolean;
} ) {

	const [ lecture, setLecture ] = useState( false );
	const [ vitesse, setVitesse ] = useState<VitesseLecture>( 1 );
	const choisir = useCallback( ( id: string | null ) => onChoisir( id === latest ? null : id ), [ onChoisir, latest ] );
	const attenteMs = delaiLecture( vitesse );

	useEffect( () => {

		if ( ! lecture || ! items || ! pret ) return;
		const t = setTimeout( () => {

			const s = voisin( items, courant, 1 );
			if ( ! s ) { setLecture( false ); return; }
			choisir( s );

		}, attenteMs );
		return () => clearTimeout( t );

	}, [ lecture, items, pret, courant, attenteMs, choisir ] );

	const lancer = useCallback( ( on: boolean ) => {

		if ( on && items ) { const d = departLecture( items, courant ); if ( d && d !== courant ) choisir( d ); }
		setLecture( on && !! items && items.length > 1 );

	}, [ items, courant, choisir ] );

	const etat = useRef( { items, courant, lecture, lancer, choisir } );
	etat.current = { items, courant, lecture, lancer, choisir };
	useEffect( () => {

		if ( ! clavier ) return;
		const f = ( e: KeyboardEvent ) => {

			if ( e.ctrlKey || e.metaKey || e.altKey || estSaisie( e.target ) ) return;
			const s = etat.current;
			if ( ! s.items?.length ) return;
			let id: string | null = null;
			if ( e.key === ' ' || e.code === 'Space' ) { if ( ( e.target as HTMLElement )?.closest?.( 'button, a' ) ) return; e.preventDefault(); s.lancer( ! s.lecture ); return; }
			if ( e.key === 'ArrowRight' ) id = voisin( s.items, s.courant, 1 );
			else if ( e.key === 'ArrowLeft' ) id = voisin( s.items, s.courant, - 1 );
			else if ( e.key === 'Home' ) id = voisin( s.items, s.courant, 'debut' );
			else if ( e.key === 'End' ) id = voisin( s.items, s.courant, 'fin' );
			else if ( e.key === '1' || e.key === '2' || e.key === '4' ) { setVitesse( Number( e.key ) as VitesseLecture ); return; }
			else return;
			e.preventDefault();
			setLecture( false );
			if ( id ) s.choisir( id );

		};
		addEventListener( 'keydown', f );
		return () => removeEventListener( 'keydown', f );

	}, [ clavier ] );

	return { lecture, setLecture: lancer, vitesse, setVitesse, attenteMs: pret ? attenteMs : null };

}
