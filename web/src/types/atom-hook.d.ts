// Interface du crochet de test `window.__atom` (tests E2E Playwright, lot F5).
// Implémentation : web/src/scene/hook.ts. Cette interface est un contrat avec les tests :
// toute modification doit être annoncée à l'agent qui les écrit.

import type { Viz } from '../scene/viz';

/** Résultat de `pick` : nœud cliqué et position (contrat v1 rév. 2 : nœud (i, j) en x0 + i·dx). */
export interface AtomPick {
	/** Indices dans la grille AFFICHÉE (échantillonnée selon la densité). */
	ix: number;
	iy: number;
	/** Fractions du domaine depuis le coin sud-ouest, dans [0, 1]. */
	fx: number;
	fy: number;
	/** Nœud NATIF le plus proche (index binaire = j·nx + i), celui de /v1/column/{id}?i&j. */
	i: number;
	j: number;
	/** Position de ce nœud, en m : x = x0 + i·dx, y = y0 + j·dy. */
	x_m: number;
	y_m: number;
}

export interface AtomHook {
	/**
	 * Résolue quand la PREMIÈRE scène avec un champ est rendue (une image effectivement
	 * dessinée). REJETÉE avec un message (Error) si les données ne se chargent pas dans
	 * les 15 s, ou dès qu'une ressource indispensable (/v1/meta, /v1/latest, champ u/v
	 * du premier niveau) est absente ou invalide. Ne se résout que sur la page
	 * « Exploration 3D » (/exploration).
	 */
	readonly ready: Promise<void>;
	/** Scène courante, ou null si la page « Exploration 3D » n'est pas montée. */
	readonly scene: Viz | null;
	/**
	 * Choisit le niveau le plus proche de `m` (mètres AU-DESSUS DE LA MER) et résout quand
	 * le champ de ce niveau est rendu. Rejetée si la scène n'est pas montée ou si le
	 * champ ne se charge pas.
	 */
	setAltitude( m: number ): Promise<void>;
	/**
	 * Picking à (x, y), en PIXELS CSS RELATIFS AU COIN HAUT-GAUCHE DU CANEVAS de la scène
	 * (comme `event.offsetX/offsetY`, sans tenir compte de devicePixelRatio). Résout, après
	 * le rendu du marqueur, avec un `AtomPick`, ou `null` si le rayon ne touche pas le
	 * domaine. Déclenche aussi le profil vertical du nœud (/v1/column), affiché dans le panneau.
	 */
	pick( x: number, y: number ): Promise<AtomPick | null>;
}

declare global {
	interface Window { __atom: AtomHook }
}
