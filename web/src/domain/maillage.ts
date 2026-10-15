// Géométrie pure de la scène (sans three.js) : maillages des coupes et intersection rayon / surface.
//
// Repère local de la scène, en MÈTRES : x vers l'Est (x_m − x0), y vers le Nord (y_m − y0), z altitude
// au-dessus de la mer. L'exagération verticale est appliquée par la scène (échelle du groupe), jamais ici.

/**
 * Triangles des quadrilatères dont les 4 sommets sont valides, sur une grille ncol × nlig
 * (sommet (c, l) d'indice l·ncol + c). Un nœud absent (sous le relief) n'est jamais relié :
 * la coupe s'arrête au relief au lieu d'y peindre une valeur.
 */
export function trianglesValides( ncol: number, nlig: number, valide: ArrayLike<number | boolean> ): Uint32Array {

	let n = 0;
	const out = new Uint32Array( Math.max( 0, ( ncol - 1 ) * ( nlig - 1 ) * 6 ) );
	for ( let l = 0; l + 1 < nlig; l ++ ) for ( let c = 0; c + 1 < ncol; c ++ ) {

		const a = l * ncol + c, b = a + 1, d = a + ncol, e = d + 1;
		if ( ! valide[ a ] || ! valide[ b ] || ! valide[ d ] || ! valide[ e ] ) continue;
		out[ n ++ ] = a; out[ n ++ ] = d; out[ n ++ ] = b;
		out[ n ++ ] = b; out[ n ++ ] = d; out[ n ++ ] = e;

	}

	return out.slice( 0, n );

}

export interface Bornes { xmin: number; xmax: number; ymin: number; ymax: number }

/**
 * Premier point où le rayon o + t·d (t ≥ 0) passe sous la surface z = surface(x, y), dans les bornes.
 * `surface` renvoie NaN là où elle n'existe pas (ignoré). Marche à pas horizontal `pas` (m), puis
 * dichotomie. Renvoie null si le rayon ne touche pas la surface dans le domaine.
 */
export function intersecterSurface(
	o: [ number, number, number ],
	d: [ number, number, number ],
	surface: ( x: number, y: number ) => number,
	b: Bornes,
	pas: number,
): { x: number; y: number; z: number } | null {

	// Découpe du rayon par la boîte horizontale (méthode des dalles).
	let t0 = 0, t1 = Infinity;
	for ( const [ oo, dd, lo, hi ] of [ [ o[ 0 ], d[ 0 ], b.xmin, b.xmax ], [ o[ 1 ], d[ 1 ], b.ymin, b.ymax ] ] as const ) {

		if ( Math.abs( dd ) < 1e-12 ) { if ( oo < lo || oo > hi ) return null; continue; }
		let ta = ( lo - oo ) / dd, tb = ( hi - oo ) / dd;
		if ( ta > tb ) [ ta, tb ] = [ tb, ta ];
		t0 = Math.max( t0, ta ); t1 = Math.min( t1, tb );

	}

	if ( ! ( t1 >= t0 ) ) return null;
	const horiz = Math.hypot( d[ 0 ], d[ 1 ] );
	const dt = horiz > 1e-9 ? pas / horiz : ( t1 - t0 );
	const ecart = ( t: number ) => {

		const x = o[ 0 ] + t * d[ 0 ], y = o[ 1 ] + t * d[ 1 ], s = surface( x, y );
		return Number.isNaN( s ) ? NaN : o[ 2 ] + t * d[ 2 ] - s;

	};

	// Rayon vertical (ou presque) : un seul point utile.
	if ( ! Number.isFinite( t1 ) ) {

		if ( Math.abs( d[ 2 ] ) < 1e-12 ) return null;
		const s = surface( o[ 0 ], o[ 1 ] );
		if ( Number.isNaN( s ) ) return null;
		const t = ( s - o[ 2 ] ) / d[ 2 ];
		return t >= 0 ? { x: o[ 0 ], y: o[ 1 ], z: s } : null;

	}

	let ta = t0, ea = ecart( ta );
	if ( ea <= 0 ) return { x: o[ 0 ] + ta * d[ 0 ], y: o[ 1 ] + ta * d[ 1 ], z: o[ 2 ] + ta * d[ 2 ] }; // entre par le dessous
	for ( let t = t0 + dt; ; t += dt ) {

		const tt = Math.min( t, t1 ), e = ecart( tt );
		if ( e <= 0 && ! Number.isNaN( ea ) ) {

			let lo = ta, hi = tt;
			for ( let k = 0; k < 30; k ++ ) { const m = ( lo + hi ) / 2, em = ecart( m ); if ( em > 0 || Number.isNaN( em ) ) lo = m; else hi = m; }
			return { x: o[ 0 ] + hi * d[ 0 ], y: o[ 1 ] + hi * d[ 1 ], z: o[ 2 ] + hi * d[ 2 ] };

		}

		if ( e <= 0 && Number.isNaN( ea ) ) return { x: o[ 0 ] + tt * d[ 0 ], y: o[ 1 ] + tt * d[ 1 ], z: o[ 2 ] + tt * d[ 2 ] };
		ta = tt; ea = e;
		if ( tt >= t1 ) return null;

	}

}

/** Longueur « ronde » de la barre d'échelle (1, 2, 5 × 10^n m) proche de `cible` m. */
export function longueurEchelle( cible: number ): number {

	if ( ! ( cible > 0 ) ) return 1;
	const p = 10 ** Math.floor( Math.log10( cible ) ), m = cible / p;
	return ( m < 2 ? 1 : m < 5 ? 2 : 5 ) * p;

}

export function libelleDistance( m: number ): string {

	return m >= 1000 ? `${ ( m / 1000 ).toLocaleString( 'fr-FR', { maximumFractionDigits: 1 } ) } km` : `${ Math.round( m ) } m`;

}
