// Scène 3D du champ de vent (three.js) — portage TypeScript de legacy/viz.js.
// Repère scène : x = Est (u), z = -Nord (v), y = altitude (w vers le haut).
//
// Rendu inchangé (sol, grille, boîte du domaine, nord, flèches instanciées colorées par
// vitesse, plan de picking, marqueur de colonne). Ajouts du portage : typage, picking
// programmable (`pickAt`), attente d'une image rendue (`apresRendu`), libération (`dispose`).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Plan } from '../domain/field';

// Palette viridis (vitesse faible -> forte).
const VIRIDIS: [ number, number, number ][] = [
	[ 0.267, 0.005, 0.329 ], [ 0.283, 0.141, 0.458 ], [ 0.254, 0.265, 0.530 ],
	[ 0.207, 0.372, 0.553 ], [ 0.164, 0.471, 0.558 ], [ 0.128, 0.567, 0.551 ],
	[ 0.135, 0.659, 0.518 ], [ 0.267, 0.749, 0.441 ], [ 0.478, 0.821, 0.318 ],
	[ 0.741, 0.873, 0.150 ], [ 0.993, 0.906, 0.144 ],
];

export function viridis( t: number ): [ number, number, number ] {

	t = Math.min( 1, Math.max( 0, t ) );
	const x = t * ( VIRIDIS.length - 1 );
	const i = Math.floor( x ), f = x - i;
	const a = VIRIDIS[ i ], b = VIRIDIS[ Math.min( i + 1, VIRIDIS.length - 1 ) ];
	return [ a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * f, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * f, a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * f ];

}

export function viridisCss( t: number ): string { const c = viridis( t ); return `rgb(${ c.map( ( v ) => Math.round( v * 255 ) ).join( ',' ) })`; }

const W = 100;          // largeur scène (axe x / Est)
const H = 46;           // hauteur scène pour toute la colonne atmosphérique

/** Géométrie du domaine dont la scène a besoin (issue de /v1/meta). */
export interface SceneMeta {
	nx: number;
	ny: number;
	altitudes: number[];
	sizeX?: number | null;
	sizeY?: number | null;
}

/** Résultat d'un picking : indices dans la grille AFFICHÉE (échantillonnée) + fractions du domaine. */
export interface PickResult {
	ix: number;
	iy: number;
	/** Fractions du domaine depuis le coin sud-ouest, dans [0, 1]. */
	fx: number;
	fy: number;
}

export type OnPick = ( p: PickResult ) => void;

export class Viz {

	readonly canvas: HTMLCanvasElement;
	onPick?: OnPick;
	meta: SceneMeta | null = null;
	/** Échelle de vitesse horizontale du plan affiché ; null si aucun nœud valide (pas d'échelle fictive). */
	range: [ number, number ] | null = null;

	readonly renderer: THREE.WebGLRenderer;
	readonly scene: THREE.Scene;
	readonly camera: THREE.PerspectiveCamera;
	readonly controls: OrbitControls;
	readonly world: THREE.Group;

	arrows: THREE.InstancedMesh | null = null;
	pickPlane: THREE.Mesh | null = null;
	marker: THREE.Mesh | null = null;
	terrainGroup: THREE.Group | null = null;
	fieldDims: { nx: number; ny: number; nxNatif: number; nyNatif: number; stride: number } | null = null;
	currentAltScene = 0;
	/** Nombre d'images rendues depuis la création. */
	frames = 0;

	private readonly _ray = new THREE.Raycaster();
	private readonly _dummy = new THREE.Object3D();
	private readonly _color = new THREE.Color();
	private _raf = 0;
	private _attenteRendu: ( () => void )[] = [];
	private readonly _onPointer: ( e: PointerEvent ) => void;
	private readonly _onResize: () => void;
	private readonly _ro: ResizeObserver | null;

	constructor( canvas: HTMLCanvasElement, { onPick }: { onPick?: OnPick } = {} ) {

		this.canvas = canvas;
		this.onPick = onPick;

		this.renderer = new THREE.WebGLRenderer( { canvas, antialias: true, alpha: true } );
		this.renderer.setPixelRatio( Math.min( devicePixelRatio, 2 ) );

		this.scene = new THREE.Scene();
		this.scene.fog = new THREE.FogExp2( 0x0a0e17, 0.0016 );

		this.camera = new THREE.PerspectiveCamera( 50, 1, 0.1, 4000 );
		this.camera.position.set( W * 0.9, H * 1.8, W * 1.25 );

		this.controls = new OrbitControls( this.camera, canvas );
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.08;
		this.controls.maxPolarAngle = Math.PI * 0.49;

		this.scene.add( new THREE.HemisphereLight( 0xbfe4ff, 0x16233a, 1.1 ) );
		const dir = new THREE.DirectionalLight( 0xffffff, 1.4 );
		dir.position.set( 60, 120, 40 );
		this.scene.add( dir );

		this.world = new THREE.Group();
		this.scene.add( this.world );

		this._onPointer = ( e ) => this._handlePick( e );
		this._onResize = () => this._resize();
		canvas.addEventListener( 'pointerdown', this._onPointer );
		addEventListener( 'resize', this._onResize );
		// Le canevas vit dans une mise en page React : on suit aussi sa propre taille.
		this._ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver( this._onResize ) : null;
		this._ro?.observe( canvas );
		this._resize();
		this._animate();

	}

	private _resize() {

		const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
		this.renderer.setSize( w, h, false );
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();

	}

	private _animate() {

		this._raf = requestAnimationFrame( () => this._animate() );
		this.controls.update();
		this.renderer.render( this.scene, this.camera );
		this.frames ++;
		if ( this._attenteRendu.length ) {

			const a = this._attenteRendu;
			this._attenteRendu = [];
			for ( const f of a ) f();

		}

	}

	/** Résout après la prochaine image effectivement rendue. */
	apresRendu(): Promise<void> {

		return new Promise( ( r ) => this._attenteRendu.push( r ) );

	}

	get depth(): number { // profondeur scène (axe z / Nord), proportionnelle au domaine

		if ( this.meta && this.meta.sizeX && this.meta.sizeY ) return W * this.meta.sizeY / this.meta.sizeX;
		if ( this.meta ) return W * this.meta.ny / this.meta.nx;
		return W;

	}

	private _altScene( alt: number ): number { const a = this.meta!.altitudes; const max = a[ a.length - 1 ] || 1000; return ( alt / max ) * H; }

	// Contrat v1 rév. 2 : nœud (i, j) en x0 + i·dx. Le nœud échantillonné (ix, iy) est le nœud
	// natif (ix·stride, iy·stride), placé à la fraction i / (nx − 1) du domaine (nœud 0 → bord ouest).
	private _cellToScene( ix: number, iy: number, yScene: number, p: { nxNatif: number; nyNatif: number; stride: number } ): THREE.Vector3 {

		const D = this.depth;
		return new THREE.Vector3(
			( ( ix * p.stride ) / ( p.nxNatif - 1 || 1 ) - 0.5 ) * W,
			yScene,
			- ( ( iy * p.stride ) / ( p.nyNatif - 1 || 1 ) - 0.5 ) * D,
		);

	}

	setMeta( meta: SceneMeta ) {

		this.meta = meta;
		// Nettoyage.
		this.world.clear();
		const D = this.depth;

		// Sol + grille.
		const ground = new THREE.Mesh(
			new THREE.PlaneGeometry( W, D ),
			new THREE.MeshStandardMaterial( { color: 0x101a2c, roughness: 1, metalness: 0, transparent: true, opacity: 0.85 } ),
		);
		ground.rotation.x = - Math.PI / 2;
		this.world.add( ground );
		const grid = new THREE.GridHelper( Math.max( W, D ), 24, 0x2a3c5a, 0x1b2740 );
		grid.position.y = 0.05;
		this.world.add( grid );

		// Boîte du domaine (colonne atmosphérique).
		const box = new THREE.LineSegments(
			new THREE.EdgesGeometry( new THREE.BoxGeometry( W, H, D ) ),
			new THREE.LineBasicMaterial( { color: 0x33507a, transparent: true, opacity: 0.5 } ),
		);
		box.position.y = H / 2;
		this.world.add( box );
		this.terrainGroup = new THREE.Group();
		this.terrainGroup.add( ground, grid, box );
		this.world.add( this.terrainGroup );

		// Repère Nord.
		const northDir = new THREE.ArrowHelper( new THREE.Vector3( 0, 0, -1 ), new THREE.Vector3( - W / 2, 0.2, - D / 2 ), 12, 0x7aa2ff, 4, 2.4 );
		this.world.add( northDir );

		// Flèches instanciées. On rend toujours une grille ÉCHANTILLONNÉE,
		// donc on alloue le pire cas raisonnable plutôt que la grille native entière.
		const count = Math.min( meta.nx * meta.ny, 16000 );
		const geo = new THREE.ConeGeometry( 0.34, 1, 7 );
		geo.translate( 0, 0.5, 0 ); // base à l'origine, pointe vers +Y
		const mat = new THREE.MeshStandardMaterial( { roughness: 0.45, metalness: 0.1 } );
		this.arrows = new THREE.InstancedMesh( geo, mat, count );
		this.arrows.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
		this.arrows.count = count;
		this.world.add( this.arrows );

		// Plan de picking (invisible) à l'altitude courante.
		this.pickPlane = new THREE.Mesh( new THREE.PlaneGeometry( W, D ), new THREE.MeshBasicMaterial( { visible: false } ) );
		this.pickPlane.rotation.x = - Math.PI / 2;
		this.world.add( this.pickPlane );

		// Marqueur de colonne sélectionnée.
		this.marker = new THREE.Mesh(
			new THREE.CylinderGeometry( 0.6, 0.6, H, 8 ),
			new THREE.MeshBasicMaterial( { color: 0x41d0c4, transparent: true, opacity: 0.25 } ),
		);
		this.marker.position.y = H / 2;
		this.marker.visible = false;
		this.world.add( this.marker );

	}

	setTerrainVisible( on: boolean ) { if ( this.terrainGroup ) this.terrainGroup.visible = on; }

	// Met à jour les flèches pour un plan (un niveau). Le champ est déjà échantillonné :
	// on dessine une flèche par cellule valide reçue.
	setField( field: Plan, { vertical = false }: { vertical?: boolean } = {} ): { range: [ number, number ] | null; shown: number } | undefined {

		if ( ! this.arrows || ! this.pickPlane ) return;
		const { nx, ny, u, v, w, mask, altitude } = field;
		this.fieldDims = { nx, ny, nxNatif: field.nxNatif, nyNatif: field.nyNatif, stride: field.stride };
		// L'InstancedMesh est alloué sur un plafond ; on ne dessine que les nx*ny premières instances.
		const max = this.arrows.instanceMatrix.count;
		this.arrows.count = Math.min( nx * ny, max );
		const y = this._altScene( altitude );
		this.pickPlane.position.y = y;
		this.currentAltScene = y;

		// Échelle min/max de vitesse HORIZONTALE ‖(u, v)‖ (= speed du contrat), relief exclu. Aucun nœud
		// valide (niveau entièrement sous le relief) : pas d'échelle (null), aucune flèche.
		let lo = Infinity, hi = - Infinity;
		for ( let i = 0; i < mask.length; i ++ ) if ( mask[ i ] ) { const s = Math.hypot( u[ i ], v[ i ] ); if ( s < lo ) lo = s; if ( s > hi ) hi = s; }
		this.range = isFinite( lo ) ? [ lo, hi ] : null;

		const up = new THREE.Vector3( 0, 1, 0 );
		const dirV = new THREE.Vector3();
		const q = new THREE.Quaternion();
		let n = 0;
		for ( let iy = 0; iy < ny; iy ++ ) {

			for ( let ix = 0; ix < nx; ix ++ ) {

				const idx = iy * nx + ix;
				if ( idx >= max ) continue;
				if ( ! mask[ idx ] ) { this._dummy.position.set( 0, -9999, 0 ); this._dummy.scale.set( 0, 0, 0 ); this._dummy.updateMatrix(); this.arrows.setMatrixAt( idx, this._dummy.matrix ); continue; }

				const wu = u[ idx ], wv = v[ idx ], ww = vertical ? w[ idx ] : 0;
				const speed = Math.hypot( u[ idx ], v[ idx ] );
				dirV.set( wu, ww, - wv );
				if ( dirV.lengthSq() < 1e-9 ) dirV.set( 0, 1, 0 );
				dirV.normalize();
				q.setFromUnitVectors( up, dirV );

				const t = ( speed - lo ) / ( ( hi - lo ) || 1 );
				const len = 1.6 + 3.8 * t;            // longueur par vitesse
				const pos = this._cellToScene( ix, iy, y, field );

				this._dummy.position.copy( pos );
				this._dummy.quaternion.copy( q );
				this._dummy.scale.set( 1, len, 1 );
				this._dummy.updateMatrix();
				this.arrows.setMatrixAt( idx, this._dummy.matrix );

				const c = viridis( t );
				this._color.setRGB( c[ 0 ], c[ 1 ], c[ 2 ] );
				this.arrows.setColorAt( idx, this._color );
				n ++;

			}

		}

		this.arrows.instanceMatrix.needsUpdate = true;
		if ( this.arrows.instanceColor ) this.arrows.instanceColor.needsUpdate = true;
		return { range: this.range, shown: n };

	}

	showMarker( fx: number, fy: number ) {

		if ( ! this.marker ) return;
		const D = this.depth;
		this.marker.position.set( ( fx - 0.5 ) * W, H / 2, - ( fy - 0.5 ) * D );
		this.marker.visible = true;

	}

	/**
	 * Picking à une position écran (coordonnées client, en px). Affiche le marqueur et
	 * appelle `onPick` ; renvoie le résultat, ou null hors du domaine.
	 */
	pickAt( clientX: number, clientY: number ): PickResult | null {

		if ( ! this.meta || ! this.pickPlane || ! this.fieldDims ) return null;
		const r = this.canvas.getBoundingClientRect();
		const mouse = new THREE.Vector2( ( ( clientX - r.left ) / r.width ) * 2 - 1, - ( ( clientY - r.top ) / r.height ) * 2 + 1 );
		this.camera.updateMatrixWorld();
		this.pickPlane.updateMatrixWorld();
		this._ray.setFromCamera( mouse, this.camera );
		const hit = this._ray.intersectObject( this.pickPlane )[ 0 ];
		if ( ! hit ) return null;
		const D = this.depth;
		const fx = hit.point.x / W + 0.5;
		const fy = - hit.point.z / D + 0.5;
		if ( fx < 0 || fx > 1 || fy < 0 || fy > 1 ) return null;
		this.showMarker( fx, fy );
		// Indices dans la grille affichée + fractions du domaine (pour convertir en mètres).
		const g = this.fieldDims;
		const borne = ( v: number, n: number ) => Math.min( n - 1, Math.max( 0, v ) );
		const ix = borne( Math.round( fx * ( g.nxNatif - 1 ) / g.stride ), g.nx );
		const iy = borne( Math.round( fy * ( g.nyNatif - 1 ) / g.stride ), g.ny );
		const res = { ix, iy, fx, fy };
		if ( this.onPick ) this.onPick( res );
		return res;

	}

	private _handlePick( e: PointerEvent ) { this.pickAt( e.clientX, e.clientY ); }

	dispose() {

		cancelAnimationFrame( this._raf );
		this.canvas.removeEventListener( 'pointerdown', this._onPointer );
		removeEventListener( 'resize', this._onResize );
		this._ro?.disconnect();
		this.controls.dispose();
		this.world.traverse( ( o ) => {

			const m = o as THREE.Mesh;
			m.geometry?.dispose();
			const mat = m.material as THREE.Material | THREE.Material[] | undefined;
			if ( Array.isArray( mat ) ) mat.forEach( ( x ) => x.dispose() ); else mat?.dispose();

		} );
		this.renderer.dispose();
		for ( const f of this._attenteRendu ) f();
		this._attenteRendu = [];

	}

}
