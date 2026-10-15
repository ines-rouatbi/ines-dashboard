// Montage des pages du lot F4 dans le tableau de bord (routes /eolien et /alertes) : instantané de latest.
import { AlertesPage } from './alertes/AlertesPage';
import { EolienPage } from './eolien/EolienPage';
import { loadAlerts, loadEolien } from './shared/api';
import { EtatPage, useDonneesInstantane } from './shared/Instantane';
import type { EtatLatest } from '../ui/useLatest';

export function Eolien( { latest }: { latest: EtatLatest } ) {

	const etat = useDonneesInstantane( latest, loadEolien );
	return <EtatPage titre="Éolien" nom="eolien" etat={ etat }>{ ( data ) => <EolienPage data={ data } /> }</EtatPage>;

}

export function Alertes( { latest }: { latest: EtatLatest } ) {

	const etat = useDonneesInstantane( latest, loadAlerts );
	return <EtatPage titre="Alertes" nom="alertes" etat={ etat }>{ ( alerts ) => <AlertesPage alerts={ alerts } /> }</EtatPage>;

}
