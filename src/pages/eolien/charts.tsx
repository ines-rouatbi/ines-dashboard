// Graphiques de la page Éolien. Ils affichent les données publiées telles quelles (D4) :
// courbes de puissance de wind-farm.power_curves, point de fonctionnement (rews.p50, power_kw.p50)
// de chaque éolienne, rose des vents précalculée par M5 et M6.
import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import type { Turbine, WindFarm, WindRose } from '../shared/types';
import { useECharts } from '../shared/useECharts';

const fr = ( v: number ) => v.toLocaleString( 'fr-FR' );
const AXIS = { axisLine: { lineStyle: { color: '#8b98a5' } }, axisLabel: { color: '#8b98a5', formatter: fr }, splitLine: { lineStyle: { color: '#26323f' } } };

export function PowerCurveChart( { farm }: { farm: WindFarm } ) {

	const option = useMemo<EChartsOption>( () => {

		const curves = Object.entries( farm.power_curves ).map( ( [ model, c ] ) => ( {
			name: `Courbe ${ model }`, type: 'line' as const, showSymbol: false,
			data: c.speed_ms.map( ( v, k ) => [ v, c.power_kw[ k ] ] ),
		} ) );
		const placed = farm.turbines.filter( ( t: Turbine ) => t.rews.p50 != null && t.power_kw.p50 != null );
		return {
			animation: false,
			textStyle: { color: '#e6edf3' },
			tooltip: { trigger: 'item' },
			legend: { top: 0, right: 0, textStyle: { color: '#e6edf3' } },
			grid: { left: 56, right: 16, top: 48, bottom: 44 },
			xAxis: { type: 'value', name: 'Vent équivalent rotor (m/s)', nameLocation: 'middle', nameGap: 28, min: 0, ...AXIS },
			yAxis: { type: 'value', name: 'Puissance (kW)', ...AXIS },
			series: [
				...curves,
				{
					name: 'Éoliennes (p50)', type: 'scatter', symbolSize: 10,
					label: { show: true, formatter: ( p: any ) => p.data[ 2 ], position: 'top', color: '#e6edf3' },
					data: placed.map( ( t ) => [ t.rews.p50, t.power_kw.p50, t.id ] ),
				},
			],
		};

	}, [ farm ] );
	const ref = useECharts( option );
	return <div ref={ ref } className="atom-chart" data-testid="power-curve-chart" role="img" aria-label="Courbes de puissance et point de fonctionnement des éoliennes" />;

}

/** Libellé de secteur : points cardinaux si la largeur le permet, sinon degrés. */
function sectorLabel( deg: number, width: number ) {

	const names16 = [ 'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO' ];
	if ( width === 22.5 ) return names16[ Math.round( deg / 22.5 ) % 16 ];
	if ( width === 45 ) return names16[ Math.round( deg / 22.5 ) % 16 ];
	if ( deg % 90 === 0 ) return names16[ deg / 22.5 ];
	return `${ deg }°`;

}

export function WindRoseChart( { rose }: { rose: WindRose } ) {

	const option = useMemo<EChartsOption>( () => {

		const edges = rose.speed_bin_edges_ms;
		const cats = rose.sectors.map( ( s ) => sectorLabel( s.dir_center_deg, rose.sector_width_deg ) );
		return {
			animation: false,
			textStyle: { color: '#e6edf3' },
			legend: { bottom: 0, textStyle: { color: '#e6edf3' } },
			tooltip: { trigger: 'item', valueFormatter: ( v: any ) => `${ ( Number( v ) * 100 ).toFixed( 1 ) } %` },
			// Secteur 0 (nord) en haut, puis sens horaire : convention de lecture d'une rose météo.
			polar: { radius: [ 0, '72%' ], center: [ '50%', '46%' ] },
			angleAxis: { type: 'category', data: cats, startAngle: 90 + 180 / cats.length, clockwise: true, axisLabel: { color: '#8b98a5' }, axisLine: { lineStyle: { color: '#26323f' } } },
			// Graduations radiales masquées (elles chevauchent les secteurs) : les fréquences sont dans le tableau voisin et l'infobulle.
			radiusAxis: { axisLabel: { show: false }, axisTick: { show: false }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#26323f' } } },
			series: edges.slice( 0, -1 ).map( ( lo, b ) => ( {
				name: `${ lo }–${ edges[ b + 1 ] } m/s`, type: 'bar' as const, coordinateSystem: 'polar' as const, stack: 'rose',
				data: rose.sectors.map( ( s ) => s.speed_bins[ b ] ?? 0 ),
			} ) ),
		};

	}, [ rose ] );
	const ref = useECharts( option );
	return <div ref={ ref } className="atom-chart" data-testid="windrose-chart" role="img" aria-label={ `Rose des vents de ${ rose.site_id }` } />;

}
