// Briques communes des pages F3 : chargement asynchrone, état d'une ressource, valeurs « non disponible ».

import { useEffect, useState, type ReactNode } from 'react';
import { api, CacheChamps, libelleErreur } from '../../data';
import type { Snapshot } from '../../data/contract';
import type { EtatLatest } from '../../ui/useLatest';
import { NA } from '../shared/format';
import type { Ressource } from './donnees';
import './f3.css';

/** Cache des champs de l'instantané courant, partagé par la Vue d'ensemble et la page Fiabilité. */
export const cacheChamps = new CacheChamps( api );

export type Chargement<T> = { etat: 'attente' } | { etat: 'ok'; val: T } | { etat: 'erreur'; message: string };

/** Exécute `f` (annulable) quand `cle` change ; `cle` null = rien à charger. */
export function useAsync<T>( cle: string | null, f: ( signal: AbortSignal ) => Promise<T> ): Chargement<T> {

	const [ s, setS ] = useState<{ cle: string | null; c: Chargement<T> }>( { cle: null, c: { etat: 'attente' } } );
	useEffect( () => {

		if ( cle == null ) return;
		const ctl = new AbortController();
		setS( { cle, c: { etat: 'attente' } } );
		f( ctl.signal ).then(
			( val ) => setS( { cle, c: { etat: 'ok', val } } ),
			( e ) => { if ( ( e as Error )?.name !== 'AbortError' ) setS( { cle, c: { etat: 'erreur', message: libelleErreur( e ) } } ); },
		);
		return () => ctl.abort();

	}, [ cle ] ); // `f` est relu à chaque changement de clé, pas à chaque rendu.
	return s.cle === cle ? s.c : { etat: 'attente' };

}

/** Instantané du manifeste latest (/v1/snapshots/{id}). */
export function useInstantane( latest: EtatLatest ): Chargement<Snapshot> {

	const id = latest.etat === 'ok' ? latest.latest.snapshot_id : null;
	const c = useAsync( id, ( s ) => api.snapshot( id!, s ) );
	if ( latest.etat === 'erreur' ) return { etat: 'erreur', message: `dernier instantané ${ latest.message }` };
	return c;

}

/** Page en attente ou en erreur (jamais de donnée de démo). */
export function EtatPageF3( { titre, nom, etat }: { titre: string; nom: string; etat: { etat: 'attente' } | { etat: 'erreur'; message: string } } ) {

	return (
		<section className="f3-page" data-testid={ `page-${ nom }-${ etat.etat }` }>
			<h1>{ titre }</h1>
			<p className="muet" role="status">{ etat.etat === 'attente' ? 'chargement…' : `${ titre } : ${ etat.message }` }</p>
		</section>
	);

}

/** Contenu d'une ressource facultative : non publiée → « non disponible », erreur → « indisponible ». */
export function AvecRessource<T>( { r, quoi, children }: { r: Ressource<T>; quoi: string; children: ( val: T ) => ReactNode } ) {

	if ( r.etat === 'ok' ) return <>{ children( r.val ) }</>;
	if ( r.etat === 'non_publie' ) return <p className="muet" data-testid="non-publie">{ quoi } : { NA } (non publié pour cet instantané).</p>;
	return <p className="f3-erreur" data-testid="ressource-erreur">{ quoi } : { r.message }</p>;

}

/** Indicateur clé : valeur (déjà formatée, « non disponible » si inconnue) et libellé. */
export function Kpi( { valeur, libelle, detail, testid }: { valeur: string; libelle: string; detail?: ReactNode; testid: string } ) {

	return (
		<div className={ `f3-kpi${ valeur === NA ? ' f3-kpi-na' : '' }` } data-testid={ testid }>
			<span className="f3-kpi-valeur" data-testid={ `${ testid }-valeur` }>{ valeur }</span>
			<span className="f3-kpi-libelle">{ libelle }</span>
			{ detail ? <span className="f3-kpi-detail">{ detail }</span> : null }
		</div>
	);

}

/** Booléen de contrat : true / false / null (« non disponible »). */
export function oui( b: boolean | null | undefined, vrai = 'oui', faux = 'non' ): string {

	return b == null ? NA : b ? vrai : faux;

}

/** Part 0..1 en pourcentage ; null → « non disponible », jamais 0 %. */
export function pourcent( x: number | null | undefined, decimales = 1 ): string {

	if ( x == null || ! Number.isFinite( x ) ) return NA;
	return `${ ( x * 100 ).toLocaleString( 'fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales } ) } %`;

}

/** Notation scientifique lisible : 2,6 × 10⁻⁵. */
export function scientifique( x: number | null | undefined, chiffres = 2 ): string {

	if ( x == null || ! Number.isFinite( x ) ) return NA;
	if ( x === 0 ) return '0';
	const e = Math.floor( Math.log10( Math.abs( x ) ) ), m = x / 10 ** e;
	const exp = String( e ).replace( '-', '⁻' ).replace( /\d/g, ( c ) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[ Number( c ) ] );
	return `${ m.toLocaleString( 'fr-FR', { maximumFractionDigits: chiffres - 1 } ) } × 10${ exp }`;

}
