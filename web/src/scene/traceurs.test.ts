// Traceurs animés de la scène 3D (UI v2) : ils suivent les lignes dans le sens de l'écoulement, plus vite là où le
// vent publié est plus fort, et renaissent au début d'une ligne en fin de parcours.

import { describe, expect, it } from 'vitest';
import { debutsLignes, Traceurs } from './traceurs';
import type { TamponLignes } from './tampons';

/** Deux lignes droites vers l'Est : A (3 segments de 1 maille, vitesse 2 m/s), B (1 segment, vitesse 4 m/s). */
function lignes(): TamponLignes {

	const seg = [ [ 0, 1 ], [ 1, 2 ], [ 2, 3 ], [ 10, 11 ] ];
	const positions = new Float32Array( seg.length * 6 ), couleurs = new Float32Array( seg.length * 6 ).fill( 0.5 );
	const phases = Float32Array.from( [ 0, 1, 1, 2, 2, 3, 0, 1 ] ), vitesses = Float32Array.from( [ 2, 2, 2, 2, 2, 2, 4, 4 ] );
	seg.forEach( ( [ a, b ], s ) => { positions[ s * 6 ] = a * 100; positions[ s * 6 + 3 ] = b * 100; } );
	return { positions, couleurs, phases, sommets: seg.length * 2, vitesses };

}

describe( 'traceurs', () => {

	it( 'début de chaque ligne : la phase repart de 0', () => {

		expect( Array.from( debutsLignes( lignes().phases, 4 ) ) ).toEqual( [ 0, 3 ] );

	} );

	it( 'avancent dans le sens de l’écoulement, au plus de quelques mailles par seconde', () => {

		const t = new Traceurs( 50 );
		t.charger( lignes(), 50 );
		const avant = Float32Array.from( t.positions );
		t.avancer( 0.05, 6 );
		for ( let k = 0; k < t.n; k ++ ) {

			const e = t.etatTraceur( k ), renait = e.t === 0; // renaissance : début d'une ligne
			if ( ! renait ) expect( t.positions[ k * 3 ] ).toBeGreaterThanOrEqual( avant[ k * 3 ] ); // vers l'Est
			if ( ! renait ) expect( t.positions[ k * 3 ] - avant[ k * 3 ] ).toBeLessThanOrEqual( 6 * 0.05 * 100 + 1e-3 );

		}

	} );

	it( 'plus vite sur la ligne au vent le plus fort', () => {

		const t = new Traceurs( 400 );
		t.charger( lignes(), 400 );
		const avant = Float32Array.from( t.positions ), e0 = Array.from( { length: t.n }, ( _, k ) => t.etatTraceur( k ) ), seg0 = e0.map( ( e ) => e.seg );
		t.avancer( 0.01, 6 );
		let a = 0, na = 0, b = 0, nb = 0;
		for ( let k = 0; k < t.n; k ++ ) {

			const e = t.etatTraceur( k ), s = e.seg;
			if ( e.t === 0 ) continue; // renaissance
			const d = t.positions[ k * 3 ] - avant[ k * 3 ];
			if ( seg0[ k ] === 3 && s === 3 ) { b += d; nb ++; } else if ( seg0[ k ] < 3 && s < 3 ) { a += d; na ++; }

		}
		expect( nb ).toBeGreaterThan( 0 );
		expect( b / nb ).toBeGreaterThan( a / na );

	} );

	it( 'renaissent au début d’une ligne en fin de parcours ; aucune ligne : aucun traceur', () => {

		const t = new Traceurs( 20 );
		t.charger( lignes(), 20 );
		for ( let i = 0; i < 200; i ++ ) t.avancer( 0.1, 6 );
		for ( let k = 0; k < t.n; k ++ ) expect( [ 0, 1, 2, 3 ] ).toContain( t.etatTraceur( k ).seg );
		t.charger( null, 20 );
		expect( t.n ).toBe( 0 );

	} );

} );
