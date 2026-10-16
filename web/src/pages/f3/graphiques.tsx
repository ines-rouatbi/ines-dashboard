// Graphiques ECharts des pages F3 : série au moyeu (TB4) et répartition des classes de fiabilité.
// Valeurs publiées telles quelles (D4). null = trou dans la courbe ou barre absente, jamais 0.

import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import type { Quality } from '../../data/contract';
import { NA, num, utc } from '../shared/format';
import { useECharts } from '../shared/useECharts';
import { CLASSES, SERIE } from './couleurs';
import { COULEURS } from '../../ui/couleurs';
import type { PointMoyeu } from './donnees';

const ENCRE = COULEURS.encre, MUET = COULEURS.encre3, GRILLE = '#E1E0D9', AXE = '#C3C2B7';
const fr = ( v: number ) => v.toLocaleString( 'fr-FR' );
const AXIS = { axisLine: { lineStyle: { color: AXE } }, axisLabel: { color: MUET }, splitLine: { lineStyle: { color: GRILLE } }, nameTextStyle: { color: MUET } };

/** Données d'une série au moyeu : [temps, valeur | null] ; null reste un trou (connectNulls: false). */
export function donneesSerie( points: PointMoyeu[], cle: 'moyenne' | 'max' ): [ string, number | null ][] {

	return points.map( ( p ) => [ p.valid_time, p[ cle ] ] );

}

export function SerieMoyeu( { points, hauteur }: { points: PointMoyeu[]; hauteur: number | null } ) {

	const option = useMemo<EChartsOption>( () => ( {
		animation: false,
		// Les instantanés sont datés en UTC : l'axe du temps aussi (sinon ECharts suit le fuseau du navigateur).
		useUTC: true,
		textStyle: { color: ENCRE, fontFamily: 'Inter, system-ui, sans-serif' },
		tooltip: {
			trigger: 'axis',
			valueFormatter: ( v ) => ( typeof v === 'number' ? `${ num( v, 2 ) } m/s` : NA ),
		},
		legend: { top: 0, left: 0, textStyle: { color: ENCRE } },
		grid: { left: 52, right: 16, top: 36, bottom: 36 },
		xAxis: { type: 'time', name: 'UTC', nameLocation: 'end', ...AXIS, splitLine: { show: false } },
		yAxis: { type: 'value', name: 'm/s', min: 0, ...AXIS, axisLabel: { color: MUET, formatter: fr } },
		series: ( [ [ 'moyenne', 'Moyenne sur le domaine' ], [ 'max', 'Maximum sur le domaine' ] ] as const ).map( ( [ cle, nom ], k ) => ( {
			name: nom,
			type: 'line' as const,
			connectNulls: false,
			showSymbol: true,
			symbolSize: 8,
			lineStyle: { width: 2, color: SERIE[ k ] },
			itemStyle: { color: SERIE[ k ], borderColor: '#fff', borderWidth: 2 },
			data: donneesSerie( points, cle ),
		} ) ),
	} ), [ points ] );
	const ref = useECharts( option );
	const titre = `Vent au moyeu, ${ hauteur == null ? NA : `${ num( hauteur ) } m` } au-dessus du sol`;
	return (
		<div data-testid="serie-moyeu">
			<div ref={ ref } className="f3-graphique" role="img"
				aria-label={ `${ titre } : ${ points.length } instant(s), moyenne et maximum sur le domaine en m/s` } />
			<details className="f3-tableau-repli">
				<summary>Tableau des valeurs</summary>
				<table className="f3-table" data-testid="serie-moyeu-table">
					<thead><tr><th>Instant (UTC)</th><th>Moyenne (m/s)</th><th>Maximum (m/s)</th></tr></thead>
					<tbody>
						{ points.map( ( p ) => (
							<tr key={ p.snapshot_id }>
								<td>{ utc( p.valid_time ) }</td>
								<td className="num">{ num( p.moyenne, 2 ) }</td>
								<td className="num">{ num( p.max, 2 ) }</td>
							</tr>
						) ) }
					</tbody>
				</table>
			</details>
		</div>
	);

}

type Niveau = Quality[ 'by_level' ][ number ];

/** Part (0..1) en % pour le graphique ; null reste null (barre absente, pas 0). */
export const partPct = ( x: number | null ) => ( x == null ? null : Math.round( x * 1000 ) / 10 );

export function RepartitionClasses( { niveaux }: { niveaux: Niveau[] } ) {

	const option = useMemo<EChartsOption>( () => {

		const cats = niveaux.map( ( l ) => `${ fr( l.z_asl_m ) } m` );
		const classes = [ [ 'share_elevee', 'Élevée', CLASSES.elevee ], [ 'share_moyenne', 'Moyenne', CLASSES.moyenne ], [ 'share_faible', 'Faible', CLASSES.faible ] ] as const;
		return {
			animation: false,
			textStyle: { color: ENCRE, fontFamily: 'Inter, system-ui, sans-serif' },
			tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: ( v ) => ( typeof v === 'number' ? `${ num( v, 1 ) } %` : NA ) },
			legend: { top: 0, left: 0, textStyle: { color: ENCRE } },
			grid: { left: 64, right: 16, top: 36, bottom: 36 },
			xAxis: { type: 'value', min: 0, max: 100, name: '% des nœuds valides', nameLocation: 'middle', nameGap: 24, ...AXIS },
			yAxis: { type: 'category', data: cats, name: 'niveau (m au-dessus de la mer)', ...AXIS, nameTextStyle: { color: MUET, align: 'left' }, splitLine: { show: false } },
			series: classes.map( ( [ cle, nom, couleur ] ) => ( {
				name: nom, type: 'bar' as const, stack: 'classes', barWidth: '70%',
				itemStyle: { color: couleur, borderColor: '#fff', borderWidth: 1 },
				data: niveaux.map( ( l ) => partPct( l[ cle ] ) ),
			} ) ),
		};

	}, [ niveaux ] );
	const ref = useECharts( option );
	return <div ref={ ref } className="f3-graphique f3-graphique-haut" role="img" aria-label="Répartition des nœuds valides par classe de fiabilité (élevée, moyenne, faible), par niveau du modèle" data-testid="repartition" />;

}
