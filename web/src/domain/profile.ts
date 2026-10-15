// Profil vertical au clic, CALCULÉ PAR LE FRONT à partir de la colonne brute /v1/column/{id}?i&j
// (contrat v1 rév. 2, B3 et D6). Le Worker ne fait que les conversions (NaN → null, uint8 × scale,
// 255 → null) ; le front ajoute, avec les formules du contrat :
//   - direction météo (d'où vient le vent) : dirFrom(u, v), null si vitesse < 0,2 m/s ;
//   - intervalle à 80 % : p50 = speed, p10 = max(0, speed − 1,2816·sigma_speed),
//     p90 = speed + 1,2816·sigma_speed ; tout null si sigma_speed est inconnu ;
//   - statut : 1 → « mesure », 0 → « estime ».
// La classe de fiabilité n'est pas recalculée (seuils non publiés, D4) : elle vaut null.

import type { Column, ColumnLevel, ProfileLevel } from '../data/contract';
import { dirFrom } from './wind';

/** Quantile 0,9 de la loi normale : ±Z80·σ encadre 80 % des valeurs. */
export const Z80 = 1.2816;

export interface ProfilCalcule {
	i: number;
	j: number;
	x_m: number;
	y_m: number;
	z_terrain_m: number;
	levels: ProfileLevel[];
}

/** Intervalle à 80 % de la vitesse (p10 borné à 0) ; null partout si une donnée manque. */
export function intervalle80( speed: number | null, sigma: number | null ): ProfileLevel[ 'speed_interval' ] {

	if ( speed == null || sigma == null || ! Number.isFinite( speed ) || ! Number.isFinite( sigma ) ) return { p10: null, p50: null, p90: null };
	return { p10: Math.max( 0, speed - Z80 * sigma ), p50: speed, p90: speed + Z80 * sigma };

}

/** Un niveau de colonne brute → niveau de profil au format du contrat. */
export function niveauDepuisColonne( l: ColumnLevel ): ProfileLevel {

	const base = { z_asl_m: l.z_asl_m, z_agl_m: l.z_agl_m, below_terrain: l.below_terrain };
	// Sous le relief : below_terrain = true. Au-dessus du relief mais sans valeur (null) : below_terrain
	// reste false et tout est null (« non disponible »), jamais présenté comme « sous le relief ».
	if ( l.below_terrain || l.u == null || l.v == null || l.speed == null ) {

		return {
			...base,
			u: null, v: null, w: null, speed: null, sigma_speed: null, dir_from_deg: null,
			speed_interval: { p10: null, p50: null, p90: null },
			status: null, coverage: null, reliability: null, reliability_class: null,
		};

	}

	const iv = intervalle80( l.speed, l.sigma_speed );
	return {
		...base,
		u: l.u, v: l.v, w: l.w, speed: l.speed, sigma_speed: l.sigma_speed,
		dir_from_deg: dirFrom( l.u, l.v ),
		// Sans sigma, p50 reste la vitesse servie (D6).
		speed_interval: iv.p50 == null ? { p10: null, p50: l.speed, p90: null } : iv,
		status: l.status === 1 ? 'mesure' : l.status === 0 ? 'estime' : null,
		coverage: l.coverage,
		reliability: l.reliability,
		reliability_class: null,
	};

}

/** Profil complet d'une colonne. */
export function profilDepuisColonne( c: Column ): ProfilCalcule {

	return { i: c.i, j: c.j, x_m: c.x_m, y_m: c.y_m, z_terrain_m: c.z_terrain_m, levels: c.levels.map( niveauDepuisColonne ) };

}
