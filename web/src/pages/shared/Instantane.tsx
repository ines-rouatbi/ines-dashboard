// Chargement commun des pages F4 : instantané de latest (/v1/snapshots/{id}), puis données de la page
// à partir de snapshot.assets. Pendant le chargement ou en cas d'erreur, la page affiche un état
// explicite (jamais de donnée de démo) ; le data-testid « page-… » n'apparaît qu'une fois les données là.
import { useEffect, useState, type ReactNode } from 'react';
import { api, libelleErreur } from '../../data';
import type { EtatLatest } from '../../ui/useLatest';
import type { SnapshotLite } from './api';
import './pages.css';

export type Chargement<T> = { etat: 'attente' } | { etat: 'ok'; val: T } | { etat: 'erreur'; message: string };

export function useDonneesInstantane<T>( latest: EtatLatest, charger: ( s: SnapshotLite, signal: AbortSignal ) => Promise<T> ): Chargement<T> {

	const id = latest.etat === 'ok' ? latest.latest.snapshot_id : null;
	const erreurLatest = latest.etat === 'erreur' ? latest.message : null;
	const [ s, setS ] = useState<Chargement<T>>( { etat: 'attente' } );

	useEffect( () => {

		if ( ! id ) return;
		const ctl = new AbortController();
		setS( { etat: 'attente' } );
		api.snapshot( id, ctl.signal )
			.then( ( snap ) => charger( snap, ctl.signal ) )
			.then(
				( val ) => setS( { etat: 'ok', val } ),
				( e ) => { if ( ( e as Error ).name !== 'AbortError' ) setS( { etat: 'erreur', message: libelleErreur( e ) } ); },
			);
		return () => ctl.abort();

	}, [ id, charger ] );

	if ( erreurLatest ) return { etat: 'erreur', message: `dernier instantané ${ erreurLatest }` };
	return s;

}

export function EtatPage<T>( { titre, nom, etat, children }: { titre: string; nom: string; etat: Chargement<T>; children: ( val: T ) => ReactNode } ) {

	if ( etat.etat === 'ok' ) return <>{ children( etat.val ) }</>;
	return (
		<section className="atom-page" data-testid={ `page-${ nom }-${ etat.etat }` }>
			<h2>{ titre }</h2>
			<p className="atom-muted">{ etat.etat === 'attente' ? 'chargement…' : `${ titre } : ${ etat.message }` }</p>
		</section>
	);

}
