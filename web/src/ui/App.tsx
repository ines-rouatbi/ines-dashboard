// Coquille du tableau de bord : barre supérieure, navigation, bandeau de fraîcheur, page.

import { useLatest, type EtatLatest } from './useLatest';
import { ROUTES, naviguer, useRoute, type PageId } from './routes';
import { texteBandeau } from '../domain/freshness';
import { EnConstruction } from '../pages/EnConstruction';
import { Exploration } from '../pages/Exploration';
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
		ensemble: () => <EnConstruction titre="Vue d'ensemble" />,
		exploration: () => <Exploration latest={ latest } />,
		fiabilite: () => <EnConstruction titre="Fiabilité" />,
		eolien: () => <EnConstruction titre="Éolien" />,
		alertes: () => <EnConstruction titre="Alertes" />,
		modele: () => <EnConstruction titre="Modèle" />,
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
				<Pastille s={ latest } />
			</header>
			<Bandeau s={ latest } />
			<main className="page">{ pages[ route.id ]() }</main>
		</div>
	);

}
