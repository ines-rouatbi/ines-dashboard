// Vue d'ensemble (lot F3) : indicateurs clés TB1, cartes à 10, 100, 300 et 1 000 m AU-DESSUS DU SOL
// avec la couche capteurs TB2, alertes ouvertes TB3, série au moyeu TB4, DSO de l'instant TB5.
// Mesure VIS1 : indicateurs + 4 cartes peints (vis1.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../data';
import type { Latest, Meta, Snapshot } from '../../data/contract';
import { HAUTEURS_SOL_M, type Resume } from '../../domain/hauteurSol';
import { naviguer } from '../../ui/routes';
import type { EtatLatest } from '../../ui/useLatest';
import { sortAlerts } from '../alertes/AlertesPage';
import { ALERT_LEVEL, NA, num, utc, withUnit } from '../shared/format';
import { AvecRessource, EtatPageF3, Kpi, cacheChamps, oui, pourcent, scientifique, useAsync, useInstantane } from './commun';
import { Carte, Legende, LegendeCapteurs, bornesEchelle, type Echelle } from './Carte';
import { RAMPE_VITESSE } from './couleurs';
import { chargerBase, chargerCartes, chargerSerie, exportCarte, type Base, type CarteSol } from './donnees';
import { ExportsPublies } from '../../ui/Exports';
import { SerieMoyeu } from './graphiques';
import { CarteVivante } from './CarteVivante';
import { SqueletteBloc, SqueletteCarte, SqueletteLignes } from '../../ui/Squelette';
import { annulerVis1, debutVis1, finVis1, SEUIL_VIS1_MS, type MesureVis1 } from './vis1';

/** Message d'une carte sans aucune valeur, selon la raison dominante. */
export function texteCarteVide( r: Resume, meta: Pick<Meta, 'grid'> ): string {

	const a = r.absentes, sommet = meta.grid.levels_asl_m[ meta.grid.levels_asl_m.length - 1 ];
	if ( a.au_dessus_sommet === r.total ) return `hors du domaine vertical du modèle partout (sommet à ${ num( sommet ) } m au-dessus de la mer)`;
	if ( a.trop_pres_du_sol === r.total ) return `plus près du sol que le premier nœud publié (${ num( meta.grid.min_agl_m ) } m)`;
	return 'aucune colonne n’a deux niveaux encadrants valides à cette hauteur';

}

/** Détail des absences d'une carte (colonnes sans valeur, par raison). */
export function texteAbsences( r: Resume ): string | null {

	const a = r.absentes, parts: string[] = [];
	if ( a.sous_relief ) parts.push( `${ num( a.sous_relief ) } sous le premier nœud valide` );
	if ( a.sous_premier_niveau ) parts.push( `${ num( a.sous_premier_niveau ) } sous le premier niveau` );
	if ( a.au_dessus_sommet ) parts.push( `${ num( a.au_dessus_sommet ) } au-dessus du sommet du modèle` );
	if ( a.trop_pres_du_sol ) parts.push( `${ num( a.trop_pres_du_sol ) } trop près du sol` );
	return parts.length ? `Colonnes absentes : ${ parts.join( ', ' ) }.` : null;

}

export function VueEnsemble( { latest }: { latest: EtatLatest } ) {

	const snap = useInstantane( latest );
	const jeton = useRef<number | null>( null );
	useEffect( () => {

		const j = debutVis1();
		jeton.current = j;
		return () => annulerVis1( j );

	}, [] );
	if ( snap.etat !== 'ok' ) return <EtatPageF3 titre="Vue d'ensemble" nom="ensemble" etat={ snap } />;
	return <Ensemble key={ snap.val.snapshot_id } snapshot={ snap.val } latest={ latest.etat === 'ok' ? latest.latest : null } jeton={ jeton } />;

}

function Ensemble( { snapshot, latest, jeton }: { snapshot: Snapshot; latest: Latest | null; jeton: { current: number | null } } ) {

	const id = snapshot.snapshot_id;
	const base = useAsync( id, ( s ) => chargerBase( api, snapshot, s ) );
	const b = base.etat === 'ok' ? base.val : null;
	const cartes = useAsync( b ? id : null, () => chargerCartes( cacheChamps, b!, 'speed', HAUTEURS_SOL_M ) );
	const serie = useAsync( `${ id }:serie`, ( s ) => chargerSerie( api, s ) );
	const [ mesure, setMesure ] = useState<MesureVis1 | null>( null );

	// VIS1 : fin quand les 4 cartes sont peintes (les indicateurs sont rendus avec l'instantané).
	const peintes = useRef( new Set<number>() );
	const peinte = useCallback( ( h: number ) => {

		peintes.current.add( h );
		if ( peintes.current.size === HAUTEURS_SOL_M.length && jeton.current != null ) finVis1( jeton.current, id, setMesure );

	}, [ id, jeton ] );

	return (
		<section className="f3-page" data-testid="page-ensemble">
			<header className="f3-entete">
				<h1>Vue d'ensemble</h1>
				<p className="muet">
					Instantané du <span data-testid="valid-time">{ utc( snapshot.valid_time ) }</span> · <code>{ id }</code>
					{ latest ? <> · données d'entrée { latest.data_status === 'complete' ? 'complètes' : 'dégradées' }</> : null }
				</p>
				<ExportsPublies snapshot={ snapshot } />
			</header>

			<Indicateurs snapshot={ snapshot } />

			{ /* Carte animée : montée une fois les 4 cartes chargées (n'entre pas dans la mesure VIS1). */ }
			{ b && cartes.etat === 'ok' ? <CarteVivante base={ b } />
				: base.etat === 'erreur' ? null : <section className="f3-bloc"><SqueletteCarte texte="carte animée : chargement…" ratio="2 / 1" /></section> }

			<div className="f3-grille-principale">
				<section className="f3-carte-bloc" aria-labelledby="titre-cartes">
					<h2 id="titre-cartes">Vent à 10, 100, 300 et 1 000 m au-dessus du sol</h2>
					<p className="petit muet">
						Hauteur au-dessus du sol calculée par colonne : relief + h, interpolé entre les niveaux du modèle
						(publiés au-dessus de la mer). Vitesse horizontale.
					</p>
					{ base.etat === 'erreur' ? <p className="f3-erreur" role="alert">Cartes : { base.message }</p>
						: cartes.etat === 'erreur' ? <p className="f3-erreur" role="alert">Cartes : { cartes.message }</p>
							: b && cartes.etat === 'ok' ? <Cartes base={ b } cartes={ cartes.val } onPeinte={ peinte } />
								: <div className="f3-cartes">{ HAUTEURS_SOL_M.map( ( h ) => <SqueletteCarte key={ h } texte={ `carte à ${ h } m : chargement…` } /> ) }</div> }
				</section>

				<aside className="f3-colonne">
					<Alertes base={ b } snapshot={ snapshot } erreur={ base.etat === 'erreur' ? base.message : null } />
					<Dso snapshot={ snapshot } base={ b } />
				</aside>
			</div>

			<section className="f3-bloc" aria-labelledby="titre-serie">
				<h2 id="titre-serie">Série au moyeu</h2>
				<p className="petit muet">
					hub_wind_* de chaque instantané de /v1/times : statistique sur le domaine à la hauteur du moyeu
					au-dessus du sol (pas la production du parc). Un instant sans valeur est un trou, jamais 0.
				</p>
				{ serie.etat === 'ok'
					? serie.val.points.length
						? <SerieMoyeu points={ serie.val.points } hauteur={ snapshot.kpi.hub_height_agl_m } />
						: <p className="muet">Aucun instantané publié dans /v1/times.</p>
					: serie.etat === 'erreur' ? <p className="f3-erreur">Série : { serie.message }</p> : <SqueletteBloc texte="chargement de la série…" /> }
				{ serie.etat === 'ok' && serie.val.total > serie.val.points.length
					? <p className="petit muet">{ serie.val.points.length } derniers instants sur { num( serie.val.total ) }.</p> : null }
			</section>

			<p className="petit muet f3-vis1" data-testid="vis1" data-vis1-ms={ mesure?.duree_ms ?? '' }>
				{ mesure
					? `Reconstruction et indicateurs affichés en ${ num( mesure.duree_ms / 1000, 2 ) } s (${ mesure.depuis === 'navigation' ? 'depuis le chargement de la page' : 'depuis l’ouverture de la vue' } ; objectif VIS1 : moins de ${ num( SEUIL_VIS1_MS / 1000 ) } s).`
					: 'Mesure VIS1 en cours…' }
			</p>
		</section>
	);

}

export function Indicateurs( { snapshot }: { snapshot: Snapshot } ) {

	const k = snapshot.kpi, n = snapshot.network;
	const oa = k.open_alerts;
	const totalAlertes = oa ? oa.critique + oa.important + oa.avertissement + oa.information : null;
	const h = `${ num( k.hub_height_agl_m ) } m au-dessus du sol`;
	return (
		<section className="f3-kpis" aria-label="Indicateurs clés de l'instantané" data-testid="kpis">
			<Kpi testid="kpi-hub-mean" valeur={ withUnit( k.hub_wind_mean_ms, 'm/s', 1 ) } libelle={ `Vent moyen à ${ h }` } detail="sur le domaine" />
			<Kpi testid="kpi-hub-max" valeur={ withUnit( k.hub_wind_max_ms, 'm/s', 1 ) } libelle={ `Vent maximal à ${ h }` } detail="sur le domaine" />
			<Kpi testid="kpi-fiabilite" valeur={ pourcent( k.share_high_reliability ) } libelle="Nœuds en fiabilité élevée" />
			<Kpi testid="kpi-alertes" valeur={ num( totalAlertes ) } libelle="Alertes ouvertes"
				detail={ oa ? `${ oa.critique } crit. · ${ oa.important } imp. · ${ oa.avertissement } av. · ${ oa.information } info.` : undefined } />
			<Kpi testid="kpi-capteurs" valeur={ `${ num( n.sensors_visible ) } / ${ num( n.sensors_total ) }` } libelle="Capteurs visibles / total"
				detail={ n.kind === 'treillis_synthetique' ? 'treillis synthétique' : 'stations ANEO' } />
			<Kpi testid="kpi-reconstruction" valeur={ withUnit( k.reconstruction_ms, 'ms' ) } libelle="Temps de reconstruction" />
		</section>
	);

}

function Cartes( { base, cartes, onPeinte }: { base: Base; cartes: CarteSol[]; onPeinte: ( h: number ) => void } ) {

	const g = base.meta.grid;
	const grille = { nx: g.nx, ny: g.ny, dx: g.dx_m, dy: g.dy_m, x0: g.x0_m, y0: g.y0_m };
	// Échelle commune aux 4 hauteurs (comparaison directe), de 0 au maximum arrondi.
	const max = cartes.reduce<number | null>( ( m, c ) => ( c.resume.max == null ? m : Math.max( m ?? 0, c.resume.max ) ), null );
	const echelle = useMemo<Echelle>( () => ( { kind: 'continue', ...bornesEchelle( max, 2 ), rampe: RAMPE_VITESSE, unite: 'm/s', decimales: 1 } ), [ max ] );
	const stations = base.stations.etat === 'ok' ? base.stations.val.items : null;
	const rappels = useMemo( () => new Map( cartes.map( ( c ) => [ c.hauteur, () => onPeinte( c.hauteur ) ] ) ), [ cartes, onPeinte ] );
	return (
		<>
			<Legende echelle={ echelle } titre="Vitesse horizontale du vent" />
			<LegendeCapteurs reseau={ base.snapshot.network } stations={ stations } />
			{ base.stations.etat !== 'ok' ? <AvecRessource r={ base.stations } quoi="Capteurs">{ () => null }</AvecRessource> : null }
			<div className="f3-cartes">
				{ cartes.map( ( c ) => (
					<div key={ c.hauteur }>
						<Carte
							testid={ `carte-${ c.hauteur }` }
							titre={ `${ num( c.hauteur ) } m au-dessus du sol` }
							valeurs={ c.valeurs }
							grille={ grille }
							echelle={ echelle }
							resume={ c.resume }
							stations={ stations ?? [] }
							videTexte={ texteCarteVide( c.resume, base.meta ) }
							onPeinte={ rappels.get( c.hauteur ) }
							exporter={ exportCarte( base, c, 'm/s' ) }
						/>
						{ c.resume.disponibles ? <p className="petit muet">{ texteAbsences( c.resume ) }</p> : null }
					</div>
				) ) }
			</div>
		</>
	);

}

function Alertes( { base, snapshot, erreur }: { base: Base | null; snapshot: Snapshot; erreur: string | null } ) {

	const lien = <a href="/alertes" onClick={ ( e ) => { if ( e.button === 0 && ! e.metaKey && ! e.ctrlKey ) { e.preventDefault(); naviguer( '/alertes' ); } } } data-testid="lien-alertes">Toutes les alertes →</a>;
	return (
		<section className="f3-bloc" aria-labelledby="titre-alertes" data-testid="alertes-ouvertes">
			<h2 id="titre-alertes">Alertes ouvertes</h2>
			{ erreur ? <p className="f3-erreur">Alertes : { erreur }</p>
				: ! base ? <SqueletteLignes n={ 3 } texte="alertes : chargement…" />
					: <AvecRessource r={ base.alerts } quoi="Alertes">{ ( a ) => {

						const ouvertes = sortAlerts( a.items.filter( ( x ) => x.status === 'ouverte' ) );
						// Liste vide ET décompte null : les alertes n'ont pas été calculées (M4 inactif), ce n'est pas « aucune alerte ».
						if ( ! ouvertes.length && snapshot.kpi.open_alerts == null ) return <p className="muet" data-testid="alertes-non-calculees">Alertes : { NA } (non calculées pour cet instantané).</p>;
						if ( ! ouvertes.length ) return <p className="muet" data-testid="aucune-alerte">Aucune alerte ouverte.</p>;
						return (
							<ul className="f3-alertes">
								{ ouvertes.slice( 0, 5 ).map( ( x ) => (
									<li key={ x.id } className={ `f3-alerte f3-niveau-${ x.level }` } data-testid="alerte-ouverte" data-level={ x.level }>
										<span className="f3-badge">{ ALERT_LEVEL[ x.level ] }</span> { x.title }
										<span className="petit muet"> · { x.target }</span>
									</li>
								) ) }
								{ ouvertes.length > 5 ? <li className="petit muet">et { ouvertes.length - 5 } autre(s)</li> : null }
							</ul>
						);

					} }</AvecRessource> }
			{ snapshot.kpi.open_alerts == null ? <p className="petit muet">Décompte par niveau : { NA }.</p> : null }
			<p>{ lien }</p>
		</section>
	);

}

const RHO: Record<string, string> = {
	atmosphere_standard: 'atmosphère standard',
	extrapolation_surface: 'extrapolée de la surface',
	verite_synthetique: 'vérité synthétique',
};

/** DSO de l'instant (TB5) : bloc physics de l'instantané et calibration de quality. */
export function Dso( { snapshot, base }: { snapshot: Snapshot; base: Base | null } ) {

	const p = snapshot.physics;
	const unite = 'kg·m⁻³·s⁻¹';
	return (
		<section className="f3-bloc" aria-labelledby="titre-dso" data-testid="dso">
			<h2 id="titre-dso">Contrôles physiques et DSO de l'instant</h2>
			<dl className="f3-kv">
				<dt>Résidu de masse sous le seuil DSO2 (10⁻⁴)</dt>
				<dd data-testid="dso-masse-ok">{ p ? oui( p.mass_residual_ok, 'oui (cet instant)', 'non (cet instant)' ) : NA }</dd>
				<dt>Résidu de masse RMS / p95</dt>
				<dd data-testid="dso-masse">{ p ? `${ scientifique( p.mass_residual_rms ) } / ${ scientifique( p.mass_residual_p95 ) } ${ unite }` : NA }</dd>
				<dt>Condition au sol (RMS de w − u·∇z)</dt>
				<dd data-testid="dso-sol">{ p ? withUnit( p.ground_condition_rms_ms, 'm/s', 3 ) : NA }</dd>
				<dt>Densité de l'air</dt>
				<dd data-testid="dso-rho">{ p ? RHO[ p.rho_source ] ?? p.rho_source : NA }</dd>
				<dt>DSO6 (calibration de l'incertitude)</dt>
				<dd data-testid="dso6">{ ! base ? '…' : base.quality.etat !== 'ok' ? NA
					: base.quality.val.calibration == null ? 'non calibré'
						: `${ oui( base.quality.val.calibration.dso6_pass, 'atteint', 'non atteint' ) } (couverture à 80 % : ${ pourcent( base.quality.val.calibration.coverage_80 ) }, corrélation erreur / σ : ${ num( base.quality.val.calibration.corr_error_sigma, 2 ) })` }</dd>
			</dl>
			{ p == null ? <p className="petit muet" data-testid="physics-na">Bloc physique : { NA } (pas encore publié pour cet instantané).</p> : null }
			<p className="petit muet">DSO1, DSO3 à DSO5 sont des agrégats sur 120 instants : non publiés dans l'instantané (contrat v1).</p>
		</section>
	);

}
