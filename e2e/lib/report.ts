// Rapport de performance : e2e/reports/perf-<date>.json.
// Règle 9 du salon : une mesure qui n'a pas pu être prise porte le statut « non_mesure » et sa
// raison, jamais un zéro ni un « ok » par défaut.
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Status = 'ok' | 'hors_seuil' | 'non_mesure';

export interface Metric {
	status: Status;
	/** Seuil du cahier (V3D10, VIS1…) et sens de comparaison. */
	threshold?: { value: number; unit: string; rule: '>=' | '<'; source: string };
	value?: number | null;
	reason?: string;
	detail?: unknown;
}

export class PerfReport {

	readonly startedAt = new Date();
	readonly metrics: Record<string, Metric> = {};
	env: Record<string, unknown> = {
		// Pas de os.hostname() : les rapports de référence sont commités. Libellé choisi par l'humain.
		machine: process.env.ATOM_MACHINE ?? 'non renseigné',
		os: `${ os.type() } ${ os.release() } ${ os.arch() }`,
		cpu: os.cpus()[ 0 ]?.model,
		threads: os.cpus().length,
		ramTotalGB: Math.round( os.totalmem() / 1e9 * 10 ) / 10,
		ramFreeGBAtStart: Math.round( os.freemem() / 1e9 * 10 ) / 10,
		node: process.version,
		atomUrl: process.env.ATOM_URL ?? 'http://127.0.0.1:8787 (défaut)',
	};

	/** minSamples : en dessous, un percentile ne veut rien dire et la mesure est « non_mesure ». */
	measured( name: string, value: number | null, threshold: Metric[ 'threshold' ], detail?: unknown, minSamples?: { n: number; min: number } ) {

		if ( value == null ) return this.notMeasured( name, 'aucun échantillon valide', threshold, detail );
		if ( minSamples && minSamples.n < minSamples.min ) {

			return this.notMeasured( name, `${ minSamples.n } échantillon(s) valide(s) < ${ minSamples.min } requis`, threshold, { value, ...( detail as object ) } );

		}

		const pass = ! threshold || ( threshold.rule === '>=' ? value >= threshold.value : value < threshold.value );
		this.metrics[ name ] = { status: pass ? 'ok' : 'hors_seuil', value, threshold, detail };

	}

	notMeasured( name: string, reason: string, threshold?: Metric[ 'threshold' ], detail?: unknown ) {

		this.metrics[ name ] = { status: 'non_mesure', reason, threshold, detail };

	}

	write( dir: string ) {

		mkdirSync( dir, { recursive: true } );
		const stamp = this.startedAt.toISOString().replace( /[:.]/g, '-' ).slice( 0, 19 );
		const file = path.join( dir, `perf-${ stamp }.json` );
		const statuses = Object.values( this.metrics ).map( ( m ) => m.status );
		const verdict = statuses.includes( 'hors_seuil' ) ? 'hors_seuil'
			: statuses.includes( 'non_mesure' ) || ! statuses.length ? 'incomplet' : 'ok';
		writeFileSync( file, JSON.stringify( {
			startedAt: this.startedAt.toISOString(),
			finishedAt: new Date().toISOString(),
			verdict,
			percentileMethod: 'rang le plus proche',
			env: this.env,
			metrics: this.metrics,
		}, null, 2 ) + '\n' );
		return { file, verdict };

	}

}
