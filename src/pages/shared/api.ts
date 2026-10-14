// Chargement des données des pages Éolien et Alertes depuis l'API /v1 du Worker (lot F1).
// Les adresses viennent de snapshot.assets : la page ne fabrique aucune URL elle-même.
import type { Alerts, SnapshotAssets, SnapshotPoint, WindFarm, WindRose } from './types';

export interface SnapshotLite {
	snapshot_id: string;
	points: SnapshotPoint[];
	assets: SnapshotAssets;
}

async function getJSON<T>( url: string, signal?: AbortSignal ): Promise<T> {

	const res = await fetch( url, { signal, headers: { accept: 'application/json' } } );
	if ( ! res.ok ) throw new Error( `${ url } : HTTP ${ res.status }` );
	return res.json() as Promise<T>;

}

export interface EolienData {
	windFarm: WindFarm;
	/** Roses des points déclarés avec windrose: true, dans l'ordre de snapshot.points. */
	windroses: { point: SnapshotPoint; rose: WindRose | null; error?: string }[];
}

export async function loadEolien( snapshot: SnapshotLite, signal?: AbortSignal ): Promise<EolienData> {

	const windFarm = await getJSON<WindFarm>( snapshot.assets.wind_farm, signal );
	const points = snapshot.points.filter( ( p ) => p.windrose );
	// Une rose manquante n'empêche pas d'afficher le reste : elle est signalée « non disponible ».
	const windroses = await Promise.all( points.map( async ( point ) => {

		const url = snapshot.assets.windrose_template.replace( '{site_id}', encodeURIComponent( point.id ) );
		try { return { point, rose: await getJSON<WindRose>( url, signal ) }; } catch ( e ) { return { point, rose: null, error: String( ( e as Error ).message ) }; }

	} ) );
	return { windFarm, windroses };

}

export const loadAlerts = ( snapshot: SnapshotLite, signal?: AbortSignal ) => getJSON<Alerts>( snapshot.assets.alerts, signal );
