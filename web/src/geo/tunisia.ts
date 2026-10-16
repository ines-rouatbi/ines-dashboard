/**
 * Carte de la Tunisie du tableau de bord ATOM-AI (cahier des charges §17.1, V3D1).
 *
 * Module autonome (aucune dépendance au reste de l'application) :
 *  - chargement des fichiers produits par tools/geo/build-tunisia.mjs (web/public/geo/) ;
 *  - conversion lat/lon ↔ pixel de l'image d'estompage tunisie-ombre.png ;
 *  - échantillonnage du relief national ;
 *  - coins du domaine ATOM en lat/lon, à partir de la grille et du georef de /v1/meta (jamais codés en dur).
 *
 * Projection du domaine (contrat v1 rév. 2, B2 et D4 ; identique au script de construction) : le nœud
 * (i, j) est en x = x0 + i·dx, y = y0 + j·dy ; georef.lat0/lon0 désigne le nœud (0, 0) ; plan tangent
 * équirectangulaire en ce nœud, 1° de latitude = m_per_deg_lat (110 574 m), 1° de longitude =
 * m_per_deg_lon (111 320·cos(lat0) m) ; rotation_deg = angle de l'axe x depuis l'Est, sens antihoraire.
 * Tant que georef.suppose vaut true, l'interface DOIT afficher « position supposée ».
 *
 * RELIEF : tunisie-relief.f32 et domaine-relief-reel.f32 (Terrain Tiles, à l'ancrage SUPPOSÉ) ne sont
 * qu'un FOND DE CARTE. La hauteur au-dessus du sol d'un nœud du modèle se calcule TOUJOURS avec le relief
 * du modèle, /v1/terrain/{sha8} (meta.terrain.href), jamais avec ces fichiers (D6).
 */

export const M_PER_DEG_LAT = 110574;
export const M_PER_DEG_LON_EQ = 111320;

export interface BBox {
	lat_min: number;
	lat_max: number;
	lon_min: number;
	lon_max: number;
}

export interface ImageMeta {
	fichier: string;
	largeur_px: number;
	hauteur_px: number;
	bbox: BBox;
	m_par_px: { x: number; y: number };
}

export interface TunisiaMeta {
	bbox: BBox;
	nx: number;
	ny: number;
	pas_deg: number;
	min_m: number;
	max_m: number;
	fichier: string;
	image: ImageMeta;
	source: { attribution: string };
	controles?: { jebel_chambi?: { reference_m: number; source_zoom8_m: number; grille_0_01deg_m: number } };
	date_extraction: string;
}

export interface Ville {
	nom: string;
	lat: number;
	lon: number;
}

export interface Georef {
	lat0: number;
	lon0: number;
	rotation_deg: number;
	/** m par degré de latitude ; 110 574 si absent. */
	m_per_deg_lat?: number;
	/** m par degré de longitude ; 111 320·cos(lat0) si absent. */
	m_per_deg_lon?: number;
	suppose?: boolean;
}

/** Extrait de /v1/meta (contrat rév. 2) : grille et géoréférencement du domaine. */
export interface MetaDomaine {
	grid: { nx: number; ny: number; dx_m: number; dy_m: number; x0_m: number; y0_m: number };
	georef: Georef;
}

export interface LatLon {
	lat: number;
	lon: number;
}

export interface Tunisia {
	meta: TunisiaMeta;
	/** ny×nx, [j][i], j=0 au sud ; m au-dessus de la mer, mer ≤ 0. */
	relief: Float32Array;
	villes: Ville[];
	/** URL de l'image d'estompage, nord en haut. */
	imageUrl: string;
}

export interface DomainRelief {
	meta: {
		min_m: number; max_m: number; moyenne_m: number; ancrage: Georef & { suppose: boolean };
		grille: MetaDomaine[ 'grid' ];
	};
	nx: number;
	ny: number;
	/** ny×nx valeurs aux NŒUDS (x0 + i·dx, y0 + j·dy) de la grille du meta de construction, [j][i], j=0 au sud. Fond de carte seulement. */
	relief: Float32Array;
}

/** Décode un tampon Float32 little-endian, quelle que soit l'endianness de la machine. */
export function parseF32LE(buf: ArrayBuffer): Float32Array {
	const n = buf.byteLength >>> 2;
	const dv = new DataView(buf);
	const out = new Float32Array(n);
	for (let k = 0; k < n; k++) out[k] = dv.getFloat32(4 * k, true);
	return out;
}

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;

const join = (base: string, file: string) => (base.endsWith('/') ? base : base + '/') + file;

async function get(fetchFn: FetchLike, url: string) {
	const res = await fetchFn(url);
	if (!res.ok) throw new Error(`geo : ${url} → HTTP ${res.status}`);
	return res;
}

/** Charge la carte nationale (métadonnées, relief, villes). */
export async function loadTunisia(baseUrl = '/geo/', fetchFn: FetchLike = fetch): Promise<Tunisia> {
	const [meta, villes] = await Promise.all([
		get(fetchFn, join(baseUrl, 'tunisie-relief.json')).then((r) => r.json() as Promise<TunisiaMeta>),
		get(fetchFn, join(baseUrl, 'villes.json')).then((r) => r.json() as Promise<{ villes: Ville[] }>),
	]);
	const relief = parseF32LE(await (await get(fetchFn, join(baseUrl, meta.fichier))).arrayBuffer());
	if (relief.length !== meta.nx * meta.ny) throw new Error(`geo : relief de ${relief.length} valeurs, ${meta.nx * meta.ny} attendues`);
	return { meta, relief, villes: villes.villes, imageUrl: join(baseUrl, meta.image.fichier) };
}

/** Charge le relief réel du domaine ATOM (ancrage supposé). */
export async function loadDomainRelief(baseUrl = '/geo/', fetchFn: FetchLike = fetch): Promise<DomainRelief> {
	const meta = (await (await get(fetchFn, join(baseUrl, 'domaine-relief-reel.json'))).json()) as DomainRelief['meta'];
	const relief = parseF32LE(await (await get(fetchFn, join(baseUrl, 'domaine-relief-reel.f32'))).arrayBuffer());
	const { nx, ny } = meta.grille;
	if (relief.length !== nx * ny) throw new Error(`geo : relief du domaine de ${relief.length} valeurs, ${nx * ny} attendues`);
	return { meta, nx, ny, relief };
}

/** lat/lon → pixel (flottant) de l'image d'estompage ; (0, 0) = coin haut-gauche (nord-ouest). */
export function latLonToPixel(img: ImageMeta, lat: number, lon: number): { x: number; y: number } {
	const b = img.bbox;
	return {
		x: ((lon - b.lon_min) / (b.lon_max - b.lon_min)) * img.largeur_px,
		y: ((b.lat_max - lat) / (b.lat_max - b.lat_min)) * img.hauteur_px,
	};
}

/** Pixel de l'image → lat/lon (inverse exact de latLonToPixel). */
export function pixelToLatLon(img: ImageMeta, x: number, y: number): LatLon {
	const b = img.bbox;
	return {
		lat: b.lat_max - (y / img.hauteur_px) * (b.lat_max - b.lat_min),
		lon: b.lon_min + (x / img.largeur_px) * (b.lon_max - b.lon_min),
	};
}

/** Relief national bilinéaire en (lat, lon) ; NaN hors de la boîte. */
export function reliefAt(meta: TunisiaMeta, relief: Float32Array, lat: number, lon: number): number {
	const fi = (lon - meta.bbox.lon_min) / meta.pas_deg;
	const fj = (lat - meta.bbox.lat_min) / meta.pas_deg;
	if (fi < 0 || fj < 0 || fi > meta.nx - 1 || fj > meta.ny - 1) return NaN;
	const i = Math.min(Math.floor(fi), meta.nx - 2);
	const j = Math.min(Math.floor(fj), meta.ny - 2);
	const a = fi - i;
	const b = fj - j;
	const v = (jj: number, ii: number) => relief[jj * meta.nx + ii];
	return (v(j, i) * (1 - a) + v(j, i + 1) * a) * (1 - b) + (v(j + 1, i) * (1 - a) + v(j + 1, i + 1) * a) * b;
}

/**
 * (x, y) en mètres dans le repère du contrat (x vers l'Est du domaine, origine du repère, PAS le nœud
 * (0, 0)) → lat/lon. On soustrait (x0, y0) : georef.lat0/lon0 est le nœud (0, 0).
 */
export function domainToLatLon(meta: MetaDomaine, x: number, y: number): LatLon {
	const g = meta.georef;
	const th = (g.rotation_deg * Math.PI) / 180;
	const dx = x - meta.grid.x0_m;
	const dy = y - meta.grid.y0_m;
	const e = dx * Math.cos(th) - dy * Math.sin(th);
	const n = dx * Math.sin(th) + dy * Math.cos(th);
	const mLat = g.m_per_deg_lat ?? M_PER_DEG_LAT;
	const mLon = g.m_per_deg_lon ?? M_PER_DEG_LON_EQ * Math.cos((g.lat0 * Math.PI) / 180);
	return { lat: g.lat0 + n / mLat, lon: g.lon0 + e / mLon };
}

/** Position (m) du nœud (i, j) : x = x0 + i·dx, y = y0 + j·dy (B2). */
export function positionNoeud(meta: MetaDomaine, i: number, j: number): { x: number; y: number } {
	return { x: meta.grid.x0_m + i * meta.grid.dx_m, y: meta.grid.y0_m + j * meta.grid.dy_m };
}

/**
 * Les 4 coins du domaine en lat/lon = nœuds extrêmes (0, 0), (nx−1, 0), (nx−1, ny−1), (0, ny−1) de la
 * grille du meta, dans l'ordre sud-ouest, sud-est, nord-est, nord-ouest (polygone fermable).
 */
export function domainCorners(meta: MetaDomaine): [LatLon, LatLon, LatLon, LatLon] {
	const { nx, ny } = meta.grid;
	const c = (i: number, j: number) => {
		const p = positionNoeud(meta, i, j);
		return domainToLatLon(meta, p.x, p.y);
	};
	return [c(0, 0), c(nx - 1, 0), c(nx - 1, ny - 1), c(0, ny - 1)];
}

/** Longueur au sol (km) représentée par `px` pixels de l'image, pour la barre d'échelle. */
export function pixelsToKm(img: ImageMeta, px: number): number {
	return (px * img.m_par_px.y) / 1000;
}
