// Rotors 3D (UI v2) : provenance au moyeu lue au niveau publié le plus proche, orientation face au vent.

import { describe, expect, it } from 'vitest';
import { orientationRotor, provenanceAuMoyeu, vitesseAngulaire } from './rotors';

type Niveau = { z_agl_m: number; below_terrain: boolean; dir_from_deg: number | null };
const profil = ( levels: Niveau[] ) => ( { levels } ) as unknown as Parameters<typeof provenanceAuMoyeu>[ 0 ];

describe( 'provenance du vent au moyeu', () => {

	it( 'niveau publié le plus proche du moyeu, sans interpolation d’angle', () => {

		const p = profil( [
			{ z_agl_m: - 20, below_terrain: true, dir_from_deg: 10 },
			{ z_agl_m: 30, below_terrain: false, dir_from_deg: 350 },
			{ z_agl_m: 80, below_terrain: false, dir_from_deg: 20 },
			{ z_agl_m: 130, below_terrain: false, dir_from_deg: 40 },
		] );
		expect( provenanceAuMoyeu( p, 90 ) ).toBe( 20 );
		expect( provenanceAuMoyeu( p, 120 ) ).toBe( 40 );
		expect( provenanceAuMoyeu( p, 0 ) ).toBe( 350 ); // le niveau sous le relief n'est jamais retenu

	} );

	it( 'null si aucun niveau utile (direction absente, sous le relief, pas de profil)', () => {

		expect( provenanceAuMoyeu( profil( [ { z_agl_m: 90, below_terrain: false, dir_from_deg: null } ] ), 90 ) ).toBeNull();
		expect( provenanceAuMoyeu( profil( [ { z_agl_m: 90, below_terrain: true, dir_from_deg: 200 } ] ), 90 ) ).toBeNull();
		expect( provenanceAuMoyeu( null, 90 ) ).toBeNull();

	} );

} );

describe( 'orientation du rotor', () => {

	// Normale du disque (+Z local) tournée de φ autour de Y : (sin φ, cos φ) en (X = Est, Z = −Nord).
	const normale = ( d: number | null ) => { const f = orientationRotor( d ); return [ Math.sin( f ), Math.cos( f ) ]; };
	const proche = ( a: number[], b: number[] ) => a.forEach( ( x, k ) => expect( x ).toBeCloseTo( b[ k ], 9 ) );

	it( 'le disque fait face à la provenance du vent', () => {

		proche( normale( 0 ), [ 0, - 1 ] ); // vent du nord : face au nord (Z = −Nord)
		proche( normale( 90 ), [ 1, 0 ] ); // vent d'est : face à l'est
		proche( normale( 180 ), [ 0, 1 ] ); // vent du sud
		proche( normale( 270 ), [ - 1, 0 ] ); // vent d'ouest

	} );

	it( 'provenance inconnue : face au sud', () => {

		expect( orientationRotor( null ) ).toBe( 0 );
		expect( orientationRotor( Number.NaN ) ).toBe( 0 );

	} );

	it( 'vitesse angulaire : un tour par période, 0 si immobile', () => {

		expect( vitesseAngulaire( 4 ) ).toBeCloseTo( Math.PI / 2, 12 );
		expect( vitesseAngulaire( null ) ).toBe( 0 );
		expect( vitesseAngulaire( 0 ) ).toBe( 0 );

	} );

} );
