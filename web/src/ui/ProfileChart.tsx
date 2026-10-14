// Profil vertical (ECharts) : médiane p50 et bornes p10 / p90 en fonction de l'altitude.

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ProfileLevel } from '../data/contract';
import { COULEURS } from './couleurs';

echarts.use( [ LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer ] );

const num = ( x: number | null | undefined ) => ( typeof x === 'number' && Number.isFinite( x ) ? x : null );

export function ProfileChart( { niveaux }: { niveaux: ProfileLevel[] } ) {

	const ref = useRef<HTMLDivElement>( null );

	useEffect( () => {

		if ( ! ref.current ) return;
		const chart = echarts.init( ref.current, undefined, { renderer: 'canvas' } );
		const valides = niveaux.filter( ( n ) => ! n.below_terrain );
		const serie = ( cle: 'speed_p10' | 'speed_p50' | 'speed_p90' ) =>
			valides.map( ( n ) => [ num( n[ cle ] ), n.z_m_asl ] ).filter( ( p ) => p[ 0 ] != null );

		chart.setOption( {
			animation: false,
			textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: COULEURS.encre },
			grid: { left: 46, right: 12, top: 26, bottom: 30 },
			legend: { top: 0, right: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 } },
			tooltip: { trigger: 'axis', axisPointer: { type: 'line', axis: 'y' }, valueFormatter: ( v: unknown ) => typeof v === 'number' ? v.toFixed( 1 ) : String( v ) },
			xAxis: { type: 'value', name: 'm/s', nameLocation: 'end', nameGap: 4, min: 0, splitLine: { lineStyle: { color: COULEURS.trait } } },
			yAxis: { type: 'value', name: 'altitude (m, mer)', nameTextStyle: { align: 'left' }, splitLine: { lineStyle: { color: COULEURS.trait } } },
			series: [
				{ name: 'p10', type: 'line', data: serie( 'speed_p10' ), showSymbol: false, lineStyle: { type: 'dashed', width: 1, color: COULEURS.accent }, itemStyle: { color: COULEURS.accent } },
				{ name: 'p50', type: 'line', data: serie( 'speed_p50' ), symbolSize: 5, lineStyle: { width: 2, color: COULEURS.encre }, itemStyle: { color: COULEURS.encre } },
				{ name: 'p90', type: 'line', data: serie( 'speed_p90' ), showSymbol: false, lineStyle: { type: 'dashed', width: 1, color: COULEURS.accent }, itemStyle: { color: COULEURS.accent } },
			],
		} );
		const ro = new ResizeObserver( () => chart.resize() );
		ro.observe( ref.current );
		return () => { ro.disconnect(); chart.dispose(); };

	}, [ niveaux ] );

	return <div ref={ ref } className="graphe-profil" />;

}
