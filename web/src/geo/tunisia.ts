/**
 * Carte de la Tunisie du tableau de bord ATOM-AI (cahier des charges §17.1, V3D1).
 *
 * Module autonome (aucune dépendance au reste de l'application) :
 *  - chargement des fichiers produits par tools/geo/build-tunisia.mjs (web/public/geo/) ;
 *  - conversion lat/lon ↔ pixel de l'image d'estompage tunisie-ombre.png ;
 *  - échantillonnage du relief national ;
 *  - coins du domaine ATOM en lat/lon à partir d'un georef {lat0, lon0, rotation_deg}.
 *
 * Projection du domaine (identique au script de construction) : plan tangent local au coin
 * sud-ouest ; 1° de latitude = 110 574 m ; 1° de longitude = 111 320·cos(lat0) m ;
 * rotation_deg = rotation de l'axe x du domaine depuis l'est géographique, sens antihoraire.
 * Tant que georef.suppose vaut true, l'interface DOIT afficher « position supposée ».
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
	suppose?: boolean;
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
	meta: { min_m: number; max_m: number; moyenne_m: number; ancrage: Georef & { suppose: boolean } };
	nx: number;
	ny: number;
	/** ny×nx = 250×500, [j][i], j=0 au sud. */
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
	const meta = (await (await get(fetchFn, join(baseUrl, 'domaine-relief-reel.json'))).json()) as DomainRelief['meta'] & { grille: { nx: number; ny: number } };
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

/** (x, y) en mètres dans le repère du domaine (origine au coin sud-ouest) → lat/lon. */
export function domainToLatLon(g: Georef, x: number, y: number): LatLon {
	const th = (g.rotation_deg * Math.PI) / 180;
	const e = x * Math.cos(th) - y * Math.sin(th);
	const n = x * Math.sin(th) + y * Math.cos(th);
	return {
		lat: g.lat0 + n / M_PER_DEG_LAT,
		lon: g.lon0 + e / (M_PER_DEG_LON_EQ * Math.cos((g.lat0 * Math.PI) / 180)),
	};
}

/**
 * Les 4 coins du domaine en lat/lon, dans l'ordre sud-ouest, sud-est, nord-est, nord-ouest
 * (polygone fermable). Par défaut 50 km vers l'est × 25 km vers le nord.
 */
export function domainCorners(g: Georef, lengthEastM = 50000, widthNorthM = 25000): [LatLon, LatLon, LatLon, LatLon] {
	return [
		domainToLatLon(g, 0, 0),
		domainToLatLon(g, lengthEastM, 0),
		domainToLatLon(g, lengthEastM, widthNorthM),
		domainToLatLon(g, 0, widthNorthM),
	];
}

/** Longueur au sol (km) représentée par `px` pixels de l'image, pour la barre d'échelle. */
export function pixelsToKm(img: ImageMeta, px: number): number {
	return (px * img.m_par_px.y) / 1000;
}
