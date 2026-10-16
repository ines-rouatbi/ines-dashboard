// Compteurs animés et sparklines (UI v2) : la valeur publiée finale est toujours dans le DOM ; null = trou.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Compteur, segmentsSparkline, sortieCubique, valeurCompteur } from './Compteur';

describe( 'compteur', () => {

	it( 'courbe bornée, de la valeur de départ à la valeur publiée', () => {

		expect( sortieCubique( 0 ) ).toBe( 0 );
		expect( sortieCubique( 1 ) ).toBe( 1 );
		expect( sortieCubique( 2 ) ).toBe( 1 );
		expect( valeurCompteur( 0, 3.5, 1 ) ).toBe( 3.5 );
		expect( valeurCompteur( 2, 4, 0.5 ) ).toBeGreaterThan( 3 ); // départ rapide

	} );

	it( 'rendu statique : valeur finale dans l’élément porteur du testid, « non disponible » si null', () => {

		const f = ( x: number ) => `${ x.toFixed( 1 ) } m/s`;
		expect( renderToStaticMarkup( <Compteur valeur={ 1.55 } format={ f } testid="k" /> ) ).toContain( 'data-testid="k">1.6 m/s<' );
		const nd = renderToStaticMarkup( <Compteur valeur={ null } format={ f } testid="k" /> );
		expect( nd ).toContain( '>non disponible<' );
		expect( nd ).not.toContain( '0.0' );

	} );

} );

describe( 'sparkline', () => {

	it( 'null coupe la courbe (jamais 0), échelle min..max', () => {

		const s = segmentsSparkline( [ 1, 2, null, 4, 5 ], 100, 30, 0 );
		expect( s.length ).toBe( 2 );
		expect( s[ 0 ].map( ( p ) => p.x ) ).toEqual( [ 0, 25 ] );
		expect( s[ 1 ].map( ( p ) => p.x ) ).toEqual( [ 75, 100 ] );
		expect( s[ 0 ][ 0 ].y ).toBe( 30 ); // minimum en bas
		expect( s[ 1 ][ 1 ].y ).toBe( 0 ); // maximum en haut

	} );

	it( 'valeurs égales : plate au milieu ; aucune valeur : rien', () => {

		expect( segmentsSparkline( [ 3, 3 ], 100, 30 )[ 0 ].map( ( p ) => p.y ) ).toEqual( [ 15, 15 ] );
		expect( segmentsSparkline( [ null, null ] ) ).toEqual( [] );

	} );

} );
