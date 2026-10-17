// Rotors des éoliennes dans la scène 3D (UI v2) : fonctions pures, sans three.js.
//
// Le rotor fait face au vent publié au moyeu : provenance (direction météo, D9) lue dans le profil précalculé
// de l'éolienne (/v1/profiles/{id}/{point_id}), au niveau publié le plus proche de la hauteur du moyeu, sans
// interpolation d'angle. Provenance inconnue : rotor tourné vers le sud (face à la vue par défaut), signalé.
// Vitesse de rotation : mêmes règles que la page Éolien (production proportionnelle au vent, ralenti à l'arrêt,
// immobile si indisponible) ; repère visuel, pas un régime publié.

import type { Profile } from '../data/contract.gen';

export type ModeRotor = 'production' | 'ralenti' | 'immobile';

/** Rotor d'une éolienne : période d'un tour (s, null = immobile), provenance du vent au moyeu (°), mode. */
export interface RotorRepere { periode: number | null; dirFromDeg: number | null; mode: ModeRotor }

/**
 * Provenance du vent (°, météo) au niveau publié le plus proche de la hauteur du moyeu (m au-dessus du sol),
 * parmi les niveaux au-dessus du relief qui ont une direction ; null si aucun.
 */
export function provenanceAuMoyeu( profil: Pick<Profile, 'levels'> | null | undefined, hubAglM: number ): number | null {

	let best: number | null = null, ecart = Infinity;
	for ( const l of profil?.levels ?? [] ) {

		if ( l.below_terrain || l.dir_from_deg == null || ! Number.isFinite( l.dir_from_deg ) ) continue;
		const e = Math.abs( l.z_agl_m - hubAglM );
		if ( e < ecart ) { ecart = e; best = l.dir_from_deg; }

	}
	return best;

}

/**
 * Angle (rad) autour de l'axe vertical qui tourne la normale du disque (+Z local) vers la provenance du vent.
 * Repère de la scène : X = Est, Z = −Nord ; provenance θ (depuis le nord, sens horaire) → (sin θ, 0, −cos θ).
 * Provenance inconnue : 0 (normale vers +Z, le sud).
 */
export function orientationRotor( dirFromDeg: number | null ): number {

	if ( dirFromDeg == null || ! Number.isFinite( dirFromDeg ) ) return 0;
	const t = dirFromDeg * Math.PI / 180;
	return Math.atan2( Math.sin( t ), - Math.cos( t ) );

}

/** Vitesse angulaire (rad/s) pour une période d'un tour, 0 si immobile. */
export const vitesseAngulaire = ( periode: number | null ) => ( periode != null && periode > 0 ? 2 * Math.PI / periode : 0 );
