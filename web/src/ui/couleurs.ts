// Charte graphique ATOM-AI (cahier des charges §17.4), source unique pour le code (ECharts, canevas, three.js).
// Les couleurs d'interface sont déclarées À L'IDENTIQUE en variables CSS dans theme.css (:root) ; le test
// charte.test.ts vérifie la concordance et les contrastes (WCAG 2.1 AA : 4,5:1 pour le texte).
//
// §17.4 :
//   interface   encre #12263A, fond #E9EEF1, panneaux blancs, accent bleu ciel #1E6FB8, sable #B8925A (relief) ;
//   vitesse     rampe continue bleu nuit, cyan, vert, jaune, orange, rouge, toujours avec légende chiffrée en m/s ;
//   incertitude rampe violette, du plus clair (faible) au plus foncé (forte) ;
//   états       vert (conforme, active), orange (avertissement, suspecte), rouge (important, muette) ; jamais la
//               couleur seule, toujours un libellé (et une forme sur les cartes) ;
//   typographie Inter pour le texte, Inter Display pour les titres ; chiffres alignés (tabulaires) dans les tableaux.
//
// Variantes « -texte » : la même teinte assombrie pour le TEXTE posé sur fond clair (contraste ≥ 4,5:1) ; les
// teintes de base restent celles des marques (pastilles, traits, aplats), qui ne demandent que 3:1.

export const COULEURS = {
	encre: '#12263A',
	encre2: '#3C5266',
	/** Texte secondaire : #6B7D8D d'origine n'atteignait que 3,6:1 sur le fond ; assombri pour AA. */
	encre3: '#586A7B',
	fond: '#E9EEF1',
	panneau: '#FFFFFF',
	accent: '#1E6FB8',
	/** Accent pour du texte (liens, boutons secondaires) sur fond clair. */
	accentTexte: '#1A62A3',
	sable: '#B8925A',
	/** Sable pour du texte (niveaux sous le relief) : #B8925A n'atteint que 2,9:1 sur blanc. */
	sableTexte: '#7A5A2E',
	trait: '#D5DDE3',
	ok: '#2E8B57',
	okTexte: '#1F7A4A',
	/** Orange de la charte, assez foncé pour une marque (≥ 3:1 sur blanc et sur le fond). */
	attention: '#CF6B12',
	attentionTexte: '#9A5208',
	alerte: '#C0392B',
	alerteTexte: '#B0331F',
	neutre: '#6B7D8D',
} as const;

/** Vitesse du vent (§17.4) : bleu nuit → cyan → vert → jaune → orange → rouge, de la plus faible à la plus forte. */
export const RAMPE_VITESSE = [ '#1A2A6C', '#1FA4C8', '#3BAA5C', '#F2D02B', '#F28B30', '#C62828' ] as const;

/** Incertitude (§17.4) : violet, du plus clair (faible) au plus foncé (forte). */
export const RAMPE_INCERTITUDE = [ '#F1E9F7', '#D7C2EA', '#B795D6', '#9466C0', '#7140A6', '#4F2384', '#2E0F5C' ] as const;

/**
 * Différence entre deux instants (comparaison, lot F6) : divergente, bleu (baisse) ↔ rouge (hausse) autour d'un
 * gris neutre (« pas de changement »), deux bras de même longueur. Distincte de la rampe de vitesse.
 */
export const RAMPE_DIFFERENCE = [ '#0B3C73', '#1E6FB8', '#8DB8DD', '#DDDBD6', '#E8A49B', '#C0392B', '#7A1F17' ] as const;

/** États (§17.4) : vert conforme / actif, orange avertissement / suspect, rouge important / muet. */
export const ETATS = { conforme: COULEURS.ok, avertissement: COULEURS.attention, important: COULEURS.alerte, neutre: COULEURS.neutre } as const;

/** Polices (§17.4) ; les fichiers de police ne sont pas embarqués : repli sur les polices système. */
export const POLICES = {
	texte: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
	titres: '"Inter Display", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
} as const;

/** Rôle (clé de COULEURS) de chaque variable CSS de couleur d'interface de theme.css. */
const ROLES_CSS: Record<string, keyof typeof COULEURS> = {
	'--encre': 'encre',
	'--encre-2': 'encre2',
	'--encre-3': 'encre3',
	'--fond': 'fond',
	'--panneau': 'panneau',
	'--accent': 'accent',
	'--accent-texte': 'accentTexte',
	'--sable': 'sable',
	'--sable-texte': 'sableTexte',
	'--trait': 'trait',
	'--ok': 'ok',
	'--ok-texte': 'okTexte',
	'--attention': 'attention',
	'--attention-texte': 'attentionTexte',
	'--alerte': 'alerte',
	'--alerte-texte': 'alerteTexte',
	'--attente': 'neutre',
};

/** Variables CSS de theme.css correspondant aux couleurs d'interface (contrôlé par charte.test.ts). */
export const VARIABLES_CSS: Record<string, string> = Object.fromEntries( Object.entries( ROLES_CSS ).map( ( [ v, k ] ) => [ v, COULEURS[ k ] ] ) );

/**
 * Thème sombre (UI v2) : mêmes rôles que COULEURS, déclinés sur fond nuit. La charte §17.4 reste la base (encre,
 * accent bleu ciel, sable, états vert / orange / rouge) ; les teintes sont éclaircies pour garder les contrastes AA
 * sur le fond et les panneaux sombres (contrôlé par charte.test.ts). Les rampes de données (vitesse, incertitude,
 * différence) ne changent pas : une couleur de donnée a le même sens dans les deux thèmes.
 */
export const COULEURS_SOMBRE: { [ K in keyof typeof COULEURS ]: string } = {
	encre: '#E4ECF2',
	encre2: '#BCCAD6',
	encre3: '#97A9B9',
	fond: '#0B1622',
	panneau: '#13212F',
	/** Accent des aplats (barre de navigation, boutons) : assez foncé pour un texte blanc (≥ 4,5:1). */
	accent: '#2A78C2',
	accentTexte: '#7DB9F0',
	sable: '#C9A46B',
	sableTexte: '#D9BC8C',
	trait: '#2A3D50',
	ok: '#3DAA6E',
	okTexte: '#72D29B',
	attention: '#E08A3A',
	attentionTexte: '#F2AA68',
	alerte: '#E25B4B',
	alerteTexte: '#F7958A',
	neutre: '#8496A6',
};

/** Couleurs d'interface d'un thème (graphiques ECharts, canevas). */
export function couleursTheme( t: 'light' | 'dark' ): { readonly [ K in keyof typeof COULEURS ]: string } {

	return t === 'dark' ? COULEURS_SOMBRE : COULEURS;

}

/** Variables CSS du thème sombre (bloc :root[data-theme="dark"] de theme.css, contrôlé par charte.test.ts). */
export const VARIABLES_CSS_SOMBRE: Record<string, string> = Object.fromEntries( Object.entries( ROLES_CSS ).map( ( [ v, k ] ) => [ v, COULEURS_SOMBRE[ k ] ] ) );

/** Luminance relative WCAG 2.1 d'une couleur #RRGGBB. */
export function luminance( hex: string ): number {

	const c = [ 1, 3, 5 ].map( ( k ) => parseInt( hex.slice( k, k + 2 ), 16 ) / 255 ).map( ( v ) => ( v <= 0.03928 ? v / 12.92 : ( ( v + 0.055 ) / 1.055 ) ** 2.4 ) );
	return 0.2126 * c[ 0 ] + 0.7152 * c[ 1 ] + 0.0722 * c[ 2 ];

}

/** Rapport de contraste WCAG 2.1 entre deux couleurs (1 à 21). */
export function contraste( a: string, b: string ): number {

	const x = luminance( a ), y = luminance( b );
	return ( Math.max( x, y ) + 0.05 ) / ( Math.min( x, y ) + 0.05 );

}
