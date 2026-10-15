// D6 : hauteur au-dessus du sol calculée par colonne depuis le relief et les niveaux ASL.
import { describe, expect, it } from 'vitest';
import { HAUTEURS_SOL_M, MOTIF, encadrer, resumer, valeursSol } from './hauteurSol';

const NIVEAUX = [ 25, 50, 75, 100, 150, 200, 300, 400, 500, 650, 800, 1000 ];

describe( 'encadrer (D6)', () => {

	it( 'les cartes de la vue d’ensemble sont à 10, 100, 300 et 1 000 m au-dessus du sol', () => {

		expect( [ ...HAUTEURS_SOL_M ] ).toEqual( [ 10, 100, 300, 1000 ] );

	} );

	it( 'z = relief + h, encadré par le premier k tel que L[k] ≤ z ≤ L[k+1]', () => {

		// Relief 20 m : 100 m sol = 120 m mer, entre 100 et 150 (poids 0,4).
		const e = encadrer( [ 20 ], NIVEAUX, 100, 5 );
		expect( e.bas[ 0 ] ).toBe( 3 );
		expect( e.poids[ 0 ] ).toBeCloseTo( 0.4, 6 );
		expect( e.niveaux ).toEqual( [ 3, 4 ] );
		// z pile sur un niveau : premier encadrement (poids 1 sur le niveau haut).
		const p = encadrer( [ 0 ], NIVEAUX, 100, 5 );
		expect( p.bas[ 0 ] ).toBe( 2 );
		expect( p.poids[ 0 ] ).toBeCloseTo( 1, 6 );

	} );

	it( 'ce n’est PAS un changement de libellé : même hauteur sol, niveaux différents selon le relief', () => {

		const e = encadrer( [ 0, 300 ], NIVEAUX, 100, 5 );
		expect( e.bas[ 0 ] ).toBe( 2 ); // 100 m mer
		expect( e.bas[ 1 ] ).toBe( 6 ); // 400 m mer : entre 300 et 400, poids 1
		expect( e.motif[ 0 ] ).toBe( MOTIF.ENCADREE );

	} );

	it( 'au-dessus du sommet, sous le premier niveau, plus près du sol que min_agl_m : absent', () => {

		const e = encadrer( [ 19, 579 ], NIVEAUX, 1000, 5 );
		expect( [ ...e.motif ] ).toEqual( [ MOTIF.AU_DESSUS_SOMMET, MOTIF.AU_DESSUS_SOMMET ] );
		expect( e.niveaux ).toEqual( [] );
		expect( encadrer( [ 0 ], NIVEAUX, 10, 5 ).motif[ 0 ] ).toBe( MOTIF.SOUS_PREMIER_NIVEAU );
		expect( encadrer( [ 100 ], NIVEAUX, 3, 5 ).motif[ 0 ] ).toBe( MOTIF.TROP_PRES_DU_SOL );

	} );

} );

describe( 'valeursSol', () => {

	const champs = ( valeurs: number[][] ) => new Map( valeurs.map( ( v, k ) => [ k, Float32Array.from( v ) ] ) );

	it( 'interpolation linéaire entre les niveaux encadrants', () => {

		const e = encadrer( [ 20 ], NIVEAUX, 100, 5 );
		const v = valeursSol( e, champs( NIVEAUX.map( ( _, k ) => [ k ] ) ) );
		expect( v[ 0 ] ).toBeCloseTo( 3.4, 5 );

	} );

	it( 'NaN sous le relief : un niveau encadrant absent donne NaN, jamais 0', () => {

		// Relief 30 m : 10 m sol = 40 m mer, entre 25 (sous le relief, NaN) et 50.
		const e = encadrer( [ 30 ], NIVEAUX, 10, 5 );
		const f = champs( NIVEAUX.map( ( z ) => [ z - 30 < 5 ? NaN : 7 ] ) );
		const v = valeursSol( e, f );
		expect( Number.isNaN( v[ 0 ] ) ).toBe( true );
		const r = resumer( e, v );
		expect( r.disponibles ).toBe( 0 );
		expect( r.moyenne ).toBeNull();
		expect( r.min ).toBeNull();
		expect( r.absentes.sous_relief ).toBe( 1 );

	} );

	it( 'uint8 255 → NaN (décodé) : absent, et status pris au niveau le plus proche, jamais interpolé', () => {

		const f = champs( NIVEAUX.map( ( _, k ) => [ k < 4 ? 1 : 0 ] ) );
		expect( valeursSol( encadrer( [ 20 ], NIVEAUX, 100, 5 ), f, 'proche' )[ 0 ] ).toBe( 1 ); // poids 0,4 → bas
		expect( valeursSol( encadrer( [ 50 ], NIVEAUX, 100, 5 ), f, 'proche' )[ 0 ] ).toBe( 0 ); // 150 m : poids 1 → haut
		const absent = champs( NIVEAUX.map( () => [ NaN ] ) );
		expect( Number.isNaN( valeursSol( encadrer( [ 20 ], NIVEAUX, 100, 5 ), absent, 'proche' )[ 0 ] ) ).toBe( true );

	} );

	it( 'un niveau nécessaire non chargé est une erreur, pas un 0', () => {

		const e = encadrer( [ 20 ], NIVEAUX, 100, 5 );
		expect( () => valeursSol( e, new Map() ) ).toThrow( /non chargé/ );

	} );

	it( 'résumé : min, moyenne, max des seules valeurs disponibles et décompte des absences', () => {

		const e = encadrer( [ 20, 20, 950 ], NIVEAUX, 100, 5 );
		const v = valeursSol( e, ( k ) => Float32Array.from( [ k, k + 1, 0 ] ) );
		const r = resumer( e, v );
		expect( r.disponibles ).toBe( 2 );
		expect( r.min ).toBeCloseTo( 3.4, 5 );
		expect( r.max ).toBeCloseTo( 4.4, 5 );
		expect( r.absentes.au_dessus_sommet ).toBe( 1 );

	} );

} );
