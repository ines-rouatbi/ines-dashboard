// Middleware de développement : sert GET /v1/* depuis contract/fixtures/<scénario>/.
//
// Permet de développer le front sans GPU ni Worker. Le scénario vient de la variable
// d'environnement ATOM_FIXTURE (par défaut « normal »). Un fichier absent répond
// 404 JSON { error: "absent" } : le front doit le tolérer (« indisponible »).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface CibleFixture {
	/** Chemin relatif au dossier du scénario. */
	fichier: string;
	type: 'application/json' | 'application/octet-stream';
}

// Segments autorisés dans une URL : pas de « .. », pas de séparateurs.
const SEG = /^[A-Za-z0-9_.:-]+$/;
const sur = ( s: string ) => SEG.test( s ) && ! s.includes( '..' );

const JSON_T = 'application/json' as const;

/** Correspondance chemin /v1/... -> fichier de fixture (null si route inconnue). */
export function cibleFixture( pathname: string ): CibleFixture | null {

	if ( ! pathname.startsWith( '/v1/' ) ) return null;
	const p = pathname.slice( 4 ).split( '/' ).filter( Boolean );
	if ( ! p.every( sur ) ) return null;

	const [ route, ...rest ] = p;
	switch ( route ) {

		case 'meta': return rest.length === 0 ? { fichier: 'meta.json', type: JSON_T } : null;
		case 'latest': return rest.length === 0 ? { fichier: 'latest.json', type: JSON_T } : null;
		case 'windrose': return rest.length === 0 ? { fichier: 'windrose.json', type: JSON_T } : null;
		case 'snapshots': return rest.length === 1 ? { fichier: 'snapshot.json', type: JSON_T } : null;
		case 'profiles': return rest.length === 1 ? { fichier: 'profile.json', type: JSON_T } : null;
		case 'quality': return rest.length === 1 ? { fichier: 'quality.json', type: JSON_T } : null;
		case 'alerts': return rest.length === 1 ? { fichier: 'alerts.json', type: JSON_T } : null;
		case 'stations': return rest.length === 1 ? { fichier: 'stations.json', type: JSON_T } : null;
		case 'wind-farm': return rest.length === 1 ? { fichier: 'wind-farm.json', type: JSON_T } : null;
		case 'fields':
			if ( rest.length !== 3 ) return null;
			return { fichier: `fields/${ rest[ 1 ] }_${ rest[ 2 ] }.f32`, type: 'application/octet-stream' };
		default: return null;

	}

}

function absent( res: ServerResponse ) {

	res.statusCode = 404;
	res.setHeader( 'content-type', 'application/json; charset=utf-8' );
	res.setHeader( 'cache-control', 'no-store' );
	res.end( JSON.stringify( { error: 'absent' } ) );

}

/** Fabrique le middleware (Connect) pour le serveur de dev / preview de Vite. */
export function middlewareFixtures( racineFixtures: string, scenario: string ) {

	const dossier = resolve( racineFixtures, scenario );

	return ( req: IncomingMessage, res: ServerResponse, next: () => void ) => {

		const url = new URL( req.url ?? '/', 'http://localhost' );
		if ( ! url.pathname.startsWith( '/v1/' ) ) return next();
		if ( req.method !== 'GET' && req.method !== 'HEAD' ) return absent( res );

		const cible = cibleFixture( url.pathname );
		if ( ! cible || ! sur( scenario ) ) return absent( res );

		const chemin = join( dossier, cible.fichier );
		if ( ! existsSync( chemin ) || ! statSync( chemin ).isFile() ) return absent( res );

		const corps = readFileSync( chemin );
		res.statusCode = 200;
		res.setHeader( 'content-type', cible.type === JSON_T ? 'application/json; charset=utf-8' : cible.type );
		res.setHeader( 'cache-control', 'no-store' );
		res.setHeader( 'x-atom-fixture', scenario );
		res.end( req.method === 'HEAD' ? undefined : corps );

	};

}
