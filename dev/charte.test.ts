// Charte graphique §17.4 (lot F6) : theme.css et couleurs.ts disent la même chose, et les contrastes du texte
// respectent WCAG 2.1 AA (4,5:1 ; 3:1 pour les marques non textuelles et les grands titres).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { COULEURS, COULEURS_SOMBRE, ETATS, RAMPE_DIFFERENCE, RAMPE_INCERTITUDE, RAMPE_VITESSE, VARIABLES_CSS, VARIABLES_CSS_SOMBRE, contraste, luminance } from '../web/src/ui/couleurs';
import { ETAT_CAPTEUR } from '../web/src/pages/f3/couleurs';

// Lu sur disque : sous Vitest, l'import d'un .css (même ?raw) rend une chaîne vide.
const css = readFileSync( new URL( '../web/src/ui/theme.css', import.meta.url ), 'utf8' );

const racine = /:root\s*\{([^}]*)\}/.exec( css )?.[ 1 ] ?? '';
const variables = Object.fromEntries( [ ...racine.matchAll( /(--[\w-]+)\s*:\s*([^;]+);/g ) ].map( ( m ) => [ m[ 1 ], m[ 2 ].trim() ] ) );
const sombre = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec( css )?.[ 1 ] ?? '';
const variablesSombre = Object.fromEntries( [ ...sombre.matchAll( /(--[\w-]+)\s*:\s*([^;]+);/g ) ].map( ( m ) => [ m[ 1 ], m[ 2 ].trim() ] ) );

describe( 'Charte §17.4 : couleurs d’interface', () => {

	it( 'reprend les valeurs du cahier des charges', () => {

		expect( COULEURS.encre ).toBe( '#12263A' );
		expect( COULEURS.fond ).toBe( '#E9EEF1' );
		expect( COULEURS.panneau ).toBe( '#FFFFFF' );
		expect( COULEURS.accent ).toBe( '#1E6FB8' );
		expect( COULEURS.sable ).toBe( '#B8925A' );

	} );

	it( 'theme.css déclare chaque variable avec la valeur de couleurs.ts', () => {

		for ( const [ nom, valeur ] of Object.entries( VARIABLES_CSS ) ) expect( variables[ nom ]?.toUpperCase(), nom ).toBe( valeur.toUpperCase() );

	} );

	it( 'typographie : Inter pour le texte, Inter Display pour les titres, chiffres tabulaires', () => {

		expect( variables[ '--police-texte' ] ).toMatch( /^"Inter"/ );
		expect( variables[ '--police-titres' ] ).toMatch( /^"Inter Display"/ );
		expect( css ).toMatch( /h1, h2, h3[^{]*\{[^}]*var\(--police-titres\)/ );
		expect( css ).toMatch( /tabular-nums/ );

	} );

} );

describe( 'Charte §17.4 : contrastes (WCAG 2.1 AA)', () => {

	const textes = [ 'encre', 'encre2', 'encre3', 'accentTexte', 'sableTexte', 'okTexte', 'attentionTexte', 'alerteTexte' ] as const;
	it.each( textes )( 'texte %s ≥ 4,5:1 sur les panneaux et sur le fond', ( k ) => {

		expect( contraste( COULEURS[ k ], COULEURS.panneau ) ).toBeGreaterThanOrEqual( 4.5 );
		expect( contraste( COULEURS[ k ], COULEURS.fond ) ).toBeGreaterThanOrEqual( 4.5 );

	} );

	it( 'texte blanc sur l’accent (navigation, boutons) et sur l’encre (barre supérieure)', () => {

		expect( contraste( '#FFFFFF', COULEURS.accent ) ).toBeGreaterThanOrEqual( 4.5 );
		expect( contraste( '#FFFFFF', COULEURS.encre ) ).toBeGreaterThanOrEqual( 4.5 );

	} );

	it.each( [ 'ok', 'attention', 'alerte', 'accent' ] as const )( 'marque %s ≥ 3:1 sur les panneaux et sur le fond', ( k ) => {

		expect( contraste( COULEURS[ k ], COULEURS.panneau ) ).toBeGreaterThanOrEqual( 3 );
		expect( contraste( COULEURS[ k ], COULEURS.fond ) ).toBeGreaterThanOrEqual( 3 );

	} );

	it( 'contraste : valeurs de référence WCAG', () => {

		expect( contraste( '#000000', '#FFFFFF' ) ).toBeCloseTo( 21, 5 );
		expect( contraste( '#777777', '#777777' ) ).toBe( 1 );

	} );

} );

describe( 'Charte §17.4 : rampes et états', () => {

	it( 'vitesse : bleu nuit → cyan → vert → jaune → orange → rouge', () => {

		const teinte = ( h: string ) => {

			const [ r, g, b ] = [ 1, 3, 5 ].map( ( k ) => parseInt( h.slice( k, k + 2 ), 16 ) );
			return { r, g, b };

		};
		const [ nuit, cyan, vert, jaune, orange, rouge ] = RAMPE_VITESSE.map( teinte );
		expect( nuit.b ).toBeGreaterThan( nuit.r ); expect( luminance( RAMPE_VITESSE[ 0 ] ) ).toBeLessThan( 0.05 );
		expect( cyan.b ).toBeGreaterThan( cyan.r ); expect( cyan.g ).toBeGreaterThan( cyan.r );
		expect( vert.g ).toBeGreaterThan( vert.r ); expect( vert.g ).toBeGreaterThan( vert.b );
		expect( jaune.r ).toBeGreaterThan( 200 ); expect( jaune.g ).toBeGreaterThan( 180 ); expect( jaune.b ).toBeLessThan( 100 );
		expect( orange.r ).toBeGreaterThan( orange.g ); expect( orange.g ).toBeGreaterThan( orange.b );
		expect( rouge.r ).toBeGreaterThan( 150 ); expect( rouge.g ).toBeLessThan( 80 );

	} );

	it( 'incertitude : violet, du plus clair au plus foncé', () => {

		const l = RAMPE_INCERTITUDE.map( luminance );
		for ( let k = 1; k < l.length; k ++ ) expect( l[ k ] ).toBeLessThan( l[ k - 1 ] );
		for ( const h of RAMPE_INCERTITUDE ) {

			const [ r, g, b ] = [ 1, 3, 5 ].map( ( k ) => parseInt( h.slice( k, k + 2 ), 16 ) );
			expect( b ).toBeGreaterThan( g ); expect( r ).toBeGreaterThan( g ); // violet : rouge et bleu dominent le vert

		}

	} );

	it( 'différence : divergente, deux bras de même longueur autour d’un gris neutre', () => {

		expect( RAMPE_DIFFERENCE.length % 2 ).toBe( 1 );
		const milieu = RAMPE_DIFFERENCE[ ( RAMPE_DIFFERENCE.length - 1 ) / 2 ];
		const [ r, g, b ] = [ 1, 3, 5 ].map( ( k ) => parseInt( milieu.slice( k, k + 2 ), 16 ) );
		expect( Math.max( r, g, b ) - Math.min( r, g, b ) ).toBeLessThan( 12 );

	} );

	it( 'états des capteurs : vert actif, orange suspect, rouge muet, et toujours une forme et un libellé', () => {

		expect( ETAT_CAPTEUR.active.couleur ).toBe( ETATS.conforme );
		expect( ETAT_CAPTEUR.suspecte.couleur ).toBe( ETATS.avertissement );
		expect( ETAT_CAPTEUR.muette.couleur ).toBe( ETATS.important );
		const formes = new Set( Object.values( ETAT_CAPTEUR ).map( ( e ) => e.forme ) );
		expect( formes.size ).toBe( Object.keys( ETAT_CAPTEUR ).length );
		for ( const e of Object.values( ETAT_CAPTEUR ) ) expect( e.libelle.length ).toBeGreaterThan( 0 );

	} );

} );

describe( 'Charte §17.4 : thème sombre (UI v2)', () => {

	it( 'theme.css déclare chaque variable du thème sombre avec la valeur de COULEURS_SOMBRE', () => {

		expect( Object.keys( VARIABLES_CSS_SOMBRE ).sort() ).toEqual( Object.keys( VARIABLES_CSS ).sort() );
		for ( const [ nom, valeur ] of Object.entries( VARIABLES_CSS_SOMBRE ) ) expect( variablesSombre[ nom ]?.toUpperCase(), nom ).toBe( valeur.toUpperCase() );

	} );

	const textes = [ 'encre', 'encre2', 'encre3', 'accentTexte', 'sableTexte', 'okTexte', 'attentionTexte', 'alerteTexte' ] as const;
	it.each( textes )( 'texte %s ≥ 4,5:1 sur les panneaux et sur le fond sombres', ( k ) => {

		expect( contraste( COULEURS_SOMBRE[ k ], COULEURS_SOMBRE.panneau ) ).toBeGreaterThanOrEqual( 4.5 );
		expect( contraste( COULEURS_SOMBRE[ k ], COULEURS_SOMBRE.fond ) ).toBeGreaterThanOrEqual( 4.5 );

	} );

	it( 'texte blanc sur l’accent sombre (navigation, boutons)', () => {

		expect( contraste( '#FFFFFF', COULEURS_SOMBRE.accent ) ).toBeGreaterThanOrEqual( 4.5 );

	} );

	it.each( [ 'ok', 'attention', 'alerte', 'accent', 'sable' ] as const )( 'marque %s ≥ 3:1 sur les panneaux et sur le fond sombres', ( k ) => {

		expect( contraste( COULEURS_SOMBRE[ k ], COULEURS_SOMBRE.panneau ) ).toBeGreaterThanOrEqual( 3 );
		expect( contraste( COULEURS_SOMBRE[ k ], COULEURS_SOMBRE.fond ) ).toBeGreaterThanOrEqual( 3 );

	} );

	it( 'les rampes de données ne dépendent pas du thème (même sens dans les deux thèmes)', () => {

		expect( RAMPE_VITESSE[ 0 ] ).toBe( '#1A2A6C' );
		expect( css ).not.toMatch( /data-theme="dark"[^{]*\{[^}]*--rampe/ );

	} );

} );
