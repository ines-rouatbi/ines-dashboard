// Interface du crochet de test `window.__atom` (tests E2E Playwright, lot F5).
// Implémentation : web/src/scene/hook.ts. Cette interface est un contrat avec les tests :
// toute modification doit être annoncée à l'agent qui les écrit.

import type { Viz } from '../scene/viz';

/** Résultat de `pick` : nœud cliqué et position (contrat v1 rév. 2 : nœud (i, j) en x0 + i·dx). */
export interface AtomPick {
	/** Depuis F2 (plus de grille échantillonnée) : indices du nœud natif, identiques à i et j. */
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
	 * Mode « altitude » : choisit le niveau publié le plus proche de `m` (mètres AU-DESSUS DE LA
	 * MER) et résout quand le champ de ce niveau est rendu. Rejetée si la scène n'est pas montée ou
	 * si le champ ne se charge pas.
	 */
	setAltitude( m: number ): Promise<void>;
	/**
	 * Mode « hauteur au-dessus du sol » (défaut de la page, 120 m) : plan à `m` mètres AU-DESSUS DU
	 * SOL, calculé par colonne avec le relief du modèle (D6). Résout quand ce plan est rendu.
	 * C'est la bonne méthode pour des hauteurs sol (10, 100, 300 m…), pas `setAltitude`.
	 */
	setHauteurSol( m: number ): Promise<void>;
	/** Tourne la caméra de `deg` degrés autour de la verticale ; résout après l'image rendue. */
	orbit( deg: number ): Promise<void>;
	/** Change des réglages de la page (voir AtomReglages) ; résout quand la scène les montre. */
	regler( r: Partial<AtomReglages> ): Promise<void>;
	/** État observable de la scène, pour les tests V3D1 à V3D8 et V3D10. */
	etat(): AtomEtat;
	/**
	 * Picking à (x, y), en PIXELS CSS RELATIFS AU COIN HAUT-GAUCHE DU CANEVAS de la scène
	 * (comme `event.offsetX/offsetY`, sans tenir compte de devicePixelRatio). Résout, après
	 * le rendu du marqueur, avec un `AtomPick`, ou `null` si le rayon ne touche pas le
	 * domaine. Déclenche aussi le profil vertical du nœud (/v1/column), affiché dans le panneau.
	 */
	pick( x: number, y: number ): Promise<AtomPick | null>;
}

export interface AtomReglages {
	mode: 'sol' | 'mer';
	/** Hauteur au-dessus du sol (mode « sol »), m. */
	hauteurSol: number;
	/** Indice du niveau publié (mode « mer »). */
	niveau: number;
	/** Exagération verticale, 1 à 10. */
	exageration: number;
	coloration: 'vitesse' | 'incertitude' | 'fiabilite';
	lignes: boolean;
	/** Indice de densité des lignes de courant (0 = clairsemé). */
	densite: number;
	animation: boolean;
	coupeH: boolean;
	coupeV: 'est-ouest' | 'nord-sud' | null;
	/** Position de la coupe verticale, fraction 0..1 du domaine (sud → nord, ou ouest → est). */
	coupeVPos: number;
	relief: boolean;
	stations: boolean;
	eoliennes: boolean;
	/** Instantané choisi dans la frise ; null = le dernier publié. */
	instantane: string | null;
}

export interface AtomEtat {
	reglages: AtomReglages;
	snapshot_id: string | null;
	/** Altitude mer du niveau affiché (mode « mer »), sinon null. */
	altitude_m: number | null;
	/** Nombre de nœuds où le plan affiché existe (hors relief) / total. */
	noeuds_valides: number;
	noeuds: number;
	/** Vitesse horizontale du plan : null si aucun nœud (jamais 0). */
	vitesse: { min: number | null; moyenne: number | null; max: number | null };
	legende: { min: number; max: number; graduations: number[] } | null;
	lignes: { lignes: number; segments: number };
	coupe_h_triangles: number;
	coupe_v_triangles: number;
	stations: number;
	eoliennes: number;
	instantanes: number;
	exageration: number;
	fps: { moyenne: number; p5: number; images: number } | null;
}

declare global {
	interface Window { __atom: AtomHook }
}
