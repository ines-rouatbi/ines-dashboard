// ECharts « à la carte » (echarts/core) : seuls les graphiques et composants utilisés par le tableau de bord.
//
// Ce module (web/src/ui/moteurGraphiques.ts) n'est JAMAIS importé statiquement : `chargerECharts()` le charge à la demande (import dynamique),
// si bien que la bibliothèque (≈ 1,1 Mo minifié en version complète) sort du chargement initial. Rendu SVG par
// défaut (texte des graphiques dans le DOM, lisible par Playwright et les lecteurs d'écran), canevas en option.

import * as echarts from 'echarts/core';
import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, PolarComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';

echarts.use( [ LineChart, BarChart, ScatterChart, GridComponent, LegendComponent, PolarComponent, TooltipComponent, SVGRenderer, CanvasRenderer ] );

export { echarts };
