// Particules de vent d'une carte 2D (UI v2) : advection de traceurs dans le champ horizontal publié (u, v) à une
// hauteur donnée. Fonctions pures, sans DOM (testées) ; le dessin est dans ui/ChampParticules.tsx.
//
// Règles de justesse :
//   - le champ est lu tel quel, par interpolation bilinéaire STRICTE entre 4 nœuds publiés : un nœud absent (NaN,
//     sous le relief, hors du domaine vertical) arrête la particule, qui renaît ailleurs ; jamais de vent inventé ;
//   - c'est une VISUALISATION : le temps est accéléré (facteurTemps) pour que le mouvement se voie ; la vitesse et la
//     direction affichées en infobulle restent celles des nœuds publiés ;
//   - repère du contrat : u vers l'Est, v vers le Nord ; nœud (i, j) avec j = 0 au sud ; écran nord en haut.

/** Champ horizontal d'une carte : u, v de nx·ny valeurs (index j·nx + i), NaN = absent. */
export interface ChampVent {
	nx: number;
	ny: number;
	/** Pas de grille (m). */
	dx: number;
	dy: number;
	u: Float32Array;
	v: Float32Array;
}

/** Population de particules en coordonnées de grille fractionnaires (fi, fj). Tableaux préalloués. */
export interface Particules {
	n: number;
	fi: Float32Array;
	fj: Float32Array;
	/** Position précédente (début du segment dessiné). */
	pi: Float32Array;
	pj: Float32Array;
	/** Âge et durée de vie (s). */
	age: Float32Array;
	vie: Float32Array;
	/** Vitesse horizontale au dernier pas (m/s), NaN si la particule vient de renaître. */
	vitesse: Float32Array;
}

export type Alea = () => number;

/** Générateur pseudo-aléatoire déterministe (mulberry32) : tests reproductibles. */
export function aleaGraine( graine: number ): Alea {

	let a = graine >>> 0;
	return () => {

		a = ( a + 0x6D2B79F5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

export function creerParticules( capacite: number ): Particules {

	const f = () => new Float32Array( capacite );
	return { n: 0, fi: f(), fj: f(), pi: f(), pj: f(), age: f(), vie: f(), vitesse: f() };

}

/**
 * (u, v) en (fi, fj) par interpolation bilinéaire stricte ; écrit dans `out` et renvoie true, ou false si un des
 * nœuds utiles est absent ou si le point est hors du domaine.
 */
export function ventEn( c: ChampVent, fi: number, fj: number, out: Float32Array | number[] ): boolean {

	if ( ! ( fi >= 0 && fj >= 0 && fi <= c.nx - 1 && fj <= c.ny - 1 ) ) return false;
	const i = Math.min( Math.floor( fi ), c.nx - 2 ), j = Math.min( Math.floor( fj ), c.ny - 2 );
	const a = fi - i, b = fj - j, k = j * c.nx + i;
	const w00 = ( 1 - a ) * ( 1 - b ), w10 = a * ( 1 - b ), w01 = ( 1 - a ) * b, w11 = a * b;
	let u = 0, v = 0;
	// Un nœud de poids nul n'intervient pas ; un nœud utile absent rend le point indéfini.
	const ajouter = ( w: number, q: number ) => {

		if ( w <= 0 ) return true;
		const uq = c.u[ q ], vq = c.v[ q ];
		if ( Number.isNaN( uq ) || Number.isNaN( vq ) ) return false;
		u += w * uq; v += w * vq;
		return true;

	};
	if ( ! ajouter( w00, k ) || ! ajouter( w10, k + 1 ) || ! ajouter( w01, k + c.nx ) || ! ajouter( w11, k + c.nx + 1 ) ) return false;
	out[ 0 ] = u; out[ 1 ] = v;
	return true;

}

/** Indices des nœuds où le vent est publié (u et v définis) : lieux de naissance des particules. */
export function noeudsValides( c: ChampVent ): Uint32Array {

	let n = 0;
	for ( let k = 0; k < c.u.length; k ++ ) if ( ! Number.isNaN( c.u[ k ] ) && ! Number.isNaN( c.v[ k ] ) ) n ++;
	const out = new Uint32Array( n );
	n = 0;
	for ( let k = 0; k < c.u.length; k ++ ) if ( ! Number.isNaN( c.u[ k ] ) && ! Number.isNaN( c.v[ k ] ) ) out[ n ++ ] = k;
	return out;

}

/** Maximum de la vitesse horizontale publiée (m/s), ou null si aucun nœud. */
export function vitesseMax( c: ChampVent ): number | null {

	let m = - Infinity;
	for ( let k = 0; k < c.u.length; k ++ ) {

		const s = Math.hypot( c.u[ k ], c.v[ k ] );
		if ( s > m ) m = s; // NaN est ignoré (comparaison fausse)

	}
	return Number.isFinite( m ) ? m : null;

}

/**
 * Accélération du temps (s simulées par s affichée) : la vitesse maximale du champ parcourt `cellulesParSeconde`
 * mailles par seconde à l'écran. Purement visuel ; indiqué dans la légende (« temps accéléré »).
 */
export function facteurTemps( vmax: number | null, dx: number, dy: number, cellulesParSeconde = 18 ): number {

	if ( ! vmax || ! ( vmax > 0 ) ) return 0;
	return cellulesParSeconde * Math.min( dx, dy ) / vmax;

}

/** Fait (re)naître la particule k sur un nœud publié tiré au hasard, avec un décalage dans sa maille. */
export function naitre( p: Particules, k: number, valides: Uint32Array, nx: number, alea: Alea, vieMax: number ) {

	if ( ! valides.length ) { p.age[ k ] = p.vie[ k ] = 0; p.vitesse[ k ] = NaN; return; }
	const q = valides[ Math.min( valides.length - 1, Math.floor( alea() * valides.length ) ) ];
	const i = q % nx, j = ( q - i ) / nx;
	p.fi[ k ] = p.pi[ k ] = i + ( alea() - 0.5 ) * 0.9;
	p.fj[ k ] = p.pj[ k ] = j + ( alea() - 0.5 ) * 0.9;
	p.age[ k ] = 0;
	p.vie[ k ] = vieMax * ( 0.35 + 0.65 * alea() );
	p.vitesse[ k ] = NaN;

}

/** Remplit la population jusqu'à `n` particules (âges étalés pour éviter une renaissance synchrone). */
export function peupler( p: Particules, n: number, c: ChampVent, valides: Uint32Array, alea: Alea, vieMax: number ) {

	const cible = Math.min( n, p.fi.length );
	for ( let k = p.n; k < cible; k ++ ) { naitre( p, k, valides, c.nx, alea, vieMax ); p.age[ k ] = p.vie[ k ] * alea(); }
	p.n = cible;

}

const _uv = new Float32Array( 2 );

/**
 * Un pas d'advection (Euler, RK2 au point milieu) de `dt` secondes affichées. Une particule qui sort du domaine,
 * entre dans une maille sans vent publié, atteint sa fin de vie ou tombe sous le seuil de calme renaît ailleurs.
 * Aucune allocation.
 */
export function avancer( p: Particules, c: ChampVent, dt: number, facteur: number, valides: Uint32Array, alea: Alea, vieMax: number ) {

	const ki = dt * facteur / c.dx, kj = dt * facteur / c.dy;
	for ( let k = 0; k < p.n; k ++ ) {

		p.pi[ k ] = p.fi[ k ]; p.pj[ k ] = p.fj[ k ];
		p.age[ k ] += dt;
		if ( p.age[ k ] > p.vie[ k ] || ! ventEn( c, p.fi[ k ], p.fj[ k ], _uv ) ) { naitre( p, k, valides, c.nx, alea, vieMax ); continue; }
		const mi = p.fi[ k ] + _uv[ 0 ] * ki / 2, mj = p.fj[ k ] + _uv[ 1 ] * kj / 2;
		if ( ! ventEn( c, mi, mj, _uv ) ) { naitre( p, k, valides, c.nx, alea, vieMax ); continue; }
		p.fi[ k ] += _uv[ 0 ] * ki;
		p.fj[ k ] += _uv[ 1 ] * kj;
		p.vitesse[ k ] = Math.hypot( _uv[ 0 ], _uv[ 1 ] );

	}

}

/** Nombre de particules pour une surface (px CSS) et une part de nœuds publiés, borné. */
export function nombreParticules( largeur: number, hauteur: number, partValide: number, pxParParticule = 140, min = 120, max = 6000 ): number {

	const n = Math.round( largeur * hauteur * Math.min( 1, Math.max( 0, partValide ) ) / pxParParticule );
	if ( ! Number.isFinite( n ) || n <= 0 ) return 0;
	return Math.min( max, Math.max( min, n ) );

}

/** Réduction adaptative : si l'image dure trop (moyenne, ms), on retire un quart des particules. */
export function ajusterDensite( n: number, dureeMoyenneMs: number, min: number, budgetMs = 22 ): number {

	if ( dureeMoyenneMs <= budgetMs || n <= min ) return n;
	return Math.max( min, Math.floor( n * 0.75 ) );

}

/** Grille (fi, fj) → écran (px CSS), nord en haut ; centre de la maille du nœud (i, j) comme le raster. */
export function versEcran( fi: number, fj: number, nx: number, ny: number, largeur: number, hauteur: number ): [ number, number ] {

	return [ ( fi + 0.5 ) / nx * largeur, ( 1 - ( fj + 0.5 ) / ny ) * hauteur ];

}

/** Écran (fraction 0..1 de la largeur et de la hauteur) → nœud (i, j) le plus proche, borné au domaine. */
export function noeudDepuisEcran( fx: number, fy: number, nx: number, ny: number ): { i: number; j: number } {

	const i = Math.min( nx - 1, Math.max( 0, Math.floor( fx * nx ) ) );
	const j = Math.min( ny - 1, Math.max( 0, ny - 1 - Math.floor( fy * ny ) ) );
	return { i, j };

}

/** Classe de couleur (0..n-1) d'une vitesse sur [0, vmax] ; -1 si inconnue. */
export function classeVitesse( s: number, vmax: number, n: number ): number {

	if ( ! Number.isFinite( s ) || ! ( vmax > 0 ) ) return - 1;
	return Math.min( n - 1, Math.max( 0, Math.floor( s / vmax * n ) ) );

}

/** Table de n couleurs CSS échantillonnées sur une rampe (#RRGGBB), avec une opacité. */
export function tableCouleurs( rampe: readonly string[], n: number, alpha = 1 ): string[] {

	const rgb = ( h: string ) => [ 1, 3, 5 ].map( ( k ) => parseInt( h.slice( k, k + 2 ), 16 ) );
	return Array.from( { length: n }, ( _, k ) => {

		const x = ( n > 1 ? k / ( n - 1 ) : 0 ) * ( rampe.length - 1 ), a = Math.min( rampe.length - 2, Math.floor( x ) ), f = x - a;
		const c0 = rgb( rampe[ Math.max( 0, a ) ] ), c1 = rgb( rampe[ Math.min( rampe.length - 1, a + 1 ) ] );
		const c = c0.map( ( v, q ) => Math.round( v + ( c1[ q ] - v ) * ( rampe.length > 1 ? f : 0 ) ) );
		return `rgba(${ c[ 0 ] },${ c[ 1 ] },${ c[ 2 ] },${ alpha })`;

	} );

}

/**
 * Flèches statiques (animations réduites) : une flèche tous les `pas` nœuds où le vent est publié, orientée dans
 * le sens où le vent VA (u, v), de longueur relative à la vitesse (0..1 de vmax).
 */
export function flechesStatiques( c: ChampVent, pas: number ): { fi: number; fj: number; ux: number; uy: number; s: number }[] {

	const vmax = vitesseMax( c );
	const out: { fi: number; fj: number; ux: number; uy: number; s: number }[] = [];
	if ( ! vmax ) return out;
	const p = Math.max( 1, Math.floor( pas ) );
	for ( let j = Math.floor( p / 2 ); j < c.ny; j += p ) for ( let i = Math.floor( p / 2 ); i < c.nx; i += p ) {

		const k = j * c.nx + i, u = c.u[ k ], v = c.v[ k ];
		if ( Number.isNaN( u ) || Number.isNaN( v ) ) continue;
		const s = Math.hypot( u, v );
		if ( s < 1e-9 ) continue;
		out.push( { fi: i, fj: j, ux: u / s, uy: v / s, s: s / vmax } );

	}
	return out;

}

/** Courbe d'un fondu d'affichage (0 → 1) : douce aux deux bouts ; t hors de [0, 1] borné. */
export function courbeFondu( t: number ): number {

	const x = Math.min( 1, Math.max( 0, t ) );
	return x * x * ( 3 - 2 * x );

}
