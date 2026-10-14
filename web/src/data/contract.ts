// Types TypeScript PROVISOIRES des objets du contrat v1 (docs/PLAN.md, section 3).
//
// Le contrat normatif (OpenAPI + JSON Schema) est écrit en parallèle dans contract/ ;
// ces types seront alignés (ou générés) dès qu'il est figé. En attendant, les champs
// non garantis sont optionnels et le front doit tolérer leur absence.

/** Variables disponibles en binaire via GET /v1/fields/{id}/{level}/{var}. */
export const FIELD_VARS = [ 'u', 'v', 'w', 'speed', 'sigma_u', 'sigma_v', 'coverage', 'reliability', 'status' ] as const;
export type FieldVar = typeof FIELD_VARS[ number ];

/** GET /v1/meta — grille, niveaux (au-dessus du niveau de la mer), domaine, repère. */
export interface Meta {
	grid: {
		nx: number;
		ny: number;
		nz: number;
		dx_m: number;
		dy_m: number;
	};
	/** Altitudes des niveaux, en mètres au-dessus du niveau de la mer (D6). Indice = {level}. */
	levels_m_asl: number[];
	domain?: {
		x_min_m?: number;
		x_max_m?: number;
		y_min_m?: number;
		y_max_m?: number;
	};
	/** Repère : x = Est, y = Nord, origine au coin sud-ouest. */
	frame?: string;
	/** Ancrage géographique ; `assumed: true` tant que la position réelle n'est pas fournie. */
	anchor?: { lat: number; lon: number; assumed: boolean };
	/** Relief : lien vers le binaire Float32 (altitude du sol, m). */
	terrain?: { href: string; min_m?: number; max_m?: number };
	units?: Record<string, string>;
}

export type ComputeStatus = 'online' | 'offline' | 'degraded' | string;
export type DataStatus = 'ok' | 'degraded' | 'stale' | string;

/** GET /v1/latest — manifeste du dernier instantané publié. */
export interface Latest {
	snapshot_id: string;
	valid_time: string;
	generated_at: string;
	published_at: string;
	last_observation_at?: string | null;
	model_version: string;
	norm_version?: string;
	data_version?: string;
	compute_status: ComputeStatus;
	data_status?: DataStatus;
}

/** GET /v1/times — instantanés disponibles (paginé). */
export interface Times {
	items: { snapshot_id: string; valid_time: string }[];
	next?: string | null;
}

/** Critère DSO de l'instant. */
export interface DsoCritere {
	id: string;
	name?: string;
	value?: number | null;
	unit?: string;
	threshold?: number | null;
	pass?: boolean | null;
}

/** GET /v1/snapshots/{id} — résumé, indicateurs, DSO de l'instant, liens. */
export interface Snapshot {
	snapshot_id: string;
	valid_time: string;
	summary?: Record<string, unknown>;
	indicators?: Record<string, number | null>;
	dso?: DsoCritere[] | { mass_residual?: number; ground_condition?: number; [ k: string ]: unknown };
	links?: Record<string, string>;
}

export type NodeStatus = 'measured' | 'estimated';

/** Niveau d'un profil vertical. */
export interface ProfileLevel {
	z_m_asl: number;
	below_terrain?: boolean;
	speed_p10?: number | null;
	speed_p50?: number | null;
	speed_p90?: number | null;
	direction_deg?: number | null;
	status?: NodeStatus;
	coverage?: number | null;
}

/** GET /v1/profiles/{id}?x&y — profil vertical avec p10/p50/p90. */
export interface Profile {
	x_m: number;
	y_m: number;
	terrain_m?: number;
	levels: ProfileLevel[];
	nearest_station?: { id: string; name?: string; distance_m?: number } | null;
}

/** Incertitude : toujours accompagnée de sa méthode et de son état de calibration. */
export interface Uncertainty {
	method: string;
	calibrated: boolean;
}

/** GET /v1/quality/{id} — carte de confiance agrégée, répartition, calibration. */
export interface Quality {
	uncertainty?: Uncertainty;
	calibrated?: boolean;
	node_distribution?: Partial<Record<NodeStatus, number>>;
	reliability_classes?: Record<string, number>;
	[ k: string ]: unknown;
}

export type AlertLevel = 'info' | 'vigilance' | 'alerte' | 'critique' | string;

/** GET /v1/alerts/{id}. */
export interface Alert {
	id: string;
	level: AlertLevel;
	cause: string;
	recommendation?: string;
	at: string;
	station_id?: string;
}
export interface Alerts { alerts: Alert[] }

export type StationState = 'active' | 'suspecte' | 'muette' | 'en_derive' | string;

/** GET /v1/stations/{id}. */
export interface Station {
	id: string;
	name?: string;
	x_m: number;
	y_m: number;
	z_m_asl?: number;
	state: StationState;
	last_measurement?: { at: string; speed?: number; direction_deg?: number | null } | null;
}
export interface Stations { stations: Station[] }

/** GET /v1/wind-farm/{id}. */
export interface Turbine {
	id: string;
	x_m: number;
	y_m: number;
	hub_m: number;
	hub_speed?: number | null;
	rotor_equivalent_speed?: number | null;
	shear?: number | null;
	power_kw_p10?: number | null;
	power_kw_p90?: number | null;
	state?: string;
}
export interface WindFarm {
	turbines: Turbine[];
	production_kw?: { p10?: number; p50?: number; p90?: number };
}

/** GET /v1/windrose — rose des vents et Weibull. */
export interface WindRose {
	sectors: { from_deg: number; to_deg: number; frequency: number }[];
	weibull?: { k: number; c: number };
	/** Nombre d'instants valides ayant servi au calcul. */
	valid_count: number;
}

/** Corps d'erreur JSON de l'API (ex. 404 { error: "absent" }). */
export interface ApiErrorBody { error: string; message?: string }
