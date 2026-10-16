// Préférences d'affichage (UI v2) : thème résolu, animations réduites, style des graphiques.

import { describe, expect, it } from 'vitest';
import { mouvementReduit, mouvementResolu, themeResolu } from './preferences';
import { styleGraphique } from './graphiquesTheme';
import { COULEURS, COULEURS_SOMBRE } from './couleurs';

describe( 'thème', () => {

	it( 'le choix mémorisé l’emporte, sinon la préférence du système', () => {

		expect( themeResolu( 'dark', false ) ).toBe( 'dark' );
		expect( themeResolu( 'light', true ) ).toBe( 'light' );
		expect( themeResolu( null, true ) ).toBe( 'dark' );
		expect( themeResolu( null, false ) ).toBe( 'light' );
		expect( themeResolu( 'n’importe quoi', false ) ).toBe( 'light' );

	} );

	it( 'graphiques : couleurs d’interface du thème, données inchangées', () => {

		const clair = styleGraphique( 'light', false ), sombre = styleGraphique( 'dark', false );
		expect( clair.encre ).toBe( COULEURS.encre );
		expect( sombre.encre ).toBe( COULEURS_SOMBRE.encre );
		expect( sombre.fond ).toBe( COULEURS_SOMBRE.panneau );
		expect( clair.animation.animation ).toBe( true );

	} );

} );

describe( 'animations réduites', () => {

	it( 'préférence du système OU choix dans l’interface', () => {

		expect( mouvementResolu( null, true ) ).toBe( true );
		expect( mouvementResolu( 'reduit', false ) ).toBe( true );
		expect( mouvementResolu( 'systeme', false ) ).toBe( false );
		expect( mouvementResolu( null, false ) ).toBe( false );

	} );

	it( 'coupe les animations d’entrée des graphiques', () => {

		const g = styleGraphique( 'light', true );
		expect( g.animation ).toEqual( { animation: false, animationDuration: 0, animationEasing: 'cubicOut', animationDurationUpdate: 0 } );

	} );

	it( 'hors navigateur (tests, rendu statique) : pas de réduction imposée, aucune erreur', () => {

		expect( typeof mouvementReduit() ).toBe( 'boolean' );

	} );

} );
