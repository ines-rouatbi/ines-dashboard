/* eslint-disable */
// FICHIER GÉNÉRÉ par dev/gen-contract-types.mjs depuis contract/schemas/ — ne pas éditer.
// Régénérer : npm run contract:types

/**
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "AlertLevel".
 */
export type AlertLevel = 'information' | 'avertissement' | 'important' | 'critique';
/**
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "IsoUtc".
 */
export type IsoUtc = string;
/**
 * <stem>_<sha8 du modèle>, ex. 017_120000_b2529442
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "SnapshotId".
 */
export type SnapshotId = string;
/**
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "ComponentMs".
 */
export type ComponentMs = number | null;
/**
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "SpeedMs".
 */
export type SpeedMs = number | null;
/**
 * Direction météo : D'OÙ vient le vent. null si vitesse < 0,2 m/s ou sous le relief.
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "DirFromDeg".
 */
export type DirFromDeg = number | null;
/**
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "StatusNode".
 */
export type StatusNode = 'mesure' | 'estime';
/**
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "UnitInterval".
 */
export type UnitInterval = number | null;
/**
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "ReliabilityClass".
 */
export type ReliabilityClass = 'elevee' | 'moyenne' | 'faible';
/**
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "StationState".
 */
export type StationState = 'active' | 'suspecte' | 'muette' | 'derive' | 'exclue';

/**
 * Ensemble des réponses du contrat v1 (une propriété par schéma).
 */
export interface ContratV1 {
	Alerts?: Alerts;
	Latest?: Latest;
	Meta?: Meta;
	Profile?: Profile;
	PublishManifest?: PublishManifest;
	Quality?: Quality;
	Snapshot?: Snapshot;
	Stations?: Stations;
	Times?: Times;
	WindFarm?: WindFarm;
	WindRose?: WindRose;
}
/**
 * GET /v1/alerts/{id} — alertes et recommandations
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Alerts".
 */
export interface Alerts {
	items: {
		id: string;
		level: AlertLevel;
		kind:
			| 'hors_plage'
			| 'station_muette'
			| 'capteur_derive'
			| 'stations_insuffisantes'
			| 'incoherence_physique'
			| 'derive_entrees'
			| 'vent_fort_moyeu'
			| 'cisaillement'
			| 'zone_mal_couverte';
		title: string;
		cause: string;
		recommendation: string;
		raised_at: IsoUtc;
		status: 'ouverte' | 'acquittee' | 'close';
		station_id?: string | null;
		turbine_id?: string | null;
		location?: null | {
			x_m: number;
			y_m: number;
			[k: string]: unknown | undefined;
		};
		value?: number | null;
		threshold?: number | null;
		unit?: string | null;
	}[];
}
/**
 * GET /v1/latest — manifeste du dernier instantané publié
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Latest".
 */
export interface Latest {
	snapshot_id: SnapshotId;
	valid_time: IsoUtc;
	generated_at: IsoUtc;
	published_at: IsoUtc;
	last_observation_at: IsoUtc | null;
	/**
	 * online seulement si le battement de cœur du service GPU a moins de 5 min
	 */
	compute_status: 'online' | 'offline' | 'unknown';
	heartbeat_at?: IsoUtc | null;
	data_status: 'complete' | 'degrade';
	versions: Versions;
	href: string;
}
/**
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Versions".
 */
export interface Versions {
	model: string;
	norm: string;
	data: string;
	contract: '1.0';
	model_sha256?: string;
}
/**
 * GET /v1/meta — géométrie du domaine
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Meta".
 */
export interface Meta {
	contract_version: '1.0';
	grid: {
		nx: number;
		ny: number;
		nz: number;
		dx_m: number;
		dy_m: number;
		/**
		 * Altitudes AU-DESSUS DU NIVEAU DE LA MER, croissantes
		 *
		 * @minItems 1
		 */
		levels_asl_m: [number, ...number[]];
		/**
		 * Dans un binaire de niveau : index = j*nx + i
		 */
		order: 'z,y,x ; j=0 au sud, i=0 à l ouest';
		valid_nodes: number;
		valid_fraction_by_level?: number[];
	};
	domain: {
		x_max_m: number;
		y_max_m: number;
		origin: 'coin_sud_ouest';
		/**
		 * ex. local-metrique (puis EPSG:32632 quand l'ancrage sera réel)
		 */
		crs: string;
	};
	terrain: {
		min_m: number;
		max_m: number;
		/**
		 * Binaire statique par version de modèle : Float32 LE ny*nx, altitude du sol en m au-dessus de la mer, sans nodata
		 */
		href: string;
		/**
		 * générateur synthétique | MNT public (nom)
		 */
		source: string;
	};
	/**
	 * Variables disponibles pour /v1/fields. status : 1 = mesuré, 0 = estimé, NaN = sous le relief
	 */
	fields: ('u' | 'v' | 'w' | 'speed' | 'sigma_u' | 'sigma_v' | 'sigma_w' | 'coverage' | 'reliability' | 'status')[];
	units: {
		[k: string]: string | undefined;
	};
	georef: {
		lat0: number;
		lon0: number;
		rotation_deg: number;
		/**
		 * true tant que la position réelle n est pas fournie (tâche 61) : l interface DOIT l afficher
		 */
		suppose: boolean;
	};
	conventions: {
		u: 'positif vers l Est';
		v: 'positif vers le Nord';
		w: 'positif vers le haut';
		direction: 'meteo : d ou vient le vent, (270 - atan2(v,u)) mod 360';
		nodata: 'null en JSON, NaN dans les binaires';
	};
}
/**
 * GET /v1/profiles/{id}?x_m&y_m — profil vertical
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Profile".
 */
export interface Profile {
	x_m: number;
	y_m: number;
	z_terrain_m: number;
	nearest_station: null | {
		id: string;
		distance_m: number;
	};
	levels: {
		z_asl_m: number;
		agl_m: number;
		below_terrain: boolean;
		u: ComponentMs;
		v: ComponentMs;
		w: ComponentMs;
		speed: SpeedMs;
		dir_from_deg: DirFromDeg;
		speed_interval: Interval;
		status: StatusNode | null;
		coverage: UnitInterval;
		reliability: UnitInterval;
		reliability_class: ReliabilityClass | null;
	}[];
	uncertainty: UncertaintyMethod;
}
/**
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Interval".
 */
export interface Interval {
	p10: number | null;
	p50: number | null;
	p90: number | null;
}
/**
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "UncertaintyMethod".
 */
export interface UncertaintyMethod {
	/**
	 * ex. ensemble-masquage-v1
	 */
	method: string;
	members: number;
	calibrated: boolean;
	scale_factor?: number | null;
	coverage_80_validation?: number | null;
}
/**
 * POST /v1/publish/{id}/commit — manifeste de publication (service GPU → Worker)
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "PublishManifest".
 */
export interface PublishManifest {
	snapshot_id: SnapshotId;
	valid_time: IsoUtc;
	generated_at: IsoUtc;
	last_observation_at: IsoUtc | null;
	versions: Versions;
	/**
	 * degrade si stations manquantes ou en dérive
	 */
	data_status?: 'complete' | 'degrade';
	/**
	 * @minItems 1
	 */
	files: [
		{
			path: string;
			sha256: string;
			bytes: number;
		},
		...{
			path: string;
			sha256: string;
			bytes: number;
		}[]
	];
}
/**
 * GET /v1/quality/{id} — fiabilité agrégée et calibration
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Quality".
 */
export interface Quality {
	uncertainty: UncertaintyMethod;
	by_level: {
		z_asl_m: number;
		valid_nodes: number;
		share_elevee: UnitInterval;
		share_moyenne: UnitInterval;
		share_faible: UnitInterval;
		sigma_speed_median: number | null;
		coverage_median: UnitInterval;
	}[];
	calibration: {
		/**
		 * ex. 120 instants de test, 50 % des stations
		 */
		evaluated_on: string;
		coverage_80: UnitInterval;
		corr_error_sigma: number | null;
		dso6_pass: boolean | null;
	};
}
/**
 * GET /v1/snapshots/{id} — résumé d'un instantané
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Snapshot".
 */
export interface Snapshot {
	snapshot_id: SnapshotId;
	valid_time: IsoUtc;
	versions: Versions;
	kpi: {
		stations_active: number;
		stations_total: number;
		share_high_reliability: UnitInterval;
		reconstruction_ms: number;
		/**
		 * kg·m⁻³·s⁻¹ (DSO2 : ≤ 1e-4)
		 */
		mass_residual_rms: number;
		open_alerts: {
			information: number;
			avertissement: number;
			important: number;
			critique: number;
		};
		hub_wind_mean_ms: SpeedMs;
		hub_wind_max_ms: SpeedMs;
		hub_height_agl_m: number;
	};
	physics: {
		mass_residual_rms: number;
		mass_residual_p95: number;
		ground_condition_rms: number;
		roughness_ratio: number | null;
		dso2_pass: boolean;
	};
	stations_summary: {
		active: number;
		suspecte: number;
		muette: number;
		derive: number;
		exclue: number;
	};
	/**
	 * null = reconstruction nominale ; sinon simulation (BF45, BF46)
	 */
	scenario: null | {
		kind: 'part_stations' | 'panne_zone' | 'station_retiree';
		keep_fraction?: number;
		zone?: {
			x_min_m?: number;
			x_max_m?: number;
			y_min_m?: number;
			y_max_m?: number;
			[k: string]: unknown | undefined;
		};
		stations?: string[];
		baseline_snapshot_id?: SnapshotId;
		[k: string]: unknown | undefined;
	};
	/**
	 * Liens relatifs : fields_template ({level} = indice 0..nz-1, {var}), quality, alerts, stations, wind_farm, export_netcdf, export_csv
	 */
	assets: {
		[k: string]: string | undefined;
	};
}
/**
 * GET /v1/stations/{id} — état du réseau
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Stations".
 */
export interface Stations {
	items: {
		id: string;
		x_m: number;
		y_m: number;
		height_agl_m: number;
		state: StationState;
		last_seen: IsoUtc | null;
		speed?: SpeedMs;
		dir_from_deg?: DirFromDeg;
		/**
		 * écart persistant mesure − reconstruction sans la station
		 */
		bias_ms?: number | null;
		quality_score?: UnitInterval;
	}[];
}
/**
 * GET /v1/times — instantanés publiés (paginé)
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Times".
 */
export interface Times {
	total: number;
	next?: string | null;
	items: {
		snapshot_id: SnapshotId;
		valid_time: IsoUtc;
		open_alerts?: number;
	}[];
}
/**
 * GET /v1/wind-farm/{id} — parc éolien
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "WindFarm".
 */
export interface WindFarm {
	turbines: {
		id: string;
		name: string;
		x_m: number;
		y_m: number;
		virtual: boolean;
		model?: string;
		hub_agl_m: number;
		rotor_d_m: number;
		rated_kw: number;
		cut_in_ms: number;
		cut_out_ms: number;
		hub_speed: Interval;
		rews: Interval;
		shear_ms: number | null;
		veer_deg: number | null;
		power_kw: Interval;
		state: 'production' | 'arret_vent_faible' | 'arret_vent_fort' | 'indisponible';
		air_density?: number | null;
	}[];
	farm: {
		power_kw: Interval;
		rated_kw: number;
		n_production: number;
		n_arret: number;
	};
	power_curve?: {
		name?: string;
		speed_ms: number[];
		power_kw: number[];
	};
}
/**
 * GET /v1/windrose?x_m&y_m&hub_agl_m&from&to — rose des vents et Weibull
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "WindRose".
 */
export interface WindRose {
	x_m: number;
	y_m: number;
	hub_agl_m: number;
	period: {
		from: IsoUtc;
		to: IsoUtc;
	};
	/**
	 * Nombre d'instants valides. L'interface DOIT l'afficher et signaler < 100 comme statistiquement faible
	 */
	n_valid: number;
	speed_bin_edges_ms: number[];
	sectors: {
		dir_center_deg: number;
		frequency: UnitInterval;
		speed_bins: number[];
	}[];
	weibull: null | {
		k: number;
		c_ms: number;
		aep_mwh?: number | null;
		capacity_factor?: UnitInterval;
	};
}
