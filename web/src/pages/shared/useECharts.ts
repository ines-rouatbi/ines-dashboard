// Accroche minimale d'ECharts dans React : chargement différé, init / setOption / resize / dispose.
// Rendu SVG par défaut : le texte des graphiques reste dans le DOM (lisible par Playwright et les lecteurs d'écran).
//
// ECharts n'est pas dans le chargement initial : le module web/src/ui/moteurGraphiques.ts (echarts/core, graphiques et
// composants utilisés seulement) est importé dynamiquement au premier graphique monté, puis gardé en cache.
import { useEffect, useRef } from 'react';
import type { EChartsOption } from 'echarts';

type ModuleECharts = typeof import( '../../ui/moteurGraphiques' );
type Graphique = ReturnType<ModuleECharts[ 'echarts' ][ 'init' ]>;

let chargement: Promise<ModuleECharts> | null = null;

/** Charge ECharts (une seule fois). */
export function chargerECharts(): Promise<ModuleECharts> {

	if ( ! chargement ) {

		chargement = import( '../../ui/moteurGraphiques' );
		chargement.catch( () => { chargement = null; } );

	}
	return chargement;

}

export function useECharts( option: EChartsOption, renderer: 'svg' | 'canvas' = 'svg' ) {

	const ref = useRef<HTMLDivElement | null>( null );
	const chart = useRef<Graphique | null>( null );
	const optionRef = useRef( option );
	optionRef.current = option;

	useEffect( () => {

		let vivant = true, c: Graphique | null = null, ro: ResizeObserver | null = null;
		chargerECharts().then( ( { echarts } ) => {

			if ( ! vivant || ! ref.current ) return;
			c = echarts.init( ref.current, undefined, { renderer } );
			chart.current = c;
			c.setOption( optionRef.current, { notMerge: true } );
			const g = c;
			ro = new ResizeObserver( () => g.resize() );
			ro.observe( ref.current );

		}, () => { /* graphique indisponible : le tableau des valeurs reste lisible */ } );
		return () => { vivant = false; ro?.disconnect(); c?.dispose(); chart.current = null; };

	}, [ renderer ] );

	useEffect( () => { chart.current?.setOption( option, { notMerge: true } ); }, [ option ] );

	return ref;

}
