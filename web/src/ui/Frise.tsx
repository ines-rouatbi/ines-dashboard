// Frise temporelle des instantanés publiés (/v1/times) et rejeu (V3D8).
//
// Les instantanés sont placés à leur instant de validité ; un clic en charge un. Le rejeu les
// parcourt du plus ancien au plus récent, en attendant que chacun soit rendu. Avec un seul
// instantané publié, le rejeu est indisponible (et le dit) : on n'invente aucun instant.

import type { TimeItem } from '../data/contract';

const date = ( iso: string ) => new Date( iso ).toLocaleString( 'fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' } ) + ' UTC';

export interface ProprietesFrise {
	items: TimeItem[] | null;
	erreur: string | null;
	courant: string | null;
	latest: string | null;
	lecture: boolean;
	onChoisir: ( id: string | null ) => void;
	onLecture: ( on: boolean ) => void;
}

export function Frise( { items, erreur, courant, latest, lecture, onChoisir, onLecture }: ProprietesFrise ) {

	if ( erreur ) return <div className="frise" data-testid="frise"><span className="muet">Frise temporelle { erreur }</span></div>;
	if ( ! items ) return <div className="frise" data-testid="frise"><span className="muet">Frise : chargement…</span></div>;
	const t = items.map( ( x ) => Date.parse( x.valid_time ) );
	const t0 = Math.min( ...t ), t1 = Math.max( ...t ), span = t1 - t0;
	const pos = ( k: number ) => ( span > 0 ? ( t[ k ] - t0 ) / span : 0.5 ) * 100;
	const courantItem = items.find( ( x ) => x.snapshot_id === courant );
	return (
		<div className="frise" data-testid="frise" data-instantanes={ items.length }>
			<button
				type="button" className="bouton" data-testid="rejeu"
				disabled={ items.length < 2 } onClick={ () => onLecture( ! lecture ) }
				title={ items.length < 2 ? 'Un seul instantané publié : rien à rejouer' : lecture ? 'Arrêter le rejeu' : 'Rejouer les instantanés du plus ancien au plus récent' }
			>{ lecture ? '❚❚ Pause' : '▶ Rejeu' }</button>
			<div className="frise-piste" role="listbox" aria-label="Instantanés publiés">
				{ items.map( ( x, k ) => (
					<button
						key={ x.snapshot_id } type="button" role="option"
						aria-selected={ x.snapshot_id === courant }
						className={ `frise-repere${ x.snapshot_id === courant ? ' actif' : '' }${ x.open_alerts ? ' alerte' : '' }` }
						style={ { left: `${ pos( k ) }%` } }
						title={ `${ date( x.valid_time ) } · ${ x.snapshot_id }${ x.open_alerts != null ? ` · ${ x.open_alerts } alerte(s) ouverte(s)` : '' }` }
						onClick={ () => onChoisir( x.snapshot_id === latest ? null : x.snapshot_id ) }
					/>
				) ) }
			</div>
			<div className="frise-texte num" data-testid="frise-courant">
				{ courantItem ? date( courantItem.valid_time ) : '—' }
				{ courant && courant !== latest ? ' · historique' : ' · dernier' }
				{ ' · ' }{ items.length } instantané{ items.length > 1 ? 's' : '' }
				{ items.length < 2 ? ' (rejeu indisponible)' : '' }
				{ courant && courant !== latest && <button type="button" className="lien" onClick={ () => onChoisir( null ) }>revenir au dernier</button> }
			</div>
		</div>
	);

}
