// Export CSV des valeurs AFFICHÉES (lot F6), généré côté client.
//
// Format : UTF-8, séparateur virgule, point décimal, fin de ligne CRLF (RFC 4180), une ligne d'en-tête dont
// chaque nom de colonne porte son unité (`speed_m_s`, `z_terrain_m`…). Chaque ligne répète l'identification
// de l'instantané (snapshot_id, instant de validité en UTC ISO 8601, nature des données data_kind, modèle) :
// un extrait recopié ailleurs reste traçable. Une valeur absente est une cellule VIDE, jamais 0.
// Cartes : seuls les nœuds affichés avec une valeur sont exportés (les nœuds absents, hachurés à l'écran,
// ne donnent aucune ligne) ; la position est donnée en mètres (plan local) et en degrés (position supposée
// si georef.suppose, colonne georef_suppose).

import type { Meta, ProfileLevel } from '../data/contract';
import { latLon } from './geo';

/** Identification de l'instantané, répétée sur chaque ligne. */
export interface Identite {
	snapshot_id: string;
	valid_time: string;
	data_kind: string;
	model: string;
}

/** Instant de validité normalisé en UTC ISO 8601 (« 2025-02-28T21:00:00Z »). */
export function isoUtc( iso: string ): string {

	const d = new Date( iso );
	if ( Number.isNaN( d.getTime() ) ) throw new Error( `instant illisible : ${ iso }` );
	return d.toISOString().replace( '.000Z', 'Z' );

}

/** Cellule CSV : nombre à `d` décimales (sans zéros inutiles), texte échappé, absent → vide. */
export function cellule( v: number | string | boolean | null | undefined, d = 3 ): string {

	if ( v == null ) return '';
	if ( typeof v === 'number' ) {

		if ( ! Number.isFinite( v ) ) return '';
		const s = v.toFixed( d );
		return d > 0 ? s.replace( /\.?0+$/, '' ).replace( /^-0$/, '0' ) : s;

	}
	const s = String( v );
	return /[",\r\n]/.test( s ) ? `"${ s.replace( /"/g, '""' ) }"` : s;

}

const ligne = ( cs: string[] ) => cs.join( ',' );
const COLONNES_ID = [ 'snapshot_id', 'valid_time_utc', 'data_kind', 'model' ];
const id = ( e: Identite ) => [ cellule( e.snapshot_id ), cellule( isoUtc( e.valid_time ) ), cellule( e.data_kind ), cellule( e.model ) ];

export interface CarteAExporter {
	/** Variable affichée (nom du contrat : speed, sigma_speed…) et son unité (m/s, 0-1, code). */
	variable: string;
	unite: string;
	/** Plan affiché : hauteur h au-dessus du sol (D6) ou altitude z au-dessus de la mer (niveau publié). */
	surface: { mode: 'sol'; h: number } | { mode: 'mer'; z: number };
	/** ny·nx valeurs affichées, NaN = absent. */
	valeurs: ArrayLike<number>;
	/** Relief ny·nx (m au-dessus de la mer). */
	terrain: ArrayLike<number>;
	decimales?: number;
}

/** Nom de colonne d'une variable avec son unité : speed + m/s → speed_m_s ; coverage + 0–1 → coverage_0_1. */
export function colonneVariable( variable: string, unite: string ): string {

	const u = unite.normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' ).replace( /[^0-9A-Za-z]+/g, '_' ).replace( /^_|_$/g, '' );
	return u ? `${ variable }_${ u }` : variable;

}

/** CSV d'une carte (une ligne par nœud affiché avec une valeur ; plan au-dessus du sol ou de la mer). */
export function csvCarte( e: Identite, meta: Pick<Meta, 'grid' | 'georef'>, c: CarteAExporter ): string {

	const { nx, ny, dx_m, dy_m, x0_m, y0_m } = meta.grid;
	if ( c.valeurs.length !== nx * ny || c.terrain.length !== nx * ny ) throw new Error( `carte de ${ c.valeurs.length } valeurs, ${ nx * ny } attendues` );
	const suppose = meta.georef.suppose ? 'oui' : 'non';
	const tete = ligne( [ ...COLONNES_ID, 'plan', 'i', 'j', 'x_m', 'y_m', 'lat_deg', 'lon_deg', 'georef_suppose', 'z_terrain_m', 'z_asl_m', 'z_agl_m', colonneVariable( c.variable, c.unite ) ] );
	const sf = c.surface, fixe = [ ...id( e ), sf.mode === 'sol' ? 'hauteur_sol' : 'altitude_mer' ].join( ',' );
	const out = [ tete ];
	for ( let j = 0; j < ny; j ++ ) for ( let i = 0; i < nx; i ++ ) {

		const k = j * nx + i, v = c.valeurs[ k ];
		if ( Number.isNaN( v ) ) continue;
		const x = x0_m + i * dx_m, y = y0_m + j * dy_m, ll = latLon( meta, x, y ), zt = c.terrain[ k ];
		const zAsl = sf.mode === 'sol' ? zt + sf.h : sf.z, zAgl = sf.mode === 'sol' ? sf.h : sf.z - zt;
		out.push( [ fixe, i, j, cellule( x, 1 ), cellule( y, 1 ), cellule( ll.lat, 6 ), cellule( ll.lon, 6 ), suppose,
			cellule( zt, 2 ), cellule( zAsl, 2 ), cellule( zAgl, 2 ), cellule( v, c.decimales ?? 3 ) ].join( ',' ) );

	}
	return out.join( '\r\n' ) + '\r\n';

}

export interface ProfilAExporter {
	i: number;
	j: number;
	x_m: number;
	y_m: number;
	z_terrain_m: number;
	levels: ProfileLevel[];
}

/** CSV du profil vertical affiché (un niveau par ligne, du bas vers le haut ; sous le relief : valeurs vides). */
export function csvProfil( e: Identite, meta: Pick<Meta, 'grid' | 'georef'>, p: ProfilAExporter ): string {

	const ll = latLon( meta, p.x_m, p.y_m );
	const tete = ligne( [ ...COLONNES_ID, 'i', 'j', 'x_m', 'y_m', 'lat_deg', 'lon_deg', 'georef_suppose', 'z_terrain_m', 'z_asl_m', 'z_agl_m', 'sous_relief',
		'u_m_s', 'v_m_s', 'w_m_s', 'speed_m_s', 'dir_from_deg', 'speed_p10_m_s', 'speed_p90_m_s', 'sigma_speed_m_s', 'status', 'coverage_0_1', 'reliability_0_1', 'reliability_class' ] );
	const fixe = [ ...id( e ), p.i, p.j, cellule( p.x_m, 1 ), cellule( p.y_m, 1 ), cellule( ll.lat, 6 ), cellule( ll.lon, 6 ), meta.georef.suppose ? 'oui' : 'non', cellule( p.z_terrain_m, 2 ) ].join( ',' );
	const out = [ tete ];
	for ( const l of p.levels ) {

		out.push( [ fixe, cellule( l.z_asl_m, 1 ), cellule( l.z_agl_m, 2 ), l.below_terrain ? 'oui' : 'non',
			cellule( l.u ), cellule( l.v ), cellule( l.w, 4 ), cellule( l.speed ), cellule( l.dir_from_deg, 1 ),
			cellule( l.speed_interval.p10 ), cellule( l.speed_interval.p90 ), cellule( l.sigma_speed ),
			cellule( l.status ), cellule( l.coverage ), cellule( l.reliability ), cellule( l.reliability_class ) ].join( ',' ) );

	}
	return out.join( '\r\n' ) + '\r\n';

}

/**
 * CSV d'une comparaison : une ligne par nœud présent des DEUX côtés (ceux de la carte de différence), avec la
 * vitesse de chaque instant et B − A. Les deux identifications sont en colonnes a_* et b_*.
 */
export function csvComparaison( a: Identite, b: Identite, meta: Pick<Meta, 'grid' | 'georef'>, hauteurSol: number, va: ArrayLike<number>, vb: ArrayLike<number>, terrain: ArrayLike<number> ): string {

	const { nx, ny, dx_m, dy_m, x0_m, y0_m } = meta.grid;
	if ( va.length !== nx * ny || vb.length !== nx * ny ) throw new Error( 'cartes de tailles différentes de la grille' );
	const tete = ligne( [ ...COLONNES_ID.map( ( c ) => `a_${ c }` ), ...COLONNES_ID.map( ( c ) => `b_${ c }` ), 'hauteur_sol_m', 'i', 'j', 'x_m', 'y_m', 'lat_deg', 'lon_deg', 'georef_suppose', 'z_terrain_m',
		'speed_a_m_s', 'speed_b_m_s', 'diff_b_moins_a_m_s' ] );
	const fixe = [ ...id( a ), ...id( b ), cellule( hauteurSol, 1 ) ].join( ',' ), suppose = meta.georef.suppose ? 'oui' : 'non';
	const out = [ tete ];
	for ( let j = 0; j < ny; j ++ ) for ( let i = 0; i < nx; i ++ ) {

		const k = j * nx + i, x = va[ k ], y = vb[ k ];
		if ( Number.isNaN( x ) || Number.isNaN( y ) ) continue;
		const px = x0_m + i * dx_m, py = y0_m + j * dy_m, ll = latLon( meta, px, py );
		out.push( [ fixe, i, j, cellule( px, 1 ), cellule( py, 1 ), cellule( ll.lat, 6 ), cellule( ll.lon, 6 ), suppose, cellule( terrain[ k ], 2 ),
			cellule( x ), cellule( y ), cellule( y - x ) ].join( ',' ) );

	}
	return out.join( '\r\n' ) + '\r\n';

}

/** Nom de fichier sûr : atom_<instantané>_<quoi>.csv (caractères hors [A-Za-z0-9_.-] remplacés). */
export function nomFichier( ...parts: ( string | number )[] ): string {

	return `atom_${ parts.map( ( p ) => String( p ).replace( /[^A-Za-z0-9_.-]+/g, '-' ) ).join( '_' ) }.csv`;

}
