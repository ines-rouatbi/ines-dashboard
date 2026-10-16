// Profil vertical (ECharts, chargé à la demande) : vitesse (p50) et intervalle à 80 % (p10 / p90) selon l'altitude.

import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import type { ProfileLevel } from '../data/contract';
import { useECharts } from '../pages/shared/useECharts';
import { useStyleGraphique } from './graphiquesTheme';

const num = ( x: number | null | undefined ) => ( typeof x === 'number' && Number.isFinite( x ) ? x : null );

export function ProfileChart( { niveaux }: { niveaux: ProfileLevel[] } ) {

	const g = useStyleGraphique();
	const option = useMemo<EChartsOption>( () => {

		const valides = niveaux.filter( ( n ) => ! n.below_terrain );
		const serie = ( cle: 'p10' | 'p50' | 'p90' ) =>
			valides.map( ( n ) => [ num( n.speed_interval[ cle ] ), n.z_asl_m ] ).filter( ( p ) => p[ 0 ] != null ) as [ number, number ][];
		return {
			...g.animation,
			textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: g.encre },
			grid: { left: 46, right: 24, top: 28, bottom: 48 },
			legend: { bottom: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11, color: g.encre } },
			tooltip: { trigger: 'axis', axisPointer: { type: 'line', axis: 'y' }, valueFormatter: ( v: unknown ) => ( typeof v === 'number' ? v.toFixed( 1 ) : String( v ) ) },
			xAxis: { type: 'value', name: 'm/s', axisLabel: { color: g.muet }, nameTextStyle: { color: g.muet }, nameLocation: 'end', nameGap: 4, min: 0, splitLine: { lineStyle: { color: g.grille } } },
			yAxis: { type: 'value', name: 'altitude (m, mer)', axisLabel: { color: g.muet }, nameTextStyle: { align: 'left', color: g.muet }, splitLine: { lineStyle: { color: g.grille } } },
			series: [
				{ name: 'p10', type: 'line', data: serie( 'p10' ), showSymbol: false, lineStyle: { type: 'dashed', width: 1, color: g.accent }, itemStyle: { color: g.accent } },
				{ name: 'p50', type: 'line', data: serie( 'p50' ), symbolSize: 5, lineStyle: { width: 2, color: g.encre }, itemStyle: { color: g.encre } },
				{ name: 'p90', type: 'line', data: serie( 'p90' ), showSymbol: false, lineStyle: { type: 'dashed', width: 1, color: g.accent }, itemStyle: { color: g.accent } },
			],
		};

	}, [ niveaux, g ] );
	const ref = useECharts( option, 'canvas' );
	return <div ref={ ref } className="graphe-profil" />;

}
