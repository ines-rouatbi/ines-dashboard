// Page « Exploration 3D » (lot F2) : scène three.js (scene/viz.ts) sur les données /v1 (contrat v1 rév. 2).
//
// Données : /v1/latest et /v1/times (frise), /v1/snapshots/{id}, /v1/meta/{sha8} et /v1/terrain/{sha8}
// (grille, relief du modèle de l'instantané), /v1/fields/{id}/{niveau}/{var} (en cache par instantané),
// /v1/stations et /v1/wind-farm (couches), /v1/column (profil au clic, calculé par le front).
//
// Plan affiché : par défaut à 120 m AU-DESSUS DU SOL, calculé par colonne avec le relief du modèle
// (domain/hauteurSolScene.ts, D6) ; en option, un niveau publié AU-DESSUS DE LA MER. Toute ressource absente
// s'affiche « indisponible » ou « non disponible » ; aucune donnée de démo, jamais 0 pour l'inconnu.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, CacheChamps, libelleErreur, type FieldVar, type Meta, type Snapshot, type Station, type TimeItem, type Turbine } from '../data';
import { domaineDepuisMeta, noeudProche, positionNoeud, type Domaine } from '../domain/field';
import { profilDepuisColonne, type ProfilCalcule } from '../domain/profile';
import { capteurProche, type CapteurProche } from '../domain/capteurs';
import { latLon } from '../domain/geo';
import { cardinal, dirAffichee } from '../domain/wind';
import { LIBELLE_CLASSE } from '../domain/fiabilite';
import { moyenneMax, niveauxUtiles, planHauteurSol } from '../domain/hauteurSolScene';
import { bilineaireTolerante, lignesDeCourant, type Lignes } from '../domain/lignes';
import { echelle as calculerEchelle, VARIABLE_COLORATION, type Coloration, type Echelle } from '../domain/palettes';
import { libelleDistance } from '../domain/maillage';
import { Viz, type PickResult, type Repere, type Visibilite } from '../scene/viz';
import { tamponCoupeH, tamponCoupeV, tamponLignes, type AxeCoupe, type Grille, type Surface } from '../scene/tampons';
import { brancherScene, signalerEchec, signalerPremierRendu, type AtomEtat, type AtomPick, type AtomReglages } from '../scene/hook';
import { ProfileChart } from '../ui/ProfileChart';
import { Legende } from '../ui/Legende';
import { Frise } from '../ui/Frise';
import { CarteSituation } from '../ui/CarteSituation';
import type { EtatLatest } from '../ui/useLatest';

// Caches partagés : ils survivent à la navigation entre les pages.
const champs = new CacheChamps( api );
const modeles = new Map<string, Promise<Modele>>();
const parInstantane = new Map<string, Promise<unknown>>();

/** Lignes de courant visées selon la densité choisie (décimation, V3D10). */
const DENSITES_LIGNES = [ 150, 300, 600, 1200 ] as const;
const H_SOL_MAX = 1000;
const REJEU_MS = 1500;

const fmt = ( n: number | null | undefined, d = 0 ) =>
	n == null || ! Number.isFinite( n ) ? '—' : n.toLocaleString( 'fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d } );
const nd = 'non disponible';

type Chargement<T> = { etat: 'attente' } | { etat: 'ok'; val: T } | { etat: 'erreur'; message: string };

interface Modele { sha8: string; meta: Meta; dom: Domaine; terrain: Float32Array; zMin: number; zMax: number; grille: Grille }

type Reglages = AtomReglages;

interface DonneesPlan {
	cle: string;
	surface: Surface;
	u: Float32Array;
	v: Float32Array;
	speed: Float32Array;
	/** Variable de coloration (null si elle n'est pas publiée). */
	val: Float32Array | null;
	lignes: Lignes;
	stats: { min: number | null; moyenne: number | null; max: number | null; valides: number; noeuds: number };
}

interface DonneesCoupeV { cle: string; axe: AxeCoupe; indice: number; niveaux: ( Float32Array | undefined )[]; valeurs: Float32Array }

interface ProfilAffiche extends ProfilCalcule { capteur: CapteurProche | null; lat: number; lon: number }

interface Attente { cle: string; ok: () => void; ko: ( e: unknown ) => void }

function memo<T>( cle: string, f: () => Promise<T> ): Promise<T> {

	let p = parInstantane.get( cle ) as Promise<T> | undefined;
	if ( ! p ) { p = f(); p.catch( () => parInstantane.delete( cle ) ); parInstantane.set( cle, p ); }
	return p;

}

function chargerModele( sha8: string ): Promise<Modele> {

	let p = modeles.get( sha8 );
	if ( ! p ) {

		p = ( async () => {

			const meta = await api.meta( sha8 );
			const terrain = await api.terrain( meta.terrain.href );
			const dom = domaineDepuisMeta( meta );
			if ( terrain.length !== dom.nx * dom.ny ) throw new Error( `relief de ${ terrain.length } valeurs, ${ dom.nx * dom.ny } attendues` );
			let zMin = Infinity, zMax = - Infinity;
			for ( const z of terrain ) { if ( z < zMin ) zMin = z; if ( z > zMax ) zMax = z; }
			return { sha8, meta, dom, terrain, zMin, zMax, grille: { nx: dom.nx, ny: dom.ny, dx: dom.dx, dy: dom.dy, terrain, altitudes: dom.altitudes, minAgl: dom.minAgl } };

		} )();
		p.catch( () => modeles.delete( sha8 ) );
		modeles.set( sha8, p );

	}

	return p;

}

/** Indice du niveau le plus proche d'une altitude (m au-dessus de la mer). */
function niveauProche( altitudes: number[], m: number ): number {

	let best = 0;
	for ( let k = 1; k < altitudes.length; k ++ ) if ( Math.abs( altitudes[ k ] - m ) < Math.abs( altitudes[ best ] - m ) ) best = k;
	return best;

}

function cleRendu( id: string | null, r: Reglages ): string {

	return [ id, r.mode, r.mode === 'sol' ? r.hauteurSol : r.niveau, r.coloration, r.densite, r.coupeH ? 'h' : '-', r.coupeV ?? '-', r.coupeV ? r.coupeVPos : '-' ].join( '|' );

}

async function chargerPlan( id: string, m: Modele, r: Reglages, cle: string ): Promise<DonneesPlan> {

	const { dom, meta } = m;
	const variable = VARIABLE_COLORATION[ r.coloration ];
	const publie = meta.fields.includes( variable );
	const vars: FieldVar[] = [ 'u', 'v', 'speed' ];
	if ( publie && variable !== 'speed' ) vars.push( variable );
	const lire = ( k: number, x: FieldVar ) => champs.champ( id, k, x, meta.encoding[ x ]?.scale );
	let surface: Surface;
	const plans: Partial<Record<FieldVar, Float32Array>> = {};
	if ( r.mode === 'mer' ) {

		const k = Math.min( dom.nz - 1, Math.max( 0, r.niveau ) );
		surface = { mode: 'mer', z: dom.altitudes[ k ] };
		await Promise.all( vars.map( async ( x ) => { plans[ x ] = await lire( k, x ); } ) );

	} else {

		surface = { mode: 'sol', h: r.hauteurSol };
		const ks = niveauxUtiles( dom.altitudes, m.zMin, m.zMax, r.hauteurSol, dom.minAgl );
		const charges = new Map<string, Float32Array>();
		await Promise.all( ks.flatMap( ( k ) => vars.map( async ( x ) => { charges.set( `${ k }/${ x }`, await lire( k, x ) ); } ) ) );
		for ( const x of vars ) plans[ x ] = planHauteurSol( { altitudes: dom.altitudes, terrain: m.terrain, minAgl: dom.minAgl, h: r.hauteurSol, niveau: ( k ) => charges.get( `${ k }/${ x }` ) } );

	}

	const u = plans.u!, v = plans.v!, speed = plans.speed!;
	const val = publie ? plans[ variable ]! : null;
	const pas = Math.max( 1, Math.round( Math.sqrt( dom.nx * dom.ny / DENSITES_LIGNES[ Math.min( DENSITES_LIGNES.length - 1, Math.max( 0, r.densite ) ) ] ) ) );
	const lignes = lignesDeCourant( { nx: dom.nx, ny: dom.ny, dx: dom.dx, dy: dom.dy, u, v }, { pas, maxPas: Math.max( 40, 8 * pas ) } );
	const mm = moyenneMax( speed );
	let min: number | null = null;
	for ( const s of speed ) if ( ! Number.isNaN( s ) && ( min == null || s < min ) ) min = s;
	return { cle, surface, u, v, speed, val, lignes, stats: { min, moyenne: mm.moyenne, max: mm.max, valides: mm.n, noeuds: speed.length } };

}

async function chargerCoupeV( id: string, m: Modele, r: Reglages, cle: string ): Promise<DonneesCoupeV> {

	const variable = VARIABLE_COLORATION[ r.coloration ], axe = r.coupeV!;
	const { dom, meta } = m;
	const indice = Math.round( Math.min( 1, Math.max( 0, r.coupeVPos ) ) * ( ( axe === 'est-ouest' ? dom.ny : dom.nx ) - 1 ) );
	const niveaux = meta.fields.includes( variable )
		? await Promise.all( dom.altitudes.map( ( _, k ) => champs.champ( id, k, variable, meta.encoding[ variable ]?.scale ) ) )
		: dom.altitudes.map( () => undefined );
	const ncol = axe === 'est-ouest' ? dom.nx : dom.ny, valeurs = new Float32Array( ncol * dom.nz ).fill( NaN );
	niveaux.forEach( ( f, k ) => {

		if ( f ) for ( let c = 0; c < ncol; c ++ ) valeurs[ k * ncol + c ] = f[ axe === 'est-ouest' ? indice * dom.nx + c : c * dom.nx + indice ];

	} );
	return { cle, axe, indice, niveaux, valeurs };

}

const COULEUR_ETAT: Record<string, [ number, number, number ]> = {
	active: [ 0.30, 0.75, 0.45 ], suspecte: [ 0.95, 0.80, 0.25 ], derive: [ 0.95, 0.50, 0.15 ], muette: [ 0.60, 0.62, 0.66 ], exclue: [ 0.80, 0.15, 0.15 ],
};
const LIBELLE_ETAT: Record<string, string> = { active: 'actif', suspecte: 'suspect', derive: 'en dérive', muette: 'muet', exclue: 'exclu' };

function surfaceEn( m: Modele, s: Surface, x: number, y: number ): number {

	return s.mode === 'mer' ? s.z : bilineaireTolerante( m.terrain, m.dom.nx, m.dom.ny, x / m.dom.dx, y / m.dom.dy ) + s.h;

}

function visibilite( r: Reglages ): Visibilite {

	return { relief: r.relief, lignes: r.lignes, coupeH: r.coupeH, coupeV: r.coupeV != null, stations: r.stations, eoliennes: r.eoliennes };

}

function fusionEchelles( a: Echelle | null, b: Echelle | null ): Echelle | null {

	if ( ! a || ! b ) return a ?? b;
	return { coloration: a.coloration, min: Math.min( a.min, b.min ), max: Math.max( a.max, b.max ) };

}

const REGLAGES_INITIAUX: Reglages = {
	mode: 'sol', hauteurSol: 120, niveau: - 1, exageration: 5, coloration: 'vitesse',
	lignes: true, densite: 2, animation: true, coupeH: false, coupeV: null, coupeVPos: 0.5,
	relief: true, stations: true, eoliennes: true, instantane: null,
};

export function Exploration( { latest }: { latest: EtatLatest } ) {

	const canvasRef = useRef<HTMLCanvasElement>( null );
	const vizRef = useRef<Viz | null>( null );
	const attentes = useRef<Attente[]>( [] );
	const premierRendu = useRef( false );

	const [ r, setR ] = useState<Reglages>( REGLAGES_INITIAUX );
	const rRef = useRef( r );
	rRef.current = r;
	/** Clé (cleRendu) de la dernière scène effectivement dessinée. */
	const renduRef = useRef<string | null>( null );
	const [ modele, setModele ] = useState<Chargement<Modele>>( { etat: 'attente' } );
	const [ plan, setPlan ] = useState<Chargement<DonneesPlan>>( { etat: 'attente' } );
	const [ coupeV, setCoupeV ] = useState<Chargement<DonneesCoupeV> | null>( null );
	const [ snapshot, setSnapshot ] = useState<Chargement<Snapshot>>( { etat: 'attente' } );
	const [ times, setTimes ] = useState<Chargement<TimeItem[]>>( { etat: 'attente' } );
	const [ couches, setCouches ] = useState<{ stations: Station[] | null; turbines: Turbine[] | null; erreurs: string[] }>( { stations: null, turbines: null, erreurs: [] } );
	const [ noeud, setNoeud ] = useState<{ i: number; j: number } | null>( null );
	const [ profil, setProfil ] = useState<{ cle: string; res: Chargement<ProfilAffiche> } | null>( null );
	const [ renduCle, setRenduCle ] = useState<string | null>( null );
	const [ lecture, setLecture ] = useState( false );

	const latestId = latest.etat === 'ok' ? latest.latest.snapshot_id : null;
	const snapshotId = r.instantane ?? latestId;
	const sha8 = snapshotId ? snapshotId.slice( - 8 ) : null;
	const m = modele.etat === 'ok' && modele.val.sha8 === sha8 ? modele.val : null;
	const snap = snapshot.etat === 'ok' && snapshot.val.snapshot_id === snapshotId ? snapshot.val : null;
	const cle = cleRendu( snapshotId, r );

	/** Applique des réglages ; la promesse est résolue quand la scène les montre. */
	const regler = useCallback( ( p: Partial<Reglages> ): Promise<void> => {

		const suivant = { ...rRef.current, ...p };
		rRef.current = suivant;
		setR( suivant );
		const viz = vizRef.current;
		const c = cleRendu( suivant.instantane ?? latestId, suivant );
		if ( ! viz || c === renduRef.current ) return viz ? viz.apresRendu() : Promise.resolve();
		return new Promise<void>( ( ok, ko ) => attentes.current.push( { cle: c, ok, ko } ) );

	}, [ latestId ] );

	const reglerAttentes = useCallback( ( c: string, erreur?: unknown ) => {

		const courante = cleRendu( rRef.current.instantane ?? latestId, rRef.current );
		const reste: Attente[] = [];
		for ( const a of attentes.current ) {

			if ( a.cle === c ) { if ( erreur ) a.ko( erreur ); else a.ok(); }
			else if ( a.cle !== courante ) a.ok(); // réglage dépassé par un plus récent
			else reste.push( a );

		}

		attentes.current = reste;

	}, [ latestId ] );

	// 1. Instantané (réseau, points déclarés, indicateurs).
	useEffect( () => {

		if ( ! snapshotId ) return;
		const ctl = new AbortController();
		setSnapshot( { etat: 'attente' } );
		api.snapshot( snapshotId, ctl.signal ).then(
			( val ) => setSnapshot( { etat: 'ok', val } ),
			( e ) => { if ( e.name !== 'AbortError' ) setSnapshot( { etat: 'erreur', message: libelleErreur( e ) } ); },
		);
		return () => ctl.abort();

	}, [ snapshotId ] );

	// 2. Frise : instantanés publiés (/v1/times, du plus récent au plus ancien ; affichés dans l'ordre du temps).
	useEffect( () => {

		if ( ! latestId ) return;
		const ctl = new AbortController();
		api.times( {}, ctl.signal ).then(
			( t ) => setTimes( { etat: 'ok', val: [ ...t.items ].sort( ( a, b ) => a.valid_time.localeCompare( b.valid_time ) ) } ),
			( e ) => { if ( e.name !== 'AbortError' ) setTimes( { etat: 'erreur', message: libelleErreur( e ) } ); },
		);
		return () => ctl.abort();

	}, [ latestId ] );

	// 3. Modèle de l'instantané : meta et relief (jamais de grille codée en dur).
	useEffect( () => {

		if ( ! sha8 ) return;
		let actif = true;
		chargerModele( sha8 ).then(
			( val ) => {

				if ( ! actif ) return;
				setModele( { etat: 'ok', val } );
				if ( rRef.current.niveau < 0 ) {

					const def = val.dom.altitudes.findIndex( ( a ) => a >= 650 );
					regler( { niveau: def >= 0 ? def : val.dom.nz - 1 } );

				}

			},
			( e ) => {

				if ( ! actif ) return;
				setModele( { etat: 'erreur', message: libelleErreur( e ) } );
				signalerEchec( `/v1/meta/${ sha8 } ou /v1/terrain ${ libelleErreur( e ) }`, ! premierRendu.current );

			},
		);
		return () => { actif = false; };

	}, [ sha8, regler ] );

	useEffect( () => { if ( latest.etat === 'erreur' ) signalerEchec( `/v1/latest ${ latest.message }`, true ); }, [ latest ] );

	// 4. Création / libération de la scène.
	useEffect( () => {

		const viz = new Viz( canvasRef.current!, { onPick: ( p ) => { surPick.current( p ); } } );
		vizRef.current = viz;
		return () => { viz.dispose(); vizRef.current = null; renduRef.current = null; };

	}, [] );

	// 5. Domaine dans la scène (relief, socle, nord, échelle).
	useEffect( () => {

		if ( ! m || ! vizRef.current ) return;
		vizRef.current.setDomaine( {
			nx: m.dom.nx, ny: m.dom.ny, dx: m.dom.dx, dy: m.dom.dy, sizeX: m.dom.sizeX, sizeY: m.dom.sizeY,
			terrain: m.terrain, zHaut: m.dom.altitudes[ m.dom.nz - 1 ], rotationDeg: m.meta.georef.rotation_deg,
		} );
		renduRef.current = null;

	}, [ m ] );

	// 6. Données du plan affiché (mode sol ou mer), puis lignes de courant.
	const clePlan = [ snapshotId, r.mode, r.mode === 'sol' ? r.hauteurSol : r.niveau, r.coloration, r.densite ].join( '|' );
	useEffect( () => {

		if ( ! m || ! snapshotId || ( r.mode === 'mer' && r.niveau < 0 ) ) return;
		let actif = true;
		setPlan( ( p ) => ( p.etat === 'ok' ? p : { etat: 'attente' } ) );
		chargerPlan( snapshotId, m, rRef.current, clePlan ).then(
			( val ) => { if ( actif ) setPlan( { etat: 'ok', val } ); },
			( e ) => {

				if ( ! actif ) return;
				setPlan( { etat: 'erreur', message: libelleErreur( e ) } );
				signalerEchec( `champs du plan ${ libelleErreur( e ) }`, ! premierRendu.current );
				reglerAttentes( cleRendu( snapshotId, rRef.current ), e );

			},
		);
		return () => { actif = false; };

	}, [ m, snapshotId, clePlan, reglerAttentes ] ); // eslint-disable-line react-hooks/exhaustive-deps

	// 7. Coupe verticale (tous les niveaux de la variable de coloration, le long d'une ligne de nœuds).
	const cleCoupe = r.coupeV ? [ snapshotId, r.coupeV, r.coupeVPos, r.coloration ].join( '|' ) : null;
	useEffect( () => {

		if ( ! m || ! snapshotId || ! cleCoupe ) { setCoupeV( null ); return; }
		let actif = true;
		setCoupeV( { etat: 'attente' } );
		chargerCoupeV( snapshotId, m, rRef.current, cleCoupe ).then(
			( val ) => { if ( actif ) setCoupeV( { etat: 'ok', val } ); },
			( e ) => { if ( actif ) setCoupeV( { etat: 'erreur', message: libelleErreur( e ) } ); },
		);
		return () => { actif = false; };

	}, [ m, snapshotId, cleCoupe ] );

	// 8. Échelle de couleur commune au plan et à la coupe verticale.
	const planOk = plan.etat === 'ok' && plan.val.cle === clePlan ? plan.val : null;
	const coupeOk = coupeV?.etat === 'ok' && coupeV.val.cle === cleCoupe ? coupeV.val : null;
	const ech = useMemo( () => {

		const c: Coloration = r.coloration;
		const a = planOk?.val ? calculerEchelle( c, planOk.val ) : null;
		const b = coupeOk ? calculerEchelle( c, coupeOk.valeurs ) : null;
		return fusionEchelles( a, b );

	}, [ planOk, coupeOk, r.coloration ] );

	// 9. Rendu : tampons des lignes et des coupes, puis attente de l'image dessinée.
	useEffect( () => {

		const viz = vizRef.current;
		if ( ! viz || ! m || ! planOk ) return;
		if ( r.coupeV && ! coupeOk && coupeV?.etat !== 'erreur' ) return; // la coupe arrive
		viz.setLignes( tamponLignes( m.grille, planOk.surface, planOk.lignes, planOk.val, ech ) );
		viz.setCoupeH( r.coupeH ? tamponCoupeH( m.grille, planOk.surface, planOk.u, planOk.val, ech ) : null );
		viz.setCoupeV( coupeOk ? tamponCoupeV( m.grille, coupeOk.axe, coupeOk.indice, ( k ) => coupeOk.niveaux[ k ], ech ) : null );
		// Le clic vise la surface affichée (jamais sous le relief), à défaut le relief.
		const s = planOk.surface;
		viz.setSurfacePick( ( x, y ) => Math.max( surfaceEn( m, s, x, y ), bilineaireTolerante( m.terrain, m.dom.nx, m.dom.ny, x / m.dom.dx, y / m.dom.dy ) ) );
		let actif = true;
		const c = cle;
		viz.apresRendu().then( () => {

			if ( ! actif ) return;
			renduRef.current = c;
			setRenduCle( c );
			premierRendu.current = true;
			signalerPremierRendu();
			reglerAttentes( c );

		} );
		return () => { actif = false; };

	}, [ m, planOk, coupeOk, coupeV, ech, r.coupeH, r.coupeV, cle, reglerAttentes ] );

	// 10. Couches capteurs et éoliennes (+ sites déclarés).
	useEffect( () => {

		if ( ! m || ! snapshotId || ! snap ) return;
		let actif = true;
		const erreurs: string[] = [];
		Promise.all( [
			memo( `st/${ snapshotId }`, () => api.stations( snapshotId ) ).then( ( s ) => s.items, ( e ) => { erreurs.push( `capteurs ${ libelleErreur( e ) }` ); return null; } ),
			snap.assets.wind_farm ? memo( `wf/${ snapshotId }`, () => api.windFarm( snapshotId ) ).then( ( w ) => w.turbines, ( e ) => { erreurs.push( `éoliennes ${ libelleErreur( e ) }` ); return null; } ) : Promise.resolve( null ),
		] ).then( ( [ stations, turbines ] ) => {

			if ( ! actif || ! vizRef.current ) return;
			const sol = ( x: number, y: number ) => bilineaireTolerante( m.terrain, m.dom.nx, m.dom.ny, ( x - m.dom.x0 ) / m.dom.dx, ( y - m.dom.y0 ) / m.dom.dy );
			const rep = ( x: number, y: number, h: number, couleur: [ number, number, number ] ): Repere => ( { x: x - m.dom.x0, y: y - m.dom.y0, zSol: sol( x, y ), zHaut: sol( x, y ) + h, couleur } );
			vizRef.current.setStations( ( stations ?? [] ).map( ( s ) => rep( s.x_m, s.y_m, s.height_agl_m, COULEUR_ETAT[ s.state ] ?? [ 1, 1, 1 ] ) ) );
			const sites = snap.points.filter( ( p ) => p.kind !== 'eolienne' ).map( ( p ) => rep( p.x_m, p.y_m, 80, [ 0.75, 0.55, 0.95 ] ) );
			vizRef.current.setEoliennes( [ ...( turbines ?? [] ).map( ( t ) => rep( t.x_m, t.y_m, t.hub_agl_m, [ 0.96, 0.97, 0.98 ] ) ), ...sites ] );
			vizRef.current.setVisibilite( visibilite( rRef.current ) );
			setCouches( { stations, turbines, erreurs } );

		} );
		return () => { actif = false; };

	}, [ m, snapshotId, snap ] );

	// 11. Réglages sans rechargement : visibilité, exagération, animation.
	useEffect( () => { vizRef.current?.setVisibilite( visibilite( r ) ); }, [ r, m, couches ] );
	useEffect( () => { vizRef.current?.setExageration( r.exageration ); }, [ r.exageration, m ] );
	useEffect( () => { vizRef.current?.setAnimation( r.animation ); }, [ r.animation ] );

	// 12. Clic → nœud natif le plus proche, marqueur, profil (une requête /v1/column).
	const surPick = useRef<( p: PickResult ) => AtomPick | null>( () => null );
	const dernierPick = useRef<AtomPick | null>( null );
	surPick.current = ( p ) => {

		if ( ! m ) return null;
		const { i, j } = noeudProche( m.dom, m.dom.x0 + p.x, m.dom.y0 + p.y );
		const { x_m, y_m } = positionNoeud( m.dom, i, j );
		const s = planOk?.surface ?? { mode: 'sol', h: rRef.current.hauteurSol };
		vizRef.current?.showMarker( x_m - m.dom.x0, y_m - m.dom.y0, surfaceEn( m, s, x_m - m.dom.x0, y_m - m.dom.y0 ) );
		setNoeud( { i, j } );
		dernierPick.current = { ix: i, iy: j, fx: p.fx, fy: p.fy, i, j, x_m, y_m };
		return dernierPick.current;

	};

	useEffect( () => {

		if ( ! noeud || ! snapshotId || ! m ) return;
		const c = `${ snapshotId }/${ noeud.i }/${ noeud.j }`;
		setProfil( { cle: c, res: { etat: 'attente' } } );
		( async () => {

			const p = profilDepuisColonne( await api.column( snapshotId, noeud.i, noeud.j ) );
			const reseau = snap?.network.kind ?? null;
			const st = reseau ? await memo( `st/${ snapshotId }`, () => api.stations( snapshotId ) ).then( ( s ) => s.items, () => null ) : null;
			const capteur = reseau && st ? capteurProche( reseau, st, p.x_m, p.y_m, m.dom ) : null;
			return { ...p, capteur, ...latLon( m.meta, p.x_m, p.y_m ) };

		} )().then(
			( val ) => setProfil( ( cur ) => ( cur?.cle === c ? { cle: c, res: { etat: 'ok', val } } : cur ) ),
			( e ) => setProfil( ( cur ) => ( cur?.cle === c ? { cle: c, res: { etat: 'erreur', message: libelleErreur( e ) } } : cur ) ),
		);

	}, [ noeud, snapshotId, m, snap ] );

	// 13. Rejeu : instantané suivant une fois le courant rendu.
	const items = times.etat === 'ok' ? times.val : null;
	useEffect( () => {

		if ( ! lecture || ! items || renduCle !== cle ) return;
		const k = items.findIndex( ( x ) => x.snapshot_id === snapshotId );
		const suivant = items[ k + 1 ];
		const t = setTimeout( () => {

			if ( ! suivant ) { setLecture( false ); return; }
			regler( { instantane: suivant.snapshot_id === latestId ? null : suivant.snapshot_id } );

		}, REJEU_MS );
		return () => clearTimeout( t );

	}, [ lecture, items, renduCle, cle, snapshotId, latestId, regler ] );

	const lancerRejeu = ( on: boolean ) => {

		if ( on && items && items.length > 1 ) {

			// Départ du plus ancien si l'on est au bout de la frise.
			const k = items.findIndex( ( x ) => x.snapshot_id === snapshotId );
			if ( k < 0 || k === items.length - 1 ) regler( { instantane: items[ 0 ].snapshot_id === latestId ? null : items[ 0 ].snapshot_id } );

		}

		setLecture( on );

	};

	// 14. Crochet de test window.__atom.
	const etatRef = useRef<() => AtomEtat>( () => { throw new Error( 'scène non prête' ); } );
	etatRef.current = () => {

		const viz = vizRef.current;
		return {
			reglages: { ...rRef.current },
			snapshot_id: snapshotId,
			altitude_m: r.mode === 'mer' && m && r.niveau >= 0 ? m.dom.altitudes[ r.niveau ] : null,
			noeuds_valides: planOk?.stats.valides ?? 0,
			noeuds: planOk?.stats.noeuds ?? 0,
			vitesse: { min: planOk?.stats.min ?? null, moyenne: planOk?.stats.moyenne ?? null, max: planOk?.stats.max ?? null },
			legende: ech ? { min: ech.min, max: ech.max, graduations: [] } : null,
			lignes: { lignes: planOk?.lignes.lignes ?? 0, segments: viz?.segments ?? 0 },
			coupe_h_triangles: viz?.trianglesCoupeH ?? 0,
			coupe_v_triangles: viz?.trianglesCoupeV ?? 0,
			stations: viz?.nbStations ?? 0,
			eoliennes: viz?.nbEoliennes ?? 0,
			instantanes: items?.length ?? 0,
			exageration: viz?.exageration ?? r.exageration,
			fps: viz?.fps() ?? null,
		};

	};

	useEffect( () => {

		const viz = vizRef.current;
		if ( ! viz || ! m ) return;
		return brancherScene( {
			viz,
			setAltitude: ( alt ) => regler( { mode: 'mer', niveau: niveauProche( m.dom.altitudes, alt ) } ),
			setHauteurSol: ( h ) => regler( { mode: 'sol', hauteurSol: h } ),
			regler,
			etat: () => etatRef.current(),
			pick: async ( x, y ) => {

				// (x, y) : pixels CSS relatifs au coin haut-gauche du canevas.
				const rc = viz.canvas.getBoundingClientRect();
				dernierPick.current = null;
				const p = viz.pickAt( rc.left + x, rc.top + y ); // déclenche onPick (marqueur, profil)
				await viz.apresRendu();
				return p ? dernierPick.current : null;

			},
		} );

	}, [ m, regler ] );

	// --- Rendu ------------------------------------------------------------------------------
	const dom = m?.dom ?? null;
	const altitudes = dom?.altitudes ?? [];
	const georef = m?.meta.georef ?? null;
	const nd1 = ( x: number | null ) => ( x == null ? nd : fmt( x, 1 ) );
	const variablePubliee = m ? m.meta.fields.includes( VARIABLE_COLORATION[ r.coloration ] ) : true;
	const libellePlan = r.mode === 'sol' ? `${ fmt( r.hauteurSol ) } m au-dessus du sol` : r.niveau >= 0 && dom ? `${ fmt( altitudes[ r.niveau ] ) } m au-dessus de la mer` : '—';

	let messageScene: string | null = null;
	if ( modele.etat === 'erreur' ) messageScene = `Grille ou relief ${ modele.message }`;
	else if ( latest.etat === 'erreur' ) messageScene = `Dernier instantané ${ latest.message }`;
	else if ( plan.etat === 'erreur' ) messageScene = `Champ ${ plan.message }`;
	else if ( ! m || latest.etat === 'attente' || plan.etat === 'attente' ) messageScene = 'chargement…';
	else if ( planOk && planOk.stats.valides === 0 ) messageScene = `Aucun nœud à ${ libellePlan } (sous le relief ou sous ${ fmt( dom?.minAgl ) } m) : non disponible`;

	const posCoupe = dom && r.coupeV ? ( r.coupeV === 'est-ouest' ? `y = ${ libelleDistance( r.coupeVPos * dom.sizeY ) }` : `x = ${ libelleDistance( r.coupeVPos * dom.sizeX ) }` ) : '';

	return (
		<div className="exploration">
			<aside className="panneau commandes">
				<h2>Commandes</h2>

				<fieldset className="champ">
					<legend>Plan affiché</legend>
					<label className="en-ligne"><input type="radio" name="mode" checked={ r.mode === 'sol' } onChange={ () => regler( { mode: 'sol' } ) } /> Hauteur au-dessus du sol</label>
					<label className="en-ligne"><input type="radio" name="mode" checked={ r.mode === 'mer' } onChange={ () => regler( { mode: 'mer' } ) } /> Altitude (au-dessus de la mer)</label>
				</fieldset>

				{ r.mode === 'sol' ? (
					<label className="champ">
						<span>Hauteur <b className="num" data-testid="altitude-label">{ fmt( r.hauteurSol ) } m</b> <span className="muet">au-dessus du sol</span></span>
						<input type="range" min={ 10 } max={ H_SOL_MAX } step={ 10 } value={ r.hauteurSol } onChange={ ( e ) => regler( { hauteurSol: Number( e.target.value ) } ) } aria-label="Hauteur au-dessus du sol" />
						<div className="graduations num"><span>10</span><span>120 (moyeu)</span><span>{ fmt( H_SOL_MAX ) } m</span></div>
					</label>
				) : (
					<label className="champ">
						<span>Altitude <b className="num" data-testid="altitude-label">{ r.niveau >= 0 && altitudes.length ? `${ fmt( altitudes[ r.niveau ] ) } m` : '—' }</b> <span className="muet">(au-dessus de la mer)</span></span>
						<input type="range" min={ 0 } max={ Math.max( 0, altitudes.length - 1 ) } step={ 1 } value={ Math.max( 0, r.niveau ) } disabled={ ! altitudes.length } onChange={ ( e ) => regler( { niveau: Number( e.target.value ) } ) } aria-label="Niveau d'altitude" />
						{ altitudes.length > 0 && <div className="graduations num"><span>{ fmt( altitudes[ 0 ] ) }</span><span>{ fmt( altitudes[ Math.floor( altitudes.length / 2 ) ] ) }</span><span>{ fmt( altitudes[ altitudes.length - 1 ] ) } m</span></div> }
					</label>
				) }

				<label className="champ">
					<span>Exagération verticale <b className="num" data-testid="exageration">×{ r.exageration }</b></span>
					<input type="range" min={ 1 } max={ 10 } step={ 1 } value={ r.exageration } onChange={ ( e ) => regler( { exageration: Number( e.target.value ) } ) } aria-label="Exagération verticale" />
				</label>

				<fieldset className="champ">
					<legend>Coloration</legend>
					{ ( [ [ 'vitesse', 'Vitesse' ], [ 'incertitude', 'Incertitude' ], [ 'fiabilite', 'Fiabilité' ] ] as const ).map( ( [ c, t ] ) => (
						<label key={ c } className="en-ligne"><input type="radio" name="coloration" checked={ r.coloration === c } onChange={ () => regler( { coloration: c } ) } /> { t }</label>
					) ) }
				</fieldset>
				<Legende coloration={ r.coloration } echelle={ ech } absente={ ! variablePubliee ? 'variable non publiée par ce modèle' : planOk && ! planOk.stats.valides ? 'non disponible (plan entièrement sous le relief)' : null } />

				<fieldset className="champ">
					<legend>Lignes de courant</legend>
					<label className="en-ligne"><input type="checkbox" checked={ r.lignes } onChange={ ( e ) => regler( { lignes: e.target.checked } ) } /> Afficher <span className="muet num">{ planOk ? `(${ fmt( planOk.lignes.lignes ) } lignes)` : '' }</span></label>
					<label className="en-ligne"><input type="checkbox" checked={ r.animation } onChange={ ( e ) => regler( { animation: e.target.checked } ) } /> Animer le sens de l'écoulement</label>
					<input type="range" min={ 0 } max={ DENSITES_LIGNES.length - 1 } step={ 1 } value={ r.densite } onChange={ ( e ) => regler( { densite: Number( e.target.value ) } ) } aria-label="Densité des lignes de courant" />
				</fieldset>

				<fieldset className="champ">
					<legend>Coupes</legend>
					<label className="en-ligne"><input type="checkbox" checked={ r.coupeH } onChange={ ( e ) => regler( { coupeH: e.target.checked } ) } /> Horizontale (plan affiché)</label>
					<label className="en-ligne">
						<span>Verticale</span>
						<select value={ r.coupeV ?? '' } onChange={ ( e ) => regler( { coupeV: ( e.target.value || null ) as AxeCoupe | null } ) } aria-label="Coupe verticale">
							<option value="">aucune</option>
							<option value="est-ouest">est-ouest</option>
							<option value="nord-sud">nord-sud</option>
						</select>
					</label>
					{ r.coupeV && (
						<>
							<input type="range" min={ 0 } max={ 1 } step={ 0.01 } value={ r.coupeVPos } onChange={ ( e ) => regler( { coupeVPos: Number( e.target.value ) } ) } aria-label="Position de la coupe verticale" />
							<span className="muet petit num">{ posCoupe }{ coupeV?.etat === 'erreur' ? ` · ${ coupeV.message }` : '' }</span>
						</>
					) }
				</fieldset>

				<fieldset className="champ">
					<legend>Couches</legend>
					<label className="en-ligne"><input type="checkbox" checked={ r.relief } onChange={ ( e ) => regler( { relief: e.target.checked } ) } /> Relief et socle</label>
					<label className="en-ligne"><input type="checkbox" checked={ r.stations } onChange={ ( e ) => regler( { stations: e.target.checked } ) } /> Capteurs <span className="muet num" data-testid="couche-stations">{ couches.stations ? `(${ couches.stations.length }${ snap?.network.kind === 'treillis_synthetique' ? ' signalés' : '' })` : '' }</span></label>
					<label className="en-ligne"><input type="checkbox" checked={ r.eoliennes } onChange={ ( e ) => regler( { eoliennes: e.target.checked } ) } /> Éoliennes et sites <span className="muet num" data-testid="couche-eoliennes">{ couches.turbines ? `(${ couches.turbines.length })` : snap && ! snap.assets.wind_farm ? `(${ nd })` : '' }</span></label>
					{ snap?.network.kind === 'treillis_synthetique' && <p className="astuce">Treillis synthétique de { fmt( snap.network.sensors_total ) } capteurs : seuls les capteurs signalés sont dessinés.</p> }
					{ couches.erreurs.map( ( e ) => <p key={ e } className="astuce">{ e }</p> ) }
					<div className="legende-etats">{ Object.entries( LIBELLE_ETAT ).map( ( [ k, t ] ) => <span key={ k }><i style={ { background: `rgb(${ COULEUR_ETAT[ k ].map( ( x ) => Math.round( x * 255 ) ).join( ',' ) })` } } />{ t }</span> ) }</div>
				</fieldset>

				<p className="astuce">Clic sur la scène : profil vertical du nœud le plus proche. La direction indique <b>d'où vient</b> le vent.</p>
			</aside>

			<div className="scene-zone">
				<div className="scene">
					<canvas ref={ canvasRef } data-testid="scene-canvas" id="scene" />
					<div className="scene-legende num" data-testid="scene-plan">
						{ libellePlan } · exagération ×{ r.exageration }
						{ r.instantane && r.instantane !== latestId ? ' · instantané historique' : '' }
					</div>
					{ messageScene && <div className="scene-message" data-testid="scene-message">{ messageScene }</div> }
				</div>
				<Frise
					items={ items } erreur={ times.etat === 'erreur' ? times.message : null }
					courant={ snapshotId } latest={ latestId } lecture={ lecture }
					onChoisir={ ( id ) => { setLecture( false ); regler( { instantane: id } ); } }
					onLecture={ lancerRejeu }
				/>
			</div>

			<aside className="panneau tableau">
				<section className="carte">
					<h3>Instantané</h3>
					{ snap ? (
						<dl className="grille-cles num">
							<dt>Identifiant</dt><dd>{ snap.snapshot_id }</dd>
							<dt>Instant de validité</dt><dd>{ new Date( snap.valid_time ).toLocaleString( 'fr-FR' ) }</dd>
							<dt>Modèle</dt><dd>{ snap.versions.model }</dd>
							<dt>Grille</dt><dd>{ dom ? `${ dom.nx } × ${ dom.ny } × ${ dom.nz }` : '—' }</dd>
							<dt>Domaine</dt><dd>{ dom ? `${ fmt( dom.sizeX / 1000, 1 ) } × ${ fmt( dom.sizeY / 1000, 1 ) } km` : '—' }</dd>
							<dt>Relief</dt><dd>{ m ? `${ fmt( m.zMin ) } – ${ fmt( m.zMax ) } m` : '—' }</dd>
							<dt>Position</dt>
							<dd data-testid="georef">{ georef ? `${ fmt( georef.bounds.lat_min, 3 ) }–${ fmt( georef.bounds.lat_max, 3 ) }° N, ${ fmt( georef.bounds.lon_min, 3 ) }–${ fmt( georef.bounds.lon_max, 3 ) }° E${ georef.suppose ? ' (position supposée)' : '' }` : '—' }</dd>
							<dt>Réseau</dt>
							<dd data-testid="reseau">{ `${ snap.network.kind === 'treillis_synthetique' ? 'treillis synthétique' : 'stations ANEO' } · ${ fmt( snap.network.sensors_visible ) } / ${ fmt( snap.network.sensors_total ) } capteurs` }</dd>
							<dt>Vent au moyeu</dt>
							<dd>{ snap.kpi.hub_wind_mean_ms != null ? `${ fmt( snap.kpi.hub_wind_mean_ms, 1 ) } m/s moy. à ${ fmt( snap.kpi.hub_height_agl_m ) } m sol` : nd }</dd>
							<dt>Physique</dt>
							<dd>{ snap.physics ? ( snap.physics.mass_residual_ok ? 'résidu de masse sous le seuil' : 'résidu de masse au-dessus du seuil' ) : nd }</dd>
						</dl>
					) : <p className="muet">{ snapshot.etat === 'erreur' ? snapshot.message : latest.etat === 'erreur' ? latest.message : 'chargement…' }</p> }
				</section>

				<section className="carte">
					<h3>Situation</h3>
					<CarteSituation meta={ m?.meta ?? null } />
				</section>

				<section className="carte" data-testid="plan-stats">
					<h3>Plan affiché <span className="muet num">· { libellePlan }</span></h3>
					{ planOk ? (
						<div className="stats num">
							<div><b>{ nd1( planOk.stats.min ) }</b><span>min m/s</span></div>
							<div><b>{ nd1( planOk.stats.moyenne ) }</b><span>moy m/s</span></div>
							<div><b>{ nd1( planOk.stats.max ) }</b><span>max m/s</span></div>
							<p className="muet petit">{ fmt( planOk.stats.valides / ( planOk.stats.noeuds || 1 ) * 100 ) } % des colonnes (hors relief) · vitesse horizontale</p>
						</div>
					) : <p className="muet">{ plan.etat === 'erreur' ? plan.message : '—' }</p> }
				</section>

				<section className="carte" data-testid="profil">
					<h3>Profil vertical { profil?.res.etat === 'ok' && <span className="muet num">· { fmt( profil.res.val.x_m / 1000, 2 ) }, { fmt( profil.res.val.y_m / 1000, 2 ) } km</span> }</h3>
					<Profil profil={ profil } />
				</section>
			</aside>
		</div>
	);

}

function Profil( { profil }: { profil: { res: Chargement<ProfilAffiche> } | null } ) {

	if ( ! profil ) return <p className="muet">Cliquer un point de la scène.</p>;
	if ( profil.res.etat === 'attente' ) return <p className="muet">chargement…</p>;
	if ( profil.res.etat === 'erreur' ) return <p className="muet">Profil { profil.res.message }</p>;
	const p = profil.res.val;
	return (
		<>
			<ProfileChart niveaux={ p.levels } />
			<dl className="grille-cles num petit">
				<dt>Nœud</dt><dd>({ p.i }, { p.j }) · { fmt( p.lat, 4 ) }° N, { fmt( p.lon, 4 ) }° E</dd>
				<dt>Relief</dt><dd>{ fmt( p.z_terrain_m, 0 ) } m</dd>
				<dt>Capteur le plus proche</dt>
				<dd data-testid="capteur-proche">{ p.capteur ? `${ p.capteur.id } à ${ fmt( p.capteur.distance_m, 0 ) } m (${ LIBELLE_ETAT[ p.capteur.state ] ?? p.capteur.state })` : nd }</dd>
				<dt>Intervalle</dt><dd>à 80 % : vitesse ± 1,2816 σ (borné à 0)</dd>
			</dl>
			<table className="tableau-profil num" data-testid="tableau-profil">
				<thead><tr><th>Alt. mer</th><th>Sol</th><th>Vitesse</th><th>p10–p90</th><th>Vient du</th><th>Statut</th><th>Fiabilité</th></tr></thead>
				<tbody>
					{ [ ...p.levels ].reverse().map( ( l ) => (
						<tr key={ l.z_asl_m } className={ l.below_terrain ? 'sous-relief' : undefined }>
							<td>{ fmt( l.z_asl_m ) } m</td>
							<td>{ fmt( l.z_agl_m ) } m</td>
							{ l.below_terrain ? <td colSpan={ 5 }>sous le relief</td> : l.speed == null ? <td colSpan={ 5 } data-testid="niveau-nd">non disponible</td> : (
								<>
									<td>{ fmt( l.speed, 1 ) }</td>
									<td>{ l.speed_interval.p10 == null ? nd : `${ fmt( l.speed_interval.p10, 1 ) }–${ fmt( l.speed_interval.p90, 1 ) }` }</td>
									<td>{ l.dir_from_deg == null ? 'calme' : `${ cardinal( l.dir_from_deg ) } ${ dirAffichee( l.dir_from_deg ) }°` }</td>
									<td>{ l.status === 'mesure' ? 'mesuré' : l.status === 'estime' ? 'estimé' : '—' }</td>
									<td>{ l.reliability_class ? `${ LIBELLE_CLASSE[ l.reliability_class ] } (${ fmt( l.reliability, 2 ) })` : nd }</td>
								</>
							) }
						</tr>
					) ) }
				</tbody>
			</table>
		</>
	);

}
