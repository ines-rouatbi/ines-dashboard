// Tests « pièges » sans navigateur (F5-c). Chaque valeur attendue est calculée à la main dans le
// commentaire qui la précède : un oracle qui se vérifie avec lui-même ne vérifie rien.
import { test, expect } from '@playwright/test';
import {
	windDirection, angularDiff, decodeField, finiteStats, aslFromAgl, sampleAtAgl, interpProfile,
	rews, shearExponent, powerAt, gamma, weibullMean, weibullQuantile, weibullMoments, weibullMle,
	sectorOf, windRose, type PowerCurve,
} from './wind';

const s = 5 / Math.SQRT2; // composante d'un vent de 5 m/s à 45°

test.describe( 'direction météo (d’où vient le vent)', () => {

	// (270 − atan2(v,u)) mod 360. Ex. u=0, v=−5 : atan2 = −90° → 360 mod 360 = 0° (vent du nord).
	const cases: [ string, number, number, number ][] = [
		[ 'nord', 0, - 5, 0 ],
		[ 'nord-est', - s, - s, 45 ], // atan2(−,−) = −135° → 405 mod 360 = 45
		[ 'est', - 5, 0, 90 ], // atan2 = 180° → 90
		[ 'sud-est', - s, s, 135 ], // atan2 = 135° → 135
		[ 'sud', 0, 5, 180 ], // atan2 = 90° → 180
		[ 'sud-ouest', s, s, 225 ], // atan2 = 45° → 225
		[ 'ouest', 5, 0, 270 ], // atan2 = 0° → 270
		[ 'nord-ouest', s, - s, 315 ], // atan2 = −45° → 315
	];

	for ( const [ name, u, v, expected ] of cases ) {

		test( `${ name } : u=${ u.toFixed( 2 ) }, v=${ v.toFixed( 2 ) } → ${ expected }°`, () => {

			const d = windDirection( u, v );
			expect( d ).not.toBeNull();
			expect( angularDiff( d!, expected ) ).toBeLessThan( 1e-9 );
			expect( d! ).toBeGreaterThanOrEqual( 0 );
			expect( d! ).toBeLessThan( 360 );

		} );

	}

	test( 'piège : la direction n’est PAS celle vers laquelle souffle le vent', () => {

		// u = +5 souffle vers l'est, donc VIENT de l'ouest : 270°, pas 90°.
		expect( windDirection( 5, 0 ) ).toBe( 270 );

	} );

	test( 'vent calme (< 0,2 m/s) : direction indéfinie', () => {

		expect( windDirection( 0, 0 ) ).toBeNull();
		expect( windDirection( 0.19, 0 ) ).toBeNull();
		expect( windDirection( 0.1, - 0.1 ) ).toBeNull(); // |V| = 0,141
		expect( windDirection( NaN, 1 ) ).toBeNull();

	} );

	test( 'borne : exactement 0,2 m/s est défini (seuil strict)', () => {

		expect( windDirection( 0.2, 0 ) ).toBe( 270 );

	} );

	test( 'jamais 360 : le nord s’écrit 0', () => {

		expect( windDirection( - 1e-12, - 5 ) ).toBeLessThan( 360 );

	} );

} );

test.describe( 'champ binaire Float32 LE, ordre [j][i], NaN sous le relief', () => {

	test( 'décodage indépendant de la machine et indexation sud → nord, ouest → est', () => {

		const nx = 3, ny = 2;
		const buf = new ArrayBuffer( nx * ny * 4 ), dv = new DataView( buf );
		// j = 0 (sud) : 1 2 3 ; j = 1 (nord) : NaN 5 6
		[ 1, 2, 3, NaN, 5, 6 ].forEach( ( x, k ) => dv.setFloat32( k * 4, x, true ) );
		const f = decodeField( buf, nx, ny );
		expect( f.at( 0, 0 ) ).toBe( 1 ); // coin sud-ouest
		expect( f.at( 2, 0 ) ).toBe( 3 ); // coin sud-est
		expect( f.at( 1, 1 ) ).toBe( 5 );
		expect( Number.isNaN( f.at( 0, 1 ) ) ).toBe( true ); // nœud sous le relief
		expect( finiteStats( f.data ) ).toEqual( { min: 1, max: 6, n: 5, nan: 1 } );

	} );

	test( 'piège : lire en big-endian donne autre chose', () => {

		const buf = new ArrayBuffer( 4 );
		new DataView( buf ).setFloat32( 0, 7.5, true );
		expect( decodeField( buf, 1, 1 ).at( 0, 0 ) ).toBe( 7.5 );
		expect( new DataView( buf ).getFloat32( 0, false ) ).not.toBe( 7.5 );

	} );

	test( 'taille incohérente : erreur explicite, pas un champ tronqué', () => {

		expect( () => decodeField( new ArrayBuffer( 20 ), 3, 2 ) ).toThrow( /attendu 24 o/ );

	} );

	test( 'piège : NaN ne doit pas fausser min / max', () => {

		// Math.min avec un NaN rend NaN : les statistiques doivent ignorer le relief.
		expect( Math.min( ...[ 4, NaN, 2 ] ) ).toBeNaN();
		expect( finiteStats( [ 4, NaN, 2 ] ) ).toEqual( { min: 2, max: 4, n: 2, nan: 1 } );
		expect( finiteStats( [ NaN, NaN ] ) ).toEqual( { min: null, max: null, n: 0, nan: 2 } );

	} );

} );

test.describe( 'hauteur au-dessus du sol ≠ altitude (décision D6)', () => {

	// Niveaux du modèle en altitude ; sol à 350 m : le niveau 300 m est sous le relief.
	const levels = [ 100, 300, 500, 700 ];
	const values = [ NaN, NaN, 8, 10 ];
	const terrain = 350;

	test( '120 m au-dessus d’un sol à 350 m = 470 m d’altitude', () => {

		expect( aslFromAgl( 120, terrain ) ).toBe( 470 );

	} );

	test( '250 m sol → 600 m : interpolation entre 500 (8) et 700 (10) = 9', () => {

		expect( sampleAtAgl( levels, values, terrain, 250 ) ).toBeCloseTo( 9, 12 );

	} );

	test( 'piège : 120 m sol tombe entre un niveau sous le relief et 500 m → NaN, pas une valeur inventée', () => {

		// 470 m est entre 300 m (sous le relief, NaN) et 500 m : on n'interpole pas à travers le sol.
		expect( sampleAtAgl( levels, values, terrain, 120 ) ).toBeNaN();

	} );

	test( 'piège : prendre le libellé « 120 m » pour une altitude lit un niveau sous le relief', () => {

		// Le niveau 100 m est sous le relief : une interface qui changerait juste le libellé
		// afficherait NaN (ou pire, une valeur d'un autre niveau).
		expect( values[ levels.indexOf( 100 ) ] ).toBeNaN();

	} );

	test( 'hors colonne ou sous le sol → NaN', () => {

		expect( sampleAtAgl( levels, values, terrain, - 1 ) ).toBeNaN();
		expect( sampleAtAgl( levels, values, terrain, 400 ) ).toBeNaN(); // 750 m > 700 m

	} );

} );

test.describe( 'vent équivalent rotor (REWS)', () => {

	test( 'profil uniforme : REWS = vitesse', () => {

		expect( rews( () => 7, 100, 120 ) ).toBeCloseTo( 7, 9 );

	} );

	test( 'profil linéaire : solution exacte REWS³ = a³ + 3·a·b²·R²/4', () => {

		// v(z) = a + b(z − H). Sur le disque, E[(z−H)] = E[(z−H)³] = 0 et E[(z−H)²] = R²/4.
		// a = 8, b = 0,02 /m, R = 60 m : 512 + 3·8·0,0004·900 = 512 + 8,64 = 520,64 → 8,04476…
		const a = 8, b = 0.02, H = 100, D = 120;
		const got = rews( ( z ) => a + b * ( z - H ), H, D );
		expect( got ).toBeCloseTo( Math.cbrt( 520.64 ), 4 );
		expect( got ).toBeGreaterThan( a ); // moyenne du cube ≥ vitesse au moyeu

	} );

	test( 'piège : REWS ≠ moyenne arithmétique sur le disque', () => {

		// La moyenne arithmétique d'un profil linéaire vaut exactement a = 8 ; REWS vaut 8,045.
		const got = rews( ( z ) => 8 + 0.02 * ( z - 100 ), 100, 120 );
		expect( Math.abs( got - 8 ) ).toBeGreaterThan( 0.04 );

	} );

	test( 'interpolation de profil bornée aux extrémités', () => {

		const h = [ 10, 100, 300 ], v = [ 4, 8, 10 ];
		expect( interpProfile( h, v, 55 ) ).toBeCloseTo( 6, 12 ); // milieu de 10–100
		expect( interpProfile( h, v, 5 ) ).toBe( 4 );
		expect( interpProfile( h, v, 400 ) ).toBe( 10 );

	} );

	test( 'cisaillement : v₂ = v₁·2^0,2 entre 50 et 100 m → α = 0,2', () => {

		expect( shearExponent( 50, 6, 100, 6 * 2 ** 0.2 ) ).toBeCloseTo( 0.2, 12 );

	} );

} );

test.describe( 'courbe de puissance', () => {

	const curve: PowerCurve = { speeds: [ 3, 5, 10, 12 ], power: [ 0, 200, 1800, 2000 ], cutIn: 3, cutOut: 25 };

	test( 'interpolation linéaire : 7,5 m/s → 200 + 0,5·1600 = 1000 kW', () => {

		expect( powerAt( curve, 7.5 ) ).toBeCloseTo( 1000, 9 );

	} );

	test( 'plateau nominal, sous le démarrage, au-delà de la coupure', () => {

		expect( powerAt( curve, 15 ) ).toBe( 2000 );
		expect( powerAt( curve, 2.9 ) ).toBe( 0 );
		expect( powerAt( curve, 25.1 ) ).toBe( 0 );
		expect( powerAt( curve, NaN ) ).toBeNaN();

	} );

	test( 'correction de densité IEC : ρ = 0,9·ρ₀ → v·∛0,9 = 7,2412 m/s → 917,17 kW', () => {

		// ∛0,9 = 0,965489 ; 7,5·0,965489 = 7,24117 ; 200 + (2,24117/5)·1600 = 917,17
		expect( powerAt( curve, 7.5, 0.9 * 1.225 ) ).toBeCloseTo( 917.17, 1 );

	} );

	test( 'piège : la coupure porte sur la vitesse réelle, pas sur la vitesse corrigée par la densité', () => {

		// 25,5 m/s réels > coupure 25 → 0 kW, même si 25,5·∛0,9 = 24,62 m/s serait sous la coupure.
		expect( powerAt( curve, 25.5, 0.9 * 1.225 ) ).toBe( 0 );
		// Air dense ρ = 1,1·ρ₀ : 24,5 m/s réels (< 25) → 24,5·∛1,1 = 25,29 m/s normalisés, PAS de coupure :
		// lecture sur le plateau nominal.
		expect( powerAt( curve, 24.5, 1.1 * 1.225 ) ).toBe( 2000 );
		// Démarrage : 2,95 m/s réels < 3 → 0 kW, même si 2,95·∛1,1 = 3,045 m/s normalisés.
		expect( powerAt( curve, 2.95, 1.1 * 1.225 ) ).toBe( 0 );

	} );

} );

test.describe( 'Weibull', () => {

	test( 'fonction Γ : Γ(5) = 24, Γ(½) = √π, Γ(1,5) = 0,886227', () => {

		expect( gamma( 5 ) ).toBeCloseTo( 24, 10 );
		expect( gamma( 0.5 ) ).toBeCloseTo( Math.sqrt( Math.PI ), 12 );
		expect( gamma( 1.5 ) ).toBeCloseTo( 0.886227, 6 );

	} );

	test( 'moyenne : k = 2, c = 8 → 8·Γ(1,5) = 7,0898 m/s', () => {

		expect( weibullMean( { k: 2, c: 8 } ) ).toBeCloseTo( 7.0898, 4 );

	} );

	// Échantillon déterministe : quantiles (i − ½)/n d'une Weibull(k = 2, c = 8).
	const sample = Array.from( { length: 4000 }, ( _, i ) => weibullQuantile( 2, 8, ( i + 0.5 ) / 4000 ) );

	test( 'maximum de vraisemblance : retrouve k = 2, c = 8 à 1 % près', () => {

		const w = weibullMle( sample );
		expect( Math.abs( w.k / 2 - 1 ) ).toBeLessThan( 0.01 );
		expect( Math.abs( w.c / 8 - 1 ) ).toBeLessThan( 0.01 );
		expect( w.n ).toBe( 4000 );

	} );

	test( 'méthode des moments (Justus) : retrouve k = 2, c = 8 à 3 % près', () => {

		const w = weibullMoments( sample );
		expect( Math.abs( w.k / 2 - 1 ) ).toBeLessThan( 0.03 );
		expect( Math.abs( w.c / 8 - 1 ) ).toBeLessThan( 0.03 );

	} );

	test( 'cas dégénérés : refus explicite, jamais un NaN ni un k plafonné en silence', () => {

		expect( () => weibullMle( [ 5 ] ) ).toThrow( /au moins 2/ );
		expect( () => weibullMoments( [ 0, 0, 5 ] ) ).toThrow( /au moins 2/ );
		expect( () => weibullMle( [ 7, 7, 7, 7 ] ) ).toThrow( /hors de/ );
		expect( () => weibullMoments( [ 7, 7, 7, 7 ] ) ).toThrow( /hors de/ );

	} );

	test( 'les valeurs nulles (calmes) sont exclues de l’ajustement', () => {

		expect( weibullMle( [ 0, 0, ...sample ] ).n ).toBe( 4000 );

	} );

} );

test.describe( 'rose des vents', () => {

	test( 'secteurs de 22,5° centrés sur le nord', () => {

		// Le secteur 0 couvre [348,75 ; 11,25[.
		expect( sectorOf( 0, 16 ) ).toBe( 0 );
		expect( sectorOf( 11.24, 16 ) ).toBe( 0 );
		expect( sectorOf( 11.26, 16 ) ).toBe( 1 );
		expect( sectorOf( 348.76, 16 ) ).toBe( 0 );
		expect( sectorOf( 348.74, 16 ) ).toBe( 15 );
		expect( sectorOf( 90, 16 ) ).toBe( 4 );
		expect( sectorOf( 270, 12 ) ).toBe( 9 );

	} );

	test( 'comptes, fréquences, calmes et nombre d’instants valides', () => {

		const r = windRose( [
			{ u: 0, v: - 5 }, { u: 0, v: - 3 }, // 2 × nord, 4 m/s de moyenne
			{ u: 5, v: 0 }, // ouest
			{ u: 0.1, v: 0 }, // calme
			{ u: NaN, v: 1 }, // invalide
		], 16 );
		expect( r.counts[ 0 ] ).toBe( 2 );
		expect( r.counts[ 12 ] ).toBe( 1 );
		expect( r.nValid ).toBe( 3 );
		expect( r.nCalm ).toBe( 1 );
		expect( r.nInvalid ).toBe( 1 );
		expect( r.freq[ 0 ] ).toBeCloseTo( 2 / 3, 12 );
		expect( r.meanSpeed[ 0 ] ).toBeCloseTo( 4, 12 );
		expect( r.meanSpeed[ 1 ] ).toBeNull();
		expect( r.freq.reduce( ( a, b ) => a + b, 0 ) ).toBeCloseTo( 1, 12 );

	} );

} );
