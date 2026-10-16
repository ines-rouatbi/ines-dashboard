// Page Fiabilité (lot F3) : cartes vent et incertitude à une hauteur au-dessus du sol (D6), méthode
// d'incertitude, répartition des classes de fiabilité par niveau, calibration (DSO6), panne simulée TB6.
// Une simulation n'est affichée que si elle existe (snapshot.scenario non null), étiquetée SIMULATION,
// jamais comme l'état courant.

import { useMemo, useState } from 'react';
import { api } from '../../data';
import type { FieldVar, Quality, Snapshot } from '../../data/contract';
import { HAUTEURS_SOL_M } from '../../domain/hauteurSol';
import type { EtatLatest } from '../../ui/useLatest';
import { NA, num, utc, withUnit } from '../shared/format';
import { AvecRessource, EtatPageF3, cacheChamps, type Chargement, oui, pourcent, useAsync, useInstantane } from './commun';
import { Carte, Legende, LegendeCapteurs, bornesEchelle, type Echelle } from './Carte';
import { RAMPE_BLEUE, RAMPE_INCERTITUDE, RAMPE_VITESSE, STATUT } from './couleurs';
import { chargerBase, chargerCartes, chargerSimulation, exportCarte, type Base, type CarteSol, type Simulation } from './donnees';
import { texteCarteVide } from './Ensemble';
import { RepartitionClasses } from './graphiques';
import { SqueletteCarte, SqueletteLignes } from '../../ui/Squelette';
import { Jauge } from '../../ui/Jauge';

type VarIncertitude = Extract<FieldVar, 'sigma_speed' | 'coverage' | 'reliability' | 'status'>;

export const VARIABLES_INCERTITUDE: { v: VarIncertitude; libelle: string }[] = [
	{ v: 'sigma_speed', libelle: 'Écart-type σ de la vitesse' },
	{ v: 'coverage', libelle: 'Couverture par les capteurs' },
	{ v: 'reliability', libelle: 'Fiabilité' },
	{ v: 'status', libelle: 'Statut mesuré / estimé' },
];

/** Échelle de la carte d'une variable (max = maximum de la carte, pour les grandeurs non bornées). */
export function echelleVariable( v: FieldVar, max: number | null ): Echelle {

	if ( v === 'status' ) return { kind: 'categories', categories: [ { valeur: 1, libelle: 'mesuré (capteur visible à ±15 m)', couleur: STATUT.mesure }, { valeur: 0, libelle: 'estimé', couleur: STATUT.estime } ] };
	if ( v === 'coverage' || v === 'reliability' ) return { kind: 'continue', min: 0, max: 1, rampe: RAMPE_BLEUE, unite: '0–1', decimales: 2 };
	if ( v === 'sigma_speed' ) return { kind: 'continue', ...bornesEchelle( max, 0.5 ), rampe: RAMPE_INCERTITUDE, unite: 'm/s', decimales: 2 };
	return { kind: 'continue', ...bornesEchelle( max, 2 ), rampe: RAMPE_VITESSE, unite: 'm/s', decimales: 1 };

}

const lireSimulation = () => ( typeof location === 'undefined' ? null : new URLSearchParams( location.search ).get( 'simulation' ) );

export function PageFiabilite( { latest }: { latest: EtatLatest } ) {

	const snap = useInstantane( latest );
	if ( snap.etat !== 'ok' ) return <EtatPageF3 titre="Fiabilité" nom="fiabilite" etat={ snap } />;
	return <Fiabilite key={ snap.val.snapshot_id } snapshot={ snap.val } />;

}

function Fiabilite( { snapshot }: { snapshot: Snapshot } ) {

	const id = snapshot.snapshot_id;
	const base = useAsync( id, ( s ) => chargerBase( api, snapshot, s ) );
	const b = base.etat === 'ok' ? base.val : null;
	const [ hauteur, setHauteur ] = useState<number>( 100 );
	const [ variable, setVariable ] = useState<VarIncertitude>( 'sigma_speed' );
	const vent = useAsync( b ? `${ id }:speed:${ hauteur }` : null, () => chargerCartes( cacheChamps, b!, 'speed', [ hauteur ] ) );
	// Variable absente de meta.fields (module de fiabilité M2 pas encore actif) : aucune requête, « non disponible ».
	const publiee = b ? b.meta.fields.includes( variable ) : true;
	const incert = useAsync( b && publiee ? `${ id }:${ variable }:${ hauteur }` : null, () => chargerCartes( cacheChamps, b!, variable, [ hauteur ] ) );
	const libelleVariable = VARIABLES_INCERTITUDE.find( ( x ) => x.v === variable )!.libelle;

	return (
		<section className="f3-page" data-testid="page-fiabilite">
			<header className="f3-entete">
				<h1>Fiabilité</h1>
				<p className="muet">Reconstruction courante du <span data-testid="valid-time">{ utc( snapshot.valid_time ) }</span> · <code>{ id }</code></p>
			</header>

			<section className="f3-bloc jauges" aria-label="Fiabilité de l'instantané en un coup d'œil" data-testid="jauges">
				<Jauge testid="jauge-fiabilite" valeur={ snapshot.kpi.share_high_reliability } libelle="Nœuds en fiabilité élevée" />
				<Jauge testid="jauge-couverture" seuil={ 0.8 } libelle="Couverture de l’intervalle à 80 %"
					valeur={ b && b.quality.etat === 'ok' ? b.quality.val.calibration?.coverage_80 ?? null : null }
					detail={ ! b ? 'chargement…' : b.quality.etat === 'ok' ? ( b.quality.val.calibration ? b.quality.val.calibration.evaluated_on : 'non calibré' ) : 'qualité non publiée' } />
				<Jauge testid="jauge-capteurs" libelle="Capteurs visibles"
					valeur={ snapshot.network.sensors_total ? snapshot.network.sensors_visible / snapshot.network.sensors_total : null }
					detail={ `${ num( snapshot.network.sensors_visible ) } / ${ num( snapshot.network.sensors_total ) }` } />
			</section>

			<section className="f3-bloc" aria-labelledby="titre-cartes-fiab">
				<h2 id="titre-cartes-fiab">Vent et incertitude au-dessus du sol</h2>
				<div className="f3-controles">
					<div role="group" aria-label="Hauteur au-dessus du sol" className="f3-boutons">
						{ HAUTEURS_SOL_M.map( ( h ) => (
							<button key={ h } type="button" aria-pressed={ h === hauteur } onClick={ () => setHauteur( h ) } data-testid={ `hauteur-${ h }` }>{ num( h ) } m</button>
						) ) }
					</div>
					<label>
						Incertitude :{ ' ' }
						<select value={ variable } onChange={ ( e ) => setVariable( e.target.value as VarIncertitude ) } data-testid="variable-incertitude">
							{ VARIABLES_INCERTITUDE.map( ( x ) => <option key={ x.v } value={ x.v }>{ x.libelle }{ b && ! b.meta.fields.includes( x.v ) ? ' (non publiée)' : '' }</option> ) }
						</select>
					</label>
				</div>
				{ base.etat === 'erreur' ? <p className="f3-erreur" role="alert">Cartes : { base.message }</p> : ! b ? <div className="f3-cartes f3-cartes-2"><SqueletteCarte texte="cartes : chargement…" /><SqueletteCarte /></div> : (
					<>
						<LegendeCapteurs reseau={ snapshot.network } stations={ b.stations.etat === 'ok' ? b.stations.val.items : null } />
						<div className="f3-cartes f3-cartes-2">
							<CarteVariable base={ b } c={ vent } titre={ `Vitesse horizontale à ${ num( hauteur ) } m au-dessus du sol` } testid="carte-vent" />
							{ publiee
								? <CarteVariable base={ b } c={ incert } titre={ `${ libelleVariable } à ${ num( hauteur ) } m au-dessus du sol` } testid="carte-incertitude" />
								: <VariableNonPubliee libelle={ libelleVariable } methode={ b.quality.etat === 'ok' ? b.quality.val.uncertainty.method : null } /> }
						</div>
						<p className="petit muet">
							Couverture et fiabilité : octets 0..254 ramenés à 0..1, 255 = absent. Statut : niveau encadrant le plus proche,
							jamais interpolé. Les nœuds absents (sous le relief, hors du domaine vertical) sont hachurés.
						</p>
					</>
				) }
			</section>

			<div className="f3-grille-2">
				<section className="f3-bloc" aria-labelledby="titre-methode">
					<h2 id="titre-methode">Méthode d'incertitude et calibration</h2>
					{ b ? <AvecRessource r={ b.quality } quoi="Fiabilité">{ ( q ) => <Methode q={ q } /> }</AvecRessource> : <p className="muet">…</p> }
				</section>
				<section className="f3-bloc" aria-labelledby="titre-repartition">
					<h2 id="titre-repartition">Répartition par classe de fiabilité</h2>
					{ b ? <AvecRessource r={ b.quality } quoi="Répartition">{ ( q ) => <Repartition q={ q } /> }</AvecRessource> : <p className="muet">…</p> }
				</section>
			</div>

			<PanneSimulee />
		</section>
	);

}

/** Variable de fiabilité absente de meta.fields : jamais de carte vide présentée comme une valeur. */
export function VariableNonPubliee( { libelle, methode }: { libelle: string; methode: string | null } ) {

	return (
		<p className="f3-na" data-testid="carte-incertitude-non-publiee">
			{ libelle } : { NA }. Cette variable n’est pas publiée pour cet instantané (absente de <code>meta.fields</code>)
			{ methode === 'aucune' ? ' : le module de fiabilité (M2) n’était pas actif, méthode d’incertitude « aucune ».' : '.' }
		</p>
	);

}

function CarteVariable( { base, c, titre, testid }: { base: Base; c: Chargement<CarteSol[]>; titre: string; testid: string } ) {

	const carte = c.etat === 'ok' ? c.val[ 0 ] : null;
	const echelle = useMemo( () => ( carte ? echelleVariable( carte.variable, carte.resume.max ) : null ), [ carte ] );
	if ( c.etat === 'erreur' ) return <p className="f3-erreur" data-testid={ `${ testid }-erreur` }>{ titre } : { c.message }</p>;
	if ( ! carte || ! echelle ) return <SqueletteCarte texte={ `${ titre } : chargement…` } />;
	const g = base.meta.grid;
	const titreLegende = VARIABLES_INCERTITUDE.find( ( x ) => x.v === carte.variable )?.libelle ?? 'Vitesse horizontale du vent';
	return (
		<div>
			<Legende echelle={ echelle } titre={ titreLegende } />
			<Carte testid={ testid } titre={ titre } valeurs={ carte.valeurs } echelle={ echelle } resume={ carte.resume }
				grille={ { nx: g.nx, ny: g.ny, dx: g.dx_m, dy: g.dy_m, x0: g.x0_m, y0: g.y0_m } }
				stations={ base.stations.etat === 'ok' ? base.stations.val.items : [] } videTexte={ texteCarteVide( carte.resume, base.meta ) }
				exporter={ exportCarte( base, carte, echelle.kind === 'continue' ? echelle.unite : 'code' ) } />
		</div>
	);

}

export function Methode( { q }: { q: Quality } ) {

	const u = q.uncertainty, c = q.calibration;
	return (
		<>
			<dl className="f3-kv" data-testid="incertitude-methode">
				<dt>Méthode</dt><dd>{ u.method === 'aucune' ? 'aucune (avant M2)' : u.method }</dd>
				<dt>Membres de l'ensemble</dt><dd>{ num( u.members ) }</dd>
				<dt>Calibrée</dt><dd data-testid="incertitude-calibree">{ oui( u.calibrated ) }</dd>
				<dt>Facteur d'échelle</dt><dd>{ num( u.scale_factor ?? null, 2 ) }</dd>
				<dt>Couverture à 80 % (validation)</dt><dd>{ pourcent( u.coverage_80_validation ?? null ) }</dd>
			</dl>
			<h3>Calibration (DSO6)</h3>
			{ c == null ? <p data-testid="calibration">non calibré</p> : (
				<dl className="f3-kv" data-testid="calibration">
					<dt>Évaluée sur</dt><dd>{ c.evaluated_on }</dd>
					<dt>Couverture de l'intervalle à 80 %</dt><dd data-testid="calibration-coverage">{ pourcent( c.coverage_80 ) }</dd>
					<dt>Corrélation erreur / σ</dt><dd data-testid="calibration-corr">{ num( c.corr_error_sigma, 2 ) }</dd>
					<dt>DSO6 (≥ 80 % et corrélation &gt; 0)</dt><dd data-testid="calibration-dso6">{ oui( c.dso6_pass, 'atteint', 'non atteint' ) }</dd>
				</dl>
			) }
		</>
	);

}

export function Repartition( { q }: { q: Quality } ) {

	if ( ! q.by_level.length ) return <p className="muet">Répartition : { NA }.</p>;
	// Avant M2, toutes les parts sont null : pas de graphique vide qui ressemblerait à « 0 % ».
	const vide = q.by_level.every( ( l ) => l.share_elevee == null && l.share_moyenne == null && l.share_faible == null );
	return (
		<>
			{ vide
				? <p className="muet" data-testid="repartition-non-disponible">Répartition par classe : { NA } (classes de fiabilité non publiées{ q.uncertainty.method === 'aucune' ? ', module M2 inactif' : '' }).</p>
				: <RepartitionClasses niveaux={ q.by_level } /> }
			<details className="f3-tableau-repli">
				<summary>Tableau par niveau</summary>
				<div className="f3-defile">
					<table className="f3-table" data-testid="repartition-table">
						<thead><tr><th>Niveau (m, mer)</th><th>Nœuds valides</th><th>Élevée</th><th>Moyenne</th><th>Faible</th><th>σ médian (m/s)</th><th>Couverture médiane</th></tr></thead>
						<tbody>
							{ q.by_level.map( ( l ) => (
								<tr key={ l.z_asl_m }>
									<td className="num">{ num( l.z_asl_m ) }</td>
									<td className="num">{ num( l.valid_nodes ) }</td>
									<td className="num">{ pourcent( l.share_elevee ) }</td>
									<td className="num">{ pourcent( l.share_moyenne ) }</td>
									<td className="num">{ pourcent( l.share_faible ) }</td>
									<td className="num">{ num( l.sigma_speed_median, 3 ) }</td>
									<td className="num">{ num( l.coverage_median, 3 ) }</td>
								</tr>
							) ) }
						</tbody>
					</table>
				</div>
			</details>
		</>
	);

}

const SCENARIO: Record<NonNullable<Snapshot[ 'scenario' ]>[ 'kind' ], string> = {
	part_stations: 'part des capteurs conservée',
	panne_zone: 'panne d’une zone',
	station_retiree: 'capteur(s) retiré(s)',
};

/** Panne simulée (TB6). `?simulation=<id>` : les simulations ne sont pas listées par /v1/times. */
function PanneSimulee() {

	const [ id ] = useState( lireSimulation );
	const sim = useAsync<Simulation>( `sim:${ id ?? '' }`, ( s ) => chargerSimulation( api, id, s ) );
	return (
		<section className="f3-bloc" aria-labelledby="titre-sim" data-testid="simulation">
			<h2 id="titre-sim">Panne simulée</h2>
			{ sim.etat === 'attente' ? <SqueletteLignes n={ 2 } texte="simulation : chargement…" />
				: sim.etat === 'erreur' ? <p className="f3-erreur">Simulation : { sim.message }</p>
					: sim.val.etat === 'aucune' ? (
						<p className="muet" data-testid="aucune-simulation">
							Aucune simulation publiée n’est référencée. Les simulations (outil MCP <code>simuler_panne</code>) ne figurent
							ni dans latest ni dans /v1/times : ouvrir cette page avec <code>?simulation=&lt;identifiant&gt;</code>.
						</p>
					)
						: sim.val.etat === 'invalide' ? <p className="f3-erreur" data-testid="simulation-invalide">Simulation <code>{ sim.val.id }</code> : { sim.val.message }.</p>
							: <Simulee s={ sim.val } /> }
		</section>
	);

}

export function Simulee( { s }: { s: Extract<Simulation, { etat: 'ok' }> } ) {

	const sc = s.snapshot.scenario!, k = s.snapshot.kpi;
	const ref = s.baseline.etat === 'ok' ? s.baseline.val : null;
	const lignes: [ string, string, string ][] = [
		[ 'Capteurs visibles', num( s.snapshot.network.sensors_visible ), ref ? num( ref.network.sensors_visible ) : NA ],
		[ 'Nœuds en fiabilité élevée', pourcent( k.share_high_reliability ), ref ? pourcent( ref.kpi.share_high_reliability ) : NA ],
		[ `Vent moyen à ${ num( k.hub_height_agl_m ) } m au-dessus du sol`, withUnit( k.hub_wind_mean_ms, 'm/s', 1 ), ref ? withUnit( ref.kpi.hub_wind_mean_ms, 'm/s', 1 ) : NA ],
		[ 'Vent maximal au moyeu', withUnit( k.hub_wind_max_ms, 'm/s', 1 ), ref ? withUnit( ref.kpi.hub_wind_max_ms, 'm/s', 1 ) : NA ],
	];
	return (
		<div className="f3-simulation" data-testid="simulation-ok">
			<p className="f3-etiquette-sim" role="note">SIMULATION — ce n’est pas l’état courant du vent</p>
			<dl className="f3-kv">
				<dt>Identifiant</dt><dd><code>{ s.snapshot.snapshot_id }</code></dd>
				<dt>Scénario</dt><dd data-testid="simulation-kind">{ SCENARIO[ sc.kind ] ?? sc.kind }</dd>
				{ sc.keep_fraction != null ? <><dt>Part des capteurs conservée</dt><dd>{ pourcent( sc.keep_fraction ) }</dd></> : null }
				{ sc.zone ? <><dt>Zone en panne</dt><dd>x { num( sc.zone.x_min_m / 1000, 1 ) }–{ num( sc.zone.x_max_m / 1000, 1 ) } km, y { num( sc.zone.y_min_m / 1000, 1 ) }–{ num( sc.zone.y_max_m / 1000, 1 ) } km</dd></> : null }
				{ sc.stations?.length ? <><dt>Capteurs retirés</dt><dd>{ sc.stations.join( ', ' ) }</dd></> : null }
				<dt>Instant simulé</dt><dd>{ utc( s.snapshot.valid_time ) }</dd>
				<dt>Référence</dt><dd>{ sc.baseline_snapshot_id ? <code>{ sc.baseline_snapshot_id }</code> : NA }{ s.baseline.etat === 'erreur' ? ` (${ s.baseline.message })` : '' }</dd>
			</dl>
			<table className="f3-table" data-testid="simulation-comparaison">
				<thead><tr><th>Indicateur</th><th>Simulation</th><th>Référence</th></tr></thead>
				<tbody>{ lignes.map( ( [ l, a, b ] ) => <tr key={ l }><td>{ l }</td><td className="num">{ a }</td><td className="num">{ b }</td></tr> ) }</tbody>
			</table>
			<AvecRessource r={ s.quality } quoi="Fiabilité de la simulation">{ ( q ) => <RepartitionClasses niveaux={ q.by_level } /> }</AvecRessource>
		</div>
	);

}
