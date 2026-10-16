// Notifications de la coquille : nouvel instantané publié, passage du calcul en ligne / à l'arrêt, alertes graves
// ouvertes. Fonctions pures (testées) + crochet qui les branche sur /v1/latest (relu toutes les 60 s).

import { useEffect, useRef } from 'react';
import { api } from '../data';
import type { Latest, Snapshot } from '../data/contract';
import { utc } from '../pages/shared/format';
import { naviguer } from './routes';
import { notifier, type GenreToast } from './toasts';
import type { EtatLatest } from './useLatest';

export interface Evenement { genre: GenreToast; titre: string; texte?: string; cle: string; lien?: { libelle: string; chemin: string } }

/** Évènements entre deux lectures du manifeste (aucun à la première lecture). */
export function evenementsLatest( prec: Latest | null, cour: Latest ): Evenement[] {

	if ( ! prec ) return [];
	const out: Evenement[] = [];
	if ( cour.snapshot_id !== prec.snapshot_id ) {

		out.push( {
			genre: 'info', cle: `instantane:${ cour.snapshot_id }`,
			titre: 'Nouvel instantané publié',
			texte: `${ utc( cour.valid_time ) } · ${ cour.snapshot_id }`,
			lien: { libelle: 'Voir la vue d’ensemble', chemin: '/' },
		} );

	}
	if ( cour.compute_status !== prec.compute_status ) {

		out.push( cour.compute_status === 'online'
			? { genre: 'ok', cle: 'calcul', titre: 'Calcul en ligne', texte: 'Le service de calcul publie de nouveau.' }
			: { genre: 'attention', cle: 'calcul', titre: 'Calcul arrêté', texte: 'Affichage du dernier état réel publié.' } );

	}
	return out;

}

/** Alerte à signaler pour un instantané : alertes critiques ou importantes ouvertes (null = non calculées : rien). */
export function evenementAlertes( s: Pick<Snapshot, 'snapshot_id' | 'kpi'> ): Evenement | null {

	const oa = s.kpi.open_alerts;
	if ( ! oa ) return null;
	const graves = oa.critique + oa.important;
	if ( ! graves ) return null;
	const detail = [ oa.critique ? `${ oa.critique } critique${ oa.critique > 1 ? 's' : '' }` : null, oa.important ? `${ oa.important } importante${ oa.important > 1 ? 's' : '' }` : null ].filter( Boolean ).join( ', ' );
	return {
		genre: 'alerte', cle: `alertes:${ s.snapshot_id }`,
		titre: `${ graves } alerte${ graves > 1 ? 's' : '' } grave${ graves > 1 ? 's' : '' } ouverte${ graves > 1 ? 's' : '' }`,
		texte: detail, lien: { libelle: 'Voir les alertes', chemin: '/alertes' },
	};

}

function afficher( e: Evenement ) {

	notifier( {
		genre: e.genre, titre: e.titre, texte: e.texte, cle: e.cle, duree: e.genre === 'alerte' ? 12000 : 7000,
		action: e.lien ? { libelle: e.lien.libelle, faire: () => naviguer( e.lien!.chemin ) } : undefined,
	} );

}

/** Branche les notifications sur le manifeste. */
export function useNotifications( latest: EtatLatest ) {

	const prec = useRef<Latest | null>( null );
	const vus = useRef( new Set<string>() );
	const cour = latest.etat === 'ok' ? latest.latest : null;

	useEffect( () => {

		if ( ! cour ) return;
		for ( const e of evenementsLatest( prec.current, cour ) ) afficher( e );
		const nouveau = prec.current?.snapshot_id !== cour.snapshot_id;
		prec.current = cour;
		if ( ! nouveau || vus.current.has( cour.snapshot_id ) ) return;
		vus.current.add( cour.snapshot_id );
		const ctl = new AbortController();
		api.snapshot( cour.snapshot_id, ctl.signal ).then( ( s ) => { const e = evenementAlertes( s ); if ( e ) afficher( e ); }, () => {} );
		return () => ctl.abort();

	}, [ cour ] );

}
