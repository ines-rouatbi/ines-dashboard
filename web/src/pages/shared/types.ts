// Types du contrat ATOM v1 (révision 2) utilisés par les pages Éolien et Alertes (lot F4).
// Écrits à la main d'après contract/schemas/*.schema.json : à remplacer par les types générés
// dès que F0 en fournit. Règle B5 : null = « non disponible », jamais 0.

/** Intervalle à 80 % (common.schema.json#/$defs/interval). Tout null si inconnu. */
export interface Interval {
	p10: number | null;
	p50: number | null;
	p90: number | null;
}

// ─── wind-farm.schema.json ──────────────────────────────────────────────────

export type TurbineState = 'production' | 'arret_vent_faible' | 'arret_vent_fort' | 'indisponible';
export type AirDensitySource = 'atmosphere_standard' | 'extrapolation_surface' | 'mesure' | null;

export interface Turbine {
	id: string;
	name: string;
	x_m: number;
	y_m: number;
	virtual: boolean;
	/** Clé de WindFarm.power_curves. */
	model: string;
	hub_agl_m: number;
	rotor_d_m: number;
	rated_kw: number;
	cut_in_ms: number;
	cut_out_ms: number;
	hub_speed: Interval;
	/** Vent équivalent rotor, pondéré par l'aire. */
	rews: Interval;
	/** Exposant de loi de puissance entre le bas et le haut du rotor. */
	shear_alpha: number | null;
	/** Rotation de la direction du bas vers le haut du rotor, positive dans le sens horaire avec la hauteur, dans [−180, 180). */
	veer_deg: number | null;
	power_kw: Interval;
	state: TurbineState;
	/** kg/m³ */
	air_density: number | null;
	air_density_source: AirDensitySource;
}

export interface PowerCurve {
	speed_ms: number[];
	power_kw: number[];
}

export interface WindFarm {
	turbines: Turbine[];
	farm: {
		/** Quantiles calculés sur les membres de l'ensemble (pas la somme des quantiles). */
		power_kw: Interval;
		rated_kw: number;
		n_production: number;
		n_arret: number;
	};
	power_curves: Record<string, PowerCurve>;
}

// ─── windrose.schema.json ───────────────────────────────────────────────────

export interface WindRoseSector {
	/** Provenance (direction météo), = k · sector_width_deg. */
	dir_center_deg: number;
	frequency: number;
	speed_bins: number[];
}

export interface Weibull {
	k: number;
	c_ms: number;
	aep_mwh: number | null;
	capacity_factor: number | null;
}

export interface WindRose {
	site_id: string;
	x_m: number;
	y_m: number;
	hub_agl_m: number;
	period: { from: string; to: string };
	/** Nombre d'instants valides : l'interface DOIT l'afficher et signaler < 100 comme statistiquement faible. */
	n_valid: number;
	sector_width_deg: number;
	speed_bin_edges_ms: number[];
	sectors: WindRoseSector[];
	weibull: Weibull | null;
}

/** Seuil du contrat sous lequel une rose est « statistiquement faible ». */
export const WINDROSE_MIN_VALID = 100;

// ─── alerts.schema.json ─────────────────────────────────────────────────────

export type AlertLevel = 'information' | 'avertissement' | 'important' | 'critique';
export type AlertKind =
	| 'hors_plage' | 'station_muette' | 'stations_insuffisantes'
	| 'capteur_derive' | 'incoherence_physique' | 'derive_entrees'
	| 'zone_mal_couverte' | 'vent_fort_moyeu' | 'cisaillement';

export interface Alert {
	/** sha8 de « kind|cible » : stable d'un instantané à l'autre (clé React). */
	id: string;
	level: AlertLevel;
	kind: AlertKind;
	/** Capteur, éolienne, ou maille de 2 km « m<ix>_<iy> ». */
	target: string;
	title: string;
	cause: string;
	recommendation: string;
	/** Première levée (ISO UTC). */
	raised_at: string;
	status: 'ouverte' | 'close';
	station_id: string | null;
	turbine_id: string | null;
	location: { x_m: number; y_m: number } | null;
	value: number | null;
	threshold: number | null;
	unit: string | null;
}

export interface Alerts {
	items: Alert[];
}

// ─── snapshot.schema.json (extrait) ─────────────────────────────────────────

export interface SnapshotPoint {
	id: string;
	kind: 'eolienne' | 'site';
	name: string;
	x_m: number;
	y_m: number;
	profile: boolean;
	windrose: boolean;
}

export interface SnapshotAssets {
	windrose_template: string;
	alerts: string;
	wind_farm: string;
	[ key: string ]: string | null;
}
