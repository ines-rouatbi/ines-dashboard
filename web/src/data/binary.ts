// Décodage des champs binaires du contrat : Float32 little-endian, [j][i] du sud au nord
// puis d'ouest en est (index = j * nx + i). NaN = nœud sous le relief.

const HOTE_LITTLE_ENDIAN = new Uint8Array( new Uint16Array( [ 1 ] ).buffer )[ 0 ] === 1;

/** Convertit un tampon Float32 little-endian en Float32Array, quel que soit l'hôte. */
export function decodeFloat32LE( buf: ArrayBuffer ): Float32Array {

	if ( buf.byteLength % 4 !== 0 ) throw new Error( `taille de champ invalide : ${ buf.byteLength } octets (multiple de 4 attendu)` );
	if ( HOTE_LITTLE_ENDIAN ) return new Float32Array( buf.slice( 0 ) );
	const n = buf.byteLength / 4, out = new Float32Array( n ), dv = new DataView( buf );
	for ( let k = 0; k < n; k ++ ) out[ k ] = dv.getFloat32( k * 4, true );
	return out;

}

/** Encode (pour les tests et outils) un tableau en Float32 little-endian. */
export function encodeFloat32LE( values: ArrayLike<number> ): ArrayBuffer {

	const buf = new ArrayBuffer( values.length * 4 ), dv = new DataView( buf );
	for ( let k = 0; k < values.length; k ++ ) dv.setFloat32( k * 4, values[ k ], true );
	return buf;

}
