// Mise en forme pour l'affichage (aucun calcul scientifique : décision D4).
// Règle B5 : une valeur null s'affiche « non disponible », jamais 0 ni un tiret.
import type { AlertKind, AlertLevel, AirDensitySource, Interval, TurbineState } from './types';

export const NA = 'non disponible';

export function num( x: number | null | undefined, digits = 0 ): string {

	if ( x == null || ! Number.isFinite( x ) ) return NA;
	return x.toLocaleString( 'fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits } );

}

/** Grandeur à précision libre (au plus `max` décimales, sans zéros inutiles) avec son unité. */
export function quantity( x: number | null | undefined, unit: string | null, max = 2 ): string {

	if ( x == null || ! Number.isFinite( x ) ) return NA;
	const s = x.toLocaleString( 'fr-FR', { maximumFractionDigits: max } );
	return unit ? `${ s } ${ unit }` : s;

}

export function withUnit( x: number | null | undefined, unit: string, digits = 0 ): string {

	const s = num( x, digits );
	return s === NA ? NA : `${ s } ${ unit }`;

}

/** « 1 664 kW [1 529 – 1 797] » ; bornes inconnues signalées une par une. */
export function interval( iv: Interval | null | undefined, unit: string, digits = 0 ): string {

	if ( ! iv || iv.p50 == null ) return NA;
	const lo = iv.p10 == null ? NA : num( iv.p10, digits );
	const hi = iv.p90 == null ? NA : num( iv.p90, digits );
	return `${ num( iv.p50, digits ) } ${ unit } [${ lo } – ${ hi }]`;

}

/** Rotation avec signe explicite : « +2,3° (horaire) ». */
export function veer( deg: number | null ): string {

	if ( deg == null ) return NA;
	const sign = deg > 0 ? '+' : deg < 0 ? '−' : '';
	const sense = deg > 0 ? ' (horaire)' : deg < 0 ? ' (antihoraire)' : '';
	return `${ sign }${ num( Math.abs( deg ), 1 ) }°${ sense }`;

}

/** Date ISO UTC lisible, en UTC (les instantanés sont datés en UTC). */
export function utc( iso: string | null | undefined ): string {

	if ( ! iso ) return NA;
	const d = new Date( iso );
	if ( Number.isNaN( d.getTime() ) ) return NA;
	return d.toLocaleString( 'fr-FR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' } ) + ' UTC';

}

export const TURBINE_STATE: Record<TurbineState, string> = {
	production: 'En production',
	arret_vent_faible: 'À l’arrêt : vent trop faible',
	arret_vent_fort: 'À l’arrêt : vent trop fort',
	indisponible: 'Indisponible',
};

export const AIR_DENSITY_SOURCE: Record<Exclude<AirDensitySource, null>, string> = {
	atmosphere_standard: 'atmosphère standard',
	extrapolation_surface: 'extrapolée de la surface',
	mesure: 'mesurée',
};

export const ALERT_LEVEL: Record<AlertLevel, string> = {
	critique: 'Critique',
	important: 'Important',
	avertissement: 'Avertissement',
	information: 'Information',
};

/** Ordre d'affichage : le plus grave d'abord. */
export const LEVEL_RANK: Record<AlertLevel, number> = { critique: 0, important: 1, avertissement: 2, information: 3 };

export const ALERT_KIND: Record<AlertKind, string> = {
	hors_plage: 'Mesure hors plage',
	station_muette: 'Capteur muet',
	stations_insuffisantes: 'Capteurs valides insuffisants',
	capteur_derive: 'Capteur en dérive',
	incoherence_physique: 'Incohérence physique',
	derive_entrees: 'Dérive des données d’entrée',
	zone_mal_couverte: 'Zone mal couverte',
	vent_fort_moyeu: 'Vent fort au moyeu',
	cisaillement: 'Cisaillement',
};
