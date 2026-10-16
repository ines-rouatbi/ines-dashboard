// Vue d'ensemble, « Vent en mouvement » (UI v2) : grande carte de la vitesse horizontale à une hauteur au-dessus du
// sol (D6) avec des particules qui suivent le vent publié (u, v) à cette hauteur, choix de la hauteur et frise des
// instants publiés avec lecture automatique.
//
// Justesse : les cartes sont celles des instantanés publiés (chargerCartes : relief + h par colonne) ; changer
// d'instant ou de hauteur fait un FONDU d'affichage entre deux cartes publiées, sans valeur interpolée ; les
// particules sont une visualisation à temps accéléré. L'instant affiché est partagé (ui/instant.ts) avec
// l'Exploration 3D et la palette de commandes ; un instant autre que le dernier est signalé « historique ».

import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from '../../data';
import type { Snapshot } from '../../data/contract';
import type { ChampVent } from '../../domain/particules';
import { Frise, useLectureFrise } from '../../ui/Frise';
import { choisirInstant, useInstantChoisi, useTimes } from '../../ui/instant';
import { SqueletteCarte } from '../../ui/Squelette';
import { NA, num, utc } from '../shared/format';
import { Carte, Legende, bornesEchelle, type Echelle } from './Carte';
import { cacheChamps, useAsync } from './commun';
import { RAMPE_VITESSE } from './couleurs';
import { chargerCartes, sha8Modele, type Base, type CarteSol } from './donnees';
import { texteCarteVide } from './Ensemble';

export const HAUTEURS_VIVANTE = [ 10, 100, 120, 300, 1000 ] as const;

interface Vivante { snapshot: Snapshot; base: Pick<Base, 'meta' | 'terrain'>; vitesse: CarteSol; vent: ChampVent | null; erreurVent: string | null }

/** Carte de vitesse et vent (u, v) d'un instant publié à une hauteur au-dessus du sol. */
async function chargerVivante( id: string, h: number, ref: Base, signal: AbortSignal ): Promise<Vivante> {

	const snapshot = id === ref.snapshot.snapshot_id ? ref.snapshot : await api.snapshot( id, signal );
	const memeModele = sha8Modele( id ) === sha8Modele( ref.snapshot.snapshot_id );
	const meta = memeModele ? ref.meta : await api.meta( sha8Modele( id ), signal );
	const terrain = memeModele ? ref.terrain : await api.terrain( snapshot.assets.terrain, signal );
	const base = { snapshot, meta, terrain };
	const publie = meta.fields.includes( 'u' ) && meta.fields.includes( 'v' );
	const [ [ vitesse ], uv ] = await Promise.all( [
		chargerCartes( cacheChamps, base, 'speed', [ h ] ),
		publie ? Promise.all( [ chargerCartes( cacheChamps, base, 'u', [ h ] ), chargerCartes( cacheChamps, base, 'v', [ h ] ) ] ).catch( ( e: Error ) => e ) : Promise.resolve( null ),
	] );
	const g = meta.grid;
	const vent = Array.isArray( uv ) ? { nx: g.nx, ny: g.ny, dx: g.dx_m, dy: g.dy_m, u: uv[ 0 ][ 0 ].valeurs, v: uv[ 1 ][ 0 ].valeurs } : null;
	const erreurVent = uv instanceof Error ? uv.message : publie ? null : 'u et v non publiés par ce modèle';
	return { snapshot, base: { meta, terrain }, vitesse, vent, erreurVent };

}

export function CarteVivante( { base }: { base: Base } ) {

	const latestId = base.snapshot.snapshot_id;
	const choisi = useInstantChoisi();
	const times = useTimes( latestId );
	const items = times.etat === 'ok' ? times.items : null;
	// Un instant choisi ailleurs mais absent de la liste publiée n'est pas affiché : on reste sur le dernier.
	const id = choisi && ( ! items || items.some( ( x ) => x.snapshot_id === choisi ) ) ? choisi : latestId;
	const [ h, setH ] = useState<number>( 100 );
	const [ particules, setParticules ] = useState( true );
	const [ fond, setFond ] = useState( true );
	const cle = `${ id }|${ h }`;
	const c = useAsync( cle, ( s ) => chargerVivante( id, h, base, s ) );
	// Garde la dernière carte affichée pendant le chargement de la suivante (le fondu part de celle-ci).
	const derniere = useRef<Vivante | null>( null );
	if ( c.etat === 'ok' ) derniere.current = c.val;
	const d = c.etat === 'ok' ? c.val : derniere.current;

	const choisir = useCallback( ( x: string | null ) => choisirInstant( x === latestId ? null : x ), [ latestId ] );
	const lecteur = useLectureFrise( { items, courant: id, latest: latestId, pret: c.etat === 'ok', onChoisir: choisir } );

	const echelle = useMemo<Echelle>( () => ( { kind: 'continue', ...bornesEchelle( d?.vitesse.resume.max ?? null, 2 ), rampe: RAMPE_VITESSE, unite: 'm/s', decimales: 1 } ), [ d ] );
	const g = ( d?.base ?? base ).meta.grid;
	const grille = { nx: g.nx, ny: g.ny, dx: g.dx_m, dy: g.dy_m, x0: g.x0_m, y0: g.y0_m };
	const historique = id !== latestId;

	return (
		<section className="f3-bloc vivante" aria-labelledby="titre-vivante" data-testid="carte-vivante">
			<div className="vivante-entete">
				<div>
					<h2 id="titre-vivante">Vent en mouvement</h2>
					<p className="petit muet">
						Vitesse horizontale à { num( h ) } m au-dessus du sol (relief + h par colonne) ; les particules suivent le vent publié (u, v) à
						cette hauteur, en temps accéléré. Passer la souris : valeur et direction d’où vient le vent.
					</p>
				</div>
				<div className="vivante-instant num" data-testid="vivante-instant">
					{ d ? utc( d.snapshot.valid_time ) : '…' }
					{ historique ? <span className="etiquette-historique">historique</span> : <span className="etiquette-dernier">dernier</span> }
				</div>
			</div>
			<div className="f3-controles">
				<div role="group" aria-label="Hauteur au-dessus du sol" className="f3-boutons">
					{ HAUTEURS_VIVANTE.map( ( x ) => (
						<button key={ x } type="button" aria-pressed={ x === h } onClick={ () => setH( x ) } data-testid={ `vivante-hauteur-${ x }` }>{ num( x ) } m</button>
					) ) }
				</div>
				<label className="en-ligne petit"><input type="checkbox" checked={ particules } onChange={ ( e ) => setParticules( e.target.checked ) } /> Particules</label>
				<label className="en-ligne petit"><input type="checkbox" checked={ fond } onChange={ ( e ) => setFond( e.target.checked ) } /> Fond de vitesse</label>
				{ c.etat === 'attente' && d ? <span className="petit muet" role="status">chargement de l’instant…</span> : null }
			</div>
			{ c.etat === 'erreur' ? <p className="f3-erreur" role="alert">Carte : { c.message }</p> : null }
			{ d ? (
				<>
					<Legende echelle={ echelle } titre="Vitesse horizontale du vent" />
					<div className={ fond ? 'vivante-carte' : 'vivante-carte sans-fond' }>
						<Carte
							testid="vivante" classe="f3-carte-grande"
							titre={ `${ num( h ) } m au-dessus du sol · ${ utc( d.snapshot.valid_time ) }` }
							detail={ historique ? 'instant historique' : undefined }
							valeurs={ d.vitesse.valeurs } grille={ grille } echelle={ echelle } resume={ d.vitesse.resume }
							videTexte={ texteCarteVide( d.vitesse.resume, d.base.meta ) }
							vent={ d.vent } particules={ particules && !! d.vent } palette={ fond ? 'claire' : 'vitesse' }
						/>
					</div>
					{ d.erreurVent ? <p className="petit muet">Particules : { NA } ({ d.erreurVent }).</p> : null }
				</>
			) : c.etat === 'attente' ? <SqueletteCarte texte="carte animée : chargement…" ratio={ `${ g.nx * g.dx_m } / ${ g.ny * g.dy_m }` } /> : null }
			<Frise
				testid="vivante-frise"
				items={ items } erreur={ times.etat === 'erreur' ? times.message : null }
				courant={ id } latest={ latestId } lecture={ lecteur.lecture }
				onChoisir={ ( x ) => { lecteur.setLecture( false ); choisir( x ); } }
				onLecture={ lecteur.setLecture } vitesse={ lecteur.vitesse } onVitesse={ lecteur.setVitesse } attenteMs={ lecteur.attenteMs }
			/>
		</section>
	);

}
