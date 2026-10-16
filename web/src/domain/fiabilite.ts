// Classe de fiabilité d'un nœud (contrat v1 rév. 2, common.schema.json : « elevee » | « moyenne » | « faible »).
//
// Les seuils sont ceux des instantanés publiés : la classe des profils précalculés et les parts
// share_elevee / share_moyenne / share_faible de quality.json sont produites avec
//   reliability ≥ 0,75 → « elevee » ; ≥ 0,5 → « moyenne » ; sinon « faible ».
// Le front les reproduit (tests : dev/scene-f2.test.ts compare aux profils précalculés et à quality.json)
// sur la valeur publiée (uint8 quantifié, octet/254). Valeur inconnue (null, NaN) : classe null, jamais « faible ».

export type ClasseFiabilite = 'elevee' | 'moyenne' | 'faible';

export const SEUIL_ELEVEE = 0.75;
export const SEUIL_MOYENNE = 0.5;

export function classeFiabilite( r: number | null | undefined ): ClasseFiabilite | null {

	if ( r == null || ! Number.isFinite( r ) ) return null;
	return r >= SEUIL_ELEVEE ? 'elevee' : r >= SEUIL_MOYENNE ? 'moyenne' : 'faible';

}

export const LIBELLE_CLASSE: Record<ClasseFiabilite, string> = { elevee: 'élevée', moyenne: 'moyenne', faible: 'faible' };
