// État du service de calcul PC-FNO3D (lot F6, « GPU allumé / éteint ») lu sur /api/health via le Worker.
//
// Le tableau de bord ne dépend PAS de ce service (D1) : toutes ses pages lisent /v1 (R2). Ce bloc dit seulement
// si les fonctions qui demandent le service (nouvelles reconstructions, Swagger /api/docs, MCP) sont joignables.
// /api/health est public côté service ; le Worker relaie /api et répond 503 « service_asleep » quand l'origine dort.

import { useEffect, useState } from 'react';

export type EtatService =
	| { etat: 'attente' }
	| { etat: 'joignable'; modele: string | null; device: string | null; auth: string | null }
	| { etat: 'endormi'; detail: string }
	| { etat: 'injoignable'; detail: string };

/** Interprète la réponse de /api/health (statut HTTP, type et corps JSON éventuel). */
export function etatDepuisSante( status: number, type: string, corps: unknown ): EtatService {

	const json = type.includes( 'json' ) && corps && typeof corps === 'object' ? corps as Record<string, unknown> : null;
	const texte = ( k: string ) => ( json && typeof json[ k ] === 'string' ? json[ k ] as string : null );
	if ( status === 200 && json && ( texte( 'status' ) === 'ok' || texte( 'status' ) === 'degraded' ) ) {

		return { etat: 'joignable', modele: texte( 'modele' ), device: texte( 'device' ), auth: texte( 'auth' ) };

	}
	if ( status === 503 ) return { etat: 'endormi', detail: texte( 'error' ) ?? texte( 'message' ) ?? 'HTTP 503' };
	if ( status === 200 && ! json ) return { etat: 'injoignable', detail: 'pas de service /api derrière ce serveur (réponse non JSON)' };
	return { etat: 'injoignable', detail: `HTTP ${ status }` };

}

export async function lireSante( signal?: AbortSignal ): Promise<EtatService> {

	try {

		const r = await fetch( '/api/health', { headers: { accept: 'application/json' }, signal } );
		const type = r.headers.get( 'content-type' ) ?? '';
		const corps = type.includes( 'json' ) ? await r.json().catch( () => null ) : ( await r.body?.cancel().catch( () => {} ), null );
		return etatDepuisSante( r.status, type, corps );

	} catch ( e ) {

		if ( ( e as Error ).name === 'AbortError' ) throw e;
		return { etat: 'injoignable', detail: `réseau : ${ ( e as Error ).message }` };

	}

}

export function useServiceCalcul( periodeMs = 60_000 ): EtatService {

	const [ s, setS ] = useState<EtatService>( { etat: 'attente' } );
	useEffect( () => {

		let vivant = true;
		const ctl = new AbortController();
		const lire = () => lireSante( AbortSignal.any( [ ctl.signal, AbortSignal.timeout( 8000 ) ] ) ).then(
			( e ) => { if ( vivant ) setS( e ); },
			( e ) => { if ( vivant && ! ctl.signal.aborted ) setS( { etat: 'injoignable', detail: ( e as Error ).name === 'TimeoutError' ? 'délai dépassé' : ( e as Error ).message } ); },
		);
		lire();
		const t = setInterval( lire, periodeMs );
		return () => { vivant = false; ctl.abort(); clearInterval( t ); };

	}, [ periodeMs ] );
	return s;

}

export function ServiceCalcul( { s }: { s: EtatService } ) {

	return (
		<section className="f3-bloc" aria-labelledby="titre-service" data-testid="service-calcul" data-etat={ s.etat }>
			<h2 id="titre-service">Service de calcul</h2>
			{ s.etat === 'attente' ? <p className="muet" role="status">interrogation de /api/health…</p>
				: s.etat === 'joignable' ? (
					<dl className="f3-kv">
						<dt>État</dt><dd><span className="etat etat-ok">● joignable</span></dd>
						<dt>Poids servis</dt><dd>{ s.modele ?? 'non disponible' }</dd>
						<dt>Calcul sur</dt><dd>{ s.device ?? 'non disponible' }</dd>
					</dl>
				) : (
					<p data-testid="service-indisponible">
						<span className="etat etat-arret">○ { s.etat === 'endormi' ? 'endormi (GPU éteint)' : 'injoignable' }</span>
						<span className="muet"> · { s.detail }</span>
					</p>
				) }
			<p className="petit muet">
				Le tableau de bord n’en dépend pas : il affiche le dernier état publié (R2). Le service sert les nouvelles
				reconstructions, l’API (<code>/api/docs</code>) et le serveur MCP.
			</p>
		</section>
	);

}
