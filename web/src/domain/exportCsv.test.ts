import { describe, expect, it } from 'vitest';
import type { Meta } from '../data/contract';
import { cellule, colonneVariable, csvCarte, csvComparaison, csvProfil, isoUtc, nomFichier, type Identite } from './exportCsv';
import { profilDepuisColonne } from './profile';

const ID: Identite = { snapshot_id: '017_210000_b2529442', valid_time: '2025-02-28T21:00:00.000Z', data_kind: 'synthetique', model: 'v7' };
const META = {
	grid: { nx: 3, ny: 2, dx_m: 100, dy_m: 100, x0_m: 0, y0_m: 0 },
	georef: { lat0: 36, lon0: 9.7, rotation_deg: 0, m_per_deg_lat: 110574, m_per_deg_lon: 90059.772, suppose: true },
} as unknown as Pick<Meta, 'grid' | 'georef'>;
const lignes = ( csv: string ) => csv.split( '\r\n' ).filter( Boolean ).map( ( l ) => l.split( ',' ) );

describe( 'export CSV', () => {

	it( 'cellules : nombres sans zéros inutiles, absent → vide (jamais 0), texte échappé', () => {

		expect( cellule( 1.5 ) ).toBe( '1.5' );
		expect( cellule( 2 ) ).toBe( '2' );
		expect( cellule( - 0.0001 ) ).toBe( '0' );
		expect( cellule( 3.14159, 2 ) ).toBe( '3.14' );
		expect( cellule( NaN ) ).toBe( '' );
		expect( cellule( null ) ).toBe( '' );
		expect( cellule( undefined ) ).toBe( '' );
		expect( cellule( 'a,b' ) ).toBe( '"a,b"' );
		expect( cellule( 'dit "x"' ) ).toBe( '"dit ""x"""' );

	} );

	it( 'instant en UTC ISO 8601 et colonnes avec unité', () => {

		expect( isoUtc( '2025-02-28T22:00:00+01:00' ) ).toBe( '2025-02-28T21:00:00Z' );
		expect( () => isoUtc( 'hier' ) ).toThrow();
		expect( colonneVariable( 'speed', 'm/s' ) ).toBe( 'speed_m_s' );
		expect( colonneVariable( 'coverage', '0–1' ) ).toBe( 'coverage_0_1' );
		expect( colonneVariable( 'status', '' ) ).toBe( 'status' );
		expect( nomFichier( '017_210000_b2529442', 'carte', '100m-sol', 'speed' ) ).toBe( 'atom_017_210000_b2529442_carte_100m-sol_speed.csv' );
		expect( nomFichier( 'a/b c' ) ).toBe( 'atom_a-b-c.csv' );

	} );

	it( 'carte au-dessus du sol : une ligne par nœud affiché avec une valeur, identification sur chaque ligne', () => {

		const valeurs = Float32Array.from( [ 1.25, NaN, 3, NaN, 5.5, 6 ] ), terrain = Float32Array.from( [ 10, 20, 30, 40, 50, 60 ] );
		const csv = csvCarte( ID, META, { variable: 'speed', unite: 'm/s', surface: { mode: 'sol', h: 100 }, valeurs, terrain } );
		expect( csv.endsWith( '\r\n' ) ).toBe( true );
		const [ tete, ...rows ] = lignes( csv );
		expect( tete ).toEqual( [ 'snapshot_id', 'valid_time_utc', 'data_kind', 'model', 'plan', 'i', 'j', 'x_m', 'y_m', 'lat_deg', 'lon_deg', 'georef_suppose', 'z_terrain_m', 'z_asl_m', 'z_agl_m', 'speed_m_s' ] );
		expect( rows ).toHaveLength( 4 ); // 2 nœuds absents : aucune ligne
		const col = ( r: string[], c: string ) => r[ tete.indexOf( c ) ];
		for ( const r of rows ) {

			expect( col( r, 'snapshot_id' ) ).toBe( ID.snapshot_id );
			expect( col( r, 'valid_time_utc' ) ).toBe( '2025-02-28T21:00:00Z' );
			expect( col( r, 'data_kind' ) ).toBe( 'synthetique' );
			expect( col( r, 'georef_suppose' ) ).toBe( 'oui' );
			expect( col( r, 'plan' ) ).toBe( 'hauteur_sol' );
			expect( col( r, 'z_agl_m' ) ).toBe( '100' );

		}
		const r = rows.find( ( x ) => col( x, 'i' ) === '1' && col( x, 'j' ) === '1' )!; // k = 4
		expect( col( r, 'x_m' ) ).toBe( '100' );
		expect( col( r, 'y_m' ) ).toBe( '100' );
		expect( col( r, 'z_terrain_m' ) ).toBe( '50' );
		expect( col( r, 'z_asl_m' ) ).toBe( '150' );
		expect( col( r, 'speed_m_s' ) ).toBe( '5.5' );
		expect( Number( col( r, 'lat_deg' ) ) ).toBeCloseTo( 36 + 100 / 110574, 6 );

	} );

	it( 'plan au-dessus de la mer : z_agl = z − relief', () => {

		const csv = csvCarte( ID, META, { variable: 'speed', unite: 'm/s', surface: { mode: 'mer', z: 300 }, valeurs: Float32Array.from( [ 1, 2, 3, 4, 5, 6 ] ), terrain: Float32Array.from( [ 10, 20, 30, 40, 50, 60 ] ) } );
		const [ tete, premiere ] = lignes( csv );
		expect( premiere[ tete.indexOf( 'plan' ) ] ).toBe( 'altitude_mer' );
		expect( premiere[ tete.indexOf( 'z_asl_m' ) ] ).toBe( '300' );
		expect( premiere[ tete.indexOf( 'z_agl_m' ) ] ).toBe( '290' );

	} );

	it( 'refuse une carte qui ne correspond pas à la grille', () => {

		expect( () => csvCarte( ID, META, { variable: 'speed', unite: 'm/s', surface: { mode: 'sol', h: 10 }, valeurs: new Float32Array( 5 ), terrain: new Float32Array( 6 ) } ) ).toThrow();

	} );

	it( 'profil : un niveau par ligne ; sous le relief et sigma inconnu → cellules vides', () => {

		const p = profilDepuisColonne( {
			i: 1, j: 0, x_m: 100, y_m: 0, z_terrain_m: 120,
			levels: [
				{ z_asl_m: 100, z_agl_m: - 20, below_terrain: true, u: null, v: null, w: null, speed: null },
				{ z_asl_m: 200, z_agl_m: 80, below_terrain: false, u: 0, v: - 2, w: 0.01, speed: 2 },
			],
		} as never );
		const [ tete, bas, haut ] = lignes( csvProfil( ID, META, p ) );
		const col = ( r: string[], c: string ) => r[ tete.indexOf( c ) ];
		expect( tete ).toContain( 'speed_p10_m_s' );
		expect( col( bas, 'sous_relief' ) ).toBe( 'oui' );
		expect( col( bas, 'speed_m_s' ) ).toBe( '' );
		expect( col( haut, 'speed_m_s' ) ).toBe( '2' );
		expect( col( haut, 'dir_from_deg' ) ).toBe( '0' ); // vent du nord (v < 0)
		expect( col( haut, 'sigma_speed_m_s' ) ).toBe( '' );
		expect( col( haut, 'speed_p10_m_s' ) ).toBe( '' );
		expect( col( haut, 'status' ) ).toBe( '' );

	} );

	it( 'comparaison : seuls les nœuds présents des deux côtés, B − A', () => {

		const B: Identite = { ...ID, snapshot_id: '017_180000_b2529442', valid_time: '2025-02-28T18:00:00Z' };
		const csv = csvComparaison( ID, B, META, 100, Float32Array.from( [ 1, NaN, 3, 4, 5, 6 ] ), Float32Array.from( [ 2, 2, NaN, 3, 5, 8 ] ), new Float32Array( 6 ) );
		const [ tete, ...rows ] = lignes( csv );
		expect( rows ).toHaveLength( 4 );
		expect( tete.slice( 0, 8 ) ).toEqual( [ 'a_snapshot_id', 'a_valid_time_utc', 'a_data_kind', 'a_model', 'b_snapshot_id', 'b_valid_time_utc', 'b_data_kind', 'b_model' ] );
		expect( rows.map( ( r ) => r[ tete.indexOf( 'diff_b_moins_a_m_s' ) ] ) ).toEqual( [ '1', '-1', '0', '2' ] );

	} );

} );
