// Calque de particules de vent animées sur une carte 2D (canevas superposé au raster), UI v2.
//
// Les particules suivent le champ (u, v) PUBLIÉ à la hauteur de la carte (domain/particules.ts : bilinéaire stricte,
// renaissance sur un nœud publié, jamais de vent inventé). Rendu : traînées par estompage du canevas, segments groupés
// par classe de vitesse (un tracé par couleur), tableaux préalloués, aucune allocation par image. Densité selon la
// surface et réduite si les images deviennent lentes ; boucle arrêtée hors écran et onglet caché.
// Animations réduites : flèches statiques (sens où va le vent, longueur selon la vitesse), aucune animation.

import { useEffect, useRef } from 'react';
import {
	aleaGraine, ajusterDensite, avancer, classeVitesse, creerParticules, facteurTemps, flechesStatiques, noeudsValides,
	nombreParticules, peupler, tableCouleurs, versEcran, vitesseMax, type ChampVent, type Particules,
} from '../domain/particules';
import { RAMPE_VITESSE } from './couleurs';
import { useMouvementReduit } from './preferences';

export type PaletteParticules = 'claire' | 'vitesse';

const CLASSES = 8;
const VIE_MAX = 4; // s affichées
const MIN = 120;
/** Particules claires (sur le raster coloré) : de translucide (lent) à blanc (rapide). */
const CLAIRES = tableCouleurs( [ '#DCE6EF', '#FFFFFF' ], CLASSES, 1 );
const VITESSE = tableCouleurs( RAMPE_VITESSE, CLASSES, 0.95 );

interface Prepare { champ: ChampVent; valides: Uint32Array; facteur: number; vmax: number; part: number }

function preparer( c: ChampVent ): Prepare {

	const valides = noeudsValides( c ), vmax = vitesseMax( c ) ?? 0;
	return { champ: c, valides, facteur: facteurTemps( vmax, c.dx, c.dy ), vmax, part: valides.length / ( c.nx * c.ny || 1 ) };

}

export function ChampParticules( { champ, palette = 'claire', vmaxCouleur, testid = 'particules' }: {
	champ: ChampVent | null;
	palette?: PaletteParticules;
	/** Borne haute de l'échelle de couleur (celle de la légende) ; défaut : maximum du champ. */
	vmaxCouleur?: number | null;
	testid?: string;
} ) {

	const ref = useRef<HTMLCanvasElement>( null );
	const reduit = useMouvementReduit();
	const prep = useRef<Prepare | null>( null );
	const version = useRef( 0 );
	const reglages = useRef( { palette, vmaxCouleur } );
	reglages.current = { palette, vmaxCouleur };

	useEffect( () => { prep.current = champ ? preparer( champ ) : null; version.current ++; }, [ champ ] );

	useEffect( () => {

		const canvas = ref.current, ctx = canvas?.getContext( '2d' );
		if ( ! canvas || ! ctx ) return;
		let raf = 0, w = 0, h = 0, dpr = 1, visible = true, vu = - 1, cible = 0, derniere = 0;
		const alea = aleaGraine( 7 );
		const p: Particules = creerParticules( 6000 );
		const seaux = Array.from( { length: CLASSES }, () => new Int32Array( 6000 ) ), nSeau = new Int32Array( CLASSES );
		const durees = new Float32Array( 90 );
		let nDurees = 0;

		const redimensionner = () => {

			const r = canvas.getBoundingClientRect();
			dpr = Math.min( 2, devicePixelRatio || 1 );
			w = r.width; h = r.height;
			canvas.width = Math.max( 1, Math.round( w * dpr ) ); canvas.height = Math.max( 1, Math.round( h * dpr ) );
			ctx.setTransform( dpr, 0, 0, dpr, 0, 0 );
			vu = - 1; // recalcule la cible et redessine
			if ( reduit ) statique();

		};

		const statique = () => {

			ctx.clearRect( 0, 0, w, h );
			const pr = prep.current;
			if ( ! pr || ! w ) return;
			const c = pr.champ, pas = Math.max( 1, Math.ceil( c.nx / Math.max( 8, w / 30 ) ) );
			const cell = w / c.nx * pas;
			ctx.strokeStyle = reglages.current.palette === 'claire' ? 'rgba(255,255,255,.85)' : 'rgba(18,38,58,.8)';
			ctx.lineWidth = 1.2;
			ctx.beginPath();
			for ( const f of flechesStatiques( c, pas ) ) {

				const [ x, y ] = versEcran( f.fi, f.fj, c.nx, c.ny, w, h );
				const L = cell * ( 0.25 + 0.5 * f.s ), ex = x + f.ux * L / 2, ey = y - f.uy * L / 2, sx = x - f.ux * L / 2, sy = y + f.uy * L / 2;
				ctx.moveTo( sx, sy ); ctx.lineTo( ex, ey );
				const a = Math.atan2( - f.uy, f.ux ), t = Math.min( 5, L * 0.35 );
				ctx.moveTo( ex, ey ); ctx.lineTo( ex - t * Math.cos( a - 0.5 ), ey - t * Math.sin( a - 0.5 ) );
				ctx.moveTo( ex, ey ); ctx.lineTo( ex - t * Math.cos( a + 0.5 ), ey - t * Math.sin( a + 0.5 ) );

			}
			ctx.stroke();

		};

		const image = ( t: number ) => {

			raf = requestAnimationFrame( image );
			const pr = prep.current;
			const dt = derniere ? Math.min( 1 / 30, ( t - derniere ) / 1000 ) : 1 / 60;
			if ( derniere ) { durees[ nDurees % durees.length ] = t - derniere; nDurees ++; }
			derniere = t;
			if ( ! pr || ! w || ! pr.valides.length ) { ctx.clearRect( 0, 0, w, h ); return; }
			if ( vu !== version.current ) {

				// Nouveau champ (autre instant, autre hauteur) : la population repart, les traînées s'effacent vite.
				vu = version.current;
				cible = nombreParticules( w, h, pr.part, 140, MIN, p.fi.length );
				p.n = 0;
				peupler( p, cible, pr.champ, pr.valides, alea, VIE_MAX );
				ctx.globalCompositeOperation = 'destination-in';
				ctx.fillStyle = 'rgba(0,0,0,0.35)';
				ctx.fillRect( 0, 0, w, h );

			}
			// Densité adaptative : toutes les 90 images, retire un quart des particules si la moyenne dépasse le budget.
			if ( nDurees >= durees.length ) {

				let s = 0;
				for ( let k = 0; k < durees.length; k ++ ) s += durees[ k ];
				cible = ajusterDensite( cible, s / durees.length, MIN );
				if ( p.n > cible ) p.n = cible;
				nDurees = 0;
				canvas.dataset.n = String( p.n );

			}
			avancer( p, pr.champ, dt, pr.facteur, pr.valides, alea, VIE_MAX );

			// Traînées : estompe ce qui est déjà dessiné.
			ctx.globalCompositeOperation = 'destination-in';
			ctx.fillStyle = 'rgba(0,0,0,0.9)';
			ctx.fillRect( 0, 0, w, h );
			ctx.globalCompositeOperation = 'source-over';

			const { palette: pal, vmaxCouleur: vc } = reglages.current;
			const vmax = vc && vc > 0 ? vc : pr.vmax, table = pal === 'claire' ? CLAIRES : VITESSE;
			nSeau.fill( 0 );
			for ( let k = 0; k < p.n; k ++ ) {

				const c = classeVitesse( p.vitesse[ k ], vmax, CLASSES );
				if ( c >= 0 ) seaux[ c ][ nSeau[ c ] ++ ] = k;

			}
			const sx = w / pr.champ.nx, sy = h / pr.champ.ny;
			ctx.lineWidth = pal === 'claire' ? 1.5 : 1.7;
			ctx.lineCap = 'round';
			for ( let c = 0; c < CLASSES; c ++ ) {

				if ( ! nSeau[ c ] ) continue;
				ctx.strokeStyle = table[ c ];
				ctx.beginPath();
				const s = seaux[ c ];
				for ( let q = 0; q < nSeau[ c ]; q ++ ) {

					const k = s[ q ];
					ctx.moveTo( ( p.pi[ k ] + 0.5 ) * sx, h - ( p.pj[ k ] + 0.5 ) * sy );
					ctx.lineTo( ( p.fi[ k ] + 0.5 ) * sx, h - ( p.fj[ k ] + 0.5 ) * sy );

				}
				ctx.stroke();

			}

		};

		const demarrer = () => {

			cancelAnimationFrame( raf );
			raf = 0;
			if ( reduit ) { statique(); return; }
			if ( visible && document.visibilityState !== 'hidden' ) { derniere = 0; raf = requestAnimationFrame( image ); }

		};

		redimensionner();
		const ro = new ResizeObserver( () => { redimensionner(); demarrer(); } );
		ro.observe( canvas );
		const io = new IntersectionObserver( ( e ) => { visible = e.some( ( x ) => x.isIntersecting ); demarrer(); } );
		io.observe( canvas );
		const vis = () => demarrer();
		document.addEventListener( 'visibilitychange', vis );
		const v0 = version.current;
		// En mouvement réduit, redessiner les flèches quand le champ change.
		const veille = reduit ? setInterval( () => { if ( version.current !== vu ) { vu = version.current; statique(); } }, 250 ) : 0;
		if ( reduit ) vu = v0;
		demarrer();
		return () => { cancelAnimationFrame( raf ); ro.disconnect(); io.disconnect(); document.removeEventListener( 'visibilitychange', vis ); clearInterval( veille ); };

	}, [ reduit ] );

	return <canvas ref={ ref } className="particules" aria-hidden="true" data-testid={ testid } data-mode={ reduit ? 'fleches' : 'anime' } />;

}
