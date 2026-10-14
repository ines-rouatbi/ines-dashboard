// Page « Exploration 3D » : monte la scène portée (scene/viz.ts) sur les données /v1.
//
// Données : /v1/meta (grille, niveaux), /v1/latest (instantané courant),
// /v1/fields/{id}/{niveau}/{u|v|w} (binaires), /v1/profiles/{id}?x&y au clic.
// Toute ressource absente s'affiche « indisponible » ; aucune donnée de démo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, libelleErreur, type Meta, type Profile } from '../data';
import { DENSITES, domaineDepuisMeta, echantillonner, statsPlan, strideCible, type Domaine } from '../domain/field';
import { cardinal } from '../domain/wind';
import { Viz, viridisCss, type PickResult, type SceneMeta } from '../scene/viz';
import { brancherScene, signalerPremierRendu, type AtomPick } from '../scene/hook';
import { ProfileChart } from '../ui/ProfileChart';
import type { EtatLatest } from '../ui/useLatest';

const fmt = ( n: number | null | undefined, d = 0 ) =>
	n == null || ! Number.isFinite( n ) ? '—' : n.toLocaleString( 'fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d } );

type Chargement<T> = { etat: 'attente' } | { etat: 'ok'; val: T } | { etat: 'erreur'; message: string };

interface Composantes { u: Float32Array; v: Float32Array; w: Float32Array | null }

interface Attente { niveau: number; ok: () => void; ko: ( e: unknown ) => void }

/** Indice du niveau le plus proche d'une altitude (m au-dessus de la mer). */
function niveauProche( altitudes: number[], m: number ): number {

	let best = 0;
	for ( let k = 1; k < altitudes.length; k ++ ) if ( Math.abs( altitudes[ k ] - m ) < Math.abs( altitudes[ best ] - m ) ) best = k;
	return best;

}

export function Exploration( { latest }: { latest: EtatLatest } ) {

	const canvasRef = useRef<HTMLCanvasElement>( null );
	const vizRef = useRef<Viz | null>( null );
	const cache = useRef( new Map<string, Promise<Composantes>>() );
	const attentes = useRef<Attente[]>( [] );
	const rendu = useRef<number | null>( null ); // niveau effectivement affiché

	const [ meta, setMeta ] = useState<Chargement<{ meta: Meta; dom: Domaine }>>( { etat: 'attente' } );
	const [ niveau, setNiveau ] = useState<number | null>( null );
	const [ densite, setDensite ] = useState( 3 );
	const [ vertical, setVertical ] = useState( false );
	const [ relief, setRelief ] = useState( true );
	const [ plan, setPlan ] = useState<Chargement<{ stats: ReturnType<typeof statsPlan>; range: [ number, number ]; stride: number }>>( { etat: 'attente' } );
	const [ profil, setProfil ] = useState<{ x_m: number; y_m: number; res: Chargement<Profile> } | null>( null );

	const snapshotId = latest.etat === 'ok' ? latest.latest.snapshot_id : null;
	const dom = meta.etat === 'ok' ? meta.val.dom : null;
	const xMin = meta.etat === 'ok' ? meta.val.meta.domain?.x_min_m ?? 0 : 0;
	const yMin = meta.etat === 'ok' ? meta.val.meta.domain?.y_min_m ?? 0 : 0;

	// 1. /v1/meta (jamais de grille codée en dur).
	useEffect( () => {

		const ctl = new AbortController();
		api.meta( ctl.signal ).then(
			( m ) => {

				const d = domaineDepuisMeta( m );
				setMeta( { etat: 'ok', val: { meta: m, dom: d } } );
				// Niveau par défaut : 1er ≥ 650 m (au-dessus du relief → couverture pleine).
				const def = d.altitudes.findIndex( ( a ) => a >= 650 );
				setNiveau( ( n ) => n ?? ( def >= 0 ? def : Math.max( 0, d.nz - 1 ) ) );

			},
			( e ) => { if ( e.name !== 'AbortError' ) setMeta( { etat: 'erreur', message: libelleErreur( e ) } ); },
		);
		return () => ctl.abort();

	}, [] );

	// 2. Profil vertical au clic.
	const surPick = useRef<( p: PickResult ) => AtomPick | null>( () => null );
	surPick.current = ( p ) => {

		if ( ! dom ) return null;
		const x_m = xMin + p.fx * dom.sizeX, y_m = yMin + p.fy * dom.sizeY;
		if ( snapshotId ) {

			setProfil( { x_m, y_m, res: { etat: 'attente' } } );
			api.profile( snapshotId, x_m, y_m ).then(
				( val ) => setProfil( ( cur ) => cur && cur.x_m === x_m && cur.y_m === y_m ? { x_m, y_m, res: { etat: 'ok', val } } : cur ),
				( e ) => setProfil( ( cur ) => cur && cur.x_m === x_m && cur.y_m === y_m ? { x_m, y_m, res: { etat: 'erreur', message: libelleErreur( e ) } } : cur ),
			);

		}

		return { ...p, x_m, y_m };

	};

	// 3. Création / libération de la scène.
	useEffect( () => {

		const viz = new Viz( canvasRef.current!, { onPick: ( p ) => { surPick.current( p ); } } );
		vizRef.current = viz;
		return () => { viz.dispose(); vizRef.current = null; rendu.current = null; };

	}, [] );

	// 4. Géométrie du domaine dans la scène.
	const sceneMeta = useMemo<SceneMeta | null>( () => dom && { nx: dom.nx, ny: dom.ny, altitudes: dom.altitudes, sizeX: dom.sizeX, sizeY: dom.sizeY }, [ dom ] );
	useEffect( () => { if ( sceneMeta && vizRef.current ) { vizRef.current.setMeta( sceneMeta ); rendu.current = null; } }, [ sceneMeta ] );

	const composantes = useCallback( ( id: string, k: number ): Promise<Composantes> => {

		const cle = `${ id }/${ k }`;
		let p = cache.current.get( cle );
		if ( ! p ) {

			p = Promise.all( [
				api.field( id, k, 'u' ),
				api.field( id, k, 'v' ),
				api.field( id, k, 'w' ).catch( () => null ), // w facultatif pour l'affichage
			] ).then( ( [ u, v, w ] ) => ( { u, v, w } ) );
			p.catch( () => cache.current.delete( cle ) );
			cache.current.set( cle, p );

		}

		return p;

	}, [] );

	const reglerAttentes = useCallback( ( k: number, erreur?: unknown ) => {

		const reste: Attente[] = [];
		for ( const a of attentes.current ) {

			if ( a.niveau !== k ) reste.push( a );
			else if ( erreur ) a.ko( erreur ); else a.ok();

		}

		attentes.current = reste;

	}, [] );

	// 5. Chargement et rendu du niveau courant.
	useEffect( () => {

		const viz = vizRef.current;
		if ( ! viz || ! dom || niveau == null || ! snapshotId ) return;
		let actif = true;
		setPlan( ( p ) => ( p.etat === 'ok' ? p : { etat: 'attente' } ) );
		composantes( snapshotId, niveau ).then( async ( { u, v, w } ) => {

			if ( ! actif ) return;
			const stride = strideCible( dom.nx, dom.ny, DENSITES[ densite ] );
			const p = echantillonner( dom, dom.altitudes[ niveau ], u, v, w, stride );
			const r = viz.setField( p, { vertical } );
			setPlan( { etat: 'ok', val: { stats: statsPlan( p ), range: r?.range ?? [ 0, 1 ], stride } } );
			await viz.apresRendu();
			if ( ! actif ) return;
			rendu.current = niveau;
			signalerPremierRendu();
			reglerAttentes( niveau );

		} ).catch( ( e ) => {

			if ( ! actif ) return;
			setPlan( { etat: 'erreur', message: libelleErreur( e ) } );
			reglerAttentes( niveau, e );

		} );
		return () => { actif = false; };

	}, [ dom, niveau, densite, vertical, snapshotId, composantes, reglerAttentes ] );

	useEffect( () => { vizRef.current?.setTerrainVisible( relief ); }, [ relief, sceneMeta ] );

	// 6. Branchement du crochet de test window.__atom.
	useEffect( () => {

		const viz = vizRef.current;
		if ( ! viz || ! dom ) return;
		return brancherScene( {
			viz,
			setAltitude: ( m ) => {

				const k = niveauProche( dom.altitudes, m );
				if ( rendu.current === k ) return viz.apresRendu();
				return new Promise<void>( ( ok, ko ) => {

					attentes.current.push( { niveau: k, ok, ko } );
					setNiveau( k );

				} );

			},
			pick: async ( x, y ) => {

				const r = viz.canvas.getBoundingClientRect();
				const p = viz.pickAt( r.left + x, r.top + y );
				await viz.apresRendu();
				return p ? surPick.current( { ...p } ) ?? null : null;

			},
		} );

	}, [ dom ] );

	// --- Rendu ---------------------------------------------------------------
	const altitudes = dom?.altitudes ?? [];
	const altCourante = niveau != null ? altitudes[ niveau ] : null;
	const degrade = useMemo( () => `linear-gradient(90deg, ${ Array.from( { length: 10 }, ( _, i ) => viridisCss( i / 9 ) ).join( ',' ) })`, [] );

	let messageScene: string | null = null;
	if ( meta.etat === 'erreur' ) messageScene = `Grille ${ meta.message }`;
	else if ( latest.etat === 'erreur' ) messageScene = `Dernier instantané ${ latest.message }`;
	else if ( plan.etat === 'erreur' ) messageScene = `Champ ${ plan.message }`;
	else if ( meta.etat === 'attente' || latest.etat === 'attente' || plan.etat === 'attente' ) messageScene = 'chargement…';

	return (
		<div className="exploration">
			<aside className="panneau commandes">
				<h2>Commandes</h2>

				<label className="champ">
					<span>Altitude <b className="num" data-testid="altitude-label">{ altCourante != null ? `${ fmt( altCourante ) } m` : '—' }</b> <span className="muet">(au-dessus de la mer)</span></span>
					<input
						type="range" min={ 0 } max={ Math.max( 0, altitudes.length - 1 ) } step={ 1 }
						value={ niveau ?? 0 } disabled={ ! altitudes.length }
						onChange={ ( e ) => setNiveau( Number( e.target.value ) ) }
						aria-label="Niveau d'altitude"
					/>
					{ altitudes.length > 0 && (
						<div className="graduations num">
							<span>{ fmt( altitudes[ 0 ] ) }</span>
							<span>{ fmt( altitudes[ Math.floor( altitudes.length / 2 ) ] ) }</span>
							<span>{ fmt( altitudes[ altitudes.length - 1 ] ) } m</span>
						</div>
					) }
				</label>

				<label className="champ">
					<span>Densité des flèches <b className="num">{ plan.etat === 'ok' ? `pas ${ plan.val.stride }` : '—' }</b></span>
					<input type="range" min={ 0 } max={ DENSITES.length - 1 } step={ 1 } value={ densite } onChange={ ( e ) => setDensite( Number( e.target.value ) ) } aria-label="Densité des flèches" />
				</label>

				<label className="champ en-ligne">
					<input type="checkbox" checked={ vertical } onChange={ ( e ) => setVertical( e.target.checked ) } />
					<span>Composante verticale (w) dans les flèches</span>
				</label>

				<label className="champ en-ligne">
					<input type="checkbox" checked={ relief } onChange={ ( e ) => setRelief( e.target.checked ) } />
					<span>Sol &amp; domaine</span>
				</label>

				<div className="legende">
					<div className="legende-titre">Vitesse du vent</div>
					<div className="legende-barre" style={ { background: degrade } } />
					<div className="legende-echelle num">
						<span>{ plan.etat === 'ok' ? fmt( plan.val.range[ 0 ], 1 ) : '—' }</span>
						<span>{ plan.etat === 'ok' ? `${ fmt( plan.val.range[ 1 ], 1 ) } m/s` : '— m/s' }</span>
					</div>
				</div>

				<p className="astuce">Clic sur la scène : profil vertical du point. La direction indique <b>d'où vient</b> le vent.</p>
			</aside>

			<div className="scene">
				<canvas ref={ canvasRef } data-testid="scene-canvas" />
				{ messageScene && <div className="scene-message">{ messageScene }</div> }
			</div>

			<aside className="panneau tableau">
				<section className="carte">
					<h3>Instantané</h3>
					{ latest.etat === 'ok' ? (
						<dl className="grille-cles num">
							<dt>Identifiant</dt><dd>{ latest.latest.snapshot_id }</dd>
							<dt>Instant de validité</dt><dd>{ new Date( latest.latest.valid_time ).toLocaleString( 'fr-FR' ) }</dd>
							<dt>Modèle</dt><dd>{ latest.latest.model_version }</dd>
							<dt>Grille</dt><dd>{ dom ? `${ dom.nx } × ${ dom.ny } × ${ dom.nz }` : '—' }</dd>
							<dt>Domaine</dt><dd>{ dom ? `${ fmt( dom.sizeX / 1000, 1 ) } × ${ fmt( dom.sizeY / 1000, 1 ) } km` : '—' }</dd>
						</dl>
					) : <p className="muet">{ latest.etat === 'erreur' ? latest.message : 'chargement…' }</p> }
				</section>

				<section className="carte">
					<h3>Niveau sélectionné</h3>
					{ plan.etat === 'ok' ? (
						<div className="stats num">
							<div><b>{ fmt( plan.val.stats.min, 1 ) }</b><span>min m/s</span></div>
							<div><b>{ fmt( plan.val.stats.moy, 1 ) }</b><span>moy m/s</span></div>
							<div><b>{ fmt( plan.val.stats.max, 1 ) }</b><span>max m/s</span></div>
							<p className="muet petit">{ fmt( plan.val.stats.couverture * 100 ) } % de couverture (hors relief)</p>
						</div>
					) : <p className="muet">{ plan.etat === 'erreur' ? plan.message : '—' }</p> }
				</section>

				<section className="carte">
					<h3>Profil vertical { profil && <span className="muet num">· { fmt( profil.x_m / 1000, 1 ) }, { fmt( profil.y_m / 1000, 1 ) } km</span> }</h3>
					<Profil profil={ profil } />
				</section>
			</aside>
		</div>
	);

}

function Profil( { profil }: { profil: { res: Chargement<Profile> } | null } ) {

	if ( ! profil ) return <p className="muet">Cliquer un point de la scène.</p>;
	if ( profil.res.etat === 'attente' ) return <p className="muet">chargement…</p>;
	if ( profil.res.etat === 'erreur' ) return <p className="muet">Profil { profil.res.message }</p>;
	const p = profil.res.val;
	if ( ! Array.isArray( p.levels ) || ! p.levels.length ) return <p className="muet">Profil indisponible</p>;
	const haut = [ ...p.levels ].reverse().find( ( n ) => ! n.below_terrain && n.direction_deg != null );
	return (
		<>
			<ProfileChart niveaux={ p.levels } />
			<p className="muet petit num">
				{ haut ? `Au sommet : vent du ${ cardinal( haut.direction_deg ?? null ) } (${ fmt( haut.direction_deg, 0 ) }°)` : '' }
				{ p.nearest_station ? ` · station la plus proche : ${ p.nearest_station.name ?? p.nearest_station.id }` : '' }
			</p>
		</>
	);

}
