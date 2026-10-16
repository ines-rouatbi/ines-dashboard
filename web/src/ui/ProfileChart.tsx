// Profil vertical (ECharts, chargé à la demande) : vitesse (p50) et intervalle à 80 % (p10 / p90) selon l'altitude.

import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import type { ProfileLevel } from '../data/contract';
import { useECharts } from '../pages/shared/useECharts';
import { COULEURS } from './couleurs';

const num = ( x: number | null | undefined ) => ( typeof x === 'number' && Number.isFinite( x ) ? x : null );

export function ProfileChart( { niveaux }: { niveaux: ProfileLevel[] } ) {

	const option = useMemo<EChartsOption>( () => {

		const valides = niveaux.filter( ( n ) => ! n.below_terrain );
		const serie = ( cle: 'p10' | 'p50' | 'p90' ) =>
			valides.map( ( n ) => [ num( n.speed_interval[ cle ] ), n.z_asl_m ] ).filter( ( p ) => p[ 0 ] != null ) as [ number, number ][];
		return {
			animation: false,
			textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: COULEURS.encre },
			grid: { left: 46, right: 24, top: 28, bottom: 48 },
			legend: { bottom: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 } },
			tooltip: { trigger: 'axis', axisPointer: { type: 'line', axis: 'y' }, valueFormatter: ( v: unknown ) => ( typeof v === 'number' ? v.toFixed( 1 ) : String( v ) ) },
			xAxis: { type: 'value', name: 'm/s', nameLocation: 'end', nameGap: 4, min: 0, splitLine: { lineStyle: { color: COULEURS.trait } } },
			yAxis: { type: 'value', name: 'altitude (m, mer)', nameTextStyle: { align: 'left' }, splitLine: { lineStyle: { color: COULEURS.trait } } },
			series: [
				{ name: 'p10', type: 'line', data: serie( 'p10' ), showSymbol: false, lineStyle: { type: 'dashed', width: 1, color: COULEURS.accent }, itemStyle: { color: COULEURS.accent } },
				{ name: 'p50', type: 'line', data: serie( 'p50' ), symbolSize: 5, lineStyle: { width: 2, color: COULEURS.encre }, itemStyle: { color: COULEURS.encre } },
				{ name: 'p90', type: 'line', data: serie( 'p90' ), showSymbol: false, lineStyle: { type: 'dashed', width: 1, color: COULEURS.accent }, itemStyle: { color: COULEURS.accent } },
			],
		};

	}, [ niveaux ] );
	const ref = useECharts( option, 'canvas' );
	return <div ref={ ref } className="graphe-profil" />;

}
