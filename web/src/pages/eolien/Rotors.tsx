// Éoliennes animées (UI v2) : en PRODUCTION, le rotor tourne à une vitesse proportionnelle au vent publié au moyeu
// (hub_speed.p50). À l'arrêt pour vent trop faible ou trop fort, il tourne au RALENTI (roue libre, pales en drapeau,
// sans production), lentement et en gris. Indisponible ou vent au moyeu inconnu : immobile, « non disponible ».
// Des filets d'air défilent à une vitesse proportionnelle au vent publié. L'état est toujours écrit. Visualisation :
// la vitesse affichée n'est pas un régime publié (rpm), seulement un repère visuel proportionnel au vent.

import type { CSSProperties } from 'react';
import type { Turbine } from '../shared/types';
import { NA, TURBINE_STATE, num } from '../shared/format';
import { useMouvementReduit } from '../../ui/preferences';

/** Période d'un tour (s) pour l'animation, ou null si le rotor doit rester immobile. */
export function periodeRotor( t: Pick<Turbine, 'state' | 'hub_speed'> ): number | null {

	const v = t.hub_speed?.p50;
	if ( t.state !== 'production' || v == null || ! Number.isFinite( v ) || v <= 0 ) return null;
	// 1 tour en 12 s à 1 m/s, borné entre 0,8 s et 12 s : proportionnel au vent dans la plage utile.
	return Math.min( 12, Math.max( 0.8, 12 / v ) );

}

/** Période d'un tour (s) au ralenti (arrêt pour vent faible ou fort, vent publié > 0), sinon null. */
export function periodeRalenti( t: Pick<Turbine, 'state' | 'hub_speed'> ): number | null {

	const v = t.hub_speed?.p50;
	if ( ( t.state !== 'arret_vent_faible' && t.state !== 'arret_vent_fort' ) || v == null || ! Number.isFinite( v ) || v <= 0 ) return null;
	// Roue libre : toujours plus lent que la production (5 à 10 s par tour) ; pales en drapeau par vent fort (8 s).
	return t.state === 'arret_vent_fort' ? 8 : Math.min( 10, Math.max( 5, 12 / v ) );

}

/** Durée (s) de traversée d'un filet d'air : proportionnelle à 1/vent, bornée ; null si vent inconnu ou nul. */
export function dureeFilet( v: number | null | undefined ): number | null {

	if ( v == null || ! Number.isFinite( v ) || v <= 0 ) return null;
	return Math.min( 6, Math.max( 0.6, 6 / v ) );

}

function Rotor( { t }: { t: Turbine } ) {

	const reduit = useMouvementReduit();
	const production = periodeRotor( t ), ralenti = periodeRalenti( t );
	const periode = production ?? ralenti;
	const tourne = periode != null && ! reduit;
	const mode = production != null ? 'production' : ralenti != null ? 'ralenti' : 'immobile';
	const v = t.hub_speed?.p50;
	const filet = reduit ? null : dureeFilet( v );
	return (
		<figure className={ `rotor rotor-${ t.state } rotor-${ mode }` } data-testid="rotor" data-turbine-id={ t.id } data-tourne={ tourne ? 'oui' : 'non' } data-mode={ mode } data-periode={ periode ?? '' }>
			<svg viewBox="0 0 80 110" role="img" aria-label={ `${ t.name } : ${ TURBINE_STATE[ t.state ] ?? t.state }${ mode === 'ralenti' ? ' (rotor au ralenti)' : '' }, vent au moyeu ${ v == null ? NA : `${ num( v, 1 ) } m/s` }` }>
				{ filet != null && (
					<g className="rotor-filets" style={ { '--filet': `${ filet }s` } as CSSProperties } aria-hidden="true">
						{ [ 14, 30, 50, 66 ].map( ( y, k ) => <line key={ y } x1="-30" x2="-12" y1={ y } y2={ y } style={ { animationDelay: `${ - k * filet / 4 }s` } } /> ) }
					</g>
				) }
				<path className="rotor-mat" d="M38 40 L42 40 L44 106 L36 106 Z" />
				<g className={ `rotor-pales${ tourne ? ' tourne' : '' }` } style={ { '--periode': `${ periode ?? 0 }s` } as CSSProperties }>
					{ [ 0, 120, 240 ].map( ( a ) => <path key={ a } d="M40 38 C 37 28, 37 12, 40 4 C 43 12, 43 28, 40 38 Z" transform={ `rotate(${ a } 40 40)` } /> ) }
				</g>
				<circle className="rotor-moyeu" cx="40" cy="40" r="3.6" />
			</svg>
			<figcaption>
				<strong>{ t.name }</strong>
				<span className={ `atom-state-${ t.state }` }>{ TURBINE_STATE[ t.state ] ?? t.state }</span>
				{ mode === 'ralenti' && <span className="atom-muted petit" data-testid="rotor-ralenti">rotor au ralenti, sans production</span> }
				<span className="atom-muted num">moyeu { v == null ? NA : `${ num( v, 1 ) } m/s` } à { num( t.hub_agl_m ) } m</span>
			</figcaption>
		</figure>
	);

}

export function Rotors( { turbines }: { turbines: Turbine[] } ) {

	return (
		<div className="rotors" data-testid="rotors">
			{ turbines.map( ( t ) => <Rotor key={ t.id } t={ t } /> ) }
			<p className="atom-muted petit rotors-note">Rotation proportionnelle au vent publié au moyeu (repère visuel, pas un régime mesuré) ; hors production, rotor au ralenti (roue libre) ; immobile si indisponible ; filets d’air à la vitesse du vent publié.</p>
		</div>
	);

}
