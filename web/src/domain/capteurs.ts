// Capteur le plus proche d'un nœud (contrat v1 rév. 2, B4).
//   - stations_aneo : stations.json liste tous les capteurs ; on retient le plus proche qui
//     n'est ni muet ni exclu ;
//   - treillis_synthetique : capteurs sur un treillis régulier à 50 m (identifiant c<i>_<j>,
//     position x0 + i·50, y0 + j·50) ; stations.json ne liste que les capteurs SIGNALÉS, dont
//     on reprend l'état. Un capteur non listé est actif.
// Dans les deux cas, le capteur retenu est VISIBLE (ni muet ni exclu), comme nearest_sensor des
// profils précalculés. Sur le treillis, à distance égale : d'abord vers l'Est, puis vers le Nord.

import type { Snapshot, Station, StationState } from '../data/contract';

/** Pas du treillis synthétique de capteurs (contract/README.md). */
export const PAS_TREILLIS_M = 50;

export interface CapteurProche { id: string; distance_m: number; state: StationState }

export function capteurProche(
	reseau: Snapshot[ 'network' ][ 'kind' ],
	stations: Station[],
	xM: number,
	yM: number,
	origine: { x0: number; y0: number } = { x0: 0, y0: 0 },
): CapteurProche | null {

	if ( reseau === 'treillis_synthetique' ) {

		const etat = new Map( stations.map( ( s ) => [ s.id, s.state ] ) );
		const ci = Math.round( ( xM - origine.x0 ) / PAS_TREILLIS_M ), cj = Math.round( ( yM - origine.y0 ) / PAS_TREILLIS_M );
		const candidats: ( CapteurProche & { di: number; dj: number } )[] = [];
		// Les capteurs signalés sont rares : un voisinage de ±3 pas suffit largement.
		for ( let dj = - 3; dj <= 3; dj ++ ) for ( let di = - 3; di <= 3; di ++ ) {

			const si = ci + di, sj = cj + dj;
			if ( si < 0 || sj < 0 ) continue;
			const id = `c${ si }_${ sj }`, state = etat.get( id ) ?? 'active';
			if ( state === 'muette' || state === 'exclue' ) continue;
			candidats.push( { id, state, di, dj, distance_m: Math.hypot( origine.x0 + si * PAS_TREILLIS_M - xM, origine.y0 + sj * PAS_TREILLIS_M - yM ) } );

		}
		candidats.sort( ( a, b ) => a.distance_m - b.distance_m || b.di - a.di || b.dj - a.dj );
		const best = candidats[ 0 ];
		return best ? { id: best.id, distance_m: best.distance_m, state: best.state } : null;

	}

	let best: CapteurProche | null = null;
	for ( const s of stations ) {

		if ( s.state === 'muette' || s.state === 'exclue' ) continue;
		const d = Math.hypot( s.x_m - xM, s.y_m - yM );
		if ( ! best || d < best.distance_m ) best = { id: s.id, distance_m: d, state: s.state };

	}

	return best;

}
