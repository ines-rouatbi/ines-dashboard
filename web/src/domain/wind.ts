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

/** Arrondit un angle à `decimales` AVANT le modulo 360 (contrat m4) : 359,996 → 0 à 0,01 près. */
export function arrondirAngle( deg: number, decimales: number ): number {

	const p = 10 ** decimales;
	const d = ( ( Math.round( deg * p ) / p ) % 360 + 360 ) % 360;
	return d + 0; // pas de « -0 »

}

/**
 * Direction météo « d'où vient le vent », en degrés [0, 360), à 0,01° près comme le contrat.
 * (270 − atan2(v, u)·180/π), arrondie à 0,01° AVANT le modulo 360 (m4) ; `null` si la vitesse
 * horizontale < 0,2 m/s.
 */
export function dirFrom( u: number, v: number ): number | null {

	if ( ! Number.isFinite( u ) || ! Number.isFinite( v ) ) return null;
	if ( vitesseH( u, v ) < SEUIL_CALME ) return null;
	return arrondirAngle( 270 - Math.atan2( v, u ) * 180 / Math.PI, 2 );

}

/** Direction affichée à `decimales` près : l'arrondi d'affichage passe aussi AVANT le modulo (359,6 → « 0 »). */
export function dirAffichee( dir: number | null, decimales = 0 ): string {

	if ( dir == null || ! Number.isFinite( dir ) ) return 'calme';
	return arrondirAngle( dir, decimales ).toLocaleString( 'fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales } );

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
