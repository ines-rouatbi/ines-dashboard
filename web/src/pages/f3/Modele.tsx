// Page Modèle (lot F3) : versions (modèle, normalisation, données, nature, sha256 des poids), géométrie
// du meta (grille, niveaux au-dessus de la mer, min_agl_m, géoréférencement « supposé »), codage des
// champs, contrôles physiques de l'instant (D11) et qualité des données d'entrée (D12).

import type { JSX } from 'react';
import { api } from '../../data';
import type { DataQuality, Meta, Snapshot, Versions } from '../../data/contract';
import type { EtatLatest } from '../../ui/useLatest';
import { NA, num, utc, withUnit } from '../shared/format';
import { AvecRessource, EtatPageF3, oui, pourcent, scientifique, useAsync, useInstantane } from './commun';
import { chargerModele, type DonneesModele } from './donnees';
import { FIELD_VARS } from '../../data/contract';
import { ExportsPublies } from '../../ui/Exports';
import { ServiceCalcul, useServiceCalcul } from '../../ui/ServiceCalcul';

const NATURE: Record<Versions[ 'data_kind' ], string> = {
	test: 'test (instantané de test : pas un résultat du modèle)',
	synthetique: 'synthétique (capteurs simulés)',
	reel: 'réelle (réseau de mesure)',
};

const RHO: Record<NonNullable<Snapshot[ 'physics' ]>[ 'rho_source' ], string> = {
	atmosphere_standard: 'atmosphère standard',
	extrapolation_surface: 'extrapolée de la surface',
	verite_synthetique: 'vérité synthétique',
};

const PROBLEME: Record<DataQuality[ 'issues' ][ number ][ 'kind' ], string> = {
	fichier_rejete: 'Fichier rejeté',
	quarantaine: 'Quarantaine',
	capteur_muet: 'Capteur muet',
	valeur_interpolee: 'Valeurs interpolées',
	hors_plage: 'Hors plage',
};

export function PageModele( { latest }: { latest: EtatLatest } ) {

	const snap = useInstantane( latest );
	const d = useAsync( snap.etat === 'ok' ? snap.val.snapshot_id : null, ( s ) => chargerModele( api, ( snap as { val: Snapshot } ).val, s ) );
	if ( snap.etat !== 'ok' ) return <EtatPageF3 titre="Modèle" nom="modele" etat={ snap } />;
	if ( d.etat !== 'ok' ) return <EtatPageF3 titre="Modèle" nom="modele" etat={ d } />;
	return <Modele d={ d.val } service={ <ServiceDeCalcul /> } />;

}

function ServiceDeCalcul() {

	return <ServiceCalcul s={ useServiceCalcul() } />;

}

export function Modele( { d, service = null }: { d: DonneesModele; service?: JSX.Element | null } ) {

	const { snapshot, meta } = d;
	return (
		<section className="f3-page" data-testid="page-modele">
			<header className="f3-entete">
				<h1>Modèle</h1>
				<p className="muet">Instantané du { utc( snapshot.valid_time ) } · <code>{ snapshot.snapshot_id }</code></p>
				<ExportsPublies snapshot={ snapshot } />
			</header>
			<div className="f3-grille-2">
				{ service }
				<Versions v={ snapshot.versions } meta={ meta } />
				<Grille meta={ meta } />
				<Georef meta={ meta } />
				<Physique p={ snapshot.physics } />
				<section className="f3-bloc" aria-labelledby="titre-incertitude-modele">
					<h2 id="titre-incertitude-modele">Incertitude</h2>
					<AvecRessource r={ d.quality } quoi="Incertitude">{ ( q ) => (
						<dl className="f3-kv">
							<dt>Méthode</dt><dd>{ q.uncertainty.method }</dd>
							<dt>Membres</dt><dd>{ num( q.uncertainty.members ) }</dd>
							<dt>Calibrée</dt><dd>{ oui( q.uncertainty.calibrated ) }</dd>
						</dl>
					) }</AvecRessource>
				</section>
				<section className="f3-bloc" aria-labelledby="titre-dq">
					<h2 id="titre-dq">Qualité des données d'entrée</h2>
					<AvecRessource r={ d.dataQuality } quoi="Qualité des données">{ ( q ) => <QualiteDonnees q={ q } /> }</AvecRessource>
				</section>
			</div>
			<Codage meta={ meta } />
		</section>
	);

}

function Versions( { v, meta }: { v: Versions; meta: Meta } ) {

	const coherent = v.model_sha256 === meta.versions.model_sha256;
	return (
		<section className="f3-bloc" aria-labelledby="titre-versions" data-testid="versions">
			<h2 id="titre-versions">Versions</h2>
			<dl className="f3-kv">
				<dt>Modèle</dt><dd data-testid="version-model">{ v.model }</dd>
				<dt>sha256 des poids</dt><dd><code className="f3-hash" data-testid="version-sha256">{ v.model_sha256 }</code></dd>
				<dt>Normalisation (sha8)</dt><dd><code data-testid="version-norm">{ v.norm }</code></dd>
				<dt>Jeu de données</dt><dd data-testid="version-data">{ v.data }</dd>
				<dt>Nature des données</dt><dd data-testid="version-data-kind">{ NATURE[ v.data_kind ] ?? v.data_kind }</dd>
				<dt>Contrat</dt><dd>v{ v.contract }</dd>
			</dl>
			{ coherent ? null : <p className="f3-erreur">Le meta servi ne correspond pas au modèle de l'instantané ({ meta.versions.model_sha256.slice( 0, 8 ) }).</p> }
		</section>
	);

}

function Grille( { meta }: { meta: Meta } ) {

	const g = meta.grid;
	return (
		<section className="f3-bloc" aria-labelledby="titre-grille" data-testid="grille">
			<h2 id="titre-grille">Grille</h2>
			<dl className="f3-kv">
				<dt>Nœuds</dt><dd data-testid="grille-taille">{ num( g.nx ) } × { num( g.ny ) } × { num( g.nz ) }</dd>
				<dt>Pas horizontal</dt><dd>{ num( g.dx_m ) } m × { num( g.dy_m ) } m</dd>
				<dt>Nœud (0, 0)</dt><dd>x = { num( g.x0_m ) } m, y = { num( g.y0_m ) } m (sud-ouest)</dd>
				<dt>Étendue</dt><dd>{ num( ( meta.domain.x_max_m - g.x0_m ) / 1000, 1 ) } km (Est) × { num( ( meta.domain.y_max_m - g.y0_m ) / 1000, 1 ) } km (Nord)</dd>
				<dt>Hauteur minimale d'un nœud</dt><dd data-testid="grille-min-agl">{ num( g.min_agl_m, 1 ) } m au-dessus du sol</dd>
				<dt>Nœuds valides</dt><dd>{ num( g.valid_nodes ) }</dd>
				<dt>Relief</dt><dd>{ num( meta.terrain.min_m, 0 ) } à { num( meta.terrain.max_m, 0 ) } m au-dessus de la mer · { meta.terrain.source }</dd>
			</dl>
			<h3>Niveaux (m au-dessus de la mer)</h3>
			<div className="f3-defile">
				<table className="f3-table" data-testid="niveaux">
					<thead><tr><th>Indice</th><th>Altitude (m, mer)</th><th>Part de nœuds valides</th></tr></thead>
					<tbody>
						{ g.levels_asl_m.map( ( z, k ) => (
							<tr key={ k }><td className="num">{ k }</td><td className="num">{ num( z ) }</td><td className="num">{ pourcent( g.valid_fraction_by_level[ k ] ?? null ) }</td></tr>
						) ) }
					</tbody>
				</table>
			</div>
			<p className="petit muet">Les cartes « au-dessus du sol » sont calculées par colonne depuis ces niveaux et le relief (D6).</p>
		</section>
	);

}

function Georef( { meta }: { meta: Meta } ) {

	const r = meta.georef, b = r.bounds;
	const deg = ( x: number ) => `${ num( x, 5 ) }°`;
	return (
		<section className="f3-bloc" aria-labelledby="titre-georef" data-testid="georef">
			<h2 id="titre-georef">Géoréférencement</h2>
			{ r.suppose ? <p className="f3-avertissement" data-testid="georef-suppose" role="note">Position supposée : la position réelle du domaine n'est pas encore fournie.</p> : null }
			<dl className="f3-kv">
				<dt>Nœud (0, 0)</dt><dd>{ deg( r.lat0 ) } N, { deg( r.lon0 ) } E{ r.suppose ? ' (supposé)' : '' }</dd>
				<dt>Rotation de l'axe x</dt><dd>{ num( r.rotation_deg, 1 ) }° depuis l'Est, sens antihoraire</dd>
				<dt>Emprise</dt><dd>lat { deg( b.lat_min ) } à { deg( b.lat_max ) }, lon { deg( b.lon_min ) } à { deg( b.lon_max ) }</dd>
				<dt>Projection</dt><dd>plan tangent équirectangulaire au nœud (0, 0)</dd>
			</dl>
		</section>
	);

}

function Physique( { p }: { p: Snapshot[ 'physics' ] } ) {

	return (
		<section className="f3-bloc" aria-labelledby="titre-physique" data-testid="physique">
			<h2 id="titre-physique">Contrôles physiques (instant)</h2>
			{ p == null ? <p className="muet" data-testid="physique-na">Contrôles physiques : { NA } (pas encore publiés pour cet instantané).</p> : (
				<dl className="f3-kv">
					<dt>Résidu de masse sous le seuil DSO2</dt><dd data-testid="physique-ok">{ oui( p.mass_residual_ok ) }</dd>
					<dt>Résidu de masse RMS</dt><dd>{ scientifique( p.mass_residual_rms ) } kg·m⁻³·s⁻¹</dd>
					<dt>Résidu de masse p95</dt><dd>{ scientifique( p.mass_residual_p95 ) } kg·m⁻³·s⁻¹</dd>
					<dt>Condition au sol (RMS)</dt><dd>{ withUnit( p.ground_condition_rms_ms, 'm/s', 3 ) }</dd>
					<dt>Densité de l'air</dt><dd data-testid="physique-rho">{ RHO[ p.rho_source ] ?? p.rho_source }</dd>
				</dl>
			) }
		</section>
	);

}

function QualiteDonnees( { q }: { q: DataQuality } ) {

	return (
		<div data-testid="data-quality">
			<dl className="f3-kv">
				<dt>Période</dt><dd>{ utc( q.period.from ) } → { utc( q.period.to ) }</dd>
				<dt>Fichiers</dt><dd data-testid="dq-fichiers">{ num( q.files.received ) } reçus, { num( q.files.accepted ) } acceptés, { num( q.files.rejected ) } rejetés, { num( q.files.quarantined ) } en quarantaine</dd>
				<dt>Capteurs</dt><dd data-testid="dq-capteurs">{ num( q.sensors.total ) } au total, { num( q.sensors.observed ) } observés, { num( q.sensors.interpolated ) } interpolés, { num( q.sensors.muette ) } muets, { num( q.sensors.exclue ) } exclus</dd>
				<dt>Part interpolée</dt><dd>{ pourcent( q.interpolated_fraction ) }</dd>
			</dl>
			{ q.issues.length ? (
				<div className="f3-defile">
					<table className="f3-table" data-testid="dq-problemes">
						<thead><tr><th>Problème</th><th>Cible</th><th>Nombre</th><th>Détail</th></tr></thead>
						<tbody>{ q.issues.map( ( x, k ) => (
							<tr key={ k }><td>{ PROBLEME[ x.kind ] ?? x.kind }</td><td>{ x.target }</td><td className="num">{ num( x.count ) }</td><td>{ x.detail }</td></tr>
						) ) }</tbody>
					</table>
				</div>
			) : <p className="muet">Aucun problème signalé.</p> }
		</div>
	);

}

function Codage( { meta }: { meta: Meta } ) {

	const absentes = FIELD_VARS.filter( ( f ) => ! meta.fields.includes( f ) );
	return (
		<section className="f3-bloc" aria-labelledby="titre-codage">
			<h2 id="titre-codage">Champs publiés</h2>
			<div className="f3-defile">
				<table className="f3-table" data-testid="codage">
					<thead><tr><th>Variable</th><th>Type</th><th>Absent</th><th>Échelle</th><th>Unité</th></tr></thead>
					<tbody>{ meta.fields.map( ( f ) => {

						const e = meta.encoding[ f ];
						return (
							<tr key={ f }>
								<td><code>{ f }</code></td><td>{ e?.dtype ?? NA }</td><td>{ e ? String( e.nodata ) : NA }</td>
								<td>{ e?.scale == null ? 'sans objet (float32)' : e.scale === 1 ? '1' : `1/${ num( Math.round( 1 / e.scale ) ) }` }</td>
								<td>{ meta.units[ f ] ?? NA }</td>
							</tr>
						);

					} ) }</tbody>
				</table>
			</div>
			{ absentes.length ? (
				<p className="petit muet" data-testid="champs-non-publies">
					Non publiées pour ce modèle (non disponible) : { absentes.map( ( f, k ) => <span key={ f }>{ k ? ', ' : '' }<code>{ f }</code></span> ) }.
				</p>
			) : null }
			<p className="petit muet">Direction : d'où vient le vent, (270 − atan2(v, u)) mod 360, arrondie avant le modulo ; indéfinie sous 0,2 m/s.</p>
		</section>
	);

}
