// Cartes « hauteur au-dessus du sol » (décision D6 du plan, contrat v1 rév. 2) : partagé par les pages.
//
// Le modèle publie ses niveaux AU-DESSUS DE LA MER (meta.grid.levels_asl_m). Une carte « à 100 m » est
// une carte à 100 m AU-DESSUS DU SOL : pour chaque colonne (i, j), l'altitude cible est
// z = relief[j·nx + i] + h, puis la valeur est interpolée entre les deux niveaux qui encadrent z.
// Jamais un simple changement de libellé d'un niveau ASL.
//
// Règles (mêmes que hub_wind_* du contrat, D10 : interpolation linéaire de speed par colonne) :
//   - encadrement = le PREMIER k tel que L[k] ≤ z ≤ L[k+1] ;
//   - les deux valeurs encadrantes doivent exister (NaN = sous le relief ou absent) : sinon NaN ;
//   - z sous le premier niveau ou au-dessus du sommet du modèle : NaN (aucune extrapolation) ;
//   - h < grid.min_agl_m : NaN partout (le modèle ne publie aucun nœud aussi près du sol) ;
//   - variable catégorielle (status) : valeur du niveau encadrant le plus proche, jamais interpolée.
// Une valeur absente reste NaN (« absent ») : jamais 0.

/** Hauteurs au-dessus du sol des cartes de la vue d'ensemble (plan, lot F3, TB2). */
export const HAUTEURS_SOL_M = [ 10, 100, 300, 1000 ] as const;

/** Raison de l'absence d'une colonne à la hauteur demandée. */
export const MOTIF = {
	/** Encadrée par deux niveaux : valeur disponible si les deux valeurs existent. */
	ENCADREE: 0,
	/** z sous le premier niveau du modèle. */
	SOUS_PREMIER_NIVEAU: 1,
	/** z au-dessus du sommet du modèle (dernier niveau). */
	AU_DESSUS_SOMMET: 2,
	/** h < grid.min_agl_m. */
	TROP_PRES_DU_SOL: 3,
} as const;

export type Motif = typeof MOTIF[ keyof typeof MOTIF ];

export interface Encadrement {
	/** Hauteur au-dessus du sol (m). */
	hauteur: number;
	/** Niveau bas (indice 0..nz-1) par colonne, −1 si non encadrée. */
	bas: Int16Array;
	/** Poids du niveau haut : z = L[bas] + poids·(L[bas+1] − L[bas]), dans [0, 1]. */
	poids: Float32Array;
	motif: Uint8Array;
	/** Indices des niveaux nécessaires (bas et bas + 1 de chaque colonne encadrée), croissants. */
	niveaux: number[];
}

/**
 * Encadrement de chaque colonne à `hauteur` m au-dessus du sol. `relief` : Float32 ny·nx (m au-dessus
 * de la mer, /v1/terrain/{sha8}) ; `niveaux` : meta.grid.levels_asl_m (strictement croissants).
 */
export function encadrer( relief: ArrayLike<number>, niveaux: readonly number[], hauteur: number, minAgl: number ): Encadrement {

	const n = relief.length, nz = niveaux.length;
	const bas = new Int16Array( n ).fill( - 1 ), poids = new Float32Array( n ), motif = new Uint8Array( n );
	const utiles = new Set<number>();
	for ( let c = 0; c < n; c ++ ) {

		if ( hauteur < minAgl ) { motif[ c ] = MOTIF.TROP_PRES_DU_SOL; continue; }
		const z = relief[ c ] + hauteur;
		if ( ! Number.isFinite( z ) || nz < 2 || z < niveaux[ 0 ] ) { motif[ c ] = MOTIF.SOUS_PREMIER_NIVEAU; continue; }
		if ( z > niveaux[ nz - 1 ] ) { motif[ c ] = MOTIF.AU_DESSUS_SOMMET; continue; }
		let k = 0;
		while ( k + 2 < nz && z > niveaux[ k + 1 ] ) k ++;
		bas[ c ] = k;
		poids[ c ] = ( z - niveaux[ k ] ) / ( niveaux[ k + 1 ] - niveaux[ k ] );
		utiles.add( k ); utiles.add( k + 1 );

	}

	return { hauteur, bas, poids, motif, niveaux: [ ...utiles ].sort( ( a, b ) => a - b ) };

}

/** Champs d'un niveau, par indice (ny·nx valeurs, NaN = absent). */
export type ChampsParNiveau = ReadonlyMap<number, ArrayLike<number>> | ( ( k: number ) => ArrayLike<number> | undefined );

const lire = ( champs: ChampsParNiveau, k: number ) => typeof champs === 'function' ? champs( k ) : champs.get( k );

/**
 * Valeurs à la hauteur de l'encadrement. `mode` : « lineaire » (vitesse, sigma, couverture, fiabilité)
 * ou « proche » (variable catégorielle : status). Un niveau manquant dans `champs` lève une erreur
 * (jamais un 0 silencieux).
 */
export function valeursSol( enc: Encadrement, champs: ChampsParNiveau, mode: 'lineaire' | 'proche' = 'lineaire' ): Float32Array {

	const n = enc.bas.length, out = new Float32Array( n ).fill( NaN );
	for ( const k of enc.niveaux ) {

		const f = lire( champs, k );
		if ( ! f ) throw new Error( `niveau ${ k } non chargé` );
		if ( f.length !== n ) throw new Error( `niveau ${ k } : ${ f.length } valeurs, ${ n } attendues` );

	}

	for ( let c = 0; c < n; c ++ ) {

		const k = enc.bas[ c ];
		if ( k < 0 ) continue;
		const a = lire( champs, k )![ c ], b = lire( champs, k + 1 )![ c ], t = enc.poids[ c ];
		// Les deux valeurs encadrantes doivent exister (comme hub_wind_* du contrat).
		if ( Number.isNaN( a ) || Number.isNaN( b ) ) continue;
		out[ c ] = mode === 'proche' ? ( t <= 0.5 ? a : b ) : a + ( b - a ) * t;

	}

	return out;

}

export interface Resume {
	/** Colonnes avec une valeur. */
	disponibles: number;
	total: number;
	min: number | null;
	moyenne: number | null;
	max: number | null;
	/** Colonnes absentes, par raison. */
	absentes: { sous_relief: number; sous_premier_niveau: number; au_dessus_sommet: number; trop_pres_du_sol: number };
}

/**
 * Résumé d'une carte : min, moyenne, max des valeurs disponibles (null si aucune : « non disponible »,
 * jamais 0) et décompte des colonnes absentes. Une colonne encadrée mais sans valeur est comptée
 * « sous le relief » (un niveau encadrant est sous le premier nœud valide de la colonne).
 */
export function resumer( enc: Encadrement, valeurs: ArrayLike<number> ): Resume {

	const absentes = { sous_relief: 0, sous_premier_niveau: 0, au_dessus_sommet: 0, trop_pres_du_sol: 0 };
	let n = 0, s = 0, lo = Infinity, hi = - Infinity;
	for ( let c = 0; c < valeurs.length; c ++ ) {

		const v = valeurs[ c ];
		if ( Number.isNaN( v ) ) {

			const m = enc.motif[ c ];
			if ( m === MOTIF.ENCADREE ) absentes.sous_relief ++;
			else if ( m === MOTIF.SOUS_PREMIER_NIVEAU ) absentes.sous_premier_niveau ++;
			else if ( m === MOTIF.AU_DESSUS_SOMMET ) absentes.au_dessus_sommet ++;
			else absentes.trop_pres_du_sol ++;
			continue;

		}
		n ++; s += v; if ( v < lo ) lo = v; if ( v > hi ) hi = v;

	}

	return { disponibles: n, total: valeurs.length, min: n ? lo : null, moyenne: n ? s / n : null, max: n ? hi : null, absentes };

}
