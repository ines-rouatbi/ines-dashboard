// Notifications « toast » : nouvel instantané publié, alerte ouverte, changement d'état du calcul.
//
// File hors React (notifier() est appelable de partout), affichage par <Toasts /> dans une région aria-live : les
// lecteurs d'écran annoncent le titre et le texte. Fermeture automatique (durée suspendue au survol et au focus),
// bouton de fermeture et action facultative. Les messages ne portent que des données publiées (/v1), jamais d'invention.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export type GenreToast = 'info' | 'alerte' | 'attention' | 'ok';

export interface Toast {
	id: number;
	genre: GenreToast;
	titre: string;
	texte?: string;
	action?: { libelle: string; faire: () => void };
	/** Durée d'affichage (ms) ; 0 = jusqu'à fermeture. */
	duree: number;
	/** Clé de déduplication : un toast de même clé remplace le précédent. */
	cle?: string;
}

const MAX = 4;
let suivant = 1;
let file: Toast[] = [];
const abonnes = new Set<() => void>();
const publier = () => abonnes.forEach( ( f ) => f() );

/** Ajoute un toast ; renvoie son identifiant. */
export function notifier( t: Omit<Toast, 'id' | 'duree'> & { duree?: number } ): number {

	const id = suivant ++;
	const n: Toast = { duree: 7000, ...t, id };
	file = [ ...file.filter( ( x ) => ! t.cle || x.cle !== t.cle ), n ].slice( - MAX );
	publier();
	return id;

}

export function fermerToast( id: number ) {

	if ( ! file.some( ( x ) => x.id === id ) ) return;
	file = file.filter( ( x ) => x.id !== id );
	publier();

}

/** File courante (tests). */
export function toastsCourants(): readonly Toast[] { return file; }

function useFile(): Toast[] {

	return useSyncExternalStore( ( f ) => { abonnes.add( f ); return () => { abonnes.delete( f ); }; }, () => file, () => file );

}

const ICONE: Record<GenreToast, string> = { info: 'i', alerte: '!', attention: '!', ok: '✓' };

function UnToast( { t }: { t: Toast } ) {

	const [ sortie, setSortie ] = useState( false );
	const [ pause, setPause ] = useState( false );
	const reste = useRef( t.duree ), debut = useRef( 0 );
	const fermer = () => { setSortie( true ); setTimeout( () => fermerToast( t.id ), 280 ); };

	useEffect( () => {

		if ( ! t.duree || pause ) return;
		debut.current = performance.now();
		const minuterie = setTimeout( fermer, reste.current );
		return () => { clearTimeout( minuterie ); reste.current -= performance.now() - debut.current; };

	}, [ pause, t.duree ] ); // eslint-disable-line react-hooks/exhaustive-deps

	return (
		<div className={ `toast toast-${ t.genre }${ sortie ? ' sortie' : '' }` } data-testid="toast" data-genre={ t.genre }
			onMouseEnter={ () => setPause( true ) } onMouseLeave={ () => setPause( false ) }
			onFocus={ () => setPause( true ) } onBlur={ () => setPause( false ) }>
			<span className="toast-icone" aria-hidden="true">{ ICONE[ t.genre ] }</span>
			<span className="toast-titre">{ t.titre }</span>
			<button type="button" className="toast-fermer" aria-label="Fermer la notification" onClick={ fermer }>×</button>
			{ t.texte ? <span className="toast-texte">{ t.texte }</span> : null }
			{ t.action ? <button type="button" className="toast-action" onClick={ () => { t.action!.faire(); fermer(); } }>{ t.action.libelle } →</button> : null }
			{ t.duree ? <span className="toast-progres" aria-hidden="true" style={ { animationDuration: `${ t.duree }ms` } } /> : null }
		</div>
	);

}

/** Région des notifications (une seule, dans la coquille). */
export function Toasts() {

	const toasts = useFile();
	return (
		<div className="toasts" role="status" aria-live="polite" aria-relevant="additions text" aria-label="Notifications">
			{ toasts.map( ( t ) => <UnToast key={ t.id } t={ t } /> ) }
		</div>
	);

}
