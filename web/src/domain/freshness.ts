// Fraîcheur du dernier état publié (bandeau « dernier état réel »).
//
// Règle (coordination F0) : le bandeau s'affiche si et seulement si
// `compute_status !== "online"` dans /v1/latest. C'est le Worker qui calcule
// compute_status à partir du battement de cœur du GPU ; le front ne compare PAS
// les horodatages à l'heure courante (les instantanés de test ont des dates fixes).

import type { Latest } from '../data/contract';

export function calculArrete( latest: { compute_status: Latest[ 'compute_status' ] | string } ): boolean {

	return latest.compute_status !== 'online';

}

/** Date locale lisible (fuseau du navigateur), ou la chaîne brute si illisible. */
export function dateLocale( iso: string | null | undefined, locale = 'fr-FR', timeZone?: string ): string {

	if ( ! iso ) return '—';
	const d = new Date( iso );
	if ( Number.isNaN( d.getTime() ) ) return iso;
	return d.toLocaleString( locale, { dateStyle: 'long', timeStyle: 'short', timeZone } );

}

/** Texte du bandeau, ou null si le calcul est en ligne. */
export function texteBandeau( latest: { compute_status: Latest[ 'compute_status' ] | string; generated_at: string }, locale = 'fr-FR', timeZone?: string ): string | null {

	if ( ! calculArrete( latest ) ) return null;
	return `Dernier état réel calculé le ${ dateLocale( latest.generated_at, locale, timeZone ) } — nouvelles reconstructions indisponibles`;

}
