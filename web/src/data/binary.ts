// Décodage des champs binaires d'UN niveau (contrat v1 rév. 2), servis par
// GET /v1/fields/{id}/{level}/{var} avec l'en-tête `x-atom-dtype` :
//   - float32 : Float32 little-endian, NaN = nœud absent (sous le relief, z − relief < min_agl_m) ;
//   - uint8   : octet × meta.encoding[var].scale, 255 = absent
//               (status : 1 = mesuré, 0 = estimé ; coverage, reliability : octet/254).
// Index = j·nx + i, j = 0 au sud, i = 0 à l'ouest. Sortie toujours en Float32Array, NaN = absent.

const HOTE_LITTLE_ENDIAN = new Uint8Array( new Uint16Array( [ 1 ] ).buffer )[ 0 ] === 1;

export type Dtype = 'float32' | 'uint8';

/** Valeur uint8 qui signifie « absent ». */
export const U8_ABSENT = 255;

/** Convertit un tampon Float32 little-endian en Float32Array, quel que soit l'hôte. */
export function decodeFloat32LE( buf: ArrayBuffer ): Float32Array {

	if ( buf.byteLength % 4 !== 0 ) throw new Error( `taille de champ invalide : ${ buf.byteLength } octets (multiple de 4 attendu)` );
	if ( HOTE_LITTLE_ENDIAN ) return new Float32Array( buf.slice( 0 ) );
	const n = buf.byteLength / 4, out = new Float32Array( n ), dv = new DataView( buf );
	for ( let k = 0; k < n; k ++ ) out[ k ] = dv.getFloat32( k * 4, true );
	return out;

}

/** Décode un tampon uint8 quantifié : octet × scale, 255 → NaN. */
export function decodeUint8( buf: ArrayBuffer, scale: number | null | undefined ): Float32Array {

	const q = new Uint8Array( buf ), s = scale ?? 1, out = new Float32Array( q.length );
	for ( let k = 0; k < q.length; k ++ ) out[ k ] = q[ k ] === U8_ABSENT ? NaN : q[ k ] * s;
	return out;

}

/** Décode un niveau selon son type déclaré (en-tête x-atom-dtype ou meta.encoding). */
export function decodeNiveau( buf: ArrayBuffer, dtype: string | null, scale?: number | null ): Float32Array {

	if ( dtype === 'uint8' ) return decodeUint8( buf, scale );
	if ( dtype == null || dtype === 'float32' ) return decodeFloat32LE( buf );
	throw new Error( `type de champ inconnu : ${ dtype }` );

}

/** Encode (pour les tests et outils) un tableau en Float32 little-endian. */
export function encodeFloat32LE( values: ArrayLike<number> ): ArrayBuffer {

	const buf = new ArrayBuffer( values.length * 4 ), dv = new DataView( buf );
	for ( let k = 0; k < values.length; k ++ ) dv.setFloat32( k * 4, values[ k ], true );
	return buf;

}
