// Worker atom.zelqane.com — façade de PC-FNO3D.
//
// Rôles :
//   1. Servir le front-end ATOM Wind (assets statiques dans ./public) à la racine :
//      public/index.html + public/atom-data.js, construits dans le dépôt pcfno3d
//      (scripts/build_atom_wind.py, webapp/atom-wind/) ; la page lit /api/atom-wind/*.
//   2. Proxifier /api/* et /mcp* vers le tunnel (ORIGIN = atom-origin.zelqane.com),
//      en INJECTANT la clé d'API lecture-seule côté serveur (X-API-Key) : le navigateur
//      ne porte jamais la clé.
//   3. Relayer /mcp en FLUX (streamable HTTP / SSE), sans tampon, en laissant passer
//      les en-têtes Mcp-Session-Id et MCP-Protocol-Version dans les deux sens.
//
// Le service d'ines est sur un Colab éphémère : quand il dort, l'origine répond par une
// erreur réseau (502/522). On la transforme en 503 JSON propre que la viz sait afficher
// (« service endormi ») au lieu d'une page d'erreur Cloudflare.

const API_PREFIXES = [ '/api/', '/mcp' ];

// Défense en profondeur : même si la clé est lecture-seule côté ines, on refuse au bord
// les routes d'administration évidentes. (export_instant passe par /mcp et reste couvert
// par la portée de la clé, pas bloquable proprement par URL.)
function isAdminRoute( method, path, search ) {

	if ( method === 'GET' && path === '/api/keys' ) return true;
	if ( method === 'POST' && path === '/api/reconstruct' && /(^|&)export=(true|1)/i.test( search.replace( /^\?/, '' ) ) ) return true;
	return false;

}

// En-têtes hop-by-hop à ne pas recopier d'une connexion à l'autre.
const HOP = new Set( [ 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length' ] );

function filterHeaders( src ) {

	const h = new Headers();
	for ( const [ k, v ] of src ) if ( ! HOP.has( k.toLowerCase() ) ) h.set( k, v );
	return h;

}

// Dernier état réel connu (cahier v12, 17.1) : chaque réponse réussie des routes d'ATOM Wind est
// gardée dans le cache du Worker ; quand le Colab dort, on la ressert avec l'en-tête
// x-atom-dernier-etat (date de réception) au lieu d'un affichage de démonstration.
const DERNIER_ETAT = /^\/api\/atom-wind\/(grille|jours|jour|direct|ensemble|reseau-aneo)$/;
const GARDE_S = 14 * 24 * 3600;

async function garderEtat( request, resp ) {

	const corps = await resp.arrayBuffer();
	const h = new Headers( { 'content-type': resp.headers.get( 'content-type' ) || 'application/json',
		'cache-control': `public, max-age=${ GARDE_S }`, 'x-atom-recu-le': new Date().toISOString() } );
	await caches.default.put( new Request( request.url, { method: 'GET' } ), new Response( corps, { status: 200, headers: h } ) );

}

async function dernierEtat( request ) {

	if ( request.method !== 'GET' || ! DERNIER_ETAT.test( new URL( request.url ).pathname ) ) return null;
	const r = await caches.default.match( new Request( request.url, { method: 'GET' } ) );
	if ( ! r ) return null;
	const h = new Headers( r.headers );
	h.set( 'x-atom-dernier-etat', r.headers.get( 'x-atom-recu-le' ) || '' );
	h.set( 'cache-control', 'no-store' );
	h.delete( 'x-atom-recu-le' );
	return new Response( r.body, { status: 200, headers: h } );

}

async function proxy( request, env, url, ctx ) {

	const origin = new URL( env.ORIGIN );
	const target = new URL( request.url );
	target.protocol = origin.protocol;
	target.hostname = origin.hostname;
	target.port = origin.port;
	// Le Host qui atteindra uvicorn = atom-origin.zelqane.com : cohérent avec
	// PCFNO3D_ALLOWED_HOSTS côté ines (sinon /mcp répondrait 421).

	const headers = filterHeaders( request.headers );
	// Session d'un compte ATOM Wind (cahier v12, BF43) : le navigateur la porte dans X-ATOM-Session ;
	// elle remplace alors la clé de lecture (le service vérifie la clé et son rôle). Sinon, clé de lecture.
	const session = request.headers.get( 'x-atom-session' );
	headers.delete( 'x-atom-session' );
	if ( session && /^pcf_[A-Za-z0-9_-]{32}$/.test( session ) ) headers.set( 'X-API-Key', session );
	else if ( env.PCFNO3D_READ_KEY ) headers.set( 'X-API-Key', env.PCFNO3D_READ_KEY );
	// Mcp-Session-Id et MCP-Protocol-Version sont recopiés tels quels par filterHeaders.

	const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
	const init = {
		method: request.method,
		headers,
		body: hasBody ? request.body : undefined,
		redirect: 'manual',
	};
	if ( hasBody ) init.duplex = 'half'; // requis quand body est un flux

	let resp;
	try {

		resp = await fetch( target, init );

	} catch ( e ) {

		return ( await dernierEtat( request ) ) || serviceDown( `origine injoignable: ${ e && e.message ? e.message : e }` );

	}

	// Erreurs d'un tunnel éteint : 502/504 (timeout d'origine) et la plage Cloudflare 520–530
	// (521 origine refusée, 522 timeout, 523 injoignable, 524 délai, 530/1016 DNS d'origine).
	// Les codes applicatifs d'uvicorn (401, 403, 421, 404, 5xx<520) passent tels quels.
	if ( resp.status === 502 || resp.status === 504 || ( resp.status >= 520 && resp.status <= 530 ) ) {

		return ( await dernierEtat( request ) ) || serviceDown( `origine ${ resp.status }` );

	}
	if ( resp.status === 200 && request.method === 'GET' && DERNIER_ETAT.test( url.pathname ) && ctx ) {

		ctx.waitUntil( garderEtat( request, resp.clone() ).catch( () => {} ) );

	}

	// On renvoie le corps en FLUX (pas de .text()/.json() : le streamable HTTP reste intact).
	const out = filterHeaders( resp.headers );
	out.set( 'cache-control', 'no-store' );
	return new Response( resp.body, { status: resp.status, statusText: resp.statusText, headers: out } );

}

function serviceDown( detail ) {

	return new Response( JSON.stringify( {
		error: 'service_asleep',
		message: 'Le service PC-FNO3D est hors ligne (Colab endormi ou connecteur arrêté). Réessaie dans un instant.',
		detail,
	} ), { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '15' } } );

}

export default {

	async fetch( request, env, ctx ) {

		const url = new URL( request.url );
		const path = url.pathname;
		const isApi = API_PREFIXES.some( ( p ) => path === p.replace( /\/$/, '' ) || path.startsWith( p ) );

		if ( isApi ) {

			if ( request.method === 'OPTIONS' ) return new Response( null, { status: 204, headers: { 'cache-control': 'no-store' } } );
			if ( isAdminRoute( request.method, path, url.search ) ) {

				return new Response( JSON.stringify( { error: 'forbidden', message: 'Route d\'administration non exposée par cette façade (clé lecture-seule).' } ), { status: 403, headers: { 'content-type': 'application/json; charset=utf-8' } } );

			}

			return proxy( request, env, url, ctx );

		}

		// Tout le reste : la viz statique (SPA fallback géré par not_found_handling).
		return env.ASSETS.fetch( request );

	},

};
