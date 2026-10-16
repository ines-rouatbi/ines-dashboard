// Coquille du tableau de bord : barre supérieure, navigation, bandeau de fraîcheur, page.

import { useLatest, type EtatLatest } from './useLatest';
import { ROUTES, naviguer, useRoute, type PageId } from './routes';
import { texteBandeau } from '../domain/freshness';
import { Exploration } from '../pages/Exploration';
import { Alertes, Eolien } from '../pages/F4';
import { PageFiabilite, PageModele, VueEnsemble } from '../pages/F3';
import { PageComparaison } from '../pages/comparaison/Comparaison';
import type { JSX } from 'react';

function Pastille( { s }: { s: EtatLatest } ) {

	let cls = 'pill pill-wait', txt = '· connexion…', titre = 'État du calcul';
	if ( s.etat === 'erreur' ) { cls = 'pill pill-down'; txt = '○ indisponible'; titre = `/v1/latest ${ s.message }`; }
	else if ( s.etat === 'ok' ) {

		const enLigne = s.latest.compute_status === 'online';
		cls = enLigne ? 'pill pill-live' : 'pill pill-down';
		txt = enLigne ? '● calcul en ligne' : '○ calcul arrêté';
		titre = `Instantané ${ s.latest.snapshot_id } · modèle ${ s.latest.versions.model }`;

	}

	return <span className={ cls } title={ titre } data-testid="status-pill">{ txt }</span>;

}

const LIBELLE_NATURE: Record<string, string> = { test: 'test', synthetique: 'synthétique', reel: 'réel' };

/** Nature des données (versions.data_kind), affichée en permanence (contrat rév. 2, D15). */
function BadgeNature( { s }: { s: EtatLatest } ) {

	const kind = s.etat === 'ok' ? s.latest.versions.data_kind : null;
	const txt = kind ? `données : ${ LIBELLE_NATURE[ kind ] ?? kind }` : 'données : —';
	const titre = kind === 'test' ? 'Instantané de test : ce ne sont pas des résultats du modèle'
		: kind === 'synthetique' ? 'Données synthétiques (capteurs simulés)'
			: kind === 'reel' ? 'Données réelles (réseau de mesure)' : 'Nature des données inconnue';
	return <span className={ `badge-nature nature-${ kind ?? 'inconnue' }` } title={ titre } data-testid="data-kind">{ txt }</span>;

}

function Bandeau( { s }: { s: EtatLatest } ) {

	if ( s.etat !== 'ok' ) return null;
	const t = texteBandeau( s.latest );
	if ( ! t ) return null;
	return <div className="bandeau" role="status" data-testid="freshness-banner">{ t }</div>;

}

export function App() {

	const route = useRoute();
	const latest = useLatest();

	const pages: Record<PageId, () => JSX.Element> = {
		ensemble: () => <VueEnsemble latest={ latest } />,
		exploration: () => <Exploration latest={ latest } />,
		comparaison: () => <PageComparaison latest={ latest } />,
		fiabilite: () => <PageFiabilite latest={ latest } />,
		eolien: () => <Eolien latest={ latest } />,
		alertes: () => <Alertes latest={ latest } />,
		modele: () => <PageModele latest={ latest } />,
	};

	return (
		<div className="app">
			<header className="topbar">
				<div className="marque">
					<span className="logo" aria-hidden="true" />
					<span className="titre">ATOM-AI <span className="sep">·</span> Vent 3D</span>
				</div>
				<nav className="nav" aria-label="Pages du tableau de bord">
					{ ROUTES.map( ( r ) => (
						<a
							key={ r.id }
							href={ r.chemin }
							className={ r.id === route.id ? 'actif' : undefined }
							aria-current={ r.id === route.id ? 'page' : undefined }
							onClick={ ( e ) => { if ( e.button === 0 && ! e.metaKey && ! e.ctrlKey ) { e.preventDefault(); naviguer( r.chemin ); } } }
						>{ r.titre }</a>
					) ) }
				</nav>
				<BadgeNature s={ latest } />
				<Pastille s={ latest } />
			</header>
			<Bandeau s={ latest } />
			<main className="page">{ pages[ route.id ]() }</main>
		</div>
	);

}
