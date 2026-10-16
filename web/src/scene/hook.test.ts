import { describe, expect, it } from 'vitest';
import { installerCrochet } from './hook';

describe( 'window.__atom.ready', () => {

	it( 'est rejetée avec un message si aucune scène n\'est rendue dans le délai', async () => {

		const hook = installerCrochet( 30 );
		await expect( hook.ready ).rejects.toThrow( /aucune scène rendue en 0 s \(page « Exploration 3D » non ouverte\)/ );
		await expect( hook.setAltitude( 100 ) ).rejects.toThrow( /scène non montée/ );

	} );

} );
