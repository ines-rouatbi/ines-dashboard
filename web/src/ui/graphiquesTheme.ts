// Couleurs et animation des graphiques ECharts selon le thème et la préférence « animations réduites ».
//
// Les options ECharts portent des couleurs explicites (encre, axes, grille) : elles sont recalculées quand le thème
// change, et l'animation d'entrée est coupée si les animations sont réduites. Les couleurs de DONNÉES (rampes,
// séries, classes) ne changent pas avec le thème.

import { useMemo } from 'react';
import { couleursTheme } from './couleurs';
import { useMouvementReduit, useTheme } from './preferences';

export interface StyleGraphique {
	encre: string;
	muet: string;
	grille: string;
	axe: string;
	/** Fond des panneaux : bordure des marques (points, barres) pour les détacher. */
	fond: string;
	accent: string;
	sableTexte: string;
	encre2: string;
	sombre: boolean;
	/** Réglages d'animation à étaler dans une option ECharts. */
	animation: { animation: boolean; animationDuration: number; animationEasing: 'cubicOut'; animationDurationUpdate: number };
}

export function styleGraphique( theme: 'light' | 'dark', reduit: boolean ): StyleGraphique {

	const c = couleursTheme( theme );
	return {
		encre: c.encre, muet: c.encre3, encre2: c.encre2, accent: theme === 'dark' ? c.accentTexte : c.accent, sableTexte: c.sableTexte,
		grille: theme === 'dark' ? '#22354A' : '#E1E0D9', axe: theme === 'dark' ? '#3A5068' : '#C3C2B7',
		fond: c.panneau, sombre: theme === 'dark',
		animation: { animation: ! reduit, animationDuration: reduit ? 0 : 900, animationEasing: 'cubicOut', animationDurationUpdate: reduit ? 0 : 500 },
	};

}

export function useStyleGraphique(): StyleGraphique {

	const t = useTheme(), reduit = useMouvementReduit();
	return useMemo( () => styleGraphique( t, reduit ), [ t, reduit ] );

}
