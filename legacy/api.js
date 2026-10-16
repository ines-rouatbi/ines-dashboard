// Couche de données de la viz.
//
// L'UI ne consomme QUE le « modèle normalisé » défini ici. Deux sources le produisent :
//   • LiveSource  : /api/* via le Worker (qui injecte la clé). Calé sur le schéma réel du
//                   serveur v7 d'ines (confirmé le 2026-10-12, cf. docs/INTEGRATION.md).
//   • DemoSource  : champ de vent synthétique, autonome, aligné sur la MÊME grille/domaine.
//
// Modèle normalisé :
//   meta  : { nx, ny, nz, altitudes[], dx, dy, sizeX, sizeY, originLon, originLat, nodes, demo? }
//   field : { altitude, nx, ny, dx, dy, stride, u:F32, v:F32, w:F32, mask:U8 }  index = j*nx + i
//           (j = SUD→NORD, i = OUEST→EST ; relief exclu via mask=0)
//   instants : [{ id, label }]
//   profile  : { altitudes[], speed[], dir[], u[], v[], w[], mask[] }
//   dso      : { model, criteria:[{ id, name, value, unit, threshold, pass, note? }] }

export const state = { mode: 'wait' }; // wait | live | demo | down

// Pas d'échantillonnage proposés (densité) : indice du slider -> stride serveur.
export const STRIDES = [ 16, 12, 8, 6, 4 ];

async function getJSON( path, opts ) {

	const r = await fetch( path, { headers: { accept: 'application/json' }, ...opts } );
	if ( ! r.ok ) {

		const body = await r.json().catch( () => ( {} ) );
		const e = new Error( body.message || `HTTP ${ r.status }` );
		e.status = r.status; e.code = body.error;
		throw e;

	}

	return r.json();

}

// Le service calcule les niveaux à la demande (GPU) : le 1er accès à froid peut échouer
// (500/503) ou couper la connexion, surtout sous requêtes concurrentes. On réessaie.
async function getJSONRetry( path, tries = 3, delay = 1400 ) {

	let last;
	for ( let i = 0; i < tries; i ++ ) {

		try { return await getJSON( path ); }
		catch ( e ) {

			last = e;
			// Ne pas réessayer une vraie erreur d'auth/paramètre.
			if ( e.status === 401 || e.status === 403 || e.status === 400 ) throw e;
			if ( i < tries - 1 ) await new Promise( ( r ) => setTimeout( r, delay ) );

		}

	}

	throw last;

}

// ---------------------------------------------------------------------------
// Source LIVE — schéma réel du serveur PC-FNO3D v7
// ---------------------------------------------------------------------------
const Live = {

	async health() { return getJSON( '/api/health' ); },

	async meta() {

		const m = await getJSON( '/api/meta' );
		const g = m.grille || m.grid || {};
		const alt = m.z_levels_asl_m || m.altitudes || [];
		const dom = m.domaine_m || m.domain || {};
		return {
			nx: g.nx, ny: g.ny, nz: g.nz ?? alt.length,
			altitudes: alt,
			dx: g.dx_m ?? g.dx ?? null,
			dy: g.dy_m ?? g.dy ?? null,
			sizeX: dom.x_max ?? null,
			sizeY: dom.y_max ?? null,
			originLon: null, originLat: null,   // repère métrique local
			nodes: m.noeuds_valides ?? ( g.nx && g.ny && g.nz ? g.nx * g.ny * g.nz : null ),
			model: m.modele || null,
			raw: m,
		};

	},

	async instants() {

		const d = await getJSON( '/api/instants' );
		const arr = Array.isArray( d ) ? d : ( d.instants ?? d.stems ?? d.items ?? [] );
		return arr.map( ( it, i ) => typeof it === 'string'
			? { id: it, label: it }
			: { id: it.stem ?? it.id ?? it.timestamp_utc ?? String( i ), label: it.label ?? it.timestamp_utc ?? it.stem ?? String( i ) } );

	},

	// Une variable par appel : on récupère u, v, w en parallèle pour une altitude.
	async field( instant, altitude, stride ) {

		const call = ( variable ) => {

			const q = new URLSearchParams( { z: String( altitude ), variable, stride: String( stride ) } );
			if ( instant ) q.set( 'stem', instant );
			return getJSONRetry( `/api/field?${ q }` );

		};

		// Sérialisé (pas Promise.all) : un seul calcul à la fois, ce qui évite de saturer
		// le service au premier accès d'un niveau. Une fois le niveau en cache, c'est rapide.
		const fu = await call( 'u' );
		const fv = await call( 'v' );
		const fw = await call( 'w' );
		const ny = fu.ny, nx = fu.nx, n = nx * ny;
		const u = new Float32Array( n ), v = new Float32Array( n ), w = new Float32Array( n ), mask = new Uint8Array( n );
		// valeurs : tableau 2D [j][i], j = sud->nord, i = ouest->est.
		for ( let j = 0; j < ny; j ++ ) {

			const ru = fu.valeurs[ j ], rv = fv.valeurs[ j ], rw = fw.valeurs[ j ];
			for ( let i = 0; i < nx; i ++ ) {

				const idx = j * nx + i;
				const a = ru[ i ], b = rv[ i ], c = rw ? rw[ i ] : 0;
				if ( a == null || b == null || a === -9999 || b === -9999 ) { mask[ idx ] = 0; continue; }
				u[ idx ] = a; v[ idx ] = b; w[ idx ] = ( c == null || c === -9999 ) ? 0 : c; mask[ idx ] = 1;

			}

		}

		return { altitude, nx, ny, dx: fu.dx_m, dy: fu.dy_m, stride, u, v, w, mask };

	},

	async profile( instant, xM, yM ) {

		// Schéma réel : { x_m, y_m, z_terrain_m, niveaux:[{ z_asl_m, sous_le_relief, wind_speed_m_s, wind_direction_deg, wind_w_m_s }] }
		const q = new URLSearchParams( { x: String( xM ), y: String( yM ) } );
		if ( instant ) q.set( 'stem', instant );
		const p = await getJSONRetry( `/api/profile?${ q }` );
		const niv = p.niveaux || [];
		const altitudes = niv.map( ( n ) => n.z_asl_m );
		const speed = niv.map( ( n ) => n.sous_le_relief ? null : n.wind_speed_m_s );
		const dir = niv.map( ( n ) => n.sous_le_relief ? null : n.wind_direction_deg );
		const w = niv.map( ( n ) => n.sous_le_relief ? null : n.wind_w_m_s );
		const mask = niv.map( ( n ) => n.sous_le_relief ? 0 : 1 );
		return { altitudes, u: [], v: [], w, speed, dir, mask, terrain: p.z_terrain_m };

	},

	async dso( instant ) {

		// Schéma réel : { disponible, resume:{ dso1_*, critere_omm, dso2_*, dso3_*, dso4_*, dso5_*, mae_direction_deg, ... } }
		const d = await getJSON( `/api/dso${ instant ? '?' + new URLSearchParams( { stem: instant } ) : '' }` );
		const r = d.resume || d;
		const b = ( v ) => v === true || v === 1;
		const num = ( v ) => ( typeof v === 'number' ? v : undefined );
		const criteria = [
			{ id: 'dso1', name: 'DSO1 — RMSE ≤ 0,5 m/s', value: num( r.dso1_rmse ?? r.dso1_rmse_global_u ), unit: 'm/s', pass: b( r.dso1_rmse_global_conforme ) },
			{ id: 'omm', name: 'Critère OMM (complément)', value: undefined, unit: '', pass: b( r.critere_omm ?? ( r.critere_omm && r.critere_omm.conforme ) ) },
			{ id: 'dso2', name: 'DSO2 — RMS moyen', value: num( r.dso2_rms_moyen ), unit: 'm/s', pass: b( r.dso2_conforme ) },
			{ id: 'dso3', name: 'DSO3 — conservation', value: num( r.dso3_rugosite ), unit: '', pass: b( r.dso3_conforme ) },
			{ id: 'dso4', name: 'DSO4 — inférence < 1 s', value: num( r.dso4_inference_s ), unit: 's', pass: b( r.dso4_conforme ) },
			{ id: 'dso5', name: 'DSO5 — 25 % capteurs', value: num( r.dso5_rmse_25pct ), unit: 'm/s', pass: b( r.dso5_conforme ) },
			{ id: 'dir', name: 'MAE direction', value: num( r.mae_direction_deg ), unit: '°', pass: num( r.mae_direction_deg ) != null ? r.mae_direction_deg < 10 : undefined },
		];
		return { model: r.modele || 'v7', criteria };

	},

};

// ---------------------------------------------------------------------------
// Source DÉMO (même grille/domaine que le réel, champ synthétique)
// ---------------------------------------------------------------------------
const ALT = [ 25, 50, 75, 100, 150, 200, 300, 400, 500, 650, 800, 1000 ];
const NX_NAT = 500, NY_NAT = 250, DX = 100, DY = 100; // grille native
const DEMO_META = {
	nx: NX_NAT, ny: NY_NAT, nz: ALT.length, altitudes: ALT,
	dx: DX, dy: DY, sizeX: ( NX_NAT - 1 ) * DX, sizeY: ( NY_NAT - 1 ) * DY,
	originLon: null, originLat: null, nodes: NX_NAT * NY_NAT * ALT.length, model: 'démo', demo: true,
};

const DEMO_INSTANTS = Array.from( { length: 6 }, ( _, i ) => {

	const d = new Date( Date.UTC( 2025, 1, 28, i * 3, 0, 0 ) );
	return { id: d.toISOString().slice( 0, 19 ).replace( 'T', ' ' ), label: d.toISOString().slice( 0, 16 ).replace( 'T', ' ' ) + ' UTC' };

} );

function hash( s ) { let h = 2166136261; for ( let i = 0; i < s.length; i ++ ) { h ^= s.charCodeAt( i ); h = Math.imul( h, 16777619 ); } return ( h >>> 0 ) / 4294967295; }

// Relief : crête diagonale ; sous elle, les bas niveaux sont null. Domaine normalisé fx,fy in [0,1].
function reliefHeight( fx, fy ) {

	const d = Math.abs( ( fy - 0.5 ) - 0.3 * ( fx - 0.5 ) );
	return Math.exp( - ( d * d ) / ( 2 * 0.11 * 0.11 ) ) * 596; // crête ~596 m (= terrain_max réel)

}

function demoCell( instant, alt, fx, fy, seed, vref ) {

	const relief = reliefHeight( fx, fy );
	if ( alt < relief ) return null; // sous le relief
	const swirl = 0.6 * Math.sin( fx * 6.2 + seed * 10 ) * Math.cos( fy * 5.1 - seed * 7 );
	const dir = seed * Math.PI * 2 + swirl + 0.4 * Math.sin( fy * 3.1 );
	const accel = 1 + 0.5 * Math.exp( - Math.pow( ( alt - relief ) / 120, 2 ) ) * ( relief / 596 );
	const spd = Math.max( 0.3, vref * accel * ( 0.75 + 0.45 * hash( `${ instant }:${ ( fx * 1e4 ) | 0 }:${ ( fy * 1e4 ) | 0 }` ) ) );
	const w = 1.4 * ( relief / 596 ) * Math.sin( fx * 6.2 + seed * 10 ) * Math.exp( - Math.pow( ( alt - relief ) / 180, 2 ) );
	return [ spd * Math.cos( dir ), spd * Math.sin( dir ), w ];

}

function demoField( instant, alt, stride ) {

	const seed = hash( instant );
	const vref = 3 + 12 * Math.log10( 1 + alt / 40 ) / Math.log10( 1 + 1000 / 40 );
	const nx = Math.ceil( NX_NAT / stride ), ny = Math.ceil( NY_NAT / stride ), n = nx * ny;
	const u = new Float32Array( n ), v = new Float32Array( n ), w = new Float32Array( n ), mask = new Uint8Array( n );
	for ( let j = 0; j < ny; j ++ ) {

		const fy = ( j * stride ) / ( NY_NAT - 1 );
		for ( let i = 0; i < nx; i ++ ) {

			const fx = ( i * stride ) / ( NX_NAT - 1 ), idx = j * nx + i;
			const c = demoCell( instant, alt, fx, fy, seed, vref );
			if ( ! c ) { mask[ idx ] = 0; continue; }
			u[ idx ] = c[ 0 ]; v[ idx ] = c[ 1 ]; w[ idx ] = c[ 2 ]; mask[ idx ] = 1;

		}

	}

	return { altitude: alt, nx, ny, dx: DX * stride, dy: DY * stride, stride, u, v, w, mask };

}

const Demo = {

	async health() { return { status: 'demo' }; },
	async meta() { return structuredClone( DEMO_META ); },
	async instants() { return DEMO_INSTANTS.slice(); },
	async field( instant, altitude, stride ) { return demoField( instant, altitude, stride ); },
	async profile( instant, xM, yM ) {

		const fx = xM / DEMO_META.sizeX, fy = yM / DEMO_META.sizeY, seed = hash( instant );
		const u = [], v = [], w = [], speed = [], dir = [], mask = [];
		for ( const alt of ALT ) {

			const vref = 3 + 12 * Math.log10( 1 + alt / 40 ) / Math.log10( 1 + 1000 / 40 );
			const c = demoCell( instant, alt, fx, fy, seed, vref );
			if ( ! c ) { u.push( null ); v.push( null ); w.push( null ); speed.push( null ); dir.push( null ); mask.push( 0 ); continue; }
			u.push( c[ 0 ] ); v.push( c[ 1 ] ); w.push( c[ 2 ] );
			speed.push( Math.hypot( c[ 0 ], c[ 1 ], c[ 2 ] ) );
			dir.push( ( ( 270 - Math.atan2( c[ 1 ], c[ 0 ] ) * 180 / Math.PI ) % 360 + 360 ) % 360 );
			mask.push( 1 );

		}

		return { altitudes: ALT.slice(), u, v, w, speed, dir, mask };

	},
	async dso( instant ) {

		return {
			model: 'v7',
			criteria: [
				{ id: 'dso1', name: 'RMSE ≤ 0,5 m/s (par niveau)', value: 0.67, unit: 'm/s', threshold: 0.5, pass: false, note: 'dépasse à 650–1000 m' },
				{ id: 'dso2', name: 'R² ≥ 0,95 (par niveau)', value: 0.964, unit: '', threshold: 0.95, pass: true },
				{ id: 'dso3', name: 'Résidu conservation masse ≤ 1e-4', value: 3.1e-5, unit: '', threshold: 1e-4, pass: true },
				{ id: 'dso4', name: 'Inférence < 1 s / instant', value: 0.12, unit: 's', threshold: 1, pass: true },
				{ id: 'dso5', name: 'Tenue à 25 % des capteurs', value: 0.93, unit: '', threshold: 0.9, pass: true },
				{ id: 'dso6', name: 'Biais de direction < 10°', value: 6.4, unit: '°', threshold: 10, pass: true },
			],
		};

	},

};

// ---------------------------------------------------------------------------
// Sélection de source + façade publique
// ---------------------------------------------------------------------------
let SRC = Demo;

export async function connect() {

	try {

		const h = await Promise.race( [ Live.health(), new Promise( ( _, rej ) => setTimeout( () => rej( new Error( 'timeout' ) ), 6000 ) ) ] );
		SRC = Live; state.mode = 'live';
		return { mode: 'live', health: h };

	} catch ( e ) {

		SRC = Demo;
		state.mode = ( e.status === 503 || e.code === 'service_asleep' ) ? 'down' : 'demo';
		return { mode: state.mode, error: e.message };

	}

}

export const api = {
	meta: ( ...a ) => SRC.meta( ...a ),
	instants: ( ...a ) => SRC.instants( ...a ),
	field: ( ...a ) => SRC.field( ...a ),
	profile: ( ...a ) => SRC.profile( ...a ),
	dso: ( ...a ) => SRC.dso( ...a ),
	isDemo: () => SRC === Demo,
};
