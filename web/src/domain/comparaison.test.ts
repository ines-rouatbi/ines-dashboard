import { describe, expect, it } from 'vitest';
import { bornesDifference, difference, incompatibilite, maxCommun, statistiques } from './comparaison';
import { encadrer, valeursSol } from './hauteurSol';

const N = NaN;

describe( 'comparaison de deux instants', () => {

	it( 'la différence n’existe que sur les nœuds présents des deux côtés (jamais contre 0)', () => {

		const a = Float32Array.from( [ 1, 2, N, 4, N ] ), b = Float32Array.from( [ 3, N, 5, 1, N ] );
		const d = difference( a, b );
		expect( d[ 0 ] ).toBe( 2 );
		expect( Number.isNaN( d[ 1 ] ) ).toBe( true );
		expect( Number.isNaN( d[ 2 ] ) ).toBe( true );
		expect( d[ 3 ] ).toBe( - 3 );
		expect( Number.isNaN( d[ 4 ] ) ).toBe( true );

	} );

	it( 'statistiques sur les seuls nœuds communs, absences décomptées par côté', () => {

		const a = Float32Array.from( [ 1, 2, N, 4, N ] ), b = Float32Array.from( [ 3, N, 5, 1, N ] );
		const s = statistiques( a, b );
		expect( s ).toMatchObject( { total: 5, communs: 2, seulementA: 1, seulementB: 1, absentsDesDeux: 1 } );
		expect( s.moyenneA ).toBe( 2.5 ); // (1 + 4) / 2 : la valeur 2 (absente en B) n'entre pas
		expect( s.moyenneB ).toBe( 2 );
		expect( s.moyenneDiff ).toBe( - 0.5 );
		expect( s.moyenneAbsDiff ).toBe( 2.5 );
		expect( s.rmsDiff ).toBeCloseTo( Math.sqrt( ( 4 + 9 ) / 2 ), 12 );
		expect( s.minDiff ).toBe( - 3 );
		expect( s.maxDiff ).toBe( 2 );

	} );

	it( 'aucun nœud commun : statistiques « non disponible » (null), jamais 0', () => {

		const s = statistiques( Float32Array.from( [ 1, N ] ), Float32Array.from( [ N, 2 ] ) );
		expect( s.communs ).toBe( 0 );
		for ( const k of [ 'moyenneA', 'moyenneB', 'moyenneDiff', 'moyenneAbsDiff', 'rmsDiff', 'minDiff', 'maxDiff' ] as const ) expect( s[ k ] ).toBeNull();

	} );

	it( 'refuse des cartes de tailles différentes', () => {

		expect( () => difference( new Float32Array( 2 ), new Float32Array( 3 ) ) ).toThrow();
		expect( () => statistiques( new Float32Array( 2 ), new Float32Array( 3 ) ) ).toThrow();

	} );

	it( 'échelle commune et échelle divergente symétrique', () => {

		expect( maxCommun( Float32Array.from( [ 1, N, 3 ] ), Float32Array.from( [ N, 7.5 ] ) ) ).toBe( 7.5 );
		expect( maxCommun( Float32Array.from( [ N ] ) ) ).toBeNull();
		expect( bornesDifference( { minDiff: - 1.2, maxDiff: 0.3 } ) ).toEqual( { min: - 1.5, max: 1.5 } );
		expect( bornesDifference( { minDiff: 0, maxDiff: 0 } ) ).toEqual( { min: - 0.5, max: 0.5 } );
		expect( bornesDifference( { minDiff: null, maxDiff: null } ) ).toEqual( { min: - 0.5, max: 0.5 } );

	} );

	it( 'compatibilité : même grille et même relief, sinon la raison', () => {

		const m = { grid: { nx: 2, ny: 2, dx_m: 100, dy_m: 100, x0_m: 0, y0_m: 0 }, terrain: { sha256: 'a'.repeat( 64 ) } };
		type M = Parameters<typeof incompatibilite>[ 0 ];
		expect( incompatibilite( m as unknown as M, structuredClone( m ) as unknown as M ) ).toBeNull();
		expect( incompatibilite( m as unknown as M, { ...m, grid: { ...m.grid, nx: 3 } } as unknown as M ) ).toMatch( /nx/ );
		expect( incompatibilite( m as unknown as M, { ...m, terrain: { sha256: 'b'.repeat( 64 ) } } as unknown as M ) ).toMatch( /relief/ );

	} );

	it( 'cartes à la même hauteur au-dessus du sol (D6) : un nœud sous le relief d’un côté reste hors différence', () => {

		// 2 colonnes : relief 0 et 60 m ; niveaux 25, 50, 100 m (mer) ; h = 30 m sol → z = 30 et 90 m.
		const relief = [ 0, 60 ], niveaux = [ 25, 50, 100 ];
		const enc = encadrer( relief, niveaux, 30, 5 );
		const instantA = new Map( [ [ 0, Float32Array.from( [ 1, N ] ) ], [ 1, Float32Array.from( [ 2, 3 ] ) ], [ 2, Float32Array.from( [ 4, 5 ] ) ] ] );
		const instantB = new Map( [ [ 0, Float32Array.from( [ 2, N ] ) ], [ 1, Float32Array.from( [ 3, N ] ) ], [ 2, Float32Array.from( [ 6, 7 ] ) ] ] );
		const a = valeursSol( enc, instantA ), b = valeursSol( enc, instantB );
		const d = difference( a, b );
		expect( d[ 0 ] ).toBeCloseTo( 1, 6 ); // colonne 0 : z = 30, entre 25 et 50 → A 1,2 ; B 2,2
		expect( a[ 1 ] ).toBeCloseTo( 3 + ( 5 - 3 ) * 0.8, 6 ); // colonne 1 : z = 90, entre 50 et 100
		expect( Number.isNaN( b[ 1 ] ) ).toBe( true ); // niveau 50 absent en B
		expect( Number.isNaN( d[ 1 ] ) ).toBe( true );

	} );

} );
