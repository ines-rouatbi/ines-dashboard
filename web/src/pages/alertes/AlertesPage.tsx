// Page Alertes (lot F4, BF20 à BF23) : affiche fidèlement /v1/alerts/{id}.
// Ouvertes d'abord, du plus grave au moins grave ; les alertes closes forment l'historique.
import { useMemo, useState, type CSSProperties } from 'react';
import type { Alert, AlertLevel, Alerts } from '../shared/types';
import type { Snapshot } from '../../data/contract';
import { ALERT_KIND, ALERT_LEVEL, LEVEL_RANK, NA, num, quantity, utc } from '../shared/format';
import '../shared/pages.css';

const LEVELS: AlertLevel[] = [ 'critique', 'important', 'avertissement', 'information' ];

/** Tri : niveau (le plus grave d'abord), puis première levée (la plus récente d'abord), puis id (ordre stable). */
export function sortAlerts( items: Alert[] ): Alert[] {

	return [ ...items ].sort( ( a, b ) =>
		LEVEL_RANK[ a.level ] - LEVEL_RANK[ b.level ]
		|| b.raised_at.localeCompare( a.raised_at )
		|| a.id.localeCompare( b.id ) );

}

const sansAccents = ( s: string ) => s.normalize( 'NFD' ).replace( /[\u0300-\u036f]/g, '' ).toLowerCase();

/** Filtre texte (UI v2) : tous les mots, sans accents, sur le titre, la cible, la cause, le type et la recommandation. */
export function filtrerAlertes( items: Alert[], q: string ): Alert[] {

	const mots = sansAccents( q ).split( /\s+/ ).filter( Boolean );
	if ( ! mots.length ) return items;
	return items.filter( ( a ) => {

		const t = sansAccents( `${ a.title } ${ a.target } ${ a.cause } ${ ALERT_KIND[ a.kind ] ?? a.kind } ${ a.recommendation } ${ ALERT_LEVEL[ a.level ] }` );
		return mots.every( ( m ) => t.includes( m ) );

	} );

}

function AlertCard( { a, rang = 0 }: { a: Alert; rang?: number } ) {

	const measured = quantity( a.value, a.unit );
	const threshold = quantity( a.threshold, a.unit );
	return (
		<li className={ `atom-alert atom-level-${ a.level }` } data-testid="alert" data-alert-id={ a.id } data-level={ a.level } data-status={ a.status } style={ { '--i': Math.min( rang, 12 ) } as CSSProperties }>
			<header>
				<span className="atom-badge" data-testid="alert-level">{ ALERT_LEVEL[ a.level ] }</span>
				<h3 data-testid="alert-title">{ a.title }</h3>
				<span className="atom-muted" data-testid="alert-status">{ a.status === 'ouverte' ? 'Ouverte' : 'Close' }</span>
			</header>
			<dl className="atom-kv">
				<dt>Type</dt><dd data-testid="alert-kind">{ ALERT_KIND[ a.kind ] ?? a.kind }</dd>
				<dt>Cible</dt><dd data-testid="alert-target">{ a.target }</dd>
				<dt>Cause</dt><dd data-testid="alert-cause">{ a.cause }</dd>
				<dt>Recommandation</dt><dd data-testid="alert-recommendation">{ a.recommendation }</dd>
				<dt>Valeur</dt><dd data-testid="alert-value">{ measured }</dd>
				<dt>Seuil</dt><dd data-testid="alert-threshold">{ threshold }</dd>
				<dt>Première levée</dt><dd data-testid="alert-raised">{ utc( a.raised_at ) }</dd>
				<dt>Position</dt>
				<dd data-testid="alert-location">{ a.location ? `x = ${ num( a.location.x_m / 1000, 1 ) } km, y = ${ num( a.location.y_m / 1000, 1 ) } km` : NA }</dd>
			</dl>
		</li>
	);

}

/**
 * `alerts` = null : snapshot.assets.alerts n'est pas publié pour cet instantané (« non disponible », jamais « 0 alerte »).
 * `decompte` = snapshot.kpi.open_alerts : null quand le module d'alertes (M4) n'a pas tourné. Une liste vide avec un
 * décompte null n'est PAS « aucune alerte » : les alertes n'ont pas été calculées. undefined = décompte inconnu.
 */
export function AlertesPage( { alerts, decompte }: { alerts: Alerts | null; decompte?: Snapshot[ 'kpi' ][ 'open_alerts' ] } ) {

	if ( alerts && alerts.items.length === 0 && decompte === null ) {

		return (
			<section className="atom-page" data-testid="page-alertes">
				<h2>Alertes</h2>
				<p className="atom-muted" data-testid="alerts-not-computed">
					Alertes : { NA }. Aucune alerte n’a été calculée pour cet instantané (liste publiée vide et décompte
					<code> kpi.open_alerts </code> à null : module d’alertes pas encore actif). Ce n’est pas « zéro alerte ».
				</p>
			</section>
		);

	}

	if ( ! alerts ) {

		return (
			<section className="atom-page" data-testid="page-alertes">
				<h2>Alertes</h2>
				<p className="atom-muted" data-testid="no-alerts">Alertes : { NA } (non publiées pour cet instantané).</p>
			</section>
		);

	}
	return <ListeAlertes alerts={ alerts } />;

}

function ListeAlertes( { alerts }: { alerts: Alerts } ) {

	const [ levels, setLevels ] = useState<Set<AlertLevel>>( () => new Set( LEVELS ) );
	const open = useMemo( () => sortAlerts( alerts.items.filter( ( a ) => a.status === 'ouverte' ) ), [ alerts ] );
	const closed = useMemo( () => sortAlerts( alerts.items.filter( ( a ) => a.status === 'close' ) ), [ alerts ] );
	const counts = useMemo( () => Object.fromEntries( LEVELS.map( ( l ) => [ l, open.filter( ( a ) => a.level === l ).length ] ) ) as Record<AlertLevel, number>, [ open ] );
	const toggle = ( l: AlertLevel ) => setLevels( ( s ) => { const n = new Set( s ); if ( n.has( l ) ) n.delete( l ); else n.add( l ); return n; } );
	const [ q, setQ ] = useState( '' );
	const shown = ( a: Alert ) => levels.has( a.level );
	const ouvertes = useMemo( () => filtrerAlertes( open.filter( shown ), q ), [ open, levels, q ] ); // eslint-disable-line react-hooks/exhaustive-deps
	const closes = useMemo( () => filtrerAlertes( closed.filter( shown ), q ), [ closed, levels, q ] ); // eslint-disable-line react-hooks/exhaustive-deps
	const filtre = q.trim() !== '' || levels.size < LEVELS.length;

	return (
		<section className="atom-page" data-testid="page-alertes">
			<h2>Alertes</h2>

			<div className="atom-kpis" role="group" aria-label="Alertes ouvertes par niveau">
				{ LEVELS.map( ( l ) => (
					<button key={ l } type="button" className={ `atom-kpi atom-level-${ l }` } aria-pressed={ levels.has( l ) }
						data-testid={ `count-${ l }` } onClick={ () => toggle( l ) }>
						<span className="atom-kpi-value">{ counts[ l ] }</span>
						<span className="atom-kpi-label">{ ALERT_LEVEL[ l ] }</span>
					</button>
				) ) }
			</div>

			<div className="atom-filtre">
				<input type="search" value={ q } onChange={ ( e ) => setQ( e.target.value ) } placeholder="Filtrer : titre, cible, cause, type…" aria-label="Filtrer les alertes" data-testid="alert-filter" />
				{ filtre ? <span className="atom-muted" role="status" data-testid="alert-filter-count">{ ouvertes.length + closes.length } alerte(s) affichée(s) sur { open.length + closed.length }</span> : null }
			</div>

			<h3>Ouvertes <span className="atom-muted" data-testid="open-total">({ open.length })</span></h3>
			{ open.length === 0
				? <p className="atom-muted" data-testid="no-open">Aucune alerte ouverte.</p>
				: <ul className="atom-alerts" data-testid="alerts-open">{ ouvertes.map( ( a, k ) => <AlertCard key={ a.id } a={ a } rang={ k } /> ) }</ul> }

			<h3>Historique <span className="atom-muted" data-testid="closed-total">({ closed.length })</span></h3>
			{ closed.length === 0
				? <p className="atom-muted" data-testid="no-closed">Aucune alerte close.</p>
				: <ul className="atom-alerts atom-closed" data-testid="alerts-closed">{ closes.map( ( a, k ) => <AlertCard key={ a.id } a={ a } rang={ k } /> ) }</ul> }
		</section>
	);

}
