// Frise temporelle (UI v2) : position des instantanés publiés sur l'axe du temps, voisins, lecture automatique.
// Fonctions pures (testées). On ne se déplace JAMAIS qu'entre instants publiés : aucun instant intermédiaire inventé.

export interface InstantFrise { snapshot_id: string; valid_time: string }

export type VitesseLecture = 1 | 2 | 4;
export const VITESSES: VitesseLecture[] = [ 1, 2, 4 ];

/** Attente entre deux instants en lecture à ×1 (ms), une fois l'instant courant affiché. */
export const DELAI_LECTURE_MS = 1800;

export function delaiLecture( vitesse: VitesseLecture, base = DELAI_LECTURE_MS ): number { return Math.round( base / vitesse ); }

/** Position (0..1) de chaque instant sur l'axe du temps ; un seul instant (ou tous au même temps) : au milieu. */
export function positionsFrise( items: readonly InstantFrise[] ): number[] {

	const t = items.map( ( x ) => Date.parse( x.valid_time ) );
	const t0 = Math.min( ...t ), t1 = Math.max( ...t ), span = t1 - t0;
	return t.map( ( x ) => ( span > 0 ? ( x - t0 ) / span : 0.5 ) );

}

/** Instant publié le plus proche d'une position 0..1 sur la piste (glisser le curseur). */
export function indiceProche( items: readonly InstantFrise[], fraction: number ): number {

	if ( ! items.length ) return - 1;
	const pos = positionsFrise( items ), f = Math.min( 1, Math.max( 0, fraction ) );
	let best = 0;
	for ( let k = 1; k < pos.length; k ++ ) if ( Math.abs( pos[ k ] - f ) < Math.abs( pos[ best ] - f ) ) best = k;
	return best;

}

/** Instant voisin (sens −1 : précédent, +1 : suivant), « debut » / « fin » ; null si on est déjà au bord. */
export function voisin( items: readonly InstantFrise[], courant: string | null, sens: - 1 | 1 | 'debut' | 'fin' ): string | null {

	if ( ! items.length ) return null;
	if ( sens === 'debut' ) return items[ 0 ].snapshot_id === courant ? null : items[ 0 ].snapshot_id;
	if ( sens === 'fin' ) return items[ items.length - 1 ].snapshot_id === courant ? null : items[ items.length - 1 ].snapshot_id;
	const k = items.findIndex( ( x ) => x.snapshot_id === courant );
	if ( k < 0 ) return items[ sens > 0 ? 0 : items.length - 1 ].snapshot_id;
	return items[ k + sens ]?.snapshot_id ?? null;

}

/** Départ d'une lecture : du plus ancien si l'on est au bout de la frise (ou hors frise), sinon de l'instant courant. */
export function departLecture( items: readonly InstantFrise[], courant: string | null ): string | null {

	if ( items.length < 2 ) return null;
	const k = items.findIndex( ( x ) => x.snapshot_id === courant );
	return k < 0 || k === items.length - 1 ? items[ 0 ].snapshot_id : courant;

}
