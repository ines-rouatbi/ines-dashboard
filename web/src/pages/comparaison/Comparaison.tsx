// Page Comparaison (lot F6) : deux instantanés de /v1/times, cartes de la vitesse côte à côte à la MÊME hauteur
// au-dessus du sol (D6, domain/hauteurSol.ts), échelle commune, carte de la différence B − A (échelle divergente
// symétrique), statistiques sur les nœuds communs. Un nœud absent d'un côté n'entre jamais dans la différence.
// État dans l'adresse (?a=&b=&h=) : une comparaison se partage par son lien.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../data';
import { HAUTEURS_SOL_M, resumer } from '../../domain/hauteurSol';
import { bornesDifference, maxCommun } from '../../domain/comparaison';
import { csvComparaison, nomFichier } from '../../domain/exportCsv';
import { RAMPE_DIFFERENCE, RAMPE_VITESSE } from '../../ui/couleurs';
import { BoutonCsv } from '../../ui/Exports';
import type { EtatLatest } from '../../ui/useLatest';
import { NA, num, utc, withUnit } from '../shared/format';
import { Carte, Legende, bornesEchelle, type Echelle } from '../f3/Carte';
import { EtatPageF3, useAsync } from '../f3/commun';
import { identite } from '../f3/donnees';
import { texteCarteVide } from '../f3/Ensemble';
import { chargerComparaison, chargerInstants, choixParDefaut, type Comparaison as Donnees } from './donnees';
import { SqueletteCarte } from '../../ui/Squelette';
import '../f3/f3.css';

const NATURE: Record<string, string> = { test: 'test', synthetique: 'synthétique', reel: 'réelle' };

/** Hauteurs proposées (m au-dessus du sol) : celles de la vue d'ensemble et le moyeu par défaut (120 m). */
export const HAUTEURS_COMPARAISON = [ ...new Set( [ ...HAUTEURS_SOL_M, 120 ] ) ].sort( ( x, y ) => x - y );

function lireAdresse() {

	const q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams( location.search );
	const h = Number( q.get( 'h' ) );
	return { a: q.get( 'a' ), b: q.get( 'b' ), h: HAUTEURS_COMPARAISON.includes( h ) ? h : 100 };

}

function ecrireAdresse( a: string | null, b: string | null, h: number ) {

	if ( typeof history === 'undefined' ) return;
	const q = new URLSearchParams( location.search );
	if ( a ) q.set( 'a', a ); else q.delete( 'a' );
	if ( b ) q.set( 'b', b ); else q.delete( 'b' );
	q.set( 'h', String( h ) );
	history.replaceState( null, '', `${ location.pathname }?${ q }` );

}

export function PageComparaison( { latest }: { latest: EtatLatest } ) {

	const latestId = latest.etat === 'ok' ? latest.latest.snapshot_id : null;
	const instants = useAsync( latestId, ( s ) => chargerInstants( api, s ) );
	const [ choix, setChoix ] = useState( lireAdresse );
	const items = instants.etat === 'ok' ? instants.val.items : null;

	// Choix par défaut une fois la liste connue (sans écraser un choix venu de l'adresse).
	useEffect( () => {

		if ( ! items ) return;
		setChoix( ( c ) => {

			const connus = new Set( items.map( ( x ) => x.snapshot_id ) ), d = choixParDefaut( items, latestId );
			return { ...c, a: c.a && connus.has( c.a ) ? c.a : d.a, b: c.b && connus.has( c.b ) ? c.b : d.b };

		} );

	}, [ items, latestId ] );
	useEffect( () => { ecrireAdresse( choix.a, choix.b, choix.h ); }, [ choix ] );

	if ( latest.etat !== 'ok' ) return <EtatPageF3 titre="Comparaison" nom="comparaison" etat={ latest.etat === 'erreur' ? { etat: 'erreur', message: `dernier instantané ${ latest.message }` } : { etat: 'attente' } } />;
	if ( instants.etat !== 'ok' ) return <EtatPageF3 titre="Comparaison" nom="comparaison" etat={ instants } />;

	const liste = instants.val.items;
	const libelle = ( id: string ) => {

		const it = liste.find( ( x ) => x.snapshot_id === id );
		return it ? `${ utc( it.valid_time ) }${ id === latestId ? ' (dernier)' : '' }` : id;

	};
	const selecteur = ( cote: 'a' | 'b', titre: string ) => (
		<label className="comparaison-choix">
			<span>{ titre }</span>
			<select value={ choix[ cote ] ?? '' } data-testid={ `instant-${ cote }` } onChange={ ( e ) => setChoix( ( c ) => ( { ...c, [ cote ]: e.target.value || null } ) ) }>
				{ [ ...liste ].reverse().map( ( x ) => <option key={ x.snapshot_id } value={ x.snapshot_id }>{ libelle( x.snapshot_id ) } · { x.snapshot_id }</option> ) }
			</select>
		</label>
	);

	return (
		<section className="f3-page" data-testid="page-comparaison">
			<header className="f3-entete">
				<h1>Comparaison de deux instants</h1>
				<p className="muet">
					Vitesse horizontale à la même hauteur au-dessus du sol (relief + h, par colonne), même échelle pour les deux instants,
					puis différence B − A. Un nœud absent d’un côté (sous le relief, hors du domaine vertical) n’entre jamais dans la différence.
				</p>
			</header>
			<div className="f3-bloc f3-controles comparaison-controles">
				{ selecteur( 'a', 'Instant A (référence)' ) }
				{ selecteur( 'b', 'Instant B' ) }
				<div role="group" aria-label="Hauteur au-dessus du sol" className="f3-boutons">
					{ HAUTEURS_COMPARAISON.map( ( h ) => (
						<button key={ h } type="button" aria-pressed={ h === choix.h } data-testid={ `comparaison-hauteur-${ h }` } onClick={ () => setChoix( ( c ) => ( { ...c, h } ) ) }>{ num( h ) } m</button>
					) ) }
				</div>
				{ instants.val.tronque ? <p className="petit muet">Liste limitée aux { num( liste.length ) } instants les plus anciens sur { num( instants.val.total ) }.</p> : null }
			</div>
			{ liste.length < 2 ? <p className="f3-na" data-testid="comparaison-impossible">Comparaison : { NA } (moins de deux instantanés publiés).</p>
				: choix.a && choix.b ? <Resultat a={ choix.a } b={ choix.b } h={ choix.h } /> : null }
		</section>
	);

}

function Resultat( { a, b, h }: { a: string; b: string; h: number } ) {

	const c = useAsync( `${ a }|${ b }|${ h }`, ( s ) => chargerComparaison( api, a, b, h, s ) );
	if ( c.etat === 'attente' ) return <div className="f3-bloc"><div className="f3-cartes f3-cartes-2"><SqueletteCarte texte="chargement des deux instants…" /><SqueletteCarte /></div></div>;
	if ( c.etat === 'erreur' ) return <p className="f3-erreur" role="alert" data-testid="comparaison-erreur">Comparaison : { c.message }</p>;
	return <Cartes d={ c.val } memeInstant={ a === b } />;

}

function Cartes( { d, memeInstant }: { d: Donnees; memeInstant: boolean } ) {

	const { a, b, hauteur, diff, stats } = d;
	const g = a.base.meta.grid;
	const grille = { nx: g.nx, ny: g.ny, dx: g.dx_m, dy: g.dy_m, x0: g.x0_m, y0: g.y0_m };
	const echelle = useMemo<Echelle>( () => ( { kind: 'continue', ...bornesEchelle( maxCommun( a.carte.valeurs, b.carte.valeurs ), 2 ), rampe: RAMPE_VITESSE, unite: 'm/s', decimales: 1 } ), [ a, b ] );
	const echelleDiff = useMemo<Echelle>( () => ( { kind: 'continue', ...bornesDifference( stats ), rampe: RAMPE_DIFFERENCE, unite: 'm/s', decimales: 2 } ), [ stats ] );
	const resumeDiff = useMemo( () => resumer( a.carte.enc, diff ), [ a, diff ] );
	const titre = ( s: typeof a, lettre: string ) => `${ lettre } · ${ utc( s.base.snapshot.valid_time ) }`;
	const pct = ( n: number ) => `${ num( n ) } (${ num( stats.total ? n / stats.total * 100 : null, 1 ) } %)`;
	const signe = ( x: number | null, dd = 2 ) => ( x == null ? NA : `${ x > 0 ? '+' : x < 0 ? '−' : '' }${ num( Math.abs( x ), dd ) } m/s` );

	return (
		<>
			{ memeInstant ? <p className="f3-avertissement" role="note">A et B sont le même instantané : la différence est nulle partout où le vent existe.</p> : null }
			<section className="f3-bloc" aria-labelledby="titre-cote">
				<h2 id="titre-cote">Vitesse à { num( hauteur ) } m au-dessus du sol</h2>
				<Legende echelle={ echelle } titre="Vitesse horizontale du vent (échelle commune A et B)" />
				<div className="f3-cartes f3-cartes-2">
					{ ( [ [ a, 'A', 'comparaison-a' ], [ b, 'B', 'comparaison-b' ] ] as const ).map( ( [ s, l, t ] ) => (
						<Carte key={ t } testid={ t } titre={ titre( s, l ) } detail={ s.base.snapshot.snapshot_id } valeurs={ s.carte.valeurs } grille={ grille } echelle={ echelle }
							resume={ s.carte.resume } stations={ s.base.stations.etat === 'ok' ? s.base.stations.val.items : [] } videTexte={ texteCarteVide( s.carte.resume, s.base.meta ) } />
					) ) }
				</div>
			</section>
			<div className="f3-grille-principale">
				<section className="f3-bloc" aria-labelledby="titre-diff">
					<h2 id="titre-diff">Différence B − A</h2>
					<Legende echelle={ echelleDiff } titre="B − A : bleu = baisse, rouge = hausse" absent="absent d’au moins un côté" />
					<Carte testid="comparaison-diff" titre={ `B − A à ${ num( hauteur ) } m au-dessus du sol` } valeurs={ diff } grille={ grille } echelle={ echelleDiff }
						resume={ resumeDiff } videTexte="aucun nœud présent des deux côtés à cette hauteur" />
				</section>
				<aside className="f3-bloc" aria-labelledby="titre-stats-comp" data-testid="comparaison-stats">
					<h2 id="titre-stats-comp">Statistiques (nœuds communs)</h2>
					<dl className="f3-kv">
						<dt>Nœuds présents des deux côtés</dt><dd data-testid="stats-communs">{ pct( stats.communs ) }</dd>
						<dt>Présents en A seulement</dt><dd>{ num( stats.seulementA ) }</dd>
						<dt>Présents en B seulement</dt><dd>{ num( stats.seulementB ) }</dd>
						<dt>Absents des deux côtés</dt><dd>{ num( stats.absentsDesDeux ) }</dd>
						<dt>Vitesse moyenne A</dt><dd>{ withUnit( stats.moyenneA, 'm/s', 2 ) }</dd>
						<dt>Vitesse moyenne B</dt><dd>{ withUnit( stats.moyenneB, 'm/s', 2 ) }</dd>
						<dt>Différence moyenne B − A</dt><dd data-testid="stats-diff-moyenne">{ signe( stats.moyenneDiff ) }</dd>
						<dt>Écart absolu moyen</dt><dd>{ withUnit( stats.moyenneAbsDiff, 'm/s', 2 ) }</dd>
						<dt>Écart quadratique moyen</dt><dd>{ withUnit( stats.rmsDiff, 'm/s', 2 ) }</dd>
						<dt>Plus forte baisse / hausse</dt><dd>{ signe( stats.minDiff ) } / { signe( stats.maxDiff ) }</dd>
					</dl>
					<p className="petit muet">
						Nature des données : A { NATURE[ a.base.snapshot.versions.data_kind ] ?? a.base.snapshot.versions.data_kind }, B { NATURE[ b.base.snapshot.versions.data_kind ] ?? b.base.snapshot.versions.data_kind } ; modèle { a.base.snapshot.versions.model }.
					</p>
					{ stats.communs ? (
						<BoutonCsv testid="comparaison-export" nom={ nomFichier( a.base.snapshot.snapshot_id, 'vs', b.base.snapshot.snapshot_id, `${ hauteur }m-sol`, 'speed' ) }
							generer={ () => csvComparaison( identite( a.base.snapshot ), identite( b.base.snapshot ), a.base.meta, hauteur, a.carte.valeurs, b.carte.valeurs, a.base.terrain ) } />
					) : null }
				</aside>
			</div>
		</>
	);

}
