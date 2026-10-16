// Scène 3D (lot F2), critères V3D1 à V3D8, sur les 3 instantanés de test du contrat (projet « headless »).
// Les valeurs attendues sont relues dans l'API (/v1/*) : rien n'est codé en dur, sauf les règles du contrat.
//
// Serveur Vite (défaut) : ?scenario=<nom> choisit l'instantané. Autre serveur : seul « normal » tourne.
import { test, expect, type Page } from '@playwright/test';
import { assertIsAtom, waitForAtom, sceneBox, SCENE_PATH } from '../../lib/atom';

const SCENARIOS = [ 'normal', 'capteur_en_derive', 'gpu_eteint' ] as const;

async function ouvrir( page: Page, scenario: string ) {

	test.skip( scenario !== 'normal' && process.env.ATOM_SERVER !== 'vite', 'choix du scénario : serveur Vite des fixtures seulement' );
	const errors: string[] = [];
	page.on( 'pageerror', ( e ) => errors.push( e.message ) );
	await page.goto( `${ SCENE_PATH }?scenario=${ scenario }` );
	await assertIsAtom( page );
	const st = await waitForAtom( page );
	expect( st.ok, st.ok ? '' : st.reason ).toBe( true );
	return errors;

}

const etat = ( page: Page ) => page.evaluate( () => window.__atom!.etat!() );
const regler = ( page: Page, r: Record<string, unknown> ) => page.evaluate( ( x ) => window.__atom!.regler!( x ), r );
const api = async ( page: Page, path: string ) => ( await page.request.get( path ) ).json();

for ( const sc of SCENARIOS ) {

	test.describe( `scène 3D — instantané de test « ${ sc } »`, () => {

		test( 'V3D1 : relief ombré du modèle, exagération ×1 à ×10, socle, nord, échelle, situation', async ( { page } ) => {

			const errors = await ouvrir( page, sc );
			const meta = await api( page, '/v1/meta' );
			const relief = await page.evaluate( () => {

				const d = ( window.__atom!.scene as any ).domaine;
				let lo = Infinity, hi = - Infinity;
				for ( const z of d.terrain ) { lo = Math.min( lo, z ); hi = Math.max( hi, z ); }
				return { n: d.terrain.length, lo, hi };

			} );
			expect( relief.n ).toBe( meta.grid.nx * meta.grid.ny );
			expect( relief.hi - relief.lo ).toBeGreaterThan( 10 ); // le relief n'est pas un sol plat
			for ( const e of [ 1, 10, 5 ] ) {

				await regler( page, { exageration: e } );
				expect( ( await etat( page ) ).exageration ).toBe( e );
				await expect( page.getByTestId( 'exageration' ) ).toHaveText( `×${ e }` );

			}

			await expect( page.getByTestId( 'emprise' ) ).toBeVisible();
			if ( meta.georef.suppose ) await expect( page.getByTestId( 'position-supposee' ) ).toBeVisible();
			await expect( page.getByTestId( 'data-kind' ) ).toHaveText( /test/ );
			expect( errors ).toEqual( [] );

		} );

		test( 'V3D2 : lignes de courant colorées', async ( { page } ) => {

			await ouvrir( page, sc );
			const e = await etat( page );
			expect( e.lignes.lignes ).toBeGreaterThan( 10 );
			expect( e.lignes.segments ).toBeGreaterThan( e.lignes.lignes );
			await regler( page, { densite: 0 } );
			expect( ( await etat( page ) ).lignes.lignes ).toBeLessThan( e.lignes.lignes ); // décimation

		} );

		test( 'V3D3 : 120 m au-dessus du sol par défaut (= kpi.hub_wind_*), mode altitude en option', async ( { page } ) => {

			await ouvrir( page, sc );
			const e = await etat( page );
			expect( e.reglages.mode ).toBe( 'sol' );
			expect( e.reglages.hauteurSol ).toBe( 120 );
			await expect( page.getByTestId( 'altitude-label' ) ).toHaveText( /120 m/ );
			// Calcul par colonne avec le relief (D6) : redonne le vent au moyeu publié (D10).
			const snap = await api( page, `/v1/snapshots/${ e.snapshot_id }` );
			expect( e.vitesse.moyenne ).toBeCloseTo( snap.kpi.hub_wind_mean_ms, 2 );
			expect( e.vitesse.max ).toBeCloseTo( snap.kpi.hub_wind_max_ms, 2 );
			// Mode altitude mer : niveau publié le plus proche.
			await page.evaluate( () => window.__atom!.setAltitude( 650 ) );
			const m = await etat( page );
			expect( m.reglages.mode ).toBe( 'mer' );
			expect( m.altitude_m ).toBe( 650 );
			// Sous min_agl_m : aucun nœud, « non disponible », jamais 0.
			await page.evaluate( () => window.__atom!.setHauteurSol!( 3 ) );
			const bas = await etat( page );
			expect( bas.noeuds_valides ).toBe( 0 );
			expect( bas.vitesse ).toEqual( { min: null, moyenne: null, max: null } );
			await expect( page.getByTestId( 'scene-message' ) ).toContainText( 'non disponible' );

		} );

		test( 'V3D4 : coupes horizontale et verticale, arrêtées au relief', async ( { page } ) => {

			await ouvrir( page, sc );
			const meta = await api( page, '/v1/meta' );
			await regler( page, { coupeH: true, coupeV: 'est-ouest', coupeVPos: 0.5 } );
			const e = await etat( page );
			expect( e.coupe_h_triangles ).toBeGreaterThan( 0 );
			expect( e.coupe_v_triangles ).toBeGreaterThan( 0 );
			// La coupe verticale ne peint jamais sous le relief : moins de triangles que la grille pleine.
			expect( e.coupe_v_triangles ).toBeLessThan( 2 * ( meta.grid.nx - 1 ) * ( meta.grid.nz - 1 ) );
			await regler( page, { coupeV: 'nord-sud', coupeVPos: 0.2 } );
			expect( ( await etat( page ) ).coupe_v_triangles ).toBeGreaterThan( 0 );

		} );

		test( 'V3D5 : clic → profil (intervalle à 80 %, statut, fiabilité, capteur le plus proche)', async ( { page } ) => {

			await ouvrir( page, sc );
			const box = await sceneBox( page );
			const hit = await page.evaluate( ( [ x, y ] ) => window.__atom!.pick( x, y ), [ box.width / 2, box.height * 0.6 ] ) as { i: number; j: number } | null;
			expect( hit ).not.toBeNull();
			const tableau = page.getByTestId( 'tableau-profil' );
			await expect( tableau ).toBeVisible();
			const col = await api( page, `/v1/column/${ ( await etat( page ) ).snapshot_id }?i=${ hit!.i }&j=${ hit!.j }` );
			const lignes = tableau.locator( 'tbody tr' );
			await expect( lignes ).toHaveCount( col.levels.length );
			const texte = await tableau.innerText();
			expect( texte ).toMatch( /mesuré|estimé/ );
			expect( texte ).toMatch( /élevée|moyenne|faible/ );
			expect( texte ).toMatch( /\d+,\d–\d+,\d/ ); // p10–p90
			if ( col.levels.some( ( l: { below_terrain: boolean } ) => l.below_terrain ) ) expect( texte ).toContain( 'sous le relief' );
			await expect( page.getByTestId( 'capteur-proche' ) ).not.toHaveText( '' );

		} );

		test( 'V3D6 : couches capteurs et éoliennes', async ( { page } ) => {

			await ouvrir( page, sc );
			const e = await etat( page );
			const stations = await api( page, `/v1/stations/${ e.snapshot_id }` );
			const snap = await api( page, `/v1/snapshots/${ e.snapshot_id }` );
			const farm = snap.assets.wind_farm ? await api( page, `/v1/wind-farm/${ e.snapshot_id }` ) : { turbines: [] };
			const sites = snap.points.filter( ( p: { kind: string } ) => p.kind !== 'eolienne' ).length;
			await expect.poll( async () => ( await etat( page ) ).stations ).toBe( stations.items.length );
			await expect.poll( async () => ( await etat( page ) ).eoliennes ).toBe( farm.turbines.length + sites );
			await regler( page, { stations: false, eoliennes: false } );
			expect( ( await etat( page ) ).reglages.stations ).toBe( false );

		} );

		test( 'V3D7 : coloration vitesse / incertitude / fiabilité avec légende chiffrée', async ( { page } ) => {

			await ouvrir( page, sc );
			for ( const [ c, unite ] of [ [ 'vitesse', 'm/s' ], [ 'incertitude', 'm/s' ], [ 'fiabilite', '' ] ] as const ) {

				await regler( page, { coloration: c } );
				const leg = page.getByTestId( 'legende' );
				await expect( leg ).toHaveAttribute( 'data-coloration', c );
				const grad = page.getByTestId( 'legende-graduations' ).locator( 'span' );
				expect( await grad.count() ).toBeGreaterThanOrEqual( 2 );
				if ( unite ) await expect( leg ).toContainText( unite );
				const e = await etat( page );
				expect( e.legende ).not.toBeNull();
				expect( e.legende.max ).toBeGreaterThan( e.legende.min );

			}

			await expect( page.getByTestId( 'legende' ) ).toContainText( '0,75' );

		} );

		test( 'V3D8 : frise temporelle (/v1/times) et rejeu ; bandeau seulement si le calcul est arrêté', async ( { page } ) => {

			await ouvrir( page, sc );
			const times = await api( page, '/v1/times' );
			await expect( page.getByTestId( 'frise' ) ).toHaveAttribute( 'data-instantanes', String( times.items.length ) );
			expect( ( await etat( page ) ).instantanes ).toBe( times.items.length );
			// Un seul instantané publié : rejeu désactivé, jamais d'instant inventé.
			if ( times.items.length < 2 ) await expect( page.getByTestId( 'rejeu' ) ).toBeDisabled();
			else await expect( page.getByTestId( 'rejeu' ) ).toBeEnabled();
			const latest = await api( page, '/v1/latest' );
			if ( latest.compute_status !== 'online' ) await expect( page.getByTestId( 'freshness-banner' ) ).toContainText( 'Dernier état réel' );
			else await expect( page.getByTestId( 'freshness-banner' ) ).toHaveCount( 0 );

		} );

	} );

}
