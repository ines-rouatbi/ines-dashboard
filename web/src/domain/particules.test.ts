// Particules de vent (UI v2) : advection dans le sens du vent publié, arrêt sur les nœuds absents, densité,
// palette, conversion écran, flèches statiques (animations réduites), fondu d'affichage.

import { describe, expect, it } from 'vitest';
import {
	aleaGraine, ajusterDensite, avancer, classeVitesse, courbeFondu, creerParticules, facteurTemps, flechesStatiques,
	noeudDepuisEcran, noeudsValides, nombreParticules, peupler, tableCouleurs, ventEn, versEcran, vitesseMax, type ChampVent,
} from './particules';
import { dirFrom } from './wind';

/** Champ uniforme nx × ny (u, v) avec des nœuds absents optionnels. */
function champ( nx: number, ny: number, u: number, v: number, absents: number[] = [] ): ChampVent {

	const U = new Float32Array( nx * ny ).fill( u ), V = new Float32Array( nx * ny ).fill( v );
	for ( const k of absents ) { U[ k ] = NaN; V[ k ] = NaN; }
	return { nx, ny, dx: 100, dy: 100, u: U, v: V };

}

describe( 'lecture du champ', () => {

	it( 'bilinéaire stricte : un nœud utile absent rend le point indéfini, un nœud de poids nul non', () => {

		const c = champ( 4, 4, 3, 4, [ 5 ] ); // nœud (1, 1) absent
		const out = new Float32Array( 2 );
		expect( ventEn( c, 2.5, 2.5, out ) ).toBe( true );
		expect( [ out[ 0 ], out[ 1 ] ] ).toEqual( [ 3, 4 ] );
		expect( ventEn( c, 0.5, 0.5, out ) ).toBe( false ); // maille qui touche (1, 1)
		expect( ventEn( c, 2, 2, out ) ).toBe( true ); // sur le nœud (2, 2) : (1, 1) a un poids nul
		expect( ventEn( c, - 0.1, 1, out ) ).toBe( false );
		expect( ventEn( c, 3.01, 1, out ) ).toBe( false );

	} );

	it( 'nœuds valides et vitesse horizontale maximale (NaN ignoré, null si rien)', () => {

		const c = champ( 3, 2, 3, 4, [ 0, 4 ] );
		expect( Array.from( noeudsValides( c ) ) ).toEqual( [ 1, 2, 3, 5 ] );
		expect( vitesseMax( c ) ).toBe( 5 );
		expect( vitesseMax( champ( 2, 2, NaN, NaN ) ) ).toBeNull();

	} );

} );

describe( 'advection', () => {

	it( 'une particule avance dans le sens où VA le vent (u vers l’Est, v vers le Nord)', () => {

		// Vent de sud-ouest (vient du SO, va vers le NE) : u > 0, v > 0.
		const c = champ( 50, 50, 3, 3 );
		expect( dirFrom( 3, 3 ) ).toBe( 225 );
		const p = creerParticules( 1 ), alea = aleaGraine( 1 );
		peupler( p, 1, c, noeudsValides( c ), alea, 1e9 );
		p.age[ 0 ] = 0;
		p.fi[ 0 ] = p.fj[ 0 ] = 20;
		avancer( p, c, 0.1, facteurTemps( vitesseMax( c ), c.dx, c.dy ), noeudsValides( c ), alea, 1e9 );
		expect( p.fi[ 0 ] ).toBeGreaterThan( 20 );
		expect( p.fj[ 0 ] ).toBeGreaterThan( 20 );
		expect( p.fi[ 0 ] - 20 ).toBeCloseTo( p.fj[ 0 ] - 20, 5 );
		expect( p.pi[ 0 ] ).toBe( 20 );
		expect( p.vitesse[ 0 ] ).toBeCloseTo( Math.hypot( 3, 3 ), 5 );

	} );

	it( 'la vitesse maximale parcourt le nombre de mailles par seconde demandé', () => {

		const c = champ( 100, 10, 5, 0 );
		const f = facteurTemps( 5, 100, 100, 18 );
		const p = creerParticules( 1 ), alea = aleaGraine( 2 );
		peupler( p, 1, c, noeudsValides( c ), alea, 1e9 );
		p.age[ 0 ] = 0; p.fi[ 0 ] = 10; p.fj[ 0 ] = 5;
		avancer( p, c, 1, f, noeudsValides( c ), alea, 1e9 );
		expect( p.fi[ 0 ] ).toBeCloseTo( 28, 5 );
		expect( facteurTemps( null, 100, 100 ) ).toBe( 0 );

	} );

	it( 'une particule qui entre dans une zone sans vent publié renaît sur un nœud publié (jamais de vent inventé)', () => {

		const nx = 10, ny = 10, absents: number[] = [];
		for ( let j = 0; j < ny; j ++ ) for ( let i = 5; i < nx; i ++ ) absents.push( j * nx + i ); // moitié est absente
		const c = champ( nx, ny, 2, 0, absents );
		const valides = noeudsValides( c ), alea = aleaGraine( 3 );
		const p = creerParticules( 200 );
		peupler( p, 200, c, valides, alea, 1e9 );
		for ( let s = 0; s < 200; s ++ ) avancer( p, c, 0.05, facteurTemps( 2, 100, 100 ), valides, alea, 1e9 );
		for ( let k = 0; k < p.n; k ++ ) expect( p.fi[ k ] ).toBeLessThanOrEqual( 4.5 );

	} );

	it( 'fin de vie : renaissance, âge remis à zéro', () => {

		const c = champ( 10, 10, 1, 1 ), valides = noeudsValides( c ), alea = aleaGraine( 4 );
		const p = creerParticules( 5 );
		peupler( p, 5, c, valides, alea, 1 );
		for ( let k = 0; k < 5; k ++ ) p.age[ k ] = 10;
		avancer( p, c, 0.01, 1, valides, alea, 1 );
		for ( let k = 0; k < 5; k ++ ) { expect( p.age[ k ] ).toBe( 0 ); expect( Number.isNaN( p.vitesse[ k ] ) ).toBe( true ); }

	} );

	it( 'reproductible avec une graine', () => {

		const a = aleaGraine( 42 ), b = aleaGraine( 42 );
		for ( let k = 0; k < 10; k ++ ) expect( a() ).toBe( b() );

	} );

} );

describe( 'densité et performance', () => {

	it( 'proportionnelle à la surface utile, bornée', () => {

		expect( nombreParticules( 700, 350, 1 ) ).toBe( 1750 );
		expect( nombreParticules( 700, 350, 0.5 ) ).toBe( 875 );
		expect( nombreParticules( 100, 50, 1 ) ).toBe( 120 );
		expect( nombreParticules( 5000, 5000, 1 ) ).toBe( 6000 );
		expect( nombreParticules( 700, 350, 0 ) ).toBe( 0 );

	} );

	it( 'réduction adaptative quand l’image est trop lente', () => {

		expect( ajusterDensite( 2000, 16, 200 ) ).toBe( 2000 );
		expect( ajusterDensite( 2000, 30, 200 ) ).toBe( 1500 );
		expect( ajusterDensite( 210, 30, 200 ) ).toBe( 200 );

	} );

} );

describe( 'palette et écran', () => {

	it( 'classes de vitesse sur [0, vmax], -1 si inconnue', () => {

		expect( classeVitesse( 0, 10, 8 ) ).toBe( 0 );
		expect( classeVitesse( 9.99, 10, 8 ) ).toBe( 7 );
		expect( classeVitesse( 12, 10, 8 ) ).toBe( 7 );
		expect( classeVitesse( NaN, 10, 8 ) ).toBe( - 1 );
		expect( classeVitesse( 3, 0, 8 ) ).toBe( - 1 );

	} );

	it( 'table de couleurs échantillonnée sur la rampe, bornes exactes', () => {

		const t = tableCouleurs( [ '#000000', '#FFFFFF' ], 3, 0.5 );
		expect( t ).toEqual( [ 'rgba(0,0,0,0.5)', 'rgba(128,128,128,0.5)', 'rgba(255,255,255,0.5)' ] );

	} );

	it( 'nord en haut, centre de maille comme le raster ; aller-retour écran → nœud', () => {

		expect( versEcran( 0, 0, 10, 5, 100, 50 ) ).toEqual( [ 5, 45 ] );
		const [ x, y ] = versEcran( 9, 4, 10, 5, 100, 50 );
		expect( x ).toBeCloseTo( 95, 9 ); expect( y ).toBeCloseTo( 5, 9 );
		expect( noeudDepuisEcran( 0.05, 0.9, 10, 5 ) ).toEqual( { i: 0, j: 0 } );
		expect( noeudDepuisEcran( 0.99, 0.01, 10, 5 ) ).toEqual( { i: 9, j: 4 } );
		expect( noeudDepuisEcran( 1.5, - 1, 10, 5 ) ).toEqual( { i: 9, j: 4 } );

	} );

} );

describe( 'animations réduites et fondu', () => {

	it( 'flèches statiques dans le sens où va le vent, nœuds absents sautés', () => {

		const c = champ( 4, 4, 0, - 2, [ 0 ] ); // vent du nord : va vers le sud
		const f = flechesStatiques( c, 1 );
		expect( f.length ).toBe( 15 );
		expect( f[ 0 ] ).toEqual( { fi: 1, fj: 0, ux: 0, uy: - 1, s: 1 } );
		expect( flechesStatiques( champ( 2, 2, NaN, NaN ), 1 ) ).toEqual( [] );

	} );

	it( 'fondu d’affichage borné et doux', () => {

		expect( courbeFondu( - 1 ) ).toBe( 0 );
		expect( courbeFondu( 0.5 ) ).toBe( 0.5 );
		expect( courbeFondu( 2 ) ).toBe( 1 );
		expect( courbeFondu( 0.1 ) ).toBeLessThan( 0.1 );

	} );

} );
