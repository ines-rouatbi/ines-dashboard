// `npm run contract:types` : génère web/src/data/contract.gen.ts depuis contract/schemas/.
//
// Les schémas sont réunis en UN seul schéma en mémoire (les types communs ne sont émis
// qu'une fois) : chaque réponse devient une entrée de $defs avec un nom TypeScript propre,
// et les références « common.schema.json#/$defs/x » sont réécrites en « #/$defs/X ».
// Ne jamais éditer contract.gen.ts à la main : relancer ce script après toute PR du contrat.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const racine = resolve( fileURLToPath( new URL( '..', import.meta.url ) ) );
const dossier = join( racine, 'contract', 'schemas' );
const sortie = join( racine, 'web', 'src', 'data', 'contract.gen.ts' );

const pascal = ( s ) => s.replace( /(^|[_-])([a-z0-9])/g, ( _, __, c ) => c.toUpperCase() );
const lire = ( f ) => JSON.parse( readFileSync( join( dossier, f ), 'utf8' ) );

// Réécrit les $ref vers common.schema.json, retire $id / $schema.
function nettoyer( noeud ) {

	if ( Array.isArray( noeud ) ) return noeud.map( nettoyer );
	if ( ! noeud || typeof noeud !== 'object' ) return noeud;
	// $ref accompagné d'autres mots-clés (souvent une description) : le déréférencement
	// fusionnerait les deux et créerait un doublon (Interval1, Sha81…). On l'enveloppe.
	if ( typeof noeud.$ref === 'string' && Object.keys( noeud ).length > 1 ) {

		const { $ref, ...reste } = noeud;
		return { ...nettoyer( reste ), allOf: [ nettoyer( { $ref } ) ] };

	}

	const out = {};
	for ( const [ k, v ] of Object.entries( noeud ) ) {

		if ( k === '$id' || k === '$schema' ) continue;
		if ( k === '$ref' && typeof v === 'string' ) {

			// « common.schema.json#/$defs/x » (depuis une réponse) ou « #/$defs/x » (dans common,
			// seul fichier à porter des $defs).
			const m = v.match( /^(?:common\.schema\.json)?#\/\$defs\/(\w+)$/ );
			if ( ! m ) throw new Error( `référence non prise en charge : ${ v }` );
			out.$ref = `#/$defs/${ pascal( m[ 1 ] ) }`;
			continue;

		}

		out[ k ] = nettoyer( v );

	}

	return out;

}

const defs = {};

// Types communs.
const commun = lire( 'common.schema.json' );
for ( const [ nom, def ] of Object.entries( commun.$defs ) ) defs[ pascal( nom ) ] = { ...nettoyer( def ), title: pascal( nom ) };

// Une entrée par réponse (le titre d'origine devient la description).
const fichiers = readdirSync( dossier ).filter( ( f ) => f.endsWith( '.schema.json' ) && f !== 'common.schema.json' ).sort();
const reponses = [];
for ( const f of fichiers ) {

	const s = lire( f );
	const nom = pascal( f.replace( '.schema.json', '' ) ).replace( /^Windrose$/, 'WindRose' );
	const { title, ...reste } = nettoyer( s );
	defs[ nom ] = { ...reste, title: nom, description: [ title, s.description ].filter( Boolean ).join( '\n\n' ) };
	reponses.push( nom );

}

const schema = {
	title: 'ContratV1',
	description: 'Ensemble des réponses du contrat v1 (une propriété par schéma).',
	type: 'object',
	additionalProperties: false,
	properties: Object.fromEntries( reponses.map( ( n ) => [ n, { $ref: `#/$defs/${ n }` } ] ) ),
	$defs: defs,
};

const ts = await compile( schema, 'ContratV1', {
	bannerComment: [
		'/* eslint-disable */',
		'// FICHIER GÉNÉRÉ par dev/gen-contract-types.mjs depuis contract/schemas/ — ne pas éditer.',
		'// Régénérer : npm run contract:types',
	].join( '\n' ),
	unreachableDefinitions: true,
	strictIndexSignatures: true,
	style: { singleQuote: true, useTabs: true },
} );

writeFileSync( sortie, ts.replace( /\r\n/g, '\n' ) );
console.log( `contract.gen.ts : ${ reponses.length } réponses, ${ Object.keys( commun.$defs ).length } types communs` );
