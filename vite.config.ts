// Configuration Vite (front) + Vitest (tests unitaires).
//
// Racine du front : web/ ; build vers dist/ (servi par le Worker, cf. wrangler.jsonc).
// En dev (et en preview), GET /v1/* est servi depuis contract/fixtures/<ATOM_FIXTURE>/
// pour travailler sans GPU ni Worker.

import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { middlewareFixtures } from './dev/fixtures';

const ici = fileURLToPath( new URL( '.', import.meta.url ) );
const scenario = process.env.ATOM_FIXTURE || 'normal';

function fixturesV1(): Plugin {

	const mw = () => middlewareFixtures( resolve( ici, 'contract/fixtures' ), scenario );
	return {
		name: 'atom-fixtures-v1',
		configureServer( server ) {

			server.middlewares.use( mw() );
			server.config.logger.info( `  [atom] /v1/* servi depuis contract/fixtures/${ scenario }/` );

		},
		configurePreviewServer( server ) { server.middlewares.use( mw() ); },
	};

}

export default defineConfig( {
	root: resolve( ici, 'web' ),
	plugins: [ react(), fixturesV1() ],
	build: {
		outDir: resolve( ici, 'dist' ),
		emptyOutDir: true,
		chunkSizeWarningLimit: 1500,
	},
	test: {
		root: ici,
		include: [ 'web/src/**/*.test.ts', 'dev/**/*.test.ts' ],
		environment: 'node',
	},
} );
