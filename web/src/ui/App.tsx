// Coquille du tableau de bord : barre supérieure « en direct » (navigation à indicateur animé, horloge UTC,
// pastille d'état du calcul, nature des données, thème, palette de commandes), bandeau de fraîcheur, page (chargée
// à la demande, avec transition d'entrée et squelette pendant le chargement), notifications.

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent } from 'react';
import { useLatest, type EtatLatest } from './useLatest';
import { ROUTES, naviguer, useRoute, type PageId } from './routes';
import { texteBandeau } from '../domain/freshness';
import { SquelettePage } from './Squelette';
import { Toasts } from './toasts';
import { useNotifications } from './notifications';
import { Palette, commandes } from './Palette';
import { useTimes } from './instant';
import { basculerTheme, useChoixMouvement, useTheme } from './preferences';

// Pages chargées à la demande (import dynamique) : three.js (Exploration) et ECharts sortent du chargement
// initial ; chaque page est un morceau séparé, préchargé au survol du lien de navigation.
type PropsPage = { latest: EtatLatest };
const PAGES_MODULES: Record<PageId, () => Promise<{ default: ComponentType<PropsPage> }>> = {
	ensemble: () => import( '../pages/f3/Ensemble' ).then( ( m ) => ( { default: m.VueEnsemble } ) ),
	exploration: () => import( '../pages/Exploration' ).then( ( m ) => ( { default: m.Exploration } ) ),
	comparaison: () => import( '../pages/comparaison/Comparaison' ).then( ( m ) => ( { default: m.PageComparaison } ) ),
	fiabilite: () => import( '../pages/f3/Fiabilite' ).then( ( m ) => ( { default: m.PageFiabilite } ) ),
	eolien: () => import( '../pages/F4' ).then( ( m ) => ( { default: m.Eolien } ) ),
	alertes: () => import( '../pages/F4' ).then( ( m ) => ( { default: m.Alertes } ) ),
	modele: () => import( '../pages/f3/Modele' ).then( ( m ) => ( { default: m.PageModele } ) ),
};
const PAGES = Object.fromEntries( Object.entries( PAGES_MODULES ).map( ( [ k, f ] ) => [ k, lazy( f ) ] ) ) as unknown as Record<PageId, ComponentType<PropsPage>>;

/** Précharge le code d'une page (survol ou focus de son lien). */
export function prechargerPage( id: PageId ) { PAGES_MODULES[ id ]().catch( () => {} ); }

/** Pastille d'état du calcul : point pulsant « calcul en ligne », cerclé « calcul arrêté · dernier état ». */
function Pastille( { s }: { s: EtatLatest } ) {

	let cls = 'pill pill-wait', txt = 'connexion…', titre = 'État du calcul';
	if ( s.etat === 'erreur' ) { cls = 'pill pill-erreur'; txt = 'indisponible'; titre = `/v1/latest ${ s.message }`; }
	else if ( s.etat === 'ok' ) {

		const enLigne = s.latest.compute_status === 'online';
		cls = enLigne ? 'pill pill-live' : 'pill pill-down';
		txt = enLigne ? 'calcul en ligne' : 'calcul arrêté';
		titre = `Instantané ${ s.latest.snapshot_id } · modèle ${ s.latest.versions.model }`;

	}

	const detail = s.etat === 'ok' && s.latest.compute_status !== 'online' ? <span className="detail"> · dernier état</span> : null;
	return <span className={ cls } title={ titre } data-testid="status-pill"><span className="point" aria-hidden="true" />{ txt }{ detail }</span>;

}

const LIBELLE_NATURE: Record<string, string> = { test: 'test', synthetique: 'synthétique', reel: 'réel' };

/** Nature des données (versions.data_kind), affichée en permanence (contrat rév. 2, D15). */
function BadgeNature( { s }: { s: EtatLatest } ) {

	const kind = s.etat === 'ok' ? s.latest.versions.data_kind : null;
	const txt = kind ? `données : ${ LIBELLE_NATURE[ kind ] ?? kind }` : 'données : —';
	const titre = kind === 'test' ? 'Instantané de test : ce ne sont pas des résultats du modèle'
		: kind === 'synthetique' ? 'Données synthétiques (capteurs simulés)'
			: kind === 'reel' ? 'Données réelles (réseau de mesure)' : 'Nature des données inconnue';
	return <span className={ `badge-nature nature-${ kind ?? 'inconnue' }` } title={ titre } data-testid="data-kind">{ txt }</span>;

}

function Bandeau( { s }: { s: EtatLatest } ) {

	if ( s.etat !== 'ok' ) return null;
	const t = texteBandeau( s.latest );
	if ( ! t ) return null;
	return <div className="bandeau" role="status" data-testid="freshness-banner">{ t }</div>;

}

/** Heure UTC courante, qui tourne (les instantanés sont datés en UTC). */
export function texteHorloge( d: Date ): { heure: string; jour: string } {

	const p = ( n: number ) => String( n ).padStart( 2, '0' );
	return {
		heure: `${ p( d.getUTCHours() ) }:${ p( d.getUTCMinutes() ) }:${ p( d.getUTCSeconds() ) }`,
		jour: d.toLocaleDateString( 'fr-FR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short' } ),
	};

}

function Horloge() {

	const [ t, setT ] = useState( () => new Date() );
	useEffect( () => {

		let id = 0;
		const tic = () => { setT( new Date() ); id = window.setTimeout( tic, 1000 - ( Date.now() % 1000 ) ); };
		id = window.setTimeout( tic, 1000 - ( Date.now() % 1000 ) );
		return () => clearTimeout( id );

	}, [] );
	const h = texteHorloge( t );
	// Pas d'aria-live : une annonce par seconde serait insupportable ; l'heure reste lisible au survol.
	return <span className="horloge" title="Heure UTC (référence des instantanés)" data-testid="horloge-utc"><b>{ h.heure }</b>{ h.jour } · UTC</span>;

}

function BasculeTheme() {

	const theme = useTheme();
	const sombre = theme === 'dark';
	return (
		<button type="button" className="bouton-icone bascule-theme" data-testid="bascule-theme"
			aria-label={ sombre ? 'Passer au thème clair' : 'Passer au thème sombre' } title={ sombre ? 'Thème clair' : 'Thème sombre' }
			onClick={ ( e: MouseEvent ) => basculerTheme( { x: e.clientX, y: e.clientY } ) }>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<mask id="masque-astre"><rect width="24" height="24" fill="#fff" /><circle className="masque-lune" cx="17" cy="7" r="6" fill="#000" /></mask>
				<circle className="astre" cx="12" cy="12" r="5.2" fill="currentColor" mask="url(#masque-astre)" />
				<g className="rayons" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
					{ [ 0, 45, 90, 135, 180, 225, 270, 315 ].map( ( a ) => <line key={ a } x1="12" y1="2.2" x2="12" y2="4.2" transform={ `rotate(${ a } 12 12)` } /> ) }
				</g>
			</svg>
		</button>
	);

}

/** Navigation : pilule de l'onglet actif qui glisse d'un lien à l'autre. */
function Navigation( { actif }: { actif: PageId } ) {

	const nav = useRef<HTMLElement>( null );
	const [ pos, setPos ] = useState<{ x: number; w: number } | null>( null );
	const mesurer = useCallback( () => {

		const a = nav.current?.querySelector<HTMLAnchorElement>( 'a.actif' );
		if ( a ) setPos( { x: a.offsetLeft, w: a.offsetWidth } );

	}, [] );
	useLayoutEffect( mesurer, [ actif, mesurer ] );
	useEffect( () => {

		if ( ! nav.current || typeof ResizeObserver === 'undefined' ) return;
		const ro = new ResizeObserver( mesurer );
		ro.observe( nav.current );
		document.fonts?.ready.then( mesurer ).catch( () => {} );
		return () => ro.disconnect();

	}, [ mesurer ] );

	return (
		<nav className="nav" aria-label="Pages du tableau de bord" ref={ nav }>
			<span className="nav-indicateur" aria-hidden="true" style={ pos ? { transform: `translateX(${ pos.x }px)`, width: pos.w } : { opacity: 0 } } />
			{ ROUTES.map( ( r ) => (
				<a
					key={ r.id }
					href={ r.chemin }
					className={ r.id === actif ? 'actif' : undefined }
					aria-current={ r.id === actif ? 'page' : undefined }
					onMouseEnter={ () => prechargerPage( r.id ) }
					onFocus={ () => prechargerPage( r.id ) }
					onClick={ ( e ) => { if ( e.button === 0 && ! e.metaKey && ! e.ctrlKey ) { e.preventDefault(); naviguer( r.chemin ); } } }
				>{ r.titre }</a>
			) ) }
		</nav>
	);

}

export function App() {

	const route = useRoute();
	const latest = useLatest();
	const theme = useTheme();
	const mouvement = useChoixMouvement();
	const [ palette, setPalette ] = useState( false );
	const latestId = latest.etat === 'ok' ? latest.latest.snapshot_id : null;
	const times = useTimes( palette ? latestId : null );
	useNotifications( latest );

	// Ctrl+K / ⌘K : palette de commandes (partout, même dans un champ).
	useEffect( () => {

		const f = ( e: KeyboardEvent ) => {

			if ( ( e.ctrlKey || e.metaKey ) && ! e.altKey && e.key.toLowerCase() === 'k' ) { e.preventDefault(); setPalette( ( o ) => ! o ); }

		};
		addEventListener( 'keydown', f );
		return () => removeEventListener( 'keydown', f );

	}, [] );

	const cmds = useMemo( () => commandes( { page: route.id, theme, mouvement, instants: times.etat === 'ok' ? times.items : null, latestId } ),
		[ route.id, theme, mouvement, times, latestId ] );
	const Page = PAGES[ route.id ];

	return (
		<div className="app">
			<header className="topbar">
				<div className="marque">
					<span className="logo" aria-hidden="true" />
					<span className="titre">ATOM-AI <span className="sep">·</span> <span className="sous-titre">Vent 3D</span></span>
				</div>
				<Navigation actif={ route.id } />
				<div className="barre-droite">
					<Horloge />
					<BadgeNature s={ latest } />
					<Pastille s={ latest } />
					<button type="button" className="bouton-icone" onClick={ () => setPalette( true ) } aria-label="Palette de commandes (Ctrl+K)" title="Palette de commandes" data-testid="ouvrir-palette">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
						<span className="kbd">Ctrl K</span>
					</button>
					<BasculeTheme />
				</div>
			</header>
			<Bandeau s={ latest } />
			<main className="page">
				<div className="page-transition" key={ route.id }>
					<Suspense fallback={ <SquelettePage /> }>
						<Page latest={ latest } />
					</Suspense>
				</div>
			</main>
			<Palette ouverte={ palette } onFermer={ () => setPalette( false ) } cmds={ cmds } />
			<Toasts />
		</div>
	);

}
