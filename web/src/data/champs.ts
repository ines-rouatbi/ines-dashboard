// Cache des champs binaires, par (instantané, niveau, variable).
//
// Les instantanés sont immuables : un champ chargé une fois reste valable. Le cache ne
// garde qu'UN instantané à la fois (changer d'instantané le vide) pour borner la mémoire
// (grille v7 : 500 × 250 × 4 o = 0,5 Mo par niveau d'une variable float32). Les requêtes
// sont limitées en parallèle. Le profil au clic ne passe pas par ici : il lit /v1/column.

import type { Api } from './api';
import type { FieldVar } from './contract';

export class CacheChamps {

	private instantane: string | null = null;
	private readonly promesses = new Map<string, Promise<Float32Array>>();
	private actives = 0;
	private readonly file: ( () => void )[] = [];
	private readonly client: Api;
	private readonly maxParalleles: number;

	constructor( client: Api, maxParalleles = 6 ) {

		this.client = client;
		this.maxParalleles = maxParalleles;

	}

	/** Nombre de champs en cache (pour les tests). */
	get taille() { return this.promesses.size; }

	private async creneau<T>( f: () => Promise<T> ): Promise<T> {

		if ( this.actives >= this.maxParalleles ) await new Promise<void>( ( r ) => this.file.push( r ) );
		this.actives ++;
		try { return await f(); }
		finally {

			this.actives --;
			this.file.shift()?.();

		}

	}

	/** `scale` = meta.encoding[variable].scale (variables uint8 ; ignoré pour float32). */
	champ( id: string, niveau: number, variable: FieldVar, scale?: number | null ): Promise<Float32Array> {

		if ( id !== this.instantane ) { this.instantane = id; this.promesses.clear(); }
		const cle = `${ niveau }/${ variable }`;
		let p = this.promesses.get( cle );
		if ( ! p ) {

			p = this.creneau( () => this.client.field( id, niveau, variable, scale ) );
			// Une erreur n'est pas mise en cache : on pourra réessayer.
			p.catch( () => { if ( this.promesses.get( cle ) === p ) this.promesses.delete( cle ); } );
			this.promesses.set( cle, p );

		}

		return p;

	}

}
