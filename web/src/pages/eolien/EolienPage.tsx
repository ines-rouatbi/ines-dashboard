// Page Éolien (lot F4, BF64 à BF69) : parc, éoliennes, sites candidats, rose des vents, Weibull.
// Affiche fidèlement /v1/wind-farm/{id} et /v1/windrose/{site_id} ; aucun calcul scientifique (D4) :
// une grandeur que l'API ne publie pas n'apparaît pas, une grandeur publiée à null s'affiche « non disponible ».
import { useState } from 'react';
import type { EolienData } from '../shared/api';
import type { Turbine, WindFarm, WindRose } from '../shared/types';
import { WINDROSE_MIN_VALID } from '../shared/types';
import { AIR_DENSITY_SOURCE, NA, TURBINE_STATE, interval, num, utc, veer, withUnit } from '../shared/format';
import { PowerCurveChart, WindRoseChart } from './charts';
import { Rotors } from './Rotors';
import '../shared/pages.css';

function TurbineRow( { t }: { t: Turbine } ) {

	return (
		<tr data-testid="turbine" data-turbine-id={ t.id }>
			<th scope="row">
				{ t.name } <span className="atom-muted">{ t.id }</span>
				{ t.virtual && <span className="atom-tag" data-testid="turbine-virtual">virtuelle</span> }
			</th>
			<td data-testid="turbine-state" className={ `atom-state-${ t.state }` }>{ TURBINE_STATE[ t.state ] ?? t.state }</td>
			<td>{ t.model }</td>
			<td className="num">{ withUnit( t.hub_agl_m, 'm' ) } · ⌀ { withUnit( t.rotor_d_m, 'm' ) }</td>
			<td className="num" data-testid="turbine-hub-speed">{ interval( t.hub_speed, 'm/s', 2 ) }</td>
			<td className="num" data-testid="turbine-rews">{ interval( t.rews, 'm/s', 2 ) }</td>
			<td className="num" data-testid="turbine-power">{ interval( t.power_kw, 'kW' ) }</td>
			<td className="num">{ withUnit( t.rated_kw, 'kW' ) }</td>
			<td className="num" data-testid="turbine-shear">{ num( t.shear_alpha, 3 ) }</td>
			<td className="num" data-testid="turbine-veer">{ veer( t.veer_deg ) }</td>
			<td className="num" data-testid="turbine-air-density">
				{ withUnit( t.air_density, 'kg/m³', 3 ) }
				{ t.air_density_source && <span className="atom-muted"> ({ AIR_DENSITY_SOURCE[ t.air_density_source ] })</span> }
			</td>
		</tr>
	);

}

function RoseCard( { rose }: { rose: WindRose } ) {

	const weak = rose.n_valid < WINDROSE_MIN_VALID;
	const w = rose.weibull;
	return (
		<div className="atom-grid2" data-testid="windrose" data-site-id={ rose.site_id }>
			<div className="atom-card">
				<WindRoseChart rose={ rose } />
			</div>
			<div className="atom-card">
				<dl className="atom-kv">
					<dt>Instants valides</dt>
					<dd>
						<span data-testid="windrose-n-valid">{ num( rose.n_valid ) }</span>
						{ weak && <strong className="atom-warn" data-testid="windrose-weak"> · statistiquement faible (moins de { WINDROSE_MIN_VALID })</strong> }
					</dd>
					<dt>Période</dt><dd data-testid="windrose-period">{ utc( rose.period.from ) } → { utc( rose.period.to ) }</dd>
					<dt>Hauteur</dt><dd>{ withUnit( rose.hub_agl_m, 'm au-dessus du sol' ) }</dd>
					<dt>Position</dt><dd>x = { num( rose.x_m / 1000, 1 ) } km, y = { num( rose.y_m / 1000, 1 ) } km</dd>
					<dt>Weibull k</dt><dd data-testid="weibull-k">{ w ? num( w.k, 2 ) : NA }</dd>
					<dt>Weibull c</dt><dd data-testid="weibull-c">{ w ? withUnit( w.c_ms, 'm/s', 2 ) : NA }</dd>
					<dt>Production annuelle</dt><dd data-testid="weibull-aep">{ w ? withUnit( w.aep_mwh, 'MWh', 0 ) : NA }</dd>
					<dt>Facteur de capacité</dt><dd data-testid="weibull-cf">{ w?.capacity_factor == null ? NA : withUnit( w.capacity_factor * 100, '%', 1 ) }</dd>
				</dl>
				<div className="atom-scroll">
					<table className="atom-table" data-testid="windrose-table">
						<thead><tr><th>Provenance</th><th>Fréquence</th></tr></thead>
						<tbody>
							{ rose.sectors.map( ( s ) => (
								<tr key={ s.dir_center_deg } data-testid="windrose-sector" data-dir={ s.dir_center_deg }>
									<td>{ num( s.dir_center_deg ) }°</td>
									<td className="num">{ withUnit( s.frequency * 100, '%', 1 ) }</td>
								</tr>
							) ) }
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);

}

export function EolienPage( { data }: { data: EolienData } ) {

	const { windFarm, windroses } = data;
	const [ selected, setSelected ] = useState( windroses[ 0 ]?.point.id ?? null );
	const current = windroses.find( ( r ) => r.point.id === selected ) ?? null;

	return (
		<section className="atom-page" data-testid="page-eolien">
			<h2>Éolien</h2>

			{ windFarm
				? <Parc wf={ windFarm } />
				: <p className="atom-muted" data-testid="no-wind-farm">Parc éolien : { NA } (wind-farm non publié pour cet instantané).</p> }

			<h3>Rose des vents et Weibull</h3>
			{ windroses.length === 0
				? <p className="atom-muted" data-testid="no-windrose">Aucune rose des vents publiée pour cet instantané.</p>
				: (
					<>
						<div className="atom-tabs" role="tablist">
							{ windroses.map( ( { point } ) => (
								<button key={ point.id } type="button" role="tab" aria-selected={ point.id === selected }
									data-testid="windrose-tab" data-site-id={ point.id } onClick={ () => setSelected( point.id ) }>
									{ point.name } <span className="atom-muted">{ point.kind === 'site' ? 'site candidat' : 'éolienne' }</span>
								</button>
							) ) }
						</div>
						{ current && ( current.rose
							? <RoseCard key={ current.point.id } rose={ current.rose } />
							: <p className="atom-muted" data-testid="windrose-missing">Rose des vents de { current.point.name } : { NA }.</p> ) }
					</>
				) }
		</section>
	);

}

/** Parc, éoliennes et courbes de puissance (wind-farm.json publié). */
function Parc( { wf }: { wf: WindFarm } ) {

	// Parc publié mais sans aucune éolienne déclarée (instantanés M6 avant M5) : la production, la puissance
	// installée et les décomptes valent « non disponible », pas « 0 kW » ni « 0 / 0 ».
	if ( wf.turbines.length === 0 ) {

		return (
			<p className="atom-muted" data-testid="farm-empty">
				Parc éolien : { NA }. Aucune éolienne n’est déclarée dans cet instantané (wind-farm publié sans éolienne) :
				pas de production, de puissance installée ni de courbe de puissance à afficher.
			</p>
		);

	}

	return (
		<>
			<div className="atom-kpis">
				<div className="atom-kpi" data-testid="farm-power">
					<span className="atom-kpi-value">{ interval( wf.farm.power_kw, 'kW' ) }</span>
					<span className="atom-kpi-label">Production du parc (p50 [p10 – p90])</span>
				</div>
				<div className="atom-kpi" data-testid="farm-rated">
					<span className="atom-kpi-value">{ withUnit( wf.farm.rated_kw, 'kW' ) }</span>
					<span className="atom-kpi-label">Puissance installée</span>
				</div>
				<div className="atom-kpi" data-testid="farm-states">
					<span className="atom-kpi-value">{ num( wf.farm.n_production ) } / { num( wf.farm.n_arret ) }</span>
					<span className="atom-kpi-label">En production / à l’arrêt</span>
				</div>
			</div>

			<h3>Éoliennes</h3>
			<Rotors turbines={ wf.turbines } />
			<div className="atom-scroll">
				<table className="atom-table" data-testid="turbines">
					<thead>
						<tr>
							<th>Éolienne</th><th>État</th><th>Modèle</th><th>Moyeu · rotor</th>
							<th>Vent au moyeu</th><th>Vent équivalent rotor</th><th>Puissance</th><th>Nominale</th>
							<th title="Exposant de loi de puissance entre le bas et le haut du rotor">Cisaillement α</th>
							<th title="Rotation de la direction du bas vers le haut du rotor ; positive = sens horaire avec la hauteur">Rotation (veer)</th>
							<th>Densité de l’air</th>
						</tr>
					</thead>
					<tbody>{ wf.turbines.map( ( t ) => <TurbineRow key={ t.id } t={ t } /> ) }</tbody>
				</table>
			</div>
			<p className="atom-muted">Intervalles à 80 % : p50 [p10 – p90]. Les quantiles du parc sont calculés sur les membres de l’ensemble, ce n’est pas la somme des quantiles des éoliennes.</p>

			<h3>Courbes de puissance</h3>
			<div className="atom-card"><PowerCurveChart farm={ wf } /></div>
		</>
	);

}
