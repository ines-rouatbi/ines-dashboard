/* eslint-disable */
// FICHIER GÉNÉRÉ par dev/gen-contract-types.mjs depuis contract/schemas/ — ne pas éditer.
// Régénérer : npm run contract:types

/**
 * 8 premiers caractères hexadécimaux d'un sha256
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Sha8".
 */
export type Sha8 = string;
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
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "SigmaMs".
 */
export type SigmaMs = number | null;
/**
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "UnitInterval".
 */
export type UnitInterval = number | null;
/**
 * <stem>[_<scénario>]_<sha8 du modèle>. Stem « live_AAAAMMJJ_HHMMSS » pour le direct, « JJJ_HHMMSS » pour le rejeu, « test_<cas> » pour les instantanés de test. <scénario> seulement pour une simulation (BF45, BF46). Le sha8 est celui de versions.model_sha256.
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "SnapshotId".
 */
export type SnapshotId = string;
/**
 * degrade si des capteurs manquent ou sont en dérive
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "DataStatus".
 */
export type DataStatus = 'complete' | 'degrade';
/**
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Sha256".
 */
export type Sha256 = string;
/**
 * Nature des données d'entrée. L'interface l'affiche toujours ; « test » ne doit jamais être présenté comme un résultat du modèle.
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "DataKind".
 */
export type DataKind = 'synthetique' | 'reel' | 'test';
/**
 * Direction météo : D'OÙ vient le vent, (270 − atan2(v,u)) mod 360. L'arrondi se fait AVANT le modulo (359,996 → 360,00 → 0). null si vitesse < 0,2 m/s ou nœud absent.
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
	Column?: Column;
	DataQuality?: DataQuality;
	Latest?: Latest;
	Meta?: Meta;
	ModelManifest?: ModelManifest;
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
		/**
		 * sha8 de « kind|cible » : stable d'un instantané à l'autre
		 */
		id: Sha8;
		level: AlertLevel;
		/**
		 * Lot responsable : hors_plage, station_muette, stations_insuffisantes M3 ; capteur_derive, incoherence_physique, derive_entrees M4 ; zone_mal_couverte M2 ; vent_fort_moyeu, cisaillement M5
		 */
		kind:
			| 'hors_plage'
			| 'station_muette'
			| 'stations_insuffisantes'
			| 'capteur_derive'
			| 'incoherence_physique'
			| 'derive_entrees'
			| 'zone_mal_couverte'
			| 'vent_fort_moyeu'
			| 'cisaillement';
		/**
		 * Cible : capteur, éolienne, ou maille de 2 km « m<ix>_<iy> »
		 */
		target: string;
		title: string;
		cause: string;
		recommendation: string;
		/**
		 * Première levée (journal JSONL de M4)
		 */
		raised_at: IsoUtc;
		/**
		 * L'acquittement est géré par le Worker, hors contrat v1
		 */
		status: 'ouverte' | 'close';
		station_id: string | null;
		turbine_id: string | null;
		location: Xy | null;
		value: number | null;
		threshold: number | null;
		unit: string | null;
	}[];
}
/**
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Xy".
 */
export interface Xy {
	x_m: number;
	y_m: number;
}
/**
 * GET /v1/column/{id}?i&j — valeurs brutes de la colonne (i, j), lues par le Worker dans les fichiers publiés
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Column".
 */
export interface Column {
	i: number;
	j: number;
	x_m: number;
	y_m: number;
	z_terrain_m: number;
	/**
	 * Aucun calcul au-delà des conversions du contrat : NaN → null, uint8 × scale, 255 → null. Une clé par variable de meta.fields
	 *
	 * @minItems 1
	 */
	levels: [
		{
			z_asl_m: number;
			z_agl_m: number;
			below_terrain: boolean;
			u: ComponentMs;
			v: ComponentMs;
			w: ComponentMs;
			speed: SpeedMs;
			sigma_speed: SigmaMs;
			sigma_u?: SigmaMs;
			sigma_v?: SigmaMs;
			sigma_w?: SigmaMs;
			coverage: UnitInterval;
			reliability: UnitInterval;
			/**
			 * 1 = mesuré, 0 = estimé
			 */
			status: 0 | 1 | null;
		},
		...{
			z_asl_m: number;
			z_agl_m: number;
			below_terrain: boolean;
			u: ComponentMs;
			v: ComponentMs;
			w: ComponentMs;
			speed: SpeedMs;
			sigma_speed: SigmaMs;
			sigma_u?: SigmaMs;
			sigma_v?: SigmaMs;
			sigma_w?: SigmaMs;
			coverage: UnitInterval;
			reliability: UnitInterval;
			/**
			 * 1 = mesuré, 0 = estimé
			 */
			status: 0 | 1 | null;
		}[]
	];
}
/**
 * GET /v1/data-quality/{id} — qualité des données d'entrée (rapport de M3)
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "DataQuality".
 */
export interface DataQuality {
	period: {
		from: IsoUtc;
		to: IsoUtc;
	};
	files: {
		received: number;
		accepted: number;
		rejected: number;
		quarantined: number;
	};
	sensors: {
		total: number;
		observed: number;
		interpolated: number;
		muette: number;
		exclue: number;
	};
	interpolated_fraction: UnitInterval;
	issues: {
		kind: 'fichier_rejete' | 'quarantaine' | 'capteur_muet' | 'valeur_interpolee' | 'hors_plage';
		/**
		 * fichier ou capteur
		 */
		target: string;
		count: number;
		detail: string;
	}[];
}
/**
 * GET /v1/latest — manifeste du dernier instantané publié (écrit par le Worker au /commit)
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
	heartbeat_at: IsoUtc | null;
	data_status: DataStatus;
	versions: Versions;
	href: string;
}
/**
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Versions".
 */
export interface Versions {
	/**
	 * Nom lisible du modèle, ex. v7
	 */
	model: string;
	/**
	 * sha256 des octets du fichier de poids servi
	 */
	model_sha256: Sha256;
	/**
	 * sha8 de norm_stats.json
	 */
	norm: Sha8;
	/**
	 * Jeu de données d'entrée, ex. aneo_dataset_3d_v2
	 */
	data: string;
	data_kind: DataKind;
	contract: string;
}
/**
 * GET /v1/meta et /v1/meta/{sha8} — géométrie du domaine (fichier par modèle : models/{sha8}/meta.json)
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Meta".
 */
export interface Meta {
	versions: Versions;
	grid: {
		nx: number;
		ny: number;
		nz: number;
		dx_m: number;
		dy_m: number;
		/**
		 * x du nœud (0, 0). Le nœud (i, j) est en x = x0 + i·dx (0 pour v7)
		 */
		x0_m: number;
		/**
		 * y du nœud (0, 0). Le nœud (i, j) est en y = y0 + j·dy (0 pour v7)
		 */
		y0_m: number;
		/**
		 * Hauteur minimale d'un nœud au-dessus du sol (5,0 pour v7). Règle : NaN (ou 255 en uint8) ⇔ z_asl − relief < min_agl_m
		 */
		min_agl_m: number;
		/**
		 * Altitudes AU-DESSUS DU NIVEAU DE LA MER, strictement croissantes (contrôlé par validate.mjs)
		 *
		 * @minItems 1
		 */
		levels_asl_m: [number, ...number[]];
		/**
		 * Fichier tous niveaux : index = k·ny·nx + j·nx + i ; j = 0 au sud, i = 0 à l'ouest
		 */
		order: 'zyx_sud_ouest';
		/**
		 * Nombre de nœuds (i, j, k) avec z_asl − relief ≥ min_agl_m
		 */
		valid_nodes: number;
		valid_fraction_by_level: number[];
	};
	domain: {
		/**
		 * x0 + (nx − 1)·dx
		 */
		x_max_m: number;
		/**
		 * y0 + (ny − 1)·dy
		 */
		y_max_m: number;
		origin: 'noeud_0_0_sud_ouest';
		/**
		 * Plan tangent équirectangulaire au nœud (0, 0), voir georef
		 */
		crs: 'plan-tangent-local';
	};
	terrain: {
		min_m: number;
		max_m: number;
		/**
		 * /v1/terrain/{sha8} : Float32 LE ny·nx, altitude du sol au nœud (i, j) en m au-dessus de la mer, sans nodata. Immuable
		 */
		href: string;
		sha256: Sha256;
		bytes: number;
		/**
		 * générateur synthétique | MNT public (nom)
		 */
		source: string;
	};
	/**
	 * Variables publiées, une par fichier fields/{var}.{f32|u8} de nz·ny·nx valeurs. status : 1 = mesuré, 0 = estimé
	 */
	fields: (
		| 'u'
		| 'v'
		| 'w'
		| 'speed'
		| 'sigma_speed'
		| 'sigma_u'
		| 'sigma_v'
		| 'sigma_w'
		| 'coverage'
		| 'reliability'
		| 'status'
	)[];
	/**
	 * Codage de chaque variable de fields (toutes y figurent)
	 */
	encoding: {
		[k: string]:
			| {
					/**
					 * Little-endian pour float32
					 */
					dtype: 'float32' | 'uint8';
					file: string;
					nodata: 'NaN' | 255;
					/**
					 * uint8 quantifié : valeur = octet × scale (1/254 pour coverage et reliability, 0..254 → 0..1) ; 1 pour status ; null pour float32
					 */
					scale: number | null;
			  }
			| undefined;
	};
	units: {
		[k: string]: string | undefined;
	};
	georef: {
		/**
		 * Latitude du nœud (0, 0)
		 */
		lat0: number;
		/**
		 * Longitude du nœud (0, 0)
		 */
		lon0: number;
		/**
		 * Angle de l'axe x depuis l'Est, sens antihoraire. Est = x·cos θ − y·sin θ, Nord = x·sin θ + y·cos θ
		 */
		rotation_deg: number;
		/**
		 * lat = lat0 + Nord / m_per_deg_lat ; lon = lon0 + Est / m_per_deg_lon
		 */
		projection: 'equirectangulaire_tangent_noeud_0_0';
		m_per_deg_lat: 110574;
		/**
		 * 111320·cos(lat0)
		 */
		m_per_deg_lon: number;
		/**
		 * Emprise des 4 coins du domaine
		 */
		bounds: {
			lat_min: number;
			lat_max: number;
			lon_min: number;
			lon_max: number;
		};
		/**
		 * true tant que la position réelle n'est pas fournie (tâche 61) : l'interface DOIT afficher « position supposée »
		 */
		suppose: boolean;
	};
	conventions: {
		u: 'positif_est';
		v: 'positif_nord';
		w: 'positif_haut';
		/**
		 * (270 − atan2(v,u)) mod 360, arrondi avant le modulo
		 */
		direction: 'meteo_provenance';
		/**
		 * m au-dessus de la mer ; z_agl = z_asl − relief
		 */
		altitude: 'asl';
		nodata: 'null_json_nan_f32_255_u8';
	};
}
/**
 * POST /v1/publish/model/{sha8}/commit — manifeste de publication des fichiers par modèle (une seule fois par modèle)
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "ModelManifest".
 */
export interface ModelManifest {
	model_sha8: Sha8;
	versions: Versions;
	/**
	 * Chemins relatifs à models/{sha8}/ : meta.json et terrain.f32 au moins
	 *
	 * @minItems 1
	 */
	files: [
		{
			/**
			 * Relatif ; chaque segment commence par une lettre ou un chiffre (ni « .. » ni « _commit »)
			 */
			path: string;
			sha256: Sha256;
			bytes: number;
		},
		...{
			/**
			 * Relatif ; chaque segment commence par une lettre ou un chiffre (ni « .. » ni « _commit »)
			 */
			path: string;
			sha256: Sha256;
			bytes: number;
		}[]
	];
}
/**
 * GET /v1/profiles/{id}/{point_id} — profil vertical précalculé en un point déclaré
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Profile".
 */
export interface Profile {
	point_id: string;
	i: number;
	j: number;
	x_m: number;
	y_m: number;
	/**
	 * terrain[j·nx + i] du nœud utilisé (x_m, y_m = position de ce nœud, D5)
	 */
	z_terrain_m: number;
	nearest_sensor: {
		/**
		 * stations_aneo : identifiant ANEO ; treillis_synthetique : c<i>_<j> (indices du treillis de capteurs à 50 m)
		 */
		id: string;
		distance_m: number;
	} | null;
	/**
	 * nz niveaux exactement (contrôlé par validate.mjs, m3)
	 *
	 * @minItems 1
	 */
	levels: [
		{
			z_asl_m: number;
			/**
			 * z_asl − z_terrain_m
			 */
			z_agl_m: number;
			/**
			 * z_agl_m < grid.min_agl_m : toutes les valeurs sont null
			 */
			below_terrain: boolean;
			u: ComponentMs;
			v: ComponentMs;
			w: ComponentMs;
			speed: SpeedMs;
			sigma_speed: SigmaMs;
			dir_from_deg: DirFromDeg;
			speed_interval: Interval;
			status: StatusNode | null;
			coverage: UnitInterval;
			reliability: UnitInterval;
			reliability_class: ReliabilityClass | null;
		},
		...{
			z_asl_m: number;
			/**
			 * z_asl − z_terrain_m
			 */
			z_agl_m: number;
			/**
			 * z_agl_m < grid.min_agl_m : toutes les valeurs sont null
			 */
			below_terrain: boolean;
			u: ComponentMs;
			v: ComponentMs;
			w: ComponentMs;
			speed: SpeedMs;
			sigma_speed: SigmaMs;
			dir_from_deg: DirFromDeg;
			speed_interval: Interval;
			status: StatusNode | null;
			coverage: UnitInterval;
			reliability: UnitInterval;
			reliability_class: ReliabilityClass | null;
		}[]
	];
	uncertainty: UncertaintyMethod;
}
/**
 * Intervalle à 80 %. Pour une vitesse : p50 = speed (passe servie), p10 = max(0, speed − 1,2816·sigma_speed), p90 = speed + 1,2816·sigma_speed. Tout null si inconnu.
 *
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
	 * ex. ensemble-masquage-v1 ; « aucune » avant M2 (members = 1, calibrated = false)
	 */
	method: string;
	members: number;
	calibrated: boolean;
	scale_factor?: number | null;
	coverage_80_validation?: number | null;
}
/**
 * POST /v1/publish/{id}/commit — manifeste de publication d'un instantané (service GPU → Worker)
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "PublishManifest".
 */
export interface PublishManifest {
	snapshot_id: SnapshotId;
	valid_time: IsoUtc;
	generated_at: IsoUtc;
	last_observation_at: IsoUtc | null;
	data_status: DataStatus;
	versions: Versions;
	/**
	 * Fichiers de l'instantané, chemins relatifs à snapshots/{id}/. Ni meta.json ni terrain.f32 (fichiers du modèle)
	 *
	 * @minItems 1
	 */
	files: [
		{
			/**
			 * Relatif ; chaque segment commence par une lettre ou un chiffre (ni « .. » ni « _commit »)
			 */
			path: string;
			sha256: Sha256;
			bytes: number;
		},
		...{
			/**
			 * Relatif ; chaque segment commence par une lettre ou un chiffre (ni « .. » ni « _commit »)
			 */
			path: string;
			sha256: Sha256;
			bytes: number;
		}[]
	];
}
/**
 * GET /v1/quality/{id} — fiabilité de la reconstruction et calibration (M2)
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
		sigma_speed_median: SigmaMs;
		coverage_median: UnitInterval;
	}[];
	calibration: {
		/**
		 * ex. 120 instants de test, 50 % des capteurs
		 */
		evaluated_on: string;
		coverage_80: UnitInterval;
		corr_error_sigma: number | null;
		dso6_pass: boolean | null;
	} | null;
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
	network: {
		kind: 'treillis_synthetique' | 'stations_aneo';
		sensors_total: number;
		/**
		 * Capteurs dont une mesure entre dans cet instantané (ni muets ni exclus)
		 */
		sensors_visible: number;
		unit: 'capteur';
	};
	/**
	 * null = non disponible (lot pas encore livré) ; jamais 0 pour une valeur inconnue. hub_wind_* : statistique sur le DOMAINE à hub_height_agl_m au-dessus du sol (interpolation linéaire de speed par colonne), pas sur les éoliennes (D10)
	 */
	kpi: {
		share_high_reliability: UnitInterval;
		reconstruction_ms: number | null;
		open_alerts: {
			information: number;
			avertissement: number;
			important: number;
			critique: number;
		} | null;
		hub_wind_mean_ms: SpeedMs;
		hub_wind_max_ms: SpeedMs;
		hub_height_agl_m: number;
	};
	physics: {
		/**
		 * kg·m⁻³·s⁻¹
		 */
		mass_residual_rms: number;
		/**
		 * kg·m⁻³·s⁻¹
		 */
		mass_residual_p95: number;
		/**
		 * Cet instant sous le seuil DSO2 (1e-4) ; le DSO2 lui-même est un agrégat sur 120 instants
		 */
		mass_residual_ok: boolean;
		/**
		 * m/s : RMS de w − u·∇z_s au premier nœud valide, relief lissé à 300 m
		 */
		ground_condition_rms_ms: number;
		rho_source: 'atmosphere_standard' | 'extrapolation_surface' | 'verite_synthetique';
	} | null;
	stations_summary: {
		active: number;
		suspecte: number;
		muette: number;
		derive: number;
		exclue: number;
	} | null;
	/**
	 * null = reconstruction nominale ; sinon simulation (BF45, BF46)
	 */
	scenario: null | {
		kind: 'part_stations' | 'panne_zone' | 'station_retiree';
		keep_fraction?: number;
		zone?: {
			x_min_m: number;
			x_max_m: number;
			y_min_m: number;
			y_max_m: number;
		};
		stations?: string[];
		baseline_snapshot_id?: SnapshotId;
	};
	/**
	 * Points déclarés (éoliennes, sites) : profils et roses des vents précalculés, facultatifs
	 */
	points: {
		id: string;
		kind: 'eolienne' | 'site';
		name: string;
		x_m: number;
		y_m: number;
		/**
		 * true si /v1/profiles/{id}/{point_id} existe
		 */
		profile: boolean;
		/**
		 * true si /v1/windrose/{point_id} existe pour cet instantané
		 */
		windrose: boolean;
	}[];
	/**
	 * Liens relatifs ; null = ressource absente de cet instantané
	 */
	assets: {
		meta: string;
		terrain: string;
		/**
		 * /v1/fields/{id}/{level}/{var} ; {level} = indice 0..nz-1
		 */
		fields_template: string;
		/**
		 * /v1/column/{id}?i={i}&j={j}
		 */
		column_template: string;
		profile_template: string | null;
		windrose_template: string | null;
		quality: string | null;
		alerts: string | null;
		stations: string | null;
		wind_farm: string | null;
		data_quality: string | null;
		export_netcdf: string | null;
		export_csv: string | null;
	};
}
/**
 * GET /v1/stations/{id} — capteurs (liste complète en stations_aneo, capteurs signalés seulement en treillis_synthetique)
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "Stations".
 */
export interface Stations {
	items: {
		/**
		 * stations_aneo : identifiant ANEO ; treillis_synthetique : c<i>_<j> (indices du treillis de capteurs à 50 m)
		 */
		id: string;
		x_m: number;
		y_m: number;
		height_agl_m: number;
		state: StationState;
		last_seen: IsoUtc | null;
		speed: SpeedMs;
		dir_from_deg: DirFromDeg;
		/**
		 * écart persistant mesure − reconstruction sans le capteur
		 */
		bias_ms: number | null;
		quality_score: UnitInterval;
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
	next: string | null;
	items: {
		snapshot_id: SnapshotId;
		valid_time: IsoUtc;
		/**
		 * Nombre d'alertes au statut « ouverte » (m9)
		 */
		open_alerts?: number | null;
	}[];
}
/**
 * GET /v1/wind-farm/{id} — parc éolien (M5)
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
		/**
		 * Clé de power_curves
		 */
		model: string;
		hub_agl_m: number;
		rotor_d_m: number;
		rated_kw: number;
		cut_in_ms: number;
		cut_out_ms: number;
		hub_speed: Interval;
		/**
		 * Vent équivalent rotor, pondéré par l'aire
		 */
		rews: Interval;
		/**
		 * Exposant de loi de puissance entre le bas et le haut du rotor
		 */
		shear_alpha: number | null;
		/**
		 * Rotation de la direction du bas vers le haut du rotor, positive dans le sens horaire avec la hauteur
		 */
		veer_deg: number | null;
		power_kw: Interval;
		state: 'production' | 'arret_vent_faible' | 'arret_vent_fort' | 'indisponible';
		/**
		 * kg/m³
		 */
		air_density: number | null;
		air_density_source: 'atmosphere_standard' | 'extrapolation_surface' | 'mesure' | null;
	}[];
	farm: {
		/**
		 * Quantiles calculés sur les membres de l'ensemble (pas la somme des quantiles)
		 */
		power_kw: Interval;
		rated_kw: number;
		n_production: number;
		n_arret: number;
	};
	/**
	 * Courbes de puissance indexées par turbines[].model
	 */
	power_curves: {
		[k: string]:
			| {
					/**
					 * @minItems 2
					 */
					speed_ms: [number, number, ...number[]];
					/**
					 * @minItems 2
					 */
					power_kw: [number, number, ...number[]];
			  }
			| undefined;
	};
}
/**
 * GET /v1/windrose/{site_id} — rose des vents et Weibull précalculées (M5, M6) pour un site ou une éolienne déclaré
 *
 * This interface was referenced by `ContratV1`'s JSON-Schema
 * via the `definition` "WindRose".
 */
export interface WindRose {
	site_id: string;
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
	/**
	 * 360 / nombre de secteurs : secteurs de largeur égale, le premier centré sur 0
	 */
	sector_width_deg: number;
	/**
	 * @minItems 2
	 */
	speed_bin_edges_ms: [number, number, ...number[]];
	/**
	 * Somme des fréquences = 1 à 0,01 près (contrôle de validate.mjs)
	 *
	 * @minItems 1
	 */
	sectors: [
		{
			/**
			 * Provenance (direction météo), = k · sector_width_deg
			 */
			dir_center_deg: number;
			frequency: number;
			speed_bins: number[];
		},
		...{
			/**
			 * Provenance (direction météo), = k · sector_width_deg
			 */
			dir_center_deg: number;
			frequency: number;
			speed_bins: number[];
		}[]
	];
	weibull: {
		k: number;
		c_ms: number;
		aep_mwh: number | null;
		capacity_factor: UnitInterval;
	} | null;
}
