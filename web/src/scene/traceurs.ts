// Traceurs animés le long des lignes de courant de la scène 3D (UI v2), sans three.js (testé).
//
// Les lignes de courant (domain/lignes.ts → scene/tampons.ts) sont des polylignes orientées dans le sens de
// l'écoulement, découpées en segments consécutifs (2 sommets chacun) ; la phase (abscisse curviligne, en mailles)
// repart de 0 au début de chaque ligne. Un traceur avance le long d'une ligne, dans le sens de l'écoulement, à une
// vitesse d'affichage proportionnelle à la vitesse horizontale publiée (interpolée sur le segment) ; en fin de ligne
// il renaît au début d'une autre ligne. Tableaux préalloués, aucune allocation par image (V3D10).

import type { TamponLignes } from './tampons';

/** Index du premier segment de chaque ligne (la phase de son premier sommet vaut 0). */
export function debutsLignes( phases: Float32Array, segments: number ): Int32Array {

	let n = 0;
	for ( let s = 0; s < segments; s ++ ) if ( phases[ s * 2 ] === 0 ) n ++;
	const out = new Int32Array( n );
	n = 0;
	for ( let s = 0; s < segments; s ++ ) if ( phases[ s * 2 ] === 0 ) out[ n ++ ] = s;
	return out;

}

export class Traceurs {

	readonly capacite: number;
	n = 0;
	/** Positions (x, y, z) et couleurs (r, v, b sRGB 0..1) des traceurs, prêtes pour un BufferAttribute. */
	readonly positions: Float32Array;
	readonly couleurs: Float32Array;
	private readonly seg: Int32Array;
	private readonly t: Float32Array;
	private readonly fin: Int32Array;
	private lignes: TamponLignes | null = null;
	private debuts: Int32Array = new Int32Array( 0 );
	private finDe: Int32Array = new Int32Array( 0 );
	private vmax = 1;
	private graine = 1;

	constructor( capacite: number ) {

		this.capacite = capacite;
		this.positions = new Float32Array( capacite * 3 );
		this.couleurs = new Float32Array( capacite * 3 );
		this.seg = new Int32Array( capacite );
		this.t = new Float32Array( capacite );
		this.fin = new Int32Array( capacite );

	}

	private alea(): number {

		// Générateur linéaire congruentiel : déterministe, sans allocation.
		this.graine = ( Math.imul( this.graine, 1664525 ) + 1013904223 ) >>> 0;
		return this.graine / 4294967296;

	}

	/** Charge des lignes ; `n` traceurs répartis au hasard le long des lignes. null = aucun traceur. */
	charger( l: TamponLignes | null, n: number ) {

		this.lignes = l;
		const segments = l ? l.sommets / 2 : 0;
		this.debuts = l ? debutsLignes( l.phases, segments ) : new Int32Array( 0 );
		this.finDe = new Int32Array( this.debuts.length );
		for ( let q = 0; q < this.debuts.length; q ++ ) this.finDe[ q ] = q + 1 < this.debuts.length ? this.debuts[ q + 1 ] : segments;
		let vmax = 0;
		if ( l?.vitesses ) for ( let k = 0; k < l.sommets; k ++ ) { const v = l.vitesses[ k ]; if ( v > vmax ) vmax = v; }
		this.vmax = vmax > 0 ? vmax : 1;
		this.n = this.debuts.length ? Math.min( n, this.capacite ) : 0;
		for ( let k = 0; k < this.n; k ++ ) {

			const q = Math.floor( this.alea() * this.debuts.length );
			this.fin[ k ] = this.finDe[ q ];
			this.seg[ k ] = this.debuts[ q ] + Math.floor( this.alea() * ( this.finDe[ q ] - this.debuts[ q ] ) );
			this.t[ k ] = this.alea();
			this.placer( k );

		}

	}

	private renaitre( k: number ) {

		const q = Math.floor( this.alea() * this.debuts.length );
		this.seg[ k ] = this.debuts[ q ];
		this.fin[ k ] = this.finDe[ q ];
		this.t[ k ] = 0;

	}

	private placer( k: number ) {

		const l = this.lignes!, s = this.seg[ k ], f = this.t[ k ], a = s * 2, b = a + 1;
		for ( let c = 0; c < 3; c ++ ) {

			this.positions[ k * 3 + c ] = l.positions[ a * 3 + c ] + ( l.positions[ b * 3 + c ] - l.positions[ a * 3 + c ] ) * f;
			// Couleur du segment, éclaircie : le traceur se détache de sa ligne.
			const col = l.couleurs[ a * 3 + c ] + ( l.couleurs[ b * 3 + c ] - l.couleurs[ a * 3 + c ] ) * f;
			this.couleurs[ k * 3 + c ] = col + ( 1 - col ) * 0.45;

		}

	}

	/**
	 * Avance chaque traceur de `dt` s : `maillesParSeconde` mailles/s à la vitesse maximale des lignes, au moins un
	 * quart de ce rythme aux vitesses faibles (sinon les lignes calmes paraîtraient figées).
	 */
	avancer( dt: number, maillesParSeconde = 6 ) {

		const l = this.lignes;
		if ( ! l || ! this.n ) return;
		for ( let k = 0; k < this.n; k ++ ) {

			let s = this.seg[ k ], f = this.t[ k ];
			const a = s * 2;
			const v = l.vitesses ? ( l.vitesses[ a ] + ( l.vitesses[ a + 1 ] - l.vitesses[ a ] ) * f ) : this.vmax;
			let reste = maillesParSeconde * dt * ( 0.25 + 0.75 * Math.min( 1, Math.max( 0, ( Number.isFinite( v ) ? v : 0 ) / this.vmax ) ) );
			let garde = 0;
			while ( reste > 0 && garde ++ < 64 ) {

				const longueur = Math.max( 1e-6, l.phases[ s * 2 + 1 ] - l.phases[ s * 2 ] );
				const dispo = ( 1 - f ) * longueur;
				if ( reste < dispo ) { f += reste / longueur; reste = 0; break; }
				reste -= dispo;
				s ++; f = 0;
				if ( s >= this.fin[ k ] ) { this.renaitre( k ); s = this.seg[ k ]; f = 0; reste = 0; }

			}
			this.seg[ k ] = s; this.t[ k ] = f;
			this.placer( k );

		}

	}

	/** Segment et position dans le segment d'un traceur (tests). */
	etatTraceur( k: number ): { seg: number; t: number } { return { seg: this.seg[ k ], t: this.t[ k ] }; }

}
