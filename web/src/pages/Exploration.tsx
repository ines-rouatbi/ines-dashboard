// Page « Exploration 3D » : monte la scène portée (scene/viz.ts) sur les données /v1 (contrat v1 rév. 2).
//
// Données : /v1/meta (grille, niveaux, encodage, géoréférencement), /v1/latest (instantané courant),
// /v1/snapshots/{id} (réseau, indicateurs), /v1/fields/{id}/{niveau}/{var} (un niveau, en cache par
// instantané / niveau / variable). Profil au clic : /v1/column/{id}?i&j (UNE requête), direction et
// intervalle à 80 % calculés par le front (domain/profile.ts). Toute ressource absente s'affiche
// « indisponible » ou « non disponible » ; aucune donnée de démo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, CacheChamps, libelleErreur, type Meta, type Snapshot, type Station } from '../data';
import { DENSITES, domaineDepuisMeta, echantillonner, noeudProche, positionNoeud, statsPlan, strideCible, type Domaine } from '../domain/field';
import { profilDepuisColonne, type ProfilCalcule } from '../domain/profile';
import { capteurProche, type CapteurProche } from '../domain/capteurs';
import { latLon } from '../domain/geo';
import { cardinal } from '../domain/wind';
import { Viz, viridisCss, type PickResult, type SceneMeta } from '../scene/viz';
import { brancherScene, signalerEchec, signalerPremierRendu, type AtomPick } from '../scene/hook';
import { ProfileChart } from '../ui/ProfileChart';
import type { EtatLatest } from '../ui/useLatest';

// Cache partagé : il survit à la navigation entre les pages.
const champs = new CacheChamps( api );
const stationsParInstantane = new Map<string, Promise<Station[]>>();

const fmt = ( n: number | null | undefined, d = 0 ) =>
	n == null || ! Number.isFinite( n ) ? '—' : n.toLocaleString( 'fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d } );

type Chargement<T> = { etat: 'attente' } | { etat: 'ok'; val: T } | { etat: 'erreur'; message: string };

interface Attente { niveau: number; ok: () => void; ko: ( e: unknown ) => void }

interface ProfilAffiche extends ProfilCalcule { capteur: CapteurProche | null; lat: number; lon: number }

/** Indice du niveau le plus proche d'une altitude (m au-dessus de la mer). */
function niveauProche( altitudes: number[], m: number ): number {

	let best = 0;
	for ( let k = 1; k < altitudes.length; k ++ ) if ( Math.abs( altitudes[ k ] - m ) < Math.abs( altitudes[ best ] - m ) ) best = k;
	return best;

}

function stations( id: string ): Promise<Station[]> {

	let p = stationsParInstantane.get( id );
	if ( ! p ) {

		p = api.stations( id ).then( ( s ) => s.items );
		p.catch( () => stationsParInstantane.delete( id ) );
		stationsParInstantane.set( id, p );

	}

	return p;

}

/** Profil de la colonne (i, j) : une seule requête /v1/column, calculs du contrat côté front. */
async function chargerProfil( id: string, meta: Meta, dom: Domaine, reseau: Snapshot[ 'network' ][ 'kind' ] | null, i: number, j: number ): Promise<ProfilAffiche> {

	const colonne = await api.column( id, i, j );
	const profil = profilDepuisColonne( colonne );
	const st = reseau ? await stations( id ).catch( () => null ) : null;
	const capteur = reseau && st ? capteurProche( reseau, st, profil.x_m, profil.y_m, dom ) : null;
	return { ...profil, capteur, ...latLon( meta, profil.x_m, profil.y_m ) };

}

export function Exploration( { latest }: { latest: EtatLatest } ) {

	const canvasRef = useRef<HTMLCanvasElement>( null );
	const vizRef = useRef<Viz | null>( null );
	const attentes = useRef<Attente[]>( [] );
	const rendu = useRef<number | null>( null ); // niveau effectivement affiché
	const premierRendu = useRef( false );

	const [ meta, setMeta ] = useState<Chargement<{ meta: Meta; dom: Domaine }>>( { etat: 'attente' } );
	const [ niveau, setNiveau ] = useState<number | null>( null );
	const [ densite, setDensite ] = useState( 3 );
	const [ vertical, setVertical ] = useState( false );
	const [ relief, setRelief ] = useState( true );
	const [ plan, setPlan ] = useState<Chargement<{ stats: ReturnType<typeof statsPlan>; range: [ number, number ]; stride: number }>>( { etat: 'attente' } );
	const [ profil, setProfil ] = useState<{ cle: string; x_m: number; y_m: number; res: Chargement<ProfilAffiche> } | null>( null );
	const [ snapshot, setSnapshot ] = useState<Chargement<Snapshot>>( { etat: 'attente' } );

	const snapshotId = latest.etat === 'ok' ? latest.latest.snapshot_id : null;
	const dom = meta.etat === 'ok' ? meta.val.dom : null;
	const metaV = meta.etat === 'ok' ? meta.val.meta : null;
	const encodage = metaV?.encoding;
	const reseau = snapshot.etat === 'ok' ? snapshot.val.network.kind : null;

	// Résumé de l'instantané (réseau, indicateurs) : facultatif pour la scène.
	useEffect( () => {

		if ( ! snapshotId ) return;
		const ctl = new AbortController();
		api.snapshot( snapshotId, ctl.signal ).then(
			( val ) => setSnapshot( { etat: 'ok', val } ),
			( e ) => { if ( e.name !== 'AbortError' ) setSnapshot( { etat: 'erreur', message: libelleErreur( e ) } ); },
		);
		return () => ctl.abort();

	}, [ snapshotId ] );

	// 1. /v1/meta (jamais de grille codée en dur).
	useEffect( () => {

		const ctl = new AbortController();
		api.meta( undefined, ctl.signal ).then(
			( m ) => {

				const d = domaineDepuisMeta( m );
				setMeta( { etat: 'ok', val: { meta: m, dom: d } } );
				// Niveau par défaut : 1er ≥ 650 m (au-dessus du relief → couverture pleine).
				const def = d.altitudes.findIndex( ( a ) => a >= 650 );
				setNiveau( ( n ) => n ?? ( def >= 0 ? def : Math.max( 0, d.nz - 1 ) ) );

			},
			( e ) => {

				if ( e.name === 'AbortError' ) return;
				setMeta( { etat: 'erreur', message: libelleErreur( e ) } );
				signalerEchec( `/v1/meta ${ libelleErreur( e ) }`, true );

			},
		);
		return () => ctl.abort();

	}, [] );

	useEffect( () => { if ( latest.etat === 'erreur' ) signalerEchec( `/v1/latest ${ latest.message }`, true ); }, [ latest ] );

	// 2. Profil vertical au clic (maille native, calcul côté client).
	const surPick = useRef<( p: PickResult ) => AtomPick | null>( () => null );
	surPick.current = ( p ) => {

		if ( ! dom || ! metaV ) return null;
		const { i, j } = noeudProche( dom, dom.x0 + p.fx * dom.sizeX, dom.y0 + p.fy * dom.sizeY );
		const { x_m, y_m } = positionNoeud( dom, i, j );
		if ( snapshotId ) {

			const cle = `${ snapshotId }/${ i }/${ j }`;
			setProfil( { cle, x_m, y_m, res: { etat: 'attente' } } );
			chargerProfil( snapshotId, metaV, dom, reseau, i, j ).then(
				( val ) => setProfil( ( cur ) => cur?.cle === cle ? { ...cur, res: { etat: 'ok', val } } : cur ),
				( e ) => setProfil( ( cur ) => cur?.cle === cle ? { ...cur, res: { etat: 'erreur', message: libelleErreur( e ) } } : cur ),
			);

		}

		return { ...p, i, j, x_m, y_m };

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
		Promise.all( [
			champs.champ( snapshotId, niveau, 'u', encodage?.u?.scale ),
			champs.champ( snapshotId, niveau, 'v', encodage?.v?.scale ),
			champs.champ( snapshotId, niveau, 'w', encodage?.w?.scale ).catch( () => null ), // w facultatif pour l'affichage
		] ).then( async ( [ u, v, w ] ) => {

			if ( ! actif ) return;
			const stride = strideCible( dom.nx, dom.ny, DENSITES[ densite ] );
			const p = echantillonner( dom, dom.altitudes[ niveau ], u, v, w, stride );
			const r = viz.setField( p, { vertical } );
			setPlan( { etat: 'ok', val: { stats: statsPlan( p ), range: r?.range ?? [ 0, 1 ], stride } } );
			await viz.apresRendu();
			if ( ! actif ) return;
			rendu.current = niveau;
			premierRendu.current = true;
			signalerPremierRendu();
			reglerAttentes( niveau );

		} ).catch( ( e ) => {

			if ( ! actif ) return;
			setPlan( { etat: 'erreur', message: libelleErreur( e ) } );
			signalerEchec( `champ du niveau ${ niveau } ${ libelleErreur( e ) }`, ! premierRendu.current );
			reglerAttentes( niveau, e );

		} );
		return () => { actif = false; };

	}, [ dom, encodage, niveau, densite, vertical, snapshotId, reglerAttentes ] );

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

				// (x, y) : pixels CSS relatifs au coin haut-gauche du canevas.
				const r = viz.canvas.getBoundingClientRect();
				const p = viz.pickAt( r.left + x, r.top + y );
				await viz.apresRendu();
				return p ? surPick.current( { ...p } ) : null;

			},
		} );

	}, [ dom ] );

	// --- Rendu ---------------------------------------------------------------
	const altitudes = dom?.altitudes ?? [];
	const altCourante = niveau != null ? altitudes[ niveau ] : null;
	const degrade = useMemo( () => `linear-gradient(90deg, ${ Array.from( { length: 10 }, ( _, i ) => viridisCss( i / 9 ) ).join( ',' ) })`, [] );
	const georef = metaV?.georef ?? null;
	const nd = 'non disponible';
	const snap = snapshot.etat === 'ok' ? snapshot.val : null;

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

				<p className="astuce">Clic sur la scène : profil vertical de la maille. La direction indique <b>d'où vient</b> le vent.</p>
			</aside>

			<div className="scene">
				<canvas ref={ canvasRef } data-testid="scene-canvas" />
				{ messageScene && <div className="scene-message" data-testid="scene-message">{ messageScene }</div> }
			</div>

			<aside className="panneau tableau">
				<section className="carte">
					<h3>Instantané</h3>
					{ latest.etat === 'ok' ? (
						<dl className="grille-cles num">
							<dt>Identifiant</dt><dd>{ latest.latest.snapshot_id }</dd>
							<dt>Instant de validité</dt><dd>{ new Date( latest.latest.valid_time ).toLocaleString( 'fr-FR' ) }</dd>
							<dt>Modèle</dt><dd>{ latest.latest.versions.model }</dd>
							<dt>Grille</dt><dd>{ dom ? `${ dom.nx } × ${ dom.ny } × ${ dom.nz }` : '—' }</dd>
							<dt>Domaine</dt><dd>{ dom ? `${ fmt( dom.sizeX / 1000, 1 ) } × ${ fmt( dom.sizeY / 1000, 1 ) } km` : '—' }</dd>
							<dt>Position</dt>
							<dd data-testid="georef">{ georef ? `${ fmt( georef.bounds.lat_min, 3 ) }–${ fmt( georef.bounds.lat_max, 3 ) }° N, ${ fmt( georef.bounds.lon_min, 3 ) }–${ fmt( georef.bounds.lon_max, 3 ) }° E${ georef.suppose ? ' (position supposée)' : '' }` : '—' }</dd>
							<dt>Réseau</dt>
							<dd data-testid="reseau">{ snap ? `${ snap.network.kind === 'treillis_synthetique' ? 'treillis synthétique' : 'stations ANEO' } · ${ fmt( snap.network.sensors_visible ) } / ${ fmt( snap.network.sensors_total ) } capteurs` : snapshot.etat === 'erreur' ? nd : '—' }</dd>
							<dt>Vent au moyeu</dt>
							<dd>{ snap?.kpi.hub_wind_mean_ms != null ? `${ fmt( snap.kpi.hub_wind_mean_ms, 1 ) } m/s moy. à ${ fmt( snap.kpi.hub_height_agl_m ) } m sol` : nd }</dd>
							<dt>Physique</dt>
							<dd>{ snap?.physics ? ( snap.physics.mass_residual_ok ? 'résidu de masse sous le seuil' : 'résidu de masse au-dessus du seuil' ) : nd }</dd>
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

				<section className="carte" data-testid="profil">
					<h3>Profil vertical { profil && <span className="muet num">· { fmt( profil.x_m / 1000, 2 ) }, { fmt( profil.y_m / 1000, 2 ) } km</span> }</h3>
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
			<p className="muet petit num">
				Relief { fmt( p.z_terrain_m, 0 ) } m
				{ ` · nœud (${ p.i }, ${ p.j }) · ${ fmt( p.lat, 4 ) }° N, ${ fmt( p.lon, 4 ) }° E` }
				{ p.capteur ? ` · capteur le plus proche : ${ p.capteur.id } (${ fmt( p.capteur.distance_m, 0 ) } m${ p.capteur.state !== 'active' ? `, ${ p.capteur.state }` : '' })` : '' }
				{ ' · intervalle à 80 %' }
			</p>
			<table className="tableau-profil num">
				<thead><tr><th>Alt. mer</th><th>Sol</th><th>Vitesse</th><th>p10–p90</th><th>Vient du</th><th>Statut</th></tr></thead>
				<tbody>
					{ [ ...p.levels ].reverse().map( ( l ) => (
						<tr key={ l.z_asl_m } className={ l.below_terrain ? 'sous-relief' : undefined }>
							<td>{ fmt( l.z_asl_m ) } m</td>
							<td>{ fmt( l.z_agl_m ) } m</td>
							{ l.below_terrain ? <td colSpan={ 4 }>sous le relief</td> : (
								<>
									<td>{ fmt( l.speed, 1 ) }</td>
									<td>{ fmt( l.speed_interval.p10, 1 ) }–{ fmt( l.speed_interval.p90, 1 ) }</td>
									<td>{ l.dir_from_deg == null ? 'calme' : `${ cardinal( l.dir_from_deg ) } ${ fmt( l.dir_from_deg ) }°` }</td>
									<td>{ l.status === 'mesure' ? 'mesuré' : l.status === 'estime' ? 'estimé' : '—' }</td>
								</>
							) }
						</tr>
					) ) }
				</tbody>
			</table>
		</>
	);

}
