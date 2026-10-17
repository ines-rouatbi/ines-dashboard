// Scène 3D du champ de vent (three.js), lot F2.
//
// Le groupe « monde » est en MÈTRES (repère local de scene/tampons.ts : X = Est, Y = altitude mer,
// Z = −Nord) ; son échelle (S, S·exagération, S) le ramène à W unités de large. Changer l'exagération
// ne modifie donc qu'une échelle : aucun tampon n'est reconstruit (V3D10). Les objets qui ne doivent
// pas être déformés (têtes d'éoliennes et de capteurs, étiquettes, flèche du nord) vivent hors du groupe
// et sont repositionnés à partir de leurs coordonnées locales.
//
// Contenu : relief ombré (/v1/terrain, teinte hypsométrique, lumière du nord-ouest), socle, boîte du
// domaine, nord, barre d'échelle ; lignes de courant (LineSegments, tampons préalloués, sens de
// l'écoulement animé dans le shader) ; coupe horizontale et coupe verticale ; capteurs et éoliennes
// (InstancedMesh) ; marqueur de la colonne cliquée. Picking analytique (rayon / surface) : pas de
// lancer de rayon sur 250 000 triangles.
//
// UI v2 : traceurs lumineux qui avancent le long des lignes de courant (Points, tampons préalloués, mis à jour sans
// allocation : scene/traceurs.ts) ; fondu d'affichage des lignes quand le plan change (autre instant, autre hauteur) ;
// caméra animée (« voler vers » le point cliqué, vues prédéfinies dessus / sud / est / isométrique) ; rotation
// automatique douce en option. Animations réduites : traceurs masqués, transitions instantanées, pas de rotation.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { intersecterSurface, libelleDistance, longueurEchelle } from '../domain/maillage';
import { bilineaireTolerante } from '../domain/lignes';
import { teinteRelief, type TamponLignes, type TamponMaillage } from './tampons';
import { Traceurs } from './traceurs';
import { mouvementReduit, surPreferences } from '../ui/preferences';

/** Largeur de la scène (unités three.js) pour l'étendue Est du domaine. */
const W = 100;
/** Capacité des lignes de courant (segments) : tampon alloué une fois. */
export const CAPACITE_SEGMENTS = 60_000;
/** Capacité des traceurs animés (points) : tampon alloué une fois. */
export const CAPACITE_TRACEURS = 4000;

export type VueCamera = 'dessus' | 'sud' | 'est' | 'iso';

/** Courbe des transitions de caméra (douce aux deux bouts). */
const doux = ( t: number ) => ( t < 0.5 ? 4 * t * t * t : 1 - ( - 2 * t + 2 ) ** 3 / 2 );

export interface DomaineScene {
	nx: number;
	ny: number;
	dx: number;
	dy: number;
	/** Étendue entre le premier et le dernier nœud, m. */
	sizeX: number;
	sizeY: number;
	/** Relief du modèle, ny·nx, m au-dessus de la mer. */
	terrain: Float32Array;
	/** Altitude du niveau le plus haut, m (haut de la boîte du domaine). */
	zHaut: number;
	/** georef.rotation_deg : angle de l'axe x depuis l'Est, sens antihoraire. */
	rotationDeg: number;
}

/** Point cliqué, en mètres relatifs au nœud (0, 0) : x = x_m − x0, y = y_m − y0. */
export interface PickResult { x: number; y: number; z: number; fx: number; fy: number }

export type OnPick = ( p: PickResult ) => void;

export interface Repere { x: number; y: number; zSol: number; zHaut: number; couleur: [ number, number, number ] }

export interface Visibilite { relief: boolean; lignes: boolean; coupeH: boolean; coupeV: boolean; stations: boolean; eoliennes: boolean }

const lin = ( c: number ) => ( c <= 0.04045 ? c / 12.92 : ( ( c + 0.055 ) / 1.055 ) ** 2.4 );

/** Copie sRGB → linéaire (les matériaux standard travaillent en linéaire). */
function versLineaire( src: Float32Array ): Float32Array {

	const out = new Float32Array( src.length );
	for ( let k = 0; k < src.length; k ++ ) out[ k ] = lin( src[ k ] );
	return out;

}

function etiquette( texte: string, taille = 3.2, fond = 'rgba(18,38,58,0.85)' ): THREE.Sprite {

	const c = document.createElement( 'canvas' ), ctx = c.getContext( '2d' )!;
	const px = 48;
	ctx.font = `600 ${ px }px Inter, system-ui, sans-serif`;
	const w = Math.ceil( ctx.measureText( texte ).width ) + 28;
	c.width = w; c.height = px + 24;
	ctx.font = `600 ${ px }px Inter, system-ui, sans-serif`;
	ctx.fillStyle = fond;
	ctx.beginPath(); ctx.roundRect( 0, 0, c.width, c.height, 12 ); ctx.fill();
	ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.fillText( texte, 14, c.height / 2 + 2 );
	const tex = new THREE.CanvasTexture( c );
	tex.colorSpace = THREE.SRGBColorSpace;
	const s = new THREE.Sprite( new THREE.SpriteMaterial( { map: tex, depthTest: false, transparent: true } ) );
	s.scale.set( taille * c.width / c.height, taille, 1 );
	s.renderOrder = 10;
	return s;

}

const VERTEX_LIGNES = /* glsl */`
attribute vec3 aCouleur;
attribute float aPhase;
varying vec3 vCouleur;
varying float vPhase;
void main() {
	vCouleur = aCouleur;
	vPhase = aPhase;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const FRAGMENT_LIGNES = /* glsl */`
uniform float uTemps;
uniform float uAnime;
uniform float uOpacite;
varying vec3 vCouleur;
varying float vPhase;
void main() {
	// Traits qui avancent dans le sens de l'écoulement (phase = abscisse curviligne, en cellules).
	float f = fract( vPhase * 0.18 - uTemps * 0.5 );
	float a = mix( 0.95, 0.30 + 0.70 * smoothstep( 0.0, 0.85, f ), uAnime );
	gl_FragColor = vec4( vCouleur, a * uOpacite );
}`;

const VERTEX_TRACEURS = /* glsl */`
attribute vec3 aCouleur;
uniform float uTaille;
varying vec3 vCouleur;
void main() {
	vCouleur = aCouleur;
	vec4 mv = modelViewMatrix * vec4( position, 1.0 );
	gl_Position = projectionMatrix * mv;
	gl_PointSize = clamp( uTaille * 140.0 / max( 1.0, - mv.z ), 2.0, 9.0 * uTaille / 4.0 );
}`;

const FRAGMENT_TRACEURS = /* glsl */`
uniform float uOpacite;
varying vec3 vCouleur;
void main() {
	// Point rond à cœur blanc et halo coloré.
	float r = length( gl_PointCoord - 0.5 );
	if ( r > 0.5 ) discard;
	float a = smoothstep( 0.5, 0.05, r );
	vec3 c = mix( vCouleur, vec3( 1.0 ), smoothstep( 0.22, 0.0, r ) * 0.8 );
	gl_FragColor = vec4( c, a * uOpacite );
}`;

export class Viz {

	readonly canvas: HTMLCanvasElement;
	onPick?: OnPick;
	readonly renderer: THREE.WebGLRenderer;
	readonly scene: THREE.Scene;
	readonly camera: THREE.PerspectiveCamera;
	readonly controls: OrbitControls;
	/** Groupe en mètres (voir l'en-tête). */
	readonly monde: THREE.Group;
	readonly hors: THREE.Group;

	domaine: DomaineScene | null = null;
	exageration = 5;
	/** Nombre d'images rendues depuis la création. */
	frames = 0;
	/** Segments de lignes de courant affichés. */
	segments = 0;

	private relief: THREE.Mesh | null = null;
	private socle: THREE.Mesh | null = null;
	private boite: THREE.LineSegments | null = null;
	private echelle: THREE.Group | null = null;
	private nord: THREE.Group | null = null;
	private readonly lignes: THREE.LineSegments;
	private readonly matLignes: THREE.ShaderMaterial;
	private readonly coupeH: THREE.Mesh;
	private readonly coupeV: THREE.Mesh;
	private readonly marqueur: THREE.Line;
	private readonly teteMarqueur: THREE.Mesh;
	private stations: { tiges: THREE.LineSegments; tetes: THREE.InstancedMesh; reperes: Repere[] } | null = null;
	private eoliennes: { tiges: THREE.LineSegments; tetes: THREE.InstancedMesh; reperes: Repere[] } | null = null;
	private marqueurLocal: THREE.Vector3 | null = null;
	private etiquettes: { sprite: THREE.Sprite; local: THREE.Vector3; dy: number }[] = [];
	private surfacePick: ( ( x: number, y: number ) => number ) | null = null;
	private anime = true;
	/** Traceurs animés le long des lignes (UI v2). */
	private readonly traceurs = new Traceurs( CAPACITE_TRACEURS );
	private readonly points: THREE.Points;
	private readonly matPoints: THREE.ShaderMaterial;
	private traceursActifs = true;
	/** « Voler vers » le point cliqué (clic de l'utilisatrice, jamais le picking du crochet de test). */
	volerAuClic = true;
	private _tween: { t0: number; duree: number; p0: THREE.Vector3; p1: THREE.Vector3; c0: THREE.Vector3; c1: THREE.Vector3 } | null = null;
	private _fondu = 0;
	private _reduit = mouvementReduit();
	private _rotation = false;
	private readonly _desabo: () => void;
	private readonly _boucle: () => void;
	private _tPrec = 0;

	private readonly _ray = new THREE.Raycaster();
	private readonly _m = new THREE.Matrix4();
	private readonly _v = new THREE.Vector3();
	private readonly _horloge = new THREE.Clock();
	private _raf = 0;
	private _attenteRendu: ( () => void )[] = [];
	private _derniere = 0;
	private readonly _durees = new Float32Array( 240 );
	private _nDurees = 0;
	private readonly _onPointerDown: ( e: PointerEvent ) => void;
	private readonly _onPointerUp: ( e: PointerEvent ) => void;
	private _appui: { x: number; y: number } | null = null;
	private readonly _onResize: () => void;
	private readonly _ro: ResizeObserver | null;

	constructor( canvas: HTMLCanvasElement, { onPick }: { onPick?: OnPick } = {} ) {

		this.canvas = canvas;
		this.onPick = onPick;

		this.renderer = new THREE.WebGLRenderer( { canvas, antialias: true, alpha: true, powerPreference: 'high-performance' } );
		// Plafond 1,5 : la finesse au-delà ne se voit pas et coûte des FPS sur un portable (V3D10).
		this.renderer.setPixelRatio( Math.min( devicePixelRatio, 1.5 ) );

		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera( 45, 1, 0.5, 2000 );
		this.camera.position.set( W * 0.55, W * 0.55, W * 0.85 );

		this.controls = new OrbitControls( this.camera, canvas );
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.08;
		this.controls.maxPolarAngle = Math.PI * 0.495;
		this.controls.minDistance = 8;
		this.controls.maxDistance = 400;

		// Lumière d'estompage classique : azimut 315° (nord-ouest), élévation 45°.
		this.scene.add( new THREE.HemisphereLight( 0xf2f5f8, 0x3b3226, 1.15 ) );
		const soleil = new THREE.DirectionalLight( 0xffffff, 2.1 );
		soleil.position.set( - 1, Math.SQRT2, - 1 ).multiplyScalar( 100 );
		this.scene.add( soleil );

		this.monde = new THREE.Group();
		this.hors = new THREE.Group();
		this.scene.add( this.monde, this.hors );

		// Lignes de courant : tampons préalloués, jamais recréés.
		const gl = new THREE.BufferGeometry();
		const n = CAPACITE_SEGMENTS * 2;
		gl.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( n * 3 ), 3 ).setUsage( THREE.DynamicDrawUsage ) );
		gl.setAttribute( 'aCouleur', new THREE.BufferAttribute( new Float32Array( n * 3 ), 3 ).setUsage( THREE.DynamicDrawUsage ) );
		gl.setAttribute( 'aPhase', new THREE.BufferAttribute( new Float32Array( n ), 1 ).setUsage( THREE.DynamicDrawUsage ) );
		gl.setDrawRange( 0, 0 );
		this.matLignes = new THREE.ShaderMaterial( {
			vertexShader: VERTEX_LIGNES, fragmentShader: FRAGMENT_LIGNES,
			uniforms: { uTemps: { value: 0 }, uAnime: { value: 1 }, uOpacite: { value: 1 } }, transparent: true, depthWrite: false,
		} );
		this.lignes = new THREE.LineSegments( gl, this.matLignes );
		this.lignes.frustumCulled = false;
		this.lignes.renderOrder = 3;

		const matCoupe = () => new THREE.MeshBasicMaterial( { vertexColors: true, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: - 1, polygonOffsetUnits: - 1 } );
		this.coupeH = new THREE.Mesh( new THREE.BufferGeometry(), matCoupe() );
		this.coupeV = new THREE.Mesh( new THREE.BufferGeometry(), matCoupe() );
		this.coupeH.frustumCulled = this.coupeV.frustumCulled = false;
		this.coupeH.renderOrder = 1; this.coupeV.renderOrder = 2;

		const gm = new THREE.BufferGeometry().setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( 6 ), 3 ) );
		this.marqueur = new THREE.Line( gm, new THREE.LineBasicMaterial( { color: 0x41d0c4, depthTest: false, transparent: true } ) );
		this.marqueur.visible = false;
		this.marqueur.frustumCulled = false;
		this.marqueur.renderOrder = 9;
		this.teteMarqueur = new THREE.Mesh( new THREE.SphereGeometry( 0.7, 16, 12 ), new THREE.MeshBasicMaterial( { color: 0x41d0c4, depthTest: false } ) );
		this.teteMarqueur.visible = false;
		this.teteMarqueur.renderOrder = 9;
		// Traceurs : positions et couleurs préallouées, réécrites à chaque image sur la plage utile.
		const gp = new THREE.BufferGeometry();
		gp.setAttribute( 'position', new THREE.BufferAttribute( this.traceurs.positions, 3 ).setUsage( THREE.DynamicDrawUsage ) );
		gp.setAttribute( 'aCouleur', new THREE.BufferAttribute( this.traceurs.couleurs, 3 ).setUsage( THREE.DynamicDrawUsage ) );
		gp.setDrawRange( 0, 0 );
		this.matPoints = new THREE.ShaderMaterial( {
			vertexShader: VERTEX_TRACEURS, fragmentShader: FRAGMENT_TRACEURS,
			uniforms: { uTaille: { value: 4 }, uOpacite: { value: 1 } },
			transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
		} );
		this.points = new THREE.Points( gp, this.matPoints );
		this.points.frustumCulled = false;
		this.points.renderOrder = 4;
		this.monde.add( this.lignes, this.points, this.coupeH, this.coupeV, this.marqueur );
		this.hors.add( this.teteMarqueur );

		this._onPointerDown = ( e ) => { this._appui = { x: e.clientX, y: e.clientY }; this._tween = null; };
		// Un clic (pas une rotation de caméra) déclenche le picking.
		this._onPointerUp = ( e ) => {

			const a = this._appui;
			this._appui = null;
			if ( a && Math.hypot( e.clientX - a.x, e.clientY - a.y ) < 5 ) this.pickAt( e.clientX, e.clientY, this.volerAuClic );

		};
		this._onResize = () => this._resize();
		canvas.addEventListener( 'pointerdown', this._onPointerDown );
		canvas.addEventListener( 'pointerup', this._onPointerUp );
		addEventListener( 'resize', this._onResize );
		this._ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver( this._onResize ) : null;
		this._ro?.observe( canvas );
		this._desabo = surPreferences( () => { this._reduit = mouvementReduit(); this._appliquerMouvement(); } );
		this._boucle = () => this._animate();
		this._appliquerMouvement();
		this._resize();
		this._animate();

	}

	/** Animations réduites : pas de traits animés, de traceurs, de rotation ni de transitions. */
	private _appliquerMouvement() {

		this.matLignes.uniforms.uAnime.value = this.anime && ! this._reduit ? 1 : 0;
		this.points.visible = this.anime && this.traceursActifs && ! this._reduit && this.traceurs.n > 0;
		this.controls.autoRotate = this._rotation && ! this._reduit;

	}

	private _resize() {

		const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
		this.renderer.setSize( w, h, false );
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();

	}

	private _animate() {

		this._raf = requestAnimationFrame( this._boucle );
		const t = performance.now();
		if ( this._derniere ) { this._durees[ this._nDurees % this._durees.length ] = t - this._derniere; this._nDurees ++; }
		this._derniere = t;
		const dt = this._tPrec ? Math.min( 0.05, ( t - this._tPrec ) / 1000 ) : 1 / 60;
		this._tPrec = t;
		const tw = this._tween;
		if ( tw ) {

			const f = Math.min( 1, ( t - tw.t0 ) / tw.duree ), e = doux( f );
			this.camera.position.lerpVectors( tw.p0, tw.p1, e );
			this.controls.target.lerpVectors( tw.c0, tw.c1, e );
			if ( f >= 1 ) this._tween = null;

		}
		this.controls.update( dt );
		if ( this.anime && ! this._reduit ) this.matLignes.uniforms.uTemps.value = this._horloge.getElapsedTime();
		// Fondu d'affichage des lignes et des traceurs après un changement de plan (aucune donnée interpolée).
		if ( this._fondu ) {

			const f = Math.min( 1, ( t - this._fondu ) / 650 );
			this.matLignes.uniforms.uOpacite.value = this.matPoints.uniforms.uOpacite.value = 0.15 + 0.85 * doux( f );
			if ( f >= 1 ) this._fondu = 0;

		}
		if ( this.points.visible ) {

			this.traceurs.avancer( dt, 7 );
			const g = this.points.geometry, n = this.traceurs.n;
			for ( const a of [ 'position', 'aCouleur' ] ) {

				const at = g.attributes[ a ] as THREE.BufferAttribute;
				at.clearUpdateRanges();
				at.addUpdateRange( 0, n * 3 );
				at.needsUpdate = true;

			}

		}
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

	/** FPS mesurés sur les dernières images (moyenne et 5e centile), ou null avant 10 images. */
	fps(): { moyenne: number; p5: number; images: number } | null {

		const n = Math.min( this._nDurees, this._durees.length );
		if ( n < 10 ) return null;
		const d = Array.from( this._durees.subarray( 0, n ) ).sort( ( a, b ) => a - b );
		const moy = d.reduce( ( s, x ) => s + x, 0 ) / n;
		return { moyenne: Math.round( 1000 / moy * 10 ) / 10, p5: Math.round( 1000 / d[ Math.floor( 0.95 * ( n - 1 ) ) ] * 10 ) / 10, images: n };

	}

	/** Tourne la caméra de `deg` degrés autour de l'axe vertical, puis attend l'image rendue. */
	orbit( deg: number ): Promise<void> {

		const off = this._v.copy( this.camera.position ).sub( this.controls.target );
		off.applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), deg * Math.PI / 180 );
		this.camera.position.copy( this.controls.target ).add( off );
		this.controls.update();
		return this.apresRendu();

	}

	// --- Domaine, relief, socle, nord, échelle ----------------------------------------------

	private get S(): number { return this.domaine ? W / ( this.domaine.sizeX || 1 ) : 1; }

	private _vider( o: THREE.Object3D | null ) {

		if ( ! o ) return;
		o.parent?.remove( o );
		o.traverse( ( x ) => {

			const m = x as THREE.Mesh;
			m.geometry?.dispose();
			const mat = m.material as THREE.Material | THREE.Material[] | undefined;
			for ( const mm of Array.isArray( mat ) ? mat : mat ? [ mat ] : [] ) { ( mm as THREE.SpriteMaterial ).map?.dispose(); mm.dispose(); }

		} );

	}

	setDomaine( d: DomaineScene ) {

		this.domaine = d;
		for ( const o of [ this.relief, this.socle, this.boite, this.echelle, this.nord ] ) this._vider( o );
		for ( const e of this.etiquettes ) this._vider( e.sprite );
		this.etiquettes = [];
		this.setLignes( null ); this.setCoupeH( null ); this.setCoupeV( null );
		this.setStations( [] ); this.setEoliennes( [] );
		this.marqueur.visible = this.teteMarqueur.visible = false;
		this.marqueurLocal = null;

		const { nx, ny, dx, dy, terrain } = d;
		let zMin = Infinity, zMax = - Infinity;
		for ( const z of terrain ) { if ( z < zMin ) zMin = z; if ( z > zMax ) zMax = z; }
		const epaisseur = Math.max( 150, 0.3 * ( zMax - zMin ) ), zBas = zMin - epaisseur;

		// Relief ombré : un sommet par nœud, normales calculées, lumière du nord-ouest.
		const pos = new Float32Array( nx * ny * 3 ), col = new Float32Array( nx * ny * 3 );
		for ( let j = 0; j < ny; j ++ ) for ( let i = 0; i < nx; i ++ ) {

			const k = j * nx + i, c = teinteRelief( ( terrain[ k ] - zMin ) / ( ( zMax - zMin ) || 1 ) );
			pos[ k * 3 ] = i * dx; pos[ k * 3 + 1 ] = terrain[ k ]; pos[ k * 3 + 2 ] = - j * dy;
			col[ k * 3 ] = lin( c[ 0 ] ); col[ k * 3 + 1 ] = lin( c[ 1 ] ); col[ k * 3 + 2 ] = lin( c[ 2 ] );

		}

		const idx = new Uint32Array( ( nx - 1 ) * ( ny - 1 ) * 6 );
		let n = 0;
		for ( let j = 0; j + 1 < ny; j ++ ) for ( let i = 0; i + 1 < nx; i ++ ) {

			const a = j * nx + i, b = a + 1, c = a + nx, e = c + 1;
			idx[ n ++ ] = a; idx[ n ++ ] = b; idx[ n ++ ] = c; idx[ n ++ ] = b; idx[ n ++ ] = e; idx[ n ++ ] = c;

		}

		const gr = new THREE.BufferGeometry();
		gr.setAttribute( 'position', new THREE.BufferAttribute( pos, 3 ) );
		gr.setAttribute( 'color', new THREE.BufferAttribute( col, 3 ) );
		gr.setIndex( new THREE.BufferAttribute( idx, 1 ) );
		gr.computeVertexNormals();
		this.relief = new THREE.Mesh( gr, new THREE.MeshLambertMaterial( { vertexColors: true } ) );
		this.relief.frustumCulled = false;

		// Socle : 4 parois du bord du relief jusqu'à zBas, et le fond.
		const bord: [ number, number ][] = [];
		for ( let i = 0; i < nx; i ++ ) bord.push( [ i, 0 ] );
		for ( let j = 1; j < ny; j ++ ) bord.push( [ nx - 1, j ] );
		for ( let i = nx - 2; i >= 0; i -- ) bord.push( [ i, ny - 1 ] );
		for ( let j = ny - 2; j >= 0; j -- ) bord.push( [ 0, j ] );
		const sp: number[] = [], si: number[] = [];
		for ( let q = 0; q < bord.length; q ++ ) {

			const [ i, j ] = bord[ q ];
			sp.push( i * dx, terrain[ j * nx + i ], - j * dy, i * dx, zBas, - j * dy );

		}

		for ( let q = 0; q < bord.length; q ++ ) {

			const a = q * 2, b = ( ( q + 1 ) % bord.length ) * 2;
			si.push( a, a + 1, b, b, a + 1, b + 1 );

		}

		const f0 = sp.length / 3;
		sp.push( 0, zBas, 0, d.sizeX, zBas, 0, d.sizeX, zBas, - d.sizeY, 0, zBas, - d.sizeY );
		si.push( f0, f0 + 2, f0 + 1, f0, f0 + 3, f0 + 2 );
		const gs = new THREE.BufferGeometry();
		gs.setAttribute( 'position', new THREE.Float32BufferAttribute( sp, 3 ) );
		gs.setIndex( si );
		gs.computeVertexNormals();
		this.socle = new THREE.Mesh( gs, new THREE.MeshLambertMaterial( { color: 0x5a4a36, side: THREE.DoubleSide } ) );
		this.socle.frustumCulled = false;

		// Boîte du domaine (colonne atmosphérique jusqu'au dernier niveau).
		const X = d.sizeX, Z = - d.sizeY, h0 = zBas, h1 = d.zHaut;
		const arretes = [
			0, h1, 0, X, h1, 0, X, h1, 0, X, h1, Z, X, h1, Z, 0, h1, Z, 0, h1, Z, 0, h1, 0,
			0, h0, 0, 0, h1, 0, X, h0, 0, X, h1, 0, X, h0, Z, X, h1, Z, 0, h0, Z, 0, h1, Z,
		];
		this.boite = new THREE.LineSegments(
			new THREE.BufferGeometry().setAttribute( 'position', new THREE.Float32BufferAttribute( arretes, 3 ) ),
			new THREE.LineBasicMaterial( { color: 0x8fb3d9, transparent: true, opacity: 0.35 } ),
		);
		this.boite.frustumCulled = false;

		// Barre d'échelle le long du bord sud, devant le socle : longueur ronde ≈ 1/4 du domaine.
		const L = longueurEchelle( d.sizeX / 4 ), zE = zBas + epaisseur * 0.5, zS = d.sizeY * 0.03;
		const pts: number[] = [ 0, zE, zS, L, zE, zS ];
		for ( let q = 0; q <= 4; q ++ ) pts.push( L * q / 4, zE, zS, L * q / 4, zE + epaisseur * ( q % 4 ? 0.25 : 0.5 ), zS );
		this.echelle = new THREE.Group();
		this.echelle.add( new THREE.LineSegments(
			new THREE.BufferGeometry().setAttribute( 'position', new THREE.Float32BufferAttribute( pts, 3 ) ),
			new THREE.LineBasicMaterial( { color: 0xffffff } ),
		) );
		this.monde.add( this.relief, this.socle, this.boite, this.echelle );
		this._ajouterEtiquette( `${ libelleDistance( L ) }`, new THREE.Vector3( L / 2, zE, zS ), - 2.4 );

		// Nord : flèche orientée selon rotation_deg (Nord = (sin θ, cos θ) dans le repère de la grille).
		const t = d.rotationDeg * Math.PI / 180;
		const dirN = new THREE.Vector3( Math.sin( t ), 0, - Math.cos( t ) ).normalize();
		this.nord = new THREE.Group();
		this.nord.add( new THREE.ArrowHelper( dirN, new THREE.Vector3(), 9, 0xffffff, 3, 2 ) );
		const n0 = new THREE.Vector3( - d.sizeX * 0.06, zMax, - d.sizeY - d.sizeY * 0.02 );
		this.nord.userData.local = n0;
		this.hors.add( this.nord );
		const lettre = etiquette( 'N', 3.4, 'rgba(30,111,184,0.95)' );
		this.nord.add( lettre );
		lettre.position.copy( dirN ).multiplyScalar( 12.5 );

		// Cadrage : le domaine entier, vu du sud-est en hauteur.
		this.controls.target.set( 0, 2, 0 );
		const D = W * d.sizeY / d.sizeX;
		this.camera.position.set( W * 0.3, W * 0.8, D * 0.5 + W * 0.55 );
		this.controls.update();
		this.setExageration( this.exageration );

	}

	private _ajouterEtiquette( texte: string, local: THREE.Vector3, dy: number ) {

		const s = etiquette( texte, 2.6 );
		this.hors.add( s );
		this.etiquettes.push( { sprite: s, local, dy } );

	}

	/** Coordonnées locales (m) → monde (unités de la scène), avec l'exagération courante. */
	private _versMonde( local: THREE.Vector3, out = new THREE.Vector3() ): THREE.Vector3 {

		this.monde.updateMatrixWorld();
		return out.copy( local ).applyMatrix4( this.monde.matrixWorld );

	}

	/** Exagération verticale (×1 à ×10) : une échelle du groupe, rien n'est reconstruit. */
	setExageration( e: number ) {

		this.exageration = Math.min( 10, Math.max( 1, e ) );
		const d = this.domaine;
		if ( ! d ) return;
		const S = this.S;
		let zMin = Infinity;
		for ( const z of d.terrain ) if ( z < zMin ) zMin = z;
		this.monde.scale.set( S, S * this.exageration, S );
		this.monde.position.set( - d.sizeX * S / 2, - zMin * S * this.exageration, d.sizeY * S / 2 );
		for ( const e2 of this.etiquettes ) { this._versMonde( e2.local, e2.sprite.position ); e2.sprite.position.y += e2.dy; }
		if ( this.nord ) this._versMonde( this.nord.userData.local as THREE.Vector3, this.nord.position );
		if ( this.marqueurLocal ) this._versMonde( this.marqueurLocal, this.teteMarqueur.position );
		for ( const c of [ this.stations, this.eoliennes ] ) if ( c ) this._placerTetes( c.tetes, c.reperes );

	}

	// --- Lignes de courant et coupes -------------------------------------------------------

	setLignes( t: TamponLignes | null ) {

		const g = this.lignes.geometry;
		const n = t ? Math.min( t.sommets, CAPACITE_SEGMENTS * 2 ) : 0;
		if ( t && n ) {

			( g.attributes.position.array as Float32Array ).set( t.positions.subarray( 0, n * 3 ) );
			( g.attributes.aCouleur.array as Float32Array ).set( t.couleurs.subarray( 0, n * 3 ) );
			( g.attributes.aPhase.array as Float32Array ).set( t.phases.subarray( 0, n ) );
			for ( const a of [ 'position', 'aCouleur', 'aPhase' ] ) {

				const at = g.attributes[ a ] as THREE.BufferAttribute;
				at.clearUpdateRanges();
				at.addUpdateRange( 0, n * at.itemSize );
				at.needsUpdate = true;

			}

		}

		g.setDrawRange( 0, n );
		// Fondu d'entrée si des lignes étaient déjà affichées (changement d'instant ou de hauteur).
		if ( this.segments > 0 && n && ! this._reduit ) this._fondu = performance.now();
		this.segments = n / 2;
		// Traceurs : environ un pour 12 segments, bornés à la capacité.
		const tl = t && n ? ( n === t.sommets ? t : { ...t, sommets: n } ) : null;
		this.traceurs.charger( tl, Math.min( CAPACITE_TRACEURS, Math.round( n / 2 / 12 ) ) );
		this.points.geometry.setDrawRange( 0, this.traceurs.n );
		this._appliquerMouvement();

	}

	setAnimation( on: boolean ) { this.anime = on; this._appliquerMouvement(); }

	/** Traceurs lumineux le long des lignes (si l'animation est active). */
	setTraceurs( on: boolean ) { this.traceursActifs = on; this._appliquerMouvement(); }

	get nbTraceurs() { return this.points.visible ? this.traceurs.n : 0; }

	/** Rotation automatique douce autour du domaine (coupée en animations réduites). */
	setAutoRotation( on: boolean ) { this._rotation = on; this.controls.autoRotateSpeed = 0.6; this._appliquerMouvement(); }

	/** Déplace la caméra (monde) vers `position` en visant `cible`, en douceur (instantané en mouvement réduit). */
	allerVers( position: THREE.Vector3, cible: THREE.Vector3, duree = 900 ): Promise<void> {

		if ( this._reduit || duree <= 0 ) {

			this._tween = null;
			this.camera.position.copy( position ); this.controls.target.copy( cible ); this.controls.update();
			return this.apresRendu();

		}
		this._tween = { t0: performance.now(), duree, p0: this.camera.position.clone(), p1: position.clone(), c0: this.controls.target.clone(), c1: cible.clone() };
		return new Promise( ( ok ) => setTimeout( ok, duree + 32 ) );

	}

	/** Vues prédéfinies : dessus, depuis le sud, depuis l'est, isométrique (cadrage par défaut). */
	vue( v: VueCamera ): Promise<void> {

		const d = this.domaine;
		const D = d ? W * d.sizeY / d.sizeX : W / 2;
		const c = new THREE.Vector3( 0, 2, 0 );
		const p = v === 'dessus' ? new THREE.Vector3( 0, W * 1.15, 0.01 )
			: v === 'sud' ? new THREE.Vector3( 0, W * 0.32, D / 2 + W * 0.85 )
				: v === 'est' ? new THREE.Vector3( W / 2 + W * 0.8, W * 0.32, 0 )
					: new THREE.Vector3( W * 0.3, W * 0.8, D * 0.5 + W * 0.55 );
		return this.allerVers( p, c );

	}

	/** « Voler vers » un point (m, repère local) : la caméra s'en approche en gardant son orientation. */
	volerVers( x: number, z: number, yNord: number ): Promise<void> {

		const cible = this._versMonde( new THREE.Vector3( x, z, - yNord ) );
		const dir = this.camera.position.clone().sub( this.controls.target );
		const dist = Math.max( 22, Math.min( dir.length() * 0.6, 90 ) );
		dir.setLength( dist );
		return this.allerVers( cible.clone().add( dir ), cible, 1100 );

	}

	private _maillage( m: THREE.Mesh, t: TamponMaillage | null ) {

		const g = m.geometry;
		if ( ! t || ! t.index.length ) { g.setDrawRange( 0, 0 ); m.userData.triangles = 0; return; }
		const pos = g.getAttribute( 'position' ) as THREE.BufferAttribute | undefined;
		// Même nombre de sommets : on réécrit les tampons existants ; sinon on les remplace.
		if ( pos && pos.array.length === t.positions.length ) {

			( pos.array as Float32Array ).set( t.positions ); pos.needsUpdate = true;
			const col = g.getAttribute( 'color' ) as THREE.BufferAttribute;
			( col.array as Float32Array ).set( versLineaire( t.couleurs ) ); col.needsUpdate = true;

		} else {

			g.dispose(); // libère les anciens tampons GPU
			g.setAttribute( 'position', new THREE.BufferAttribute( t.positions, 3 ) );
			g.setAttribute( 'color', new THREE.BufferAttribute( versLineaire( t.couleurs ), 3 ) );

		}

		g.setIndex( new THREE.BufferAttribute( t.index, 1 ) );
		g.setDrawRange( 0, t.index.length );
		m.userData.triangles = t.index.length / 3;

	}

	setCoupeH( t: TamponMaillage | null ) { this._maillage( this.coupeH, t ); }
	setCoupeV( t: TamponMaillage | null ) { this._maillage( this.coupeV, t ); }

	// --- Capteurs et éoliennes ---------------------------------------------------------------

	private _placerTetes( tetes: THREE.InstancedMesh, reperes: Repere[] ) {

		const o = new THREE.Object3D(), c = new THREE.Color();
		reperes.forEach( ( r, k ) => {

			this._versMonde( this._v.set( r.x, r.zHaut, - r.y ), o.position );
			o.updateMatrix();
			tetes.setMatrixAt( k, o.matrix );
			tetes.setColorAt( k, c.setRGB( r.couleur[ 0 ], r.couleur[ 1 ], r.couleur[ 2 ], THREE.SRGBColorSpace ) );

		} );
		tetes.count = reperes.length;
		tetes.instanceMatrix.needsUpdate = true;
		if ( tetes.instanceColor ) tetes.instanceColor.needsUpdate = true;

	}

	private _couche( ancienne: { tiges: THREE.LineSegments; tetes: THREE.InstancedMesh } | null, reperes: Repere[], forme: THREE.BufferGeometry, couleurTige: number ) {

		if ( ancienne ) { this._vider( ancienne.tiges ); this._vider( ancienne.tetes ); }
		if ( ! reperes.length ) { forme.dispose(); return null; }
		const p: number[] = [];
		for ( const r of reperes ) p.push( r.x, r.zSol, - r.y, r.x, r.zHaut, - r.y );
		const tiges = new THREE.LineSegments(
			new THREE.BufferGeometry().setAttribute( 'position', new THREE.Float32BufferAttribute( p, 3 ) ),
			new THREE.LineBasicMaterial( { color: couleurTige } ),
		);
		tiges.frustumCulled = false;
		const tetes = new THREE.InstancedMesh( forme, new THREE.MeshLambertMaterial(), reperes.length );
		tetes.frustumCulled = false;
		this.monde.add( tiges );
		this.hors.add( tetes );
		this._placerTetes( tetes, reperes );
		return { tiges, tetes, reperes };

	}

	/** Capteurs : tige du sol à la hauteur de mesure, tête colorée par état. */
	setStations( r: Repere[] ) { this.stations = this._couche( this.stations, r, new THREE.SphereGeometry( 0.55, 12, 8 ), 0xffffff ); }

	/** Éoliennes : mât du sol au moyeu, nacelle au moyeu. */
	setEoliennes( r: Repere[] ) { this.eoliennes = this._couche( this.eoliennes, r, new THREE.OctahedronGeometry( 0.9 ), 0xf4f6f8 ); }

	get trianglesCoupeH(): number { return this.coupeH.visible ? this.coupeH.userData.triangles ?? 0 : 0; }
	get trianglesCoupeV(): number { return this.coupeV.visible ? this.coupeV.userData.triangles ?? 0 : 0; }

	get nbStations() { return this.stations?.reperes.length ?? 0; }
	get nbEoliennes() { return this.eoliennes?.reperes.length ?? 0; }

	setVisibilite( v: Visibilite ) {

		for ( const o of [ this.relief, this.socle ] ) if ( o ) o.visible = v.relief;
		this.lignes.visible = v.lignes;
		this.coupeH.visible = v.coupeH;
		this.coupeV.visible = v.coupeV;
		if ( this.stations ) this.stations.tiges.visible = this.stations.tetes.visible = v.stations;
		if ( this.eoliennes ) this.eoliennes.tiges.visible = this.eoliennes.tetes.visible = v.eoliennes;

	}

	// --- Picking -------------------------------------------------------------------------------

	/** Surface visée par le clic (x, y en m depuis le nœud (0, 0) → altitude mer) ; null = le relief. */
	setSurfacePick( f: ( ( x: number, y: number ) => number ) | null ) { this.surfacePick = f; }

	private _terrain = ( x: number, y: number ) => {

		const d = this.domaine!;
		return bilineaireTolerante( d.terrain, d.nx, d.ny, x / d.dx, y / d.dy );

	};

	/** Marqueur vertical de la colonne (x, y en m depuis le nœud (0, 0)) ; tête à l'altitude z. */
	showMarker( x: number, y: number, z: number ) {

		const d = this.domaine;
		if ( ! d ) return;
		const a = this.marqueur.geometry.attributes.position as THREE.BufferAttribute;
		a.setXYZ( 0, x, this._terrain( x, y ), - y );
		a.setXYZ( 1, x, d.zHaut, - y );
		a.needsUpdate = true;
		this.marqueur.geometry.computeBoundingSphere();
		this.marqueur.visible = true;
		this.marqueurLocal = new THREE.Vector3( x, z, - y );
		this._versMonde( this.marqueurLocal, this.teteMarqueur.position );
		this.teteMarqueur.visible = true;

	}

	/**
	 * Picking à une position écran (coordonnées client, px) : intersection du rayon avec la surface
	 * affichée (plan de la coupe horizontale ou relief + h), à défaut le relief. Appelle `onPick`.
	 */
	pickAt( clientX: number, clientY: number, voler = false ): PickResult | null {

		const d = this.domaine;
		if ( ! d ) return null;
		const r = this.canvas.getBoundingClientRect();
		const ndc = new THREE.Vector2( ( ( clientX - r.left ) / r.width ) * 2 - 1, - ( ( clientY - r.top ) / r.height ) * 2 + 1 );
		this.camera.updateMatrixWorld();
		this.monde.updateMatrixWorld();
		this._ray.setFromCamera( ndc, this.camera );
		// Rayon dans le repère local (m) : X = x, Y = z, Z = −y.
		this._m.copy( this.monde.matrixWorld ).invert();
		const o = this._ray.ray.origin.clone().applyMatrix4( this._m );
		const p2 = this._ray.ray.origin.clone().add( this._ray.ray.direction ).applyMatrix4( this._m );
		const dir = p2.sub( o );
		const bornes = { xmin: 0, xmax: d.sizeX, ymin: 0, ymax: d.sizeY };
		const pas = Math.min( d.dx, d.dy ) / 2;
		const toucher = ( f: ( x: number, y: number ) => number ) => intersecterSurface( [ o.x, - o.z, o.y ], [ dir.x, - dir.z, dir.y ], f, bornes, pas );
		const hit = ( this.surfacePick && toucher( this.surfacePick ) ) || toucher( this._terrain );
		if ( ! hit ) return null;
		const res = { x: hit.x, y: hit.y, z: hit.z, fx: hit.x / d.sizeX, fy: hit.y / d.sizeY };
		this.onPick?.( res );
		if ( voler ) this.volerVers( hit.x, hit.z, hit.y );
		return res;

	}

	dispose() {

		cancelAnimationFrame( this._raf );
		this._desabo();
		this.canvas.removeEventListener( 'pointerdown', this._onPointerDown );
		this.canvas.removeEventListener( 'pointerup', this._onPointerUp );
		removeEventListener( 'resize', this._onResize );
		this._ro?.disconnect();
		this.controls.dispose();
		this._vider( this.monde );
		this._vider( this.hors );
		this.renderer.dispose();
		for ( const f of this._attenteRendu ) f();
		this._attenteRendu = [];

	}

}
