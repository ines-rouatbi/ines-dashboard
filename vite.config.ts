// Configuration Vite (front) + Vitest (tests unitaires).
//
// Racine du front : web/ ; build vers dist/ (servi par le Worker, cf. wrangler.jsonc).
// En dev (et en preview), GET /v1/* est servi depuis contract/fixtures/<ATOM_FIXTURE>/
// pour travailler sans GPU ni Worker. ?scenario=<nom> change de scénario à l'exécution (cookie de dev).
// Avec ATOM_V1_ORIGIN, /v1 et /api sont relayés vers ce Worker (vrais instantanés) : voir plus bas.

import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { middlewareFixturesParScenario } from './dev/fixtures';

const ici = fileURLToPath( new URL( '.', import.meta.url ) );
const scenario = process.env.ATOM_FIXTURE || 'normal';
// Branchement réel (lot F6) : ATOM_V1_ORIGIN=http://127.0.0.1:8787 relaie /v1 et /api vers un Worker
// (wrangler dev sur le R2 local où M6 publie, ou la production) au lieu des fixtures. Lecture seule.
const origineV1 = process.env.ATOM_V1_ORIGIN || null;
const relais = origineV1
	? Object.fromEntries( [ '/v1', '/api' ].map( ( p ) => [ p, { target: origineV1, changeOrigin: true } ] ) )
	: undefined;

function fixturesV1(): Plugin {

	const racine = resolve( ici, 'contract/fixtures' );
	const mw = () => middlewareFixturesParScenario( racine, scenario );
	return {
		name: 'atom-fixtures-v1',
		configureServer( server ) {

			server.middlewares.use( mw() );
			server.config.logger.info( `  [atom] /v1/* servi depuis contract/fixtures/${ scenario }/ (autre scénario : ?scenario=<nom>)` );

		},
		configurePreviewServer( server ) { server.middlewares.use( mw() ); },
	};

}

export default defineConfig( {
	root: resolve( ici, 'web' ),
	plugins: origineV1 ? [ react() ] : [ react(), fixturesV1() ],
	server: { proxy: relais },
	preview: { proxy: relais },
	build: {
		outDir: resolve( ici, 'dist' ),
		emptyOutDir: true,
		chunkSizeWarningLimit: 800,
		rollupOptions: {
			// Bibliothèques lourdes en morceaux séparés (cache navigateur stable).
			output: { manualChunks: { three: [ 'three' ], echarts: [ 'echarts' ], react: [ 'react', 'react-dom' ] } },
		},
	},
	test: {
		root: ici,
		include: [ 'web/src/**/*.test.{ts,tsx}', 'dev/**/*.test.ts' ],
		environment: 'node',
	},
} );
