// Scène 3D du champ de vent (three.js).
// Repère scène : x = Est (u), z = -Nord (v), y = altitude (w vers le haut).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Palette viridis (vitesse faible -> forte).
const VIRIDIS = [
	[ 0.267, 0.005, 0.329 ], [ 0.283, 0.141, 0.458 ], [ 0.254, 0.265, 0.530 ],
	[ 0.207, 0.372, 0.553 ], [ 0.164, 0.471, 0.558 ], [ 0.128, 0.567, 0.551 ],
	[ 0.135, 0.659, 0.518 ], [ 0.267, 0.749, 0.441 ], [ 0.478, 0.821, 0.318 ],
	[ 0.741, 0.873, 0.150 ], [ 0.993, 0.906, 0.144 ],
];

function viridis( t ) {

	t = Math.min( 1, Math.max( 0, t ) );
	const x = t * ( VIRIDIS.length - 1 );
	const i = Math.floor( x ), f = x - i;
	const a = VIRIDIS[ i ], b = VIRIDIS[ Math.min( i + 1, VIRIDIS.length - 1 ) ];
	return [ a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * f, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * f, a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * f ];

}

export function viridisCss( t ) { const c = viridis( t ); return `rgb(${ c.map( ( v ) => Math.round( v * 255 ) ).join( ',' ) })`; }

const W = 100;          // largeur scène (axe x / Est)
const H = 46;           // hauteur scène pour toute la colonne atmosphérique

export class Viz {

	constructor( canvas, { onPick } = {} ) {

		this.canvas = canvas;
		this.onPick = onPick;
		this.meta = null;
		this.range = [ 0, 1 ];

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

		this.arrows = null;
		this.pickPlane = null;
		this.marker = null;

		this._ray = new THREE.Raycaster();
		this._dummy = new THREE.Object3D();
		this._color = new THREE.Color();

		canvas.addEventListener( 'pointerdown', ( e ) => this._handlePick( e ) );
		this._resize();
		addEventListener( 'resize', () => this._resize() );
		this._animate();

	}

	_resize() {

		const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
		this.renderer.setSize( w, h, false );
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();

	}

	_animate() {

		requestAnimationFrame( () => this._animate() );
		this.controls.update();
		this.renderer.render( this.scene, this.camera );

	}

	get depth() { // profondeur scène (axe z / Nord), proportionnelle au domaine

		if ( this.meta && this.meta.sizeX && this.meta.sizeY ) return W * this.meta.sizeY / this.meta.sizeX;
		if ( this.meta ) return W * this.meta.ny / this.meta.nx;
		return W;

	}

	_altScene( alt ) { const max = this.meta.altitudes[ this.meta.altitudes.length - 1 ] || 1000; return ( alt / max ) * H; }

	_cellToScene( ix, iy, yScene, gnx, gny ) {

		const D = this.depth;
		return new THREE.Vector3(
			( ix / ( gnx - 1 ) - 0.5 ) * W,
			yScene,
			- ( iy / ( gny - 1 ) - 0.5 ) * D,
		);

	}

	setMeta( meta ) {

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

		// Repère Nord.
		const northDir = new THREE.ArrowHelper( new THREE.Vector3( 0, 0, -1 ), new THREE.Vector3( - W / 2, 0.2, - D / 2 ), 12, 0x7aa2ff, 4, 2.4 );
		this.world.add( northDir );

		// Flèches instanciées. On rend toujours une grille ÉCHANTILLONNÉE (stride ≥ 4),
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

	setTerrainVisible( on ) { if ( this.terrainGroup ) this.terrainGroup.visible = on; }

	// Met à jour les flèches pour un plan (un niveau). Le champ est déjà échantillonné
	// (stride serveur/démo) : on dessine une flèche par cellule valide reçue.
	setField( field, { vertical = false } = {} ) {

		if ( ! this.arrows ) return;
		const { nx, ny, u, v, w, mask, altitude } = field;
		this.fieldDims = { nx, ny };
		// L'InstancedMesh est alloué sur la grille native ; un champ échantillonné en a moins.
		// On ne dessine que les nx*ny premières instances.
		this.arrows.count = Math.min( nx * ny, this.arrows.instanceMatrix.count );
		const y = this._altScene( altitude );
		this.pickPlane.position.y = y;
		this.currentAltScene = y;

		// Échelle min/max de vitesse (en excluant le relief).
		let lo = Infinity, hi = - Infinity;
		for ( let i = 0; i < mask.length; i ++ ) if ( mask[ i ] ) { const s = Math.hypot( u[ i ], v[ i ], w[ i ] ); if ( s < lo ) lo = s; if ( s > hi ) hi = s; }
		if ( ! isFinite( lo ) ) { lo = 0; hi = 1; }
		this.range = [ lo, hi ];

		const up = new THREE.Vector3( 0, 1, 0 );
		const dirV = new THREE.Vector3();
		const q = new THREE.Quaternion();
		let n = 0;
		for ( let iy = 0; iy < ny; iy ++ ) {

			for ( let ix = 0; ix < nx; ix ++ ) {

				const idx = iy * nx + ix;
				if ( ! mask[ idx ] ) { this._dummy.position.set( 0, -9999, 0 ); this._dummy.scale.set( 0, 0, 0 ); this._dummy.updateMatrix(); this.arrows.setMatrixAt( idx, this._dummy.matrix ); continue; }

				const wu = u[ idx ], wv = v[ idx ], ww = vertical ? w[ idx ] : 0;
				const speed = Math.hypot( u[ idx ], v[ idx ], w[ idx ] );
				dirV.set( wu, ww, - wv );
				if ( dirV.lengthSq() < 1e-9 ) dirV.set( 0, 1, 0 );
				dirV.normalize();
				q.setFromUnitVectors( up, dirV );

				const t = ( speed - lo ) / ( hi - lo || 1 );
				const len = 1.6 + 3.8 * t;            // longueur par vitesse
				const pos = this._cellToScene( ix, iy, y, nx, ny );

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

	showMarker( fx, fy ) {

		const D = this.depth;
		this.marker.position.set( ( fx - 0.5 ) * W, H / 2, - ( fy - 0.5 ) * D );
		this.marker.visible = true;

	}

	_handlePick( e ) {

		if ( ! this.meta || ! this.pickPlane || ! this.fieldDims ) return;
		const r = this.canvas.getBoundingClientRect();
		const mouse = new THREE.Vector2( ( ( e.clientX - r.left ) / r.width ) * 2 - 1, - ( ( e.clientY - r.top ) / r.height ) * 2 + 1 );
		this._ray.setFromCamera( mouse, this.camera );
		const hit = this._ray.intersectObject( this.pickPlane )[ 0 ];
		if ( ! hit ) return;
		const D = this.depth;
		const fx = hit.point.x / W + 0.5;
		const fy = - hit.point.z / D + 0.5;
		if ( fx < 0 || fx > 1 || fy < 0 || fy > 1 ) return;
		this.showMarker( fx, fy );
		// Indices dans la grille affichée + fractions du domaine (pour convertir en mètres).
		const ix = Math.round( fx * ( this.fieldDims.nx - 1 ) );
		const iy = Math.round( fy * ( this.fieldDims.ny - 1 ) );
		if ( this.onPick ) this.onPick( ix, iy, fx, fy );

	}

}
