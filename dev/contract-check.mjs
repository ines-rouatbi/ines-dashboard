// Garde de `npm run contract:check` : lance le validateur du contrat s'il existe.
// Le dossier contract/ est écrit dans une autre branche (lot F0, contrat v1) ; tant
// qu'il est absent, on n'échoue pas : on le signale et on sort avec le code 0.

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const validateur = 'contract/tools/validate.mjs';

if ( ! existsSync( validateur ) ) {

	console.log( 'contrat absent' );
	process.exit( 0 );

}

const r = spawnSync( process.execPath, [ validateur, ...process.argv.slice( 2 ) ], { stdio: 'inherit' } );
process.exit( r.status ?? 1 );
