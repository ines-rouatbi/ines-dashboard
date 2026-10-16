// Exports de l'interface (lot F6) : bouton « Exporter en CSV » des valeurs affichées (généré côté client) et
// liens vers les exports NetCDF / CSV complets publiés par M6 (snapshot.assets.export_*), ou « non disponible ».

import { useState } from 'react';
import type { Snapshot } from '../data/contract';
import { telechargerTexte } from './telecharger';

/** Bouton d'export : `generer` n'est appelé qu'au clic (les CSV de carte font plusieurs Mo). */
export function BoutonCsv( { nom, generer, libelle = 'Exporter en CSV', testid = 'export-csv', desactive = false }: {
	nom: string; generer: () => string; libelle?: string; testid?: string; desactive?: boolean;
} ) {

	const [ erreur, setErreur ] = useState<string | null>( null );
	return (
		<span className="export-csv">
			<button type="button" className="bouton bouton-secondaire" disabled={ desactive } data-testid={ testid } data-fichier={ nom }
				onClick={ () => {

					try { telechargerTexte( nom, generer() ); setErreur( null ); } catch ( e ) { setErreur( ( e as Error ).message ); }

				} }>{ libelle }</button>
			{ erreur ? <span className="f3-erreur petit" role="alert"> export impossible : { erreur }</span> : null }
		</span>
	);

}

/** Liens des exports complets publiés par M6 ; « non disponible » quand le lien est null (B5). */
export function ExportsPublies( { snapshot }: { snapshot: Pick<Snapshot, 'assets' | 'snapshot_id'> } ) {

	const { export_netcdf: nc, export_csv: csv } = snapshot.assets;
	const lien = ( href: string | null, titre: string, testid: string ) => href
		? <a href={ href } download data-testid={ testid }>{ titre }</a>
		: <span className="muet" data-testid={ testid }>{ titre } : non disponible</span>;
	return (
		<p className="exports-publies petit" data-testid="exports-publies">
			Exports complets de l'instantané : { lien( nc, 'NetCDF', 'export-netcdf' ) } · { lien( csv, 'CSV', 'export-csv-publie' ) }
			{ ! nc && ! csv ? <span className="muet"> (pas encore publiés par le service de calcul pour cet instantané)</span> : null }
		</p>
	);

}
