// Pages animées (UI v2) : rotors (immobiles hors production), filtre des alertes, jauges (null = non disponible),
// curseur avant / après. Rendu statique (sans navigateur).

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { dureeFilet, periodeRalenti, periodeRotor, Rotors } from './eolien/Rotors';
import { filtrerAlertes } from './alertes/AlertesPage';
import { Jauge, longueurArc } from '../ui/Jauge';
import { bornerPourcent } from './comparaison/AvantApres';
import type { Alert, Turbine } from './shared/types';

const turbine = ( p: Partial<Turbine> ): Turbine => ( {
	id: 'T-01', name: 'Éolienne 1', x_m: 0, y_m: 0, virtual: true, model: 'm', hub_agl_m: 90, rotor_d_m: 126, rated_kw: 5000, cut_in_ms: 3, cut_out_ms: 25,
	hub_speed: { p10: 5, p50: 8, p90: 10 }, rews: { p10: 5, p50: 8, p90: 10 }, shear_alpha: 0.2, veer_deg: 1, power_kw: { p10: 1, p50: 2, p90: 3 },
	state: 'production', air_density: 1.2, air_density_source: 'atmosphere_standard', ...p,
} as Turbine );

describe( 'rotors animés', () => {

	it( 'tournent en production, proportionnellement au vent au moyeu (bornés)', () => {

		expect( periodeRotor( turbine( {} ) ) ).toBe( 1.5 );
		expect( periodeRotor( turbine( { hub_speed: { p10: 2, p50: 4, p90: 6 } } ) ) ).toBe( 3 );
		expect( periodeRotor( turbine( { hub_speed: { p10: 20, p50: 24, p90: 25 } } ) ) ).toBe( 0.8 );

	} );

	it( 'immobiles à l’arrêt, indisponibles ou sans vent publié', () => {

		expect( periodeRotor( turbine( { state: 'arret_vent_faible' } ) ) ).toBeNull();
		expect( periodeRotor( turbine( { state: 'arret_vent_fort' } ) ) ).toBeNull();
		expect( periodeRotor( turbine( { state: 'indisponible' } ) ) ).toBeNull();
		expect( periodeRotor( turbine( { hub_speed: { p10: null, p50: null, p90: null } } ) ) ).toBeNull();
		const html = renderToStaticMarkup( <Rotors turbines={ [ turbine( { state: 'arret_vent_faible', hub_speed: { p10: 0, p50: 1.22, p90: 2.62 } } ) ] } /> );
		expect( html ).toContain( 'data-mode="ralenti"' );
		expect( html ).toContain( 'À l’arrêt : vent trop faible' );
		expect( html ).toContain( 'rotor au ralenti, sans production' );
		expect( html ).toContain( '1,2 m/s' );

	} );

	it( 'au ralenti à l’arrêt (vent faible ou fort), plus lent que la production ; immobile si indisponible', () => {

		expect( periodeRalenti( turbine( { state: 'arret_vent_faible', hub_speed: { p10: 0, p50: 1.22, p90: 2.62 } } ) ) ).toBeCloseTo( 9.836, 2 );
		expect( periodeRalenti( turbine( { state: 'arret_vent_faible', hub_speed: { p10: 0, p50: 0.5, p90: 1 } } ) ) ).toBe( 10 );
		expect( periodeRalenti( turbine( { state: 'arret_vent_fort', hub_speed: { p10: 25, p50: 27, p90: 30 } } ) ) ).toBe( 8 );
		expect( periodeRalenti( turbine( {} ) ) ).toBeNull();
		expect( periodeRalenti( turbine( { state: 'indisponible' } ) ) ).toBeNull();
		expect( periodeRalenti( turbine( { state: 'arret_vent_faible', hub_speed: { p10: null, p50: null, p90: null } } ) ) ).toBeNull();
		const html = renderToStaticMarkup( <Rotors turbines={ [ turbine( { state: 'indisponible' } ) ] } /> );
		expect( html ).toContain( 'data-tourne="non"' );
		expect( html ).toContain( 'data-mode="immobile"' );

	} );

	it( 'filets d’air à la vitesse du vent publié (bornés), absents sans vent', () => {

		expect( dureeFilet( 2 ) ).toBe( 3 );
		expect( dureeFilet( 30 ) ).toBe( 0.6 );
		expect( dureeFilet( 0.1 ) ).toBe( 6 );
		expect( dureeFilet( null ) ).toBeNull();
		expect( dureeFilet( 0 ) ).toBeNull();

	} );

} );

describe( 'filtre des alertes', () => {

	const a = ( id: string, title: string, target: string ): Alert => ( {
		id, title, target, kind: 'cisaillement', level: 'information', status: 'ouverte', cause: 'c', recommendation: 'r', raised_at: '2025-01-01T00:00:00Z',
		value: null, threshold: null, unit: null, location: null,
	} as unknown as Alert );
	const items = [ a( '1', 'Cisaillement marqué', 'T-01' ), a( '2', 'Vent fort au moyeu', 'T-02' ) ];

	it( 'tous les mots, sans accents, sur le titre, la cible et le type', () => {

		expect( filtrerAlertes( items, '' ).length ).toBe( 2 );
		expect( filtrerAlertes( items, 'marque' ).map( ( x ) => x.id ) ).toEqual( [ '1' ] );
		expect( filtrerAlertes( items, 't-02 vent' ).map( ( x ) => x.id ) ).toEqual( [ '2' ] );
		expect( filtrerAlertes( items, 'cisaillement' ).length ).toBe( 2 ); // type de toutes les alertes
		expect( filtrerAlertes( items, 'absent' ) ).toEqual( [] );

	} );

} );

describe( 'jauges et avant / après', () => {

	it( 'arc proportionnel, borné ; null = non disponible (jamais 0 %)', () => {

		expect( longueurArc( 0 ) ).toBe( 0 );
		expect( longueurArc( 1 ) ).toBeCloseTo( 2 * Math.PI * 42 * 0.75, 6 );
		expect( longueurArc( 2 ) ).toBe( longueurArc( 1 ) );
		expect( longueurArc( null ) ).toBeNull();
		const html = renderToStaticMarkup( <Jauge testid="j" valeur={ null } libelle="Couverture" seuil={ 0.8 } /> );
		expect( html ).toContain( 'non disponible' );
		expect( html ).not.toContain( 'jauge-arc' );
		expect( renderToStaticMarkup( <Jauge testid="j" valeur={ 0.0374 } libelle="Fiabilité" /> ) ).toContain( '3,7 %' );

	} );

	it( 'curseur avant / après borné à 0..100 %', () => {

		expect( bornerPourcent( - 5 ) ).toBe( 0 );
		expect( bornerPourcent( 140 ) ).toBe( 100 );
		expect( bornerPourcent( NaN ) ).toBe( 50 );

	} );

} );
