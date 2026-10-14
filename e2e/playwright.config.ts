// Configuration Playwright du tableau de bord ATOM (lot F5).
//
// Trois projets :
//   oracles     tests purs sans navigateur (e2e/oracles) : direction, REWS, Weibull, relief…
//   headless    tests fonctionnels, pour la porte / la CI (e2e/tests/functional)
//   headed-gpu  banc de performance, Chrome avec fenêtre et GPU matériel (e2e/tests/perf).
//               En headless, WebGL passe par un rendu logiciel et les FPS ne veulent rien dire.
//
// ATOM_URL : adresse testée. Si elle n'est pas fournie, Playwright lance lui-même le wrangler ÉPINGLÉ
// de e2e/ (devDependency exacte, npx --no-install) sur la config de la racine, au port ATOM_PORT
// (défaut 8787), ou réutilise le serveur qui écoute déjà sur ce port (d'où la vérification du titre).
//
// Prérequis du projet headed-gpu : Google Chrome installé (channel « chrome »). --use-angle=d3d11
// ne vaut que sous Windows ; ailleurs, ATOM_ANGLE=metal (macOS) ou vulkan / gl (Linux).
import { defineConfig, devices } from '@playwright/test';

const ATOM_PORT = Number( process.env.ATOM_PORT ?? 8787 );
const ATOM_URL = process.env.ATOM_URL ?? `http://127.0.0.1:${ ATOM_PORT }`;
const ANGLE = process.env.ATOM_ANGLE ?? ( process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl' );
// Les oracles n'ont pas besoin de serveur : on ne lance wrangler que si un projet navigateur tourne.
const onlyOracles = process.argv.some( ( a ) => a === '--project=oracles' ) || process.argv.join( ' ' ).includes( '--project oracles' );
// ATOM_GPU=haute-perf : force le GPU dédié sur un portable à deux GPU (NVIDIA au lieu d'Intel).
// Par défaut Chrome prend le GPU intégré, le cas défavorable qui compte pour V3D10.
const highPerfGpu = process.env.ATOM_GPU === 'haute-perf';
const startLocal = ! process.env.ATOM_URL && ! onlyOracles && process.env.ATOM_NO_SERVER !== '1';

export default defineConfig( {
	timeout: 60_000,
	expect: { timeout: 10_000 },
	// RAM du PC Mahdi : un seul Chrome à la fois (consigne de rayen-audit-atom, message 304).
	workers: 1,
	fullyParallel: false,
	retries: 0,
	reporter: [ [ 'list' ] ],
	use: {
		baseURL: ATOM_URL,
		trace: 'retain-on-failure',
	},
	projects: [
		{
			name: 'oracles',
			testDir: './oracles',
		},
		{
			name: 'headless',
			testDir: './tests/functional',
			use: { ...devices[ 'Desktop Chrome' ], headless: true },
		},
		{
			name: 'headed-gpu',
			testDir: './tests/perf',
			timeout: 180_000,
			use: {
				...devices[ 'Desktop Chrome' ],
				channel: 'chrome',
				headless: false,
				viewport: { width: 1600, height: 900 },
				deviceScaleFactor: 1,
				launchOptions: {
					args: [
						`--use-angle=${ ANGLE }`,
						'--enable-gpu-rasterization',
						'--ignore-gpu-blocklist',
						// Pas de bridage du rAF quand la fenêtre passe en arrière-plan pendant la mesure.
						'--disable-background-timer-throttling',
						'--disable-renderer-backgrounding',
						'--disable-backgrounding-occluded-windows',
						...( highPerfGpu ? [ '--force_high_performance_gpu' ] : [] ),
					],
				},
			},
		},
	],
	webServer: startLocal
		? {
			command: `npx --no-install wrangler dev --config ../wrangler.jsonc --port ${ ATOM_PORT } --ip 127.0.0.1`,
			url: ATOM_URL,
			reuseExistingServer: true,
			timeout: 120_000,
		}
		: undefined,
} );
