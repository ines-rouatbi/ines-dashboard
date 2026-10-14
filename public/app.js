import { api, connect, state, STRIDES } from './api.js';
import { Viz, viridisCss } from './viz.js';

const $ = ( id ) => document.getElementById( id );
const fmt = ( n, d = 0 ) => n == null ? '—' : Number( n ).toLocaleString( 'fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d } );

const els = {
	pill: $( 'status-pill' ), banner: $( 'banner' ),
	instant: $( 'instant-select' ), alt: $( 'alt-slider' ), altLabel: $( 'alt-label' ), ticks: $( 'level-ticks' ),
	density: $( 'density-slider' ), densityLabel: $( 'density-label' ),
	vertical: $( 'toggle-vertical' ), terrain: $( 'toggle-terrain' ),
	legendBar: $( 'legend-bar' ), legendMin: $( 'legend-min' ), legendMax: $( 'legend-max' ),
	metaGrid: $( 'meta-grid' ), dsoList: $( 'dso-list' ), dsoModel: $( 'dso-model' ),
	levelStats: $( 'level-stats' ), profileChart: $( 'profile-chart' ), profilePt: $( 'profile-pt' ), profileHint: $( 'profile-hint' ),
};

let viz, meta, instants = [], selected = null, lastField = null;
const strideFor = () => STRIDES[ Number( els.density.value ) ] ?? 8;

function setPill() {

	const map = {
		live: [ 'pill-live', '● en ligne' ],
		demo: [ 'pill-demo', '◐ mode démo' ],
		down: [ 'pill-down', '○ service endormi' ],
		wait: [ 'pill-wait', '· connexion…' ],
	};
	const [ cls, txt ] = map[ state.mode ] || map.wait;
	els.pill.className = 'pill ' + cls;
	els.pill.textContent = txt;

}

function showBanner( kind, html ) {

	els.banner.className = 'banner' + ( kind === 'down' ? ' down' : '' );
	els.banner.innerHTML = html + ' <button id="retry">Réessayer</button>';
	els.banner.classList.remove( 'hidden' );
	$( 'retry' ).onclick = () => boot();

}

function hideBanner() { els.banner.classList.add( 'hidden' ); }

function paintLegend( [ lo, hi ] ) {

	const stops = Array.from( { length: 10 }, ( _, i ) => viridisCss( i / 9 ) );
	els.legendBar.style.background = `linear-gradient(90deg, ${ stops.join( ',' ) })`;
	els.legendMin.textContent = fmt( lo, 1 );
	els.legendMax.textContent = fmt( hi, 1 ) + ' m/s';

}

function paintMeta() {

	const rows = [
		[ 'Grille', `${ meta.nx } × ${ meta.ny } × ${ meta.nz }` ],
		[ 'Nœuds / instant', fmt( meta.nodes ) ],
		[ 'Altitudes', `${ meta.altitudes[ 0 ] }–${ meta.altitudes[ meta.altitudes.length - 1 ] } m ASL` ],
		[ 'Domaine', meta.sizeX ? `${ fmt( meta.sizeX / 1000 ) } × ${ fmt( meta.sizeY / 1000 ) } km` : '—' ],
		[ 'Pas', meta.dx ? `${ fmt( meta.dx / 1000, 1 ) } × ${ fmt( meta.dy / 1000, 1 ) } km` : '—' ],
		[ 'Coin SO', meta.originLon != null ? `${ fmt( meta.originLat, 2 ) }°N ${ fmt( meta.originLon, 2 ) }°E` : '—' ],
	];
	els.metaGrid.innerHTML = rows.map( ( [ k, v ] ) => `<span class="k">${ k }</span><span class="v">${ v }</span>` ).join( '' );

}

function paintDso( d ) {

	els.dsoModel.textContent = d.model ? `· modèle ${ d.model }` : '';
	els.dsoList.innerHTML = d.criteria.map( ( c ) => {

		const cls = c.pass === true ? 'ok' : ( c.pass === false ? 'bad' : 'warn' );
		const val = ( typeof c.value === 'number' ) ? `${ Math.abs( c.value ) < 0.01 && c.value !== 0 ? c.value.toExponential( 1 ) : fmt( c.value, 2 ) }${ c.unit ? ' ' + c.unit : '' }` : '';
		return `<div class="dso-item"><span class="dso-badge ${ cls }"></span><span class="dso-name">${ c.name }${ c.note ? ` <span class="muted small">(${ c.note })</span>` : '' }</span><span class="dso-val">${ val }</span></div>`;

	} ).join( '' );

}

function paintLevelStats( field ) {

	let lo = Infinity, hi = - Infinity, sum = 0, n = 0;
	for ( let i = 0; i < field.mask.length; i ++ ) if ( field.mask[ i ] ) {

		const s = Math.hypot( field.u[ i ], field.v[ i ], field.w[ i ] );
		lo = Math.min( lo, s ); hi = Math.max( hi, s ); sum += s; n ++;

	}

	const mean = n ? sum / n : 0;
	const cover = Math.round( 100 * n / field.mask.length );
	els.levelStats.innerHTML = [
		[ fmt( isFinite( lo ) ? lo : 0, 1 ), 'min m/s' ],
		[ fmt( mean, 1 ), 'moy m/s' ],
		[ fmt( isFinite( hi ) ? hi : 0, 1 ), 'max m/s' ],
	].map( ( [ nn, ll ] ) => `<div class="stat"><div class="n">${ nn }</div><div class="l">${ ll }</div></div>` ).join( '' )
		+ `<div class="stat" style="grid-column:1/4;margin-top:4px"><div class="l">${ cover }% de couverture (hors relief)</div></div>`;

}

function drawProfile( p ) {

	const c = els.profileChart, ctx = c.getContext( '2d' );
	const Wd = c.width, Hd = c.height, pad = { l: 34, r: 10, t: 10, b: 22 };
	ctx.clearRect( 0, 0, Wd, Hd );
	const sp = p.speed.map( ( s ) => s == null ? null : s );
	const maxS = Math.max( 1, ...sp.filter( ( s ) => s != null ) );
	const alts = p.altitudes, maxA = alts[ alts.length - 1 ], minA = alts[ 0 ];
	const X = ( s ) => pad.l + ( s / maxS ) * ( Wd - pad.l - pad.r );
	const Y = ( a ) => Hd - pad.b - ( ( a - minA ) / ( maxA - minA ) ) * ( Hd - pad.t - pad.b );

	// axes
	ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1;
	ctx.beginPath(); ctx.moveTo( pad.l, pad.t ); ctx.lineTo( pad.l, Hd - pad.b ); ctx.lineTo( Wd - pad.r, Hd - pad.b ); ctx.stroke();
	ctx.fillStyle = 'rgba(154,166,189,.8)'; ctx.font = '10px Inter, sans-serif';
	ctx.fillText( '0', pad.l - 4, Hd - pad.b + 12 );
	ctx.fillText( fmt( maxS, 0 ) + ' m/s', Wd - pad.r - 34, Hd - pad.b + 12 );
	ctx.save(); ctx.translate( 10, Hd / 2 ); ctx.rotate( - Math.PI / 2 ); ctx.fillText( 'altitude (m)', -22, 0 ); ctx.restore();

	// courbe
	ctx.lineWidth = 2; ctx.strokeStyle = '#41d0c4'; ctx.beginPath();
	let started = false;
	for ( let i = 0; i < alts.length; i ++ ) {

		if ( sp[ i ] == null ) { started = false; continue; }
		const x = X( sp[ i ] ), y = Y( alts[ i ] );
		if ( ! started ) { ctx.moveTo( x, y ); started = true; } else ctx.lineTo( x, y );

	}

	ctx.stroke();
	for ( let i = 0; i < alts.length; i ++ ) {

		if ( sp[ i ] == null ) continue;
		ctx.fillStyle = viridisCss( sp[ i ] / maxS );
		ctx.beginPath(); ctx.arc( X( sp[ i ] ), Y( alts[ i ] ), 3, 0, 7 ); ctx.fill();

	}

}

let fieldToken = 0;
async function refreshField() {

	const level = Number( els.alt.value );
	const altitude = meta.altitudes[ level ];
	els.altLabel.textContent = altitude + ' m';
	const tok = ++ fieldToken;
	let field;
	try { field = await api.field( selected, altitude, strideFor() ); }
	catch ( e ) { els.levelStats.innerHTML = `<span class="muted small">champ indisponible : ${ e.message }</span>`; return; }
	if ( tok !== fieldToken ) return; // une requête plus récente a gagné
	lastField = field;
	const r = viz.setField( field, { vertical: els.vertical.checked } );
	paintLegend( r ? r.range : [ 0, 1 ] );
	paintLevelStats( field );

}

async function onPick( ix, iy, fx, fy ) {

	// fx,fy = fractions du domaine -> mètres depuis le coin SO (indépendant du stride).
	const xM = Math.round( fx * ( meta.sizeX || 0 ) ), yM = Math.round( fy * ( meta.sizeY || 0 ) );
	els.profilePt.textContent = `· ${ ( xM / 1000 ).toFixed( 1 ) }, ${ ( yM / 1000 ).toFixed( 1 ) } km`;
	els.profileHint.textContent = 'direction = d\'où vient le vent';
	try {

		const p = await api.profile( selected, xM, yM );
		drawProfile( p );

	} catch ( e ) { els.profileHint.textContent = 'profil indisponible : ' + e.message; }

}

function buildControls() {

	els.alt.max = String( meta.nz - 1 );
	// Niveau par défaut : 1er ≥ 650 m (au-dessus du relief max → couverture pleine),
	// pour éviter d'ouvrir sur un niveau bas quasi entièrement sous le relief.
	const defIdx = meta.altitudes.findIndex( ( a ) => a >= 650 );
	els.alt.value = String( defIdx >= 0 ? defIdx : Math.max( 0, meta.nz - 1 ) );
	els.ticks.innerHTML = `<span>${ meta.altitudes[ 0 ] }</span><span>${ meta.altitudes[ Math.floor( meta.nz / 2 ) ] }</span><span>${ meta.altitudes[ meta.nz - 1 ] } m</span>`;
	els.instant.innerHTML = instants.map( ( it ) => `<option value="${ it.id }">${ it.label }</option>` ).join( '' );
	selected = instants[ 0 ]?.id;

	els.instant.onchange = async () => { selected = els.instant.value; await refreshField(); await loadDso(); };
	els.alt.oninput = () => refreshField();
	els.density.oninput = () => { els.densityLabel.textContent = 'stride ' + strideFor(); refreshField(); };
	els.vertical.onchange = () => refreshField();
	els.terrain.onchange = () => viz.setTerrainVisible( els.terrain.checked );

}

async function loadDso() {

	try { paintDso( await api.dso( selected ) ); } catch ( e ) { els.dsoList.innerHTML = `<span class="muted small">DSO indisponible : ${ e.message }</span>`; }

}

async function boot() {

	setPill();
	const res = await connect();
	setPill();

	if ( state.mode === 'demo' ) showBanner( 'demo', '◐ <b>Mode démo</b> — champ synthétique. Le service PC-FNO3D n\'est pas encore joignable.' );
	else if ( state.mode === 'down' ) showBanner( 'down', '○ <b>Service endormi</b> — le Colab d\'ines est hors ligne. Affichage de démonstration.' );
	else hideBanner();

	meta = await api.meta();
	instants = await api.instants();

	if ( ! viz ) viz = new Viz( $( 'scene' ), { onPick } );
	viz.setMeta( meta );
	paintMeta();
	buildControls();
	els.densityLabel.textContent = 'stride ' + strideFor();
	await refreshField();
	await loadDso();

}

boot();
