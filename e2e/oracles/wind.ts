// Oracles de test ATOM (F5-c) : calculs de référence en TypeScript pur, sans dépendance.
//
// Décision D4 du plan : les calculs scientifiques ne vivent qu'en Python. Ce fichier ne sert
// QU'À VÉRIFIER ce que renvoient /v1/fields, /v1/wind-farm et /v1/windrose ; le front ne doit
// jamais l'importer pour afficher quoi que ce soit.

export const DEG = 180 / Math.PI;

/** Vitesse en dessous de laquelle la direction est indéfinie (contrat v1, section 3). */
export const CALM_THRESHOLD = 0.2;

/** Densité de l'air de référence (IEC 61400-12-1), kg/m³. */
export const RHO_0 = 1.225;

// ─── Direction ──────────────────────────────────────────────────────────────

/**
 * Direction météo (d'où vient le vent), en degrés dans [0, 360).
 * Contrat : (270 − atan2(v, u)) mod 360, indéfinie si la vitesse est strictement < 0,2 m/s.
 */
export function windDirection( u: number, v: number ): number | null {

	if ( ! Number.isFinite( u ) || ! Number.isFinite( v ) ) return null;
	if ( Math.hypot( u, v ) < CALM_THRESHOLD ) return null;
	const d = ( 270 - Math.atan2( v, u ) * DEG ) % 360;
	const r = d < 0 ? d + 360 : d;
	return r >= 360 ? 0 : r;

}

/** Plus petit écart angulaire entre deux directions, en degrés dans [0, 180]. */
export function angularDiff( a: number, b: number ): number {

	const d = Math.abs( a - b ) % 360;
	return d > 180 ? 360 - d : d;

}

// ─── Champs binaires ────────────────────────────────────────────────────────

/**
 * Décode un champ du contrat : Float32 little-endian, ordre [j][i] (j du sud au nord,
 * i d'ouest en est), NaN sous le relief. DataView rend le décodage indépendant de la machine.
 */
export function decodeField( buf: ArrayBuffer, nx: number, ny: number ) {

	if ( buf.byteLength !== nx * ny * 4 ) {

		throw new Error( `taille du champ ${ buf.byteLength } o, attendu ${ nx * ny * 4 } o (${ nx } × ${ ny } × 4)` );

	}

	const view = new DataView( buf );
	const data = new Float32Array( nx * ny );
	for ( let k = 0; k < data.length; k ++ ) data[ k ] = view.getFloat32( k * 4, true );
	return {
		data,
		at: ( i: number, j: number ) => data[ j * nx + i ],
	};

}

/** Min, max et nombre de valeurs finies d'un champ, en ignorant les NaN du relief. */
export function finiteStats( values: ArrayLike<number> ) {

	let min = Infinity, max = - Infinity, n = 0, nan = 0;
	for ( let k = 0; k < values.length; k ++ ) {

		const x = values[ k ];
		if ( Number.isNaN( x ) ) { nan ++; continue; }
		if ( x < min ) min = x;
		if ( x > max ) max = x;
		n ++;

	}

	return n ? { min, max, n, nan } : { min: null, max: null, n, nan };

}

// ─── Hauteur au-dessus du sol / altitude ────────────────────────────────────

/** Altitude au-dessus de la mer d'un point situé à `agl` m au-dessus d'un sol à `terrain` m. */
export const aslFromAgl = ( agl: number, terrain: number ) => terrain + agl;

/**
 * Valeur à `agl` m au-dessus du sol, par interpolation linéaire entre des niveaux exprimés en
 * altitude (décision D6). NaN si le point est sous le relief ou hors de la colonne.
 */
export function sampleAtAgl( levelsAsl: number[], values: number[], terrain: number, agl: number ): number {

	if ( agl < 0 ) return NaN;
	const z = aslFromAgl( agl, terrain );
	for ( let k = 0; k < levelsAsl.length - 1; k ++ ) {

		const z0 = levelsAsl[ k ], z1 = levelsAsl[ k + 1 ];
		if ( z >= z0 && z <= z1 ) {

			const a = values[ k ], b = values[ k + 1 ];
			if ( Number.isNaN( a ) || Number.isNaN( b ) ) return NaN;
			const t = z1 === z0 ? 0 : ( z - z0 ) / ( z1 - z0 );
			return a + t * ( b - a );

		}

	}

	return NaN;

}

// ─── Profil, vent au moyeu, vent équivalent rotor ───────────────────────────

/** Interpolation linéaire d'un profil vertical (hauteurs croissantes), bornée aux extrémités. */
export function interpProfile( heights: number[], speeds: number[], z: number ): number {

	const n = heights.length;
	if ( n === 0 ) return NaN;
	if ( z <= heights[ 0 ] ) return speeds[ 0 ];
	if ( z >= heights[ n - 1 ] ) return speeds[ n - 1 ];
	for ( let k = 0; k < n - 1; k ++ ) {

		if ( z <= heights[ k + 1 ] ) {

			const t = ( z - heights[ k ] ) / ( heights[ k + 1 ] - heights[ k ] );
			return speeds[ k ] + t * ( speeds[ k + 1 ] - speeds[ k ] );

		}

	}

	return speeds[ n - 1 ];

}

/**
 * Vent équivalent rotor (REWS) : racine cubique de la moyenne de v³ pondérée par l'aire du disque.
 * Intégration par bandes horizontales : largeur de corde 2·√(R² − (z − H)²).
 */
export function rews( profile: ( z: number ) => number, hubHeight: number, rotorDiameter: number, strips = 2000 ): number {

	const R = rotorDiameter / 2;
	const dz = rotorDiameter / strips;
	let num = 0, den = 0;
	for ( let s = 0; s < strips; s ++ ) {

		const z = hubHeight - R + ( s + 0.5 ) * dz;
		const w = 2 * Math.sqrt( Math.max( 0, R * R - ( z - hubHeight ) ** 2 ) ) * dz;
		num += w * profile( z ) ** 3;
		den += w;

	}

	return Math.cbrt( num / den );

}

/** Exposant de cisaillement α entre deux hauteurs : v2/v1 = (z2/z1)^α. */
export const shearExponent = ( z1: number, v1: number, z2: number, v2: number ) => Math.log( v2 / v1 ) / Math.log( z2 / z1 );

// ─── Courbe de puissance ────────────────────────────────────────────────────

export interface PowerCurve {
	/** Vitesses croissantes (m/s) et puissances associées (kW), à la densité RHO_0. */
	speeds: number[];
	power: number[];
	cutIn: number;
	cutOut: number;
}

/**
 * Puissance (kW) pour une vitesse donnée. Démarrage et coupure s'appliquent à la vitesse RÉELLE
 * (c'est elle que voit la régulation de l'éolienne) ; la correction de densité IEC 61400-12-1
 * ne sert qu'à lire la courbe : vitesse normalisée v·(ρ/ρ0)^(1/3), puis interpolation linéaire.
 */
export function powerAt( curve: PowerCurve, v: number, rho = RHO_0 ): number {

	if ( ! Number.isFinite( v ) ) return NaN;
	if ( v < curve.cutIn || v > curve.cutOut ) return 0;
	const vn = v * Math.cbrt( rho / RHO_0 );
	return Math.max( 0, interpProfile( curve.speeds, curve.power, vn ) );

}

// ─── Weibull ────────────────────────────────────────────────────────────────

/** Fonction Γ (approximation de Lanczos, g = 7, 9 coefficients ; erreur relative < 1e-13). */
export function gamma( x: number ): number {

	const g = 7;
	const c = [ 0.99999999999980993, 676.5203681218851, - 1259.1392167224028, 771.32342877765313,
		- 176.61502916214059, 12.507343278686905, - 0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7 ];
	if ( x < 0.5 ) return Math.PI / ( Math.sin( Math.PI * x ) * gamma( 1 - x ) );
	x -= 1;
	let a = c[ 0 ];
	const t = x + g + 0.5;
	for ( let k = 1; k < g + 2; k ++ ) a += c[ k ] / ( x + k );
	return Math.sqrt( 2 * Math.PI ) * t ** ( x + 0.5 ) * Math.exp( - t ) * a;

}

export interface Weibull { k: number; c: number; n: number }

const positives = ( xs: number[] ) => xs.filter( ( x ) => Number.isFinite( x ) && x > 0 );

/** Bornes de recherche de k. Hors de ces bornes, l'ajustement est refusé explicitement. */
export const WEIBULL_K_RANGE = [ 0.05, 50 ] as const;

function weibullInput( samples: number[] ) {

	const xs = positives( samples );
	if ( xs.length < 2 ) throw new Error( `Weibull : ${ xs.length } vitesse(s) strictement positive(s), au moins 2 requises` );
	return xs;

}

const outOfRange = ( method: string, k: number | string ) =>
	new Error( `Weibull (${ method }) : k = ${ k } hors de [${ WEIBULL_K_RANGE.join( ' ; ' ) }] (échantillon quasi constant ?)` );

/** Moyenne d'une loi de Weibull : c·Γ(1 + 1/k). */
export const weibullMean = ( { k, c }: { k: number; c: number } ) => c * gamma( 1 + 1 / k );

/** Quantile p d'une loi de Weibull. */
export const weibullQuantile = ( k: number, c: number, p: number ) => c * ( - Math.log( 1 - p ) ) ** ( 1 / k );

/** Ajustement par la méthode empirique des moments (Justus) : k = (σ/μ)^−1,086, c = μ/Γ(1 + 1/k). */
export function weibullMoments( samples: number[] ): Weibull {

	const xs = weibullInput( samples );
	const n = xs.length;
	const mu = xs.reduce( ( s, x ) => s + x, 0 ) / n;
	const sigma = Math.sqrt( xs.reduce( ( s, x ) => s + ( x - mu ) ** 2, 0 ) / ( n - 1 ) );
	const k = ( sigma / mu ) ** - 1.086;
	if ( ! ( k >= WEIBULL_K_RANGE[ 0 ] && k <= WEIBULL_K_RANGE[ 1 ] ) ) throw outOfRange( 'moments', k );
	return { k, c: mu / gamma( 1 + 1 / k ), n };

}

/**
 * Ajustement par maximum de vraisemblance. k est la racine de
 * Σxᵏ·ln x / Σxᵏ − 1/k − moyenne(ln x) = 0 (fonction croissante de k : bissection) ; c = (moyenne xᵏ)^(1/k).
 */
export function weibullMle( samples: number[] ): Weibull {

	const xs = weibullInput( samples );
	const n = xs.length;
	const meanLn = xs.reduce( ( s, x ) => s + Math.log( x ), 0 ) / n;
	const f = ( k: number ) => {

		let a = 0, b = 0;
		for ( const x of xs ) { const p = x ** k; a += p * Math.log( x ); b += p; }
		return a / b - 1 / k - meanLn;

	};

	let [ lo, hi ]: number[] = [ ...WEIBULL_K_RANGE ];
	// f est croissante : sans changement de signe entre les bornes, la racine est dehors et on le dit.
	if ( ! ( f( lo ) < 0 && f( hi ) > 0 ) ) throw outOfRange( 'vraisemblance', `racine hors bornes` );
	for ( let it = 0; it < 200; it ++ ) {

		const mid = ( lo + hi ) / 2;
		if ( f( mid ) > 0 ) hi = mid; else lo = mid;

	}

	const k = ( lo + hi ) / 2;
	const c = ( xs.reduce( ( s, x ) => s + x ** k, 0 ) / n ) ** ( 1 / k );
	return { k, c, n };

}

// ─── Rose des vents ─────────────────────────────────────────────────────────

export interface WindRose {
	sectors: number;
	/** Centre de chaque secteur, en degrés (le secteur 0 est centré sur le nord). */
	centers: number[];
	counts: number[];
	/** Fréquence par secteur, rapportée aux seuls instants valides non calmes. */
	freq: number[];
	meanSpeed: ( number | null )[];
	/** Instants à vitesse et direction définies (le « nombre d'instants valides » du contrat). */
	nValid: number;
	nCalm: number;
	nInvalid: number;
}

/** Index du secteur d'une direction : secteurs de 360/n degrés centrés sur 0°, 360/n, … */
export function sectorOf( dir: number, sectors: number ): number {

	const w = 360 / sectors;
	return Math.floor( ( ( dir + w / 2 ) % 360 + 360 ) % 360 / w ) % sectors;

}

export function windRose( samples: { u: number; v: number }[], sectors = 16 ): WindRose {

	const counts = new Array( sectors ).fill( 0 ), sums = new Array( sectors ).fill( 0 );
	let nCalm = 0, nInvalid = 0;
	for ( const { u, v } of samples ) {

		if ( ! Number.isFinite( u ) || ! Number.isFinite( v ) ) { nInvalid ++; continue; }
		const d = windDirection( u, v );
		if ( d === null ) { nCalm ++; continue; }
		const s = sectorOf( d, sectors );
		counts[ s ] ++;
		sums[ s ] += Math.hypot( u, v );

	}

	const nValid = counts.reduce( ( a, b ) => a + b, 0 );
	return {
		sectors,
		centers: counts.map( ( _, s ) => s * 360 / sectors ),
		counts,
		freq: counts.map( ( c ) => nValid ? c / nValid : 0 ),
		meanSpeed: counts.map( ( c, s ) => c ? sums[ s ] / c : null ),
		nValid, nCalm, nInvalid,
	};

}
