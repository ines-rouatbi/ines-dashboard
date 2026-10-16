// Instant affiché, partagé entre les vues (palette de commandes, carte animée de la Vue d'ensemble, Exploration 3D)
// et liste des instantanés publiés (/v1/times, lue une fois par manifeste latest).
//
// null = le dernier instantané publié (celui de /v1/latest). On ne choisit jamais qu'un instant PUBLIÉ.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, libelleErreur } from '../data';
import type { TimeItem } from '../data/contract';

let choisi: string | null = null;
const abonnes = new Set<() => void>();

export function choisirInstant( id: string | null ) {

	if ( id === choisi ) return;
	choisi = id;
	abonnes.forEach( ( f ) => f() );

}

export function instantChoisi(): string | null { return choisi; }

export function useInstantChoisi(): string | null {

	return useSyncExternalStore( ( f ) => { abonnes.add( f ); return () => { abonnes.delete( f ); }; }, () => choisi, () => null );

}

export type EtatTimes = { etat: 'attente' } | { etat: 'ok'; items: TimeItem[] } | { etat: 'erreur'; message: string };

const cache = new Map<string, Promise<TimeItem[]>>();

/** Instantanés publiés (première page de /v1/times), dans l'ordre du temps (du plus ancien au plus récent). */
export function chargerTimes( latestId: string ): Promise<TimeItem[]> {

	let p = cache.get( latestId );
	if ( ! p ) {

		p = api.times( {} ).then( ( t ) => [ ...t.items ].sort( ( a, b ) => a.valid_time.localeCompare( b.valid_time ) ) );
		p.catch( () => cache.delete( latestId ) );
		cache.set( latestId, p );

	}
	return p;

}

export function useTimes( latestId: string | null ): EtatTimes {

	const [ s, setS ] = useState<{ id: string | null; e: EtatTimes }>( { id: null, e: { etat: 'attente' } } );
	useEffect( () => {

		if ( ! latestId ) return;
		let vivant = true;
		chargerTimes( latestId ).then(
			( items ) => { if ( vivant ) setS( { id: latestId, e: { etat: 'ok', items } } ); },
			( e ) => { if ( vivant ) setS( { id: latestId, e: { etat: 'erreur', message: libelleErreur( e ) } } ); },
		);
		return () => { vivant = false; };

	}, [ latestId ] );
	return s.id === latestId ? s.e : { etat: 'attente' };

}
