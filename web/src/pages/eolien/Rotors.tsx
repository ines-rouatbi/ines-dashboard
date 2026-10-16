// Éoliennes animées (UI v2) : le rotor tourne à une vitesse proportionnelle au vent publié au moyeu (hub_speed.p50)
// et seulement si l'éolienne est EN PRODUCTION ; à l'arrêt (vent trop faible ou trop fort) ou indisponible, il est
// immobile, et l'état est toujours écrit. Vent au moyeu inconnu : immobile, « non disponible ». Visualisation : la
// vitesse de rotation affichée n'est pas un régime publié (rpm), seulement un repère visuel proportionnel au vent.

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

function Rotor( { t }: { t: Turbine } ) {

	const reduit = useMouvementReduit();
	const periode = periodeRotor( t );
	const tourne = periode != null && ! reduit;
	const v = t.hub_speed?.p50;
	return (
		<figure className={ `rotor rotor-${ t.state }` } data-testid="rotor" data-turbine-id={ t.id } data-tourne={ tourne ? 'oui' : 'non' } data-periode={ periode ?? '' }>
			<svg viewBox="0 0 80 110" role="img" aria-label={ `${ t.name } : ${ TURBINE_STATE[ t.state ] ?? t.state }, vent au moyeu ${ v == null ? NA : `${ num( v, 1 ) } m/s` }` }>
				<path className="rotor-mat" d="M38 40 L42 40 L44 106 L36 106 Z" />
				<g className={ `rotor-pales${ tourne ? ' tourne' : '' }` } style={ { '--periode': `${ periode ?? 0 }s` } as CSSProperties }>
					{ [ 0, 120, 240 ].map( ( a ) => <path key={ a } d="M40 38 C 37 28, 37 12, 40 4 C 43 12, 43 28, 40 38 Z" transform={ `rotate(${ a } 40 40)` } /> ) }
				</g>
				<circle className="rotor-moyeu" cx="40" cy="40" r="3.6" />
			</svg>
			<figcaption>
				<strong>{ t.name }</strong>
				<span className={ `atom-state-${ t.state }` }>{ TURBINE_STATE[ t.state ] ?? t.state }</span>
				<span className="atom-muted num">moyeu { v == null ? NA : `${ num( v, 1 ) } m/s` } à { num( t.hub_agl_m ) } m</span>
			</figcaption>
		</figure>
	);

}

export function Rotors( { turbines }: { turbines: Turbine[] } ) {

	return (
		<div className="rotors" data-testid="rotors">
			{ turbines.map( ( t ) => <Rotor key={ t.id } t={ t } /> ) }
			<p className="atom-muted petit rotors-note">Rotation proportionnelle au vent publié au moyeu (repère visuel, pas un régime mesuré) ; rotor immobile hors production.</p>
		</div>
	);

}
