// Palette de commandes (Ctrl+K ou ⌘K) : aller à une page, choisir un instant publié, changer de thème, réduire les
// animations. Boîte de dialogue modale accessible : champ en combobox, liste en listbox, ↑ ↓ pour choisir,
// Entrée pour exécuter, Échap pour fermer ; le focus revient à l'élément d'origine.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { TimeItem } from '../data/contract';
import { utc } from '../pages/shared/format';
import { choisirInstant } from './instant';
import { basculerTheme, choisirMouvement, type ChoixMouvement, type Theme } from './preferences';
import { ROUTES, naviguer, type PageId } from './routes';

export interface Commande { id: string; groupe: string; titre: string; detail?: string; motsCles?: string; faire: () => void }

/** Normalise pour la recherche : minuscules, sans accents. */
export const normaliser = ( s: string ) => s.normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' ).toLowerCase();

/** Filtre « tous les mots » sur le titre, le détail et les mots-clés ; ordre conservé. */
export function filtrerCommandes( cmds: Commande[], q: string ): Commande[] {

	const mots = normaliser( q ).split( /\s+/ ).filter( Boolean );
	if ( ! mots.length ) return cmds;
	return cmds.filter( ( c ) => {

		const t = normaliser( `${ c.groupe } ${ c.titre } ${ c.detail ?? '' } ${ c.motsCles ?? '' }` );
		return mots.every( ( m ) => t.includes( m ) );

	} );

}

export function commandes( p: {
	page: PageId; theme: Theme; mouvement: ChoixMouvement; instants: TimeItem[] | null; latestId: string | null;
} ): Commande[] {

	const out: Commande[] = ROUTES.map( ( r ) => ( {
		id: `page:${ r.id }`, groupe: 'Pages', titre: r.titre, detail: r.id === p.page ? 'page actuelle' : r.chemin, motsCles: 'aller page',
		faire: () => naviguer( r.chemin ),
	} ) );
	// Instants publiés, du plus récent au plus ancien ; on reste sur la page si elle sait afficher un instant.
	const cible = p.page === 'ensemble' || p.page === 'exploration' ? null : '/exploration';
	for ( const t of [ ...( p.instants ?? [] ) ].reverse() ) {

		const dernier = t.snapshot_id === p.latestId;
		out.push( {
			id: `instant:${ t.snapshot_id }`, groupe: 'Instants publiés', titre: utc( t.valid_time ),
			detail: `${ dernier ? 'dernier · ' : '' }${ t.open_alerts ? `${ t.open_alerts } alerte(s) · ` : '' }${ t.snapshot_id }`,
			motsCles: 'instant instantane heure date',
			faire: () => { choisirInstant( dernier ? null : t.snapshot_id ); if ( cible ) naviguer( cible ); },
		} );

	}
	out.push( {
		id: 'theme', groupe: 'Affichage', titre: p.theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre', motsCles: 'theme sombre clair nuit jour mode',
		faire: () => basculerTheme(),
	} );
	out.push( {
		id: 'mouvement', groupe: 'Affichage', titre: p.mouvement === 'reduit' ? 'Rétablir les animations (préférence du système)' : 'Réduire les animations',
		motsCles: 'animation mouvement reduit accessibilite',
		faire: () => choisirMouvement( p.mouvement === 'reduit' ? 'systeme' : 'reduit' ),
	} );
	return out;

}

export function Palette( { ouverte, onFermer, cmds }: { ouverte: boolean; onFermer: () => void; cmds: Commande[] } ) {

	const [ q, setQ ] = useState( '' );
	const [ k, setK ] = useState( 0 );
	const champ = useRef<HTMLInputElement>( null );
	const liste = useRef<HTMLUListElement>( null );
	const origine = useRef<Element | null>( null );
	const vus = useMemo( () => filtrerCommandes( cmds, q ), [ cmds, q ] );

	useEffect( () => {

		if ( ! ouverte ) return;
		origine.current = document.activeElement;
		setQ( '' ); setK( 0 );
		requestAnimationFrame( () => champ.current?.focus() );
		return () => { ( origine.current as HTMLElement | null )?.focus?.(); };

	}, [ ouverte ] );
	useEffect( () => { setK( 0 ); }, [ q ] );
	useEffect( () => { liste.current?.querySelector( '[aria-selected="true"]' )?.scrollIntoView( { block: 'nearest' } ); }, [ k ] );

	if ( ! ouverte ) return null;
	const executer = ( c: Commande | undefined ) => { if ( ! c ) return; onFermer(); c.faire(); };
	const touche = ( e: KeyboardEvent ) => {

		if ( e.key === 'ArrowDown' ) { e.preventDefault(); setK( ( x ) => Math.min( vus.length - 1, x + 1 ) ); }
		else if ( e.key === 'ArrowUp' ) { e.preventDefault(); setK( ( x ) => Math.max( 0, x - 1 ) ); }
		else if ( e.key === 'Enter' ) { e.preventDefault(); executer( vus[ k ] ); }
		else if ( e.key === 'Escape' ) { e.preventDefault(); onFermer(); }
		else if ( e.key === 'Tab' ) e.preventDefault(); // le focus reste dans la boîte de dialogue

	};

	let groupe = '';
	return (
		<div className="palette-voile" onMouseDown={ ( e ) => { if ( e.target === e.currentTarget ) onFermer(); } }>
			<div className="palette" role="dialog" aria-modal="true" aria-label="Palette de commandes" data-testid="palette" onKeyDown={ touche }>
				<div className="palette-recherche">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
					<input ref={ champ } value={ q } onChange={ ( e ) => setQ( e.target.value ) } placeholder="Aller à une page, choisir un instant, changer de thème…"
						role="combobox" aria-expanded="true" aria-controls="palette-liste" aria-autocomplete="list"
						aria-activedescendant={ vus[ k ] ? `palette-${ vus[ k ].id }` : undefined } aria-label="Rechercher une commande" />
					<span className="kbd">Échap</span>
				</div>
				{ vus.length ? (
					<ul className="palette-liste" id="palette-liste" role="listbox" ref={ liste }>
						{ vus.map( ( c, i ) => {

							const entete = c.groupe !== groupe ? ( groupe = c.groupe ) : null;
							return [
								entete ? <li key={ `g:${ entete }` } className="palette-groupe" role="presentation">{ entete }</li> : null,
								<li key={ c.id } id={ `palette-${ c.id }` } role="option" aria-selected={ i === k } className="palette-item"
									onMouseMove={ () => setK( i ) } onClick={ () => executer( c ) }>
									<span>{ c.titre }</span>{ c.detail ? <span className="muet">{ c.detail }</span> : null }
								</li>,
							];

						} ) }
					</ul>
				) : <p className="palette-vide">Aucune commande ne correspond.</p> }
				<div className="palette-pied"><span><b>↑ ↓</b> choisir</span><span><b>Entrée</b> exécuter</span><span><b>Ctrl K</b> ouvrir / fermer</span></div>
			</div>
		</div>
	);

}
