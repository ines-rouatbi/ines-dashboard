// Navigation du tableau de bord (routage par chemin, repli SPA côté Worker et Vite).

import { useEffect, useState } from 'react';

export type PageId = 'ensemble' | 'exploration' | 'fiabilite' | 'eolien' | 'alertes' | 'modele';

export interface Route { id: PageId; chemin: string; titre: string }

export const ROUTES: Route[] = [
	{ id: 'ensemble', chemin: '/', titre: 'Vue d\'ensemble' },
	{ id: 'exploration', chemin: '/exploration', titre: 'Exploration 3D' },
	{ id: 'fiabilite', chemin: '/fiabilite', titre: 'Fiabilité' },
	{ id: 'eolien', chemin: '/eolien', titre: 'Éolien' },
	{ id: 'alertes', chemin: '/alertes', titre: 'Alertes' },
	{ id: 'modele', chemin: '/modele', titre: 'Modèle' },
];

export function routeDepuisChemin( chemin: string ): Route {

	const c = chemin.replace( /\/+$/, '' ) || '/';
	return ROUTES.find( ( r ) => r.chemin === c ) ?? ROUTES[ 0 ];

}

export function naviguer( chemin: string ) {

	if ( location.pathname === chemin ) return;
	history.pushState( null, '', chemin );
	dispatchEvent( new PopStateEvent( 'popstate' ) );

}

export function useRoute(): Route {

	const [ r, setR ] = useState( () => routeDepuisChemin( location.pathname ) );
	useEffect( () => {

		const f = () => setR( routeDepuisChemin( location.pathname ) );
		addEventListener( 'popstate', f );
		return () => removeEventListener( 'popstate', f );

	}, [] );
	return r;

}
