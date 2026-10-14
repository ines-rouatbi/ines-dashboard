// Fonctions pures du vent : vitesse, direction météo, conversions.
//
// Repère du contrat : u = composante Est, v = composante Nord, w = verticale (m/s).
// La direction météo indique D'OÙ VIENT le vent (0° = du nord, 90° = de l'est).

/** Vitesse en dessous de laquelle la direction est indéfinie (calme), en m/s. */
export const SEUIL_CALME = 0.2;

/** Vitesse horizontale (m/s). */
export function vitesseH( u: number, v: number ): number { return Math.hypot( u, v ); }

/** Vitesse 3D (m/s). */
export function vitesse3D( u: number, v: number, w: number ): number { return Math.hypot( u, v, w ); }

/**
 * Direction météo « d'où vient le vent », en degrés [0, 360).
 * (270 − atan2(v, u)·180/π) mod 360 ; `null` si la vitesse horizontale < 0,2 m/s.
 */
export function dirFrom( u: number, v: number ): number | null {

	if ( ! Number.isFinite( u ) || ! Number.isFinite( v ) ) return null;
	if ( vitesseH( u, v ) < SEUIL_CALME ) return null;
	const d = ( ( 270 - Math.atan2( v, u ) * 180 / Math.PI ) % 360 + 360 ) % 360;
	// Évite 360 par arrondi flottant et le « -0 ».
	return d >= 360 - 1e-9 ? 0 : d + 0;

}

const ROSE = [ 'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO' ];

/** Point cardinal (16 secteurs, notation française) d'une direction, ou « calme ». */
export function cardinal( dir: number | null ): string {

	if ( dir == null ) return 'calme';
	return ROSE[ Math.round( ( ( dir % 360 ) + 360 ) % 360 / 22.5 ) % 16 ];

}

export const msVersKmh = ( ms: number ) => ms * 3.6;
export const kmhVersMs = ( kmh: number ) => kmh / 3.6;
export const msVersNoeuds = ( ms: number ) => ms * 3600 / 1852;
export const noeudsVersMs = ( kt: number ) => kt * 1852 / 3600;
