// Accroche minimale d'ECharts dans React : init / setOption / resize / dispose.
// Rendu SVG par défaut : le texte des graphiques reste dans le DOM (lisible par Playwright et les lecteurs d'écran).
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export function useECharts( option: echarts.EChartsOption, renderer: 'svg' | 'canvas' = 'svg' ) {

	const ref = useRef<HTMLDivElement | null>( null );
	const chart = useRef<echarts.ECharts | null>( null );

	useEffect( () => {

		if ( ! ref.current ) return;
		const c = echarts.init( ref.current, undefined, { renderer } );
		chart.current = c;
		const ro = new ResizeObserver( () => c.resize() );
		ro.observe( ref.current );
		return () => { ro.disconnect(); c.dispose(); chart.current = null; };

	}, [ renderer ] );

	useEffect( () => { chart.current?.setOption( option, { notMerge: true } ); }, [ option ] );

	return ref;

}
