// État du manifeste /v1/latest, relu périodiquement.

import { useEffect, useState } from 'react';
import { api, libelleErreur, type Latest } from '../data';

export type EtatLatest =
	| { etat: 'attente' }
	| { etat: 'ok'; latest: Latest }
	| { etat: 'erreur'; message: string };

const PERIODE_MS = 60_000;

export function useLatest(): EtatLatest {

	const [ s, setS ] = useState<EtatLatest>( { etat: 'attente' } );

	useEffect( () => {

		let vivant = true;
		const ctl = new AbortController();
		const lire = async () => {

			try {

				const latest = await api.latest( ctl.signal );
				if ( vivant ) setS( { etat: 'ok', latest } );

			} catch ( e ) {

				if ( vivant && ( e as Error ).name !== 'AbortError' ) setS( { etat: 'erreur', message: libelleErreur( e ) } );

			}

		};
		lire();
		const t = setInterval( lire, PERIODE_MS );
		return () => { vivant = false; ctl.abort(); clearInterval( t ); };

	}, [] );

	return s;

}
