// Chargement des données des pages Éolien et Alertes depuis l'API /v1 du Worker (lot F1).
// Les adresses viennent de snapshot.assets : la page ne fabrique aucune URL elle-même.
// Un lien null (ressource pas encore publiée, B5) donne une donnée null, affichée « non disponible » ;
// jamais une requête vers « null ». getJSON (data/api.ts) vérifie le statut HTTP ET le type JSON :
// le repli SPA (index.html en 200) est une erreur, pas un JSON illisible.
import { getJSON } from '../../data/api';
import type { Alerts, SnapshotAssets, SnapshotPoint, WindFarm, WindRose } from './types';
import type { Snapshot } from '../../data/contract';

export interface SnapshotLite {
	snapshot_id: string;
	points: SnapshotPoint[];
	assets: SnapshotAssets;
	/** Indicateurs de l'instantané (facultatif ici : seul kpi.open_alerts est lu, par la page Alertes). */
	kpi?: { open_alerts: Snapshot[ 'kpi' ][ 'open_alerts' ] };
}

export interface RoseChargee {
	point: SnapshotPoint;
	rose: WindRose | null;
	/** Raison de l'absence (« non publiée » ou message d'erreur), si rose = null. */
	error?: string;
}

export interface EolienData {
	/** null si snapshot.assets.wind_farm est null (lot M5 pas encore publié). */
	windFarm: WindFarm | null;
	/** Roses des points déclarés avec windrose: true, dans l'ordre de snapshot.points. */
	windroses: RoseChargee[];
}

export async function loadEolien( snapshot: SnapshotLite, signal?: AbortSignal ): Promise<EolienData> {

	const lien = snapshot.assets.wind_farm;
	const modele = snapshot.assets.windrose_template;
	const points = snapshot.points.filter( ( p ) => p.windrose );
	const [ windFarm, windroses ] = await Promise.all( [
		lien ? getJSON<WindFarm>( lien, signal ) : Promise.resolve( null ),
		// Une rose manquante n'empêche pas d'afficher le reste : elle est signalée « non disponible ».
		Promise.all( points.map( async ( point ): Promise<RoseChargee> => {

			if ( ! modele ) return { point, rose: null, error: 'non publiée' };
			const url = modele.replace( '{site_id}', encodeURIComponent( point.id ) );
			try { return { point, rose: await getJSON<WindRose>( url, signal ) }; } catch ( e ) {

				if ( ( e as Error ).name === 'AbortError' ) throw e;
				return { point, rose: null, error: String( ( e as Error ).message ) };

			}

		} ) ),
	] );
	return { windFarm, windroses };

}

/** Alertes et décompte kpi.open_alerts de l'instantané (null : module d'alertes inactif ; undefined : inconnu). */
export async function loadAlertesAvecDecompte( snapshot: SnapshotLite, signal?: AbortSignal ) {

	return { alerts: await loadAlerts( snapshot, signal ), decompte: snapshot.kpi?.open_alerts };

}

/** null si snapshot.assets.alerts est null (alertes pas encore publiées). */
export const loadAlerts = ( snapshot: SnapshotLite, signal?: AbortSignal ): Promise<Alerts | null> =>
	snapshot.assets.alerts ? getJSON<Alerts>( snapshot.assets.alerts, signal ) : Promise.resolve( null );
