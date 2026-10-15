// Lot F2 (scène 3D) : fonctions pures de la scène — hauteur au-dessus du sol (D6), fiabilité,
// lignes de courant, coloration et légende chiffrée, maillage des coupes, picking sur le relief.

import { describe, expect, it } from 'vitest';
import { encadrer, interpolerColonne, moyenneMax, niveauxUtiles, planHauteurSol } from './hauteurSol';
import { classeFiabilite } from './fiabilite';
import { bilineaireStricte, bilineaireTolerante, lignesDeCourant } from './lignes';
import { couleur, echelle, graduations, NEUTRE, pasRond } from './palettes';
import { intersecterSurface, longueurEchelle, trianglesValides } from './maillage';
import { niveauDepuisColonne } from './profile';

const L = [ 25, 50, 75, 100, 150, 200, 300, 400, 500, 650, 800, 1000 ];

describe( 'hauteur au-dessus du sol (D6) : par colonne, avec le relief du modèle', () => {

	it( 'interpole entre les niveaux mer encadrant z = relief + h', () => {

		// Relief 120 m, h = 120 → z = 240 m : entre 200 (k = 5) et 300 (k = 6), t = 0,4.
		expect( encadrer( L, 240 ) ).toEqual( { k: 5, t: expect.closeTo( 0.4, 12 ) } );
		const val = ( k: number ) => k * 10;
		expect( interpolerColonne( L, val, 240 ) ).toBeCloseTo( 54, 9 );
		// Exactement sur un niveau : la valeur du nœud.
		expect( interpolerColonne( L, val, 650 ) ).toBe( 90 );

	} );

	it( 'NaN sous le relief, sous min_agl_m et hors du domaine vertical — jamais 0', () => {

		// Nœud k = 3 (100 m) absent (sous le relief) : z = 120 m est entre 100 et 150 → NaN.
		const val = ( k: number ) => ( k <= 3 ? NaN : 7 );
		expect( interpolerColonne( L, val, 120 ) ).toBeNaN();
		expect( interpolerColonne( L, val, 150 ) ).toBe( 7 ); // exactement sur un nœud qui existe
		expect( interpolerColonne( L, () => 7, 10 ) ).toBeNaN(); // sous le premier niveau
		expect( interpolerColonne( L, () => 7, 1200 ) ).toBeNaN(); // au-dessus du dernier

		const terrain = Float32Array.from( [ 19, 850 ] );
		const champ = ( k: number ) => Float32Array.from( [ L[ k ] - 19 >= 5 ? k : NaN, L[ k ] - 850 >= 5 ? k : NaN ] );
		const p = planHauteurSol( { altitudes: L, terrain, minAgl: 5, h: 120, niveau: champ } );
		// Colonne 0 : z = 139 → entre 100 (k=3) et 150 (k=4) ; colonne 1 (relief 850) : z = 970 → entre 800 (k=10, sous le relief) et 1000 → NaN.
		expect( p[ 0 ] ).toBeCloseTo( 3 + 39 / 50, 5 );
		expect( p[ 1 ] ).toBeNaN();
		// h < min_agl_m : aucun nœud n'existe si près du sol.
		expect( [ ...planHauteurSol( { altitudes: L, terrain, minAgl: 5, h: 4, niveau: champ } ) ].every( Number.isNaN ) ).toBe( true );
		// Niveau non chargé → NaN, pas 0.
		expect( planHauteurSol( { altitudes: L, terrain, minAgl: 5, h: 120, niveau: () => undefined } )[ 0 ] ).toBeNaN();

	} );

	it( 'niveaux utiles : ceux qui encadrent relief_min + h … relief_max + h', () => {

		expect( niveauxUtiles( L, 19, 600, 120, 5 ) ).toEqual( [ 3, 4, 5, 6, 7, 8, 9, 10 ] );
		expect( niveauxUtiles( L, 19, 600, 3, 5 ) ).toEqual( [] );
		expect( niveauxUtiles( L, 19, 600, 5000, 5 ) ).toEqual( [] );

	} );

	it( 'moyenne et maximum : null sans valeur définie', () => {

		expect( moyenneMax( Float32Array.from( [ NaN, NaN ] ) ) ).toEqual( { moyenne: null, max: null, n: 0 } );
		expect( moyenneMax( Float32Array.from( [ 2, NaN, 4 ] ) ) ).toEqual( { moyenne: 3, max: 4, n: 2 } );

	} );

} );

describe( 'classe de fiabilité', () => {

	it( 'seuils 0,5 et 0,75 ; inconnue → null', () => {

		expect( classeFiabilite( 0.75 ) ).toBe( 'elevee' );
		expect( classeFiabilite( 0.7480 ) ).toBe( 'moyenne' );
		expect( classeFiabilite( 0.5 ) ).toBe( 'moyenne' );
		expect( classeFiabilite( 0.4999 ) ).toBe( 'faible' );
		expect( classeFiabilite( null ) ).toBeNull();
		expect( classeFiabilite( NaN ) ).toBeNull();

	} );

	it( 'le profil porte la classe, et null sous le relief', () => {

		const base = { z_asl_m: 650, z_agl_m: 500, below_terrain: false, u: 3, v: 4, w: 0, speed: 5, sigma_speed: 0.5, coverage: 0.5, status: 0 as const };
		expect( niveauDepuisColonne( { ...base, reliability: 0.8 } ).reliability_class ).toBe( 'elevee' );
		expect( niveauDepuisColonne( { ...base, reliability: null } ).reliability_class ).toBeNull();
		expect( niveauDepuisColonne( { ...base, below_terrain: true, u: null, v: null, speed: null, reliability: null } ).reliability_class ).toBeNull();

	} );

} );

describe( 'lignes de courant', () => {

	const nx = 40, ny = 30;
	const champ = ( u0: number, v0: number, trou?: ( i: number, j: number ) => boolean ) => {

		const u = new Float32Array( nx * ny ), v = new Float32Array( nx * ny );
		for ( let j = 0; j < ny; j ++ ) for ( let i = 0; i < nx; i ++ ) {

			const k = j * nx + i, t = trou?.( i, j );
			u[ k ] = t ? NaN : u0; v[ k ] = t ? NaN : v0;

		}

		return { nx, ny, dx: 500, dy: 500, u, v };

	};

	it( 'vent d\'ouest (u > 0) : lignes horizontales parcourues vers l\'Est', () => {

		const r = lignesDeCourant( champ( 8, 0 ), { pas: 5 } );
		expect( r.lignes ).toBeGreaterThan( 0 );
		for ( let s = 0; s < r.segments; s ++ ) {

			const [ i0, j0, i1, j1 ] = r.points.subarray( s * 4, s * 4 + 4 );
			expect( i1 ).toBeGreaterThan( i0 ); // sens de l'écoulement
			expect( j1 ).toBeCloseTo( j0, 6 );
			expect( r.phases[ s * 2 + 1 ] ).toBeGreaterThan( r.phases[ s * 2 ] );

		}

	} );

	it( 'vent du nord (v < 0) : lignes parcourues vers le Sud (j décroissant)', () => {

		const r = lignesDeCourant( champ( 0, - 6 ), { pas: 5 } );
		expect( r.segments ).toBeGreaterThan( 0 );
		for ( let s = 0; s < r.segments; s ++ ) expect( r.points[ s * 4 + 3 ] ).toBeLessThan( r.points[ s * 4 + 1 ] );

	} );

	it( 'aucune ligne dans le calme (< 0,2 m/s) ni à travers un nœud absent', () => {

		expect( lignesDeCourant( champ( 0.1, 0.1 ), { pas: 3 } ).segments ).toBe( 0 );
		// Bande sous le relief en i ∈ [18, 22] : aucun sommet dans la bande ouverte autour.
		const r = lignesDeCourant( champ( 8, 0, ( i ) => i >= 18 && i <= 22 ), { pas: 3 } );
		expect( r.segments ).toBeGreaterThan( 0 );
		for ( let s = 0; s < r.segments * 2; s ++ ) {

			const fi = r.points[ s * 2 ];
			expect( fi <= 17 || fi >= 23, `sommet en fi = ${ fi }` ).toBe( true );

		}

	} );

	it( 'décimation : plafond de segments respecté, germes plus espacés → moins de lignes', () => {

		const c = champ( 5, 3 );
		expect( lignesDeCourant( c, { pas: 2, maxSegments: 100 } ).segments ).toBeLessThanOrEqual( 100 );
		expect( lignesDeCourant( c, { pas: 8 } ).lignes ).toBeLessThan( lignesDeCourant( c, { pas: 3 } ).lignes );

	} );

	it( 'bilinéaire : stricte → NaN près d\'un nœud absent ; tolérante → nœuds définis seulement', () => {

		const f = Float32Array.from( [ 0, 2, NaN, 4 ] );
		expect( bilineaireStricte( f, 2, 2, 0.5, 0.5 ) ).toBeNaN();
		expect( bilineaireStricte( f, 2, 2, 0.5, 0 ) ).toBe( 1 );
		expect( bilineaireTolerante( f, 2, 2, 0.5, 0.5 ) ).toBeCloseTo( 2, 9 );
		expect( bilineaireTolerante( Float32Array.from( [ NaN, NaN, NaN, NaN ] ), 2, 2, 0.5, 0.5 ) ).toBeNaN();

	} );

} );

describe( 'coloration et légende chiffrée', () => {

	it( 'échelles : vitesse min..max, incertitude 0..max, fiabilité 0..1 ; null sans valeur', () => {

		const v = Float32Array.from( [ 4, NaN, 9 ] );
		expect( echelle( 'vitesse', v ) ).toEqual( { coloration: 'vitesse', min: 4, max: 9 } );
		expect( echelle( 'incertitude', v ) ).toEqual( { coloration: 'incertitude', min: 0, max: 9 } );
		expect( echelle( 'fiabilite', v ) ).toEqual( { coloration: 'fiabilite', min: 0, max: 1 } );
		expect( echelle( 'vitesse', Float32Array.from( [ NaN ] ) ) ).toBeNull();

	} );

	it( 'valeur inconnue → couleur neutre, jamais la couleur du minimum', () => {

		const e = echelle( 'vitesse', Float32Array.from( [ 0, 10 ] ) );
		expect( couleur( e, NaN ) ).toEqual( NEUTRE );
		expect( couleur( e, 0 ) ).not.toEqual( NEUTRE );
		expect( couleur( null, 3 ) ).toEqual( NEUTRE );

	} );

	it( 'graduations : bornes exactes et valeurs rondes ; fiabilité aux seuils de classe', () => {

		const g = graduations( { coloration: 'vitesse', min: 3.37, max: 11.9 } );
		expect( g[ 0 ] ).toEqual( { valeur: 3.37, position: 0 } );
		expect( g[ g.length - 1 ] ).toEqual( { valeur: 11.9, position: 1 } );
		expect( g.slice( 1, - 1 ).map( ( x ) => x.valeur ) ).toEqual( [ 6, 8, 10 ] );
		expect( graduations( { coloration: 'fiabilite', min: 0, max: 1 } ).map( ( x ) => x.valeur ) ).toEqual( [ 0, 0.5, 0.75, 1 ] );
		expect( pasRond( 8.5 ) ).toBe( 2 );

	} );

} );

describe( 'maillage des coupes et picking', () => {

	it( 'aucun triangle ne touche un nœud absent', () => {

		// 3 × 2 sommets, le sommet (2, 0) absent : seul le quadrilatère de gauche reste.
		const t = trianglesValides( 3, 2, [ 1, 1, 0, 1, 1, 1 ] );
		expect( t.length ).toBe( 6 );
		expect( [ ...t ].includes( 2 ) ).toBe( false );

	} );

	it( 'rayon / relief : premier point sous la surface, dans le domaine', () => {

		const b = { xmin: 0, xmax: 10_000, ymin: 0, ymax: 5000 };
		// Plan z = 300 m, rayon descendant à 45° depuis (0, 2500, 2300) vers l'Est.
		const p = intersecterSurface( [ 0, 2500, 2300 ], [ 1, 0, - 1 ], () => 300, b, 50 )!;
		expect( p.x ).toBeCloseTo( 2000, 0 );
		expect( p.z ).toBeCloseTo( 300, 0 );
		// Colline en x = 1000 m qui masque le plan derrière elle.
		const colline = ( x: number ) => ( Math.abs( x - 1000 ) < 200 ? 2000 : 300 );
		expect( intersecterSurface( [ 0, 2500, 2300 ], [ 1, 0, - 1 ], colline, b, 20 )!.x ).toBeCloseTo( 800, - 1 );
		// Rayon qui part vers le ciel : rien.
		expect( intersecterSurface( [ 0, 2500, 2300 ], [ 1, 0, 1 ], () => 300, b, 50 ) ).toBeNull();
		// Rayon hors du domaine.
		expect( intersecterSurface( [ - 100, - 100, 2300 ], [ - 1, 0, - 1 ], () => 300, b, 50 ) ).toBeNull();

	} );

	it( 'barre d\'échelle ronde', () => {

		expect( longueurEchelle( 9900 ) ).toBe( 5000 );
		expect( longueurEchelle( 12_000 ) ).toBe( 10_000 );
		expect( longueurEchelle( 450 ) ).toBe( 200 );

	} );

} );
