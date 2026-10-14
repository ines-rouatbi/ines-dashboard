// Génère les schémas JSON du contrat v1, révision 2 (sauf common et meta, écrits à la main).
// Toute correction d'un schéma généré passe par ce script, sinon elle sera écrasée (m12).
// Usage : node contract/tools/gen-schemas.cjs
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'schemas');
const C = 'common.schema.json#/$defs/';
const r = (n) => ({ $ref: C + n });
const nul = (s) => ({ anyOf: [s, { type: 'null' }] });
const obj = (required, properties, extra = {}) => ({ type: 'object', additionalProperties: false, required, properties, ...extra });
const S = (id, title, o) => fs.writeFileSync(path.join(DIR, id + '.schema.json'), JSON.stringify({
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	$id: `https://atom.zelqane.com/contract/v1/${id}.schema.json`,
	title, type: 'object', additionalProperties: false, ...o,
}, null, 2) + '\n');
const XY = { x_m: { type: 'number' }, y_m: { type: 'number' } };
const IJ = { i: { type: 'integer', minimum: 0 }, j: { type: 'integer', minimum: 0 } };
const counts = (keys) => obj(keys, Object.fromEntries(keys.map((k) => [k, { type: 'integer', minimum: 0 }])));
const POINT_ID = { type: 'string', pattern: '^[A-Za-z0-9_-]+$' };
const SENSOR_ID = { type: 'string', description: 'stations_aneo : identifiant ANEO ; treillis_synthetique : c<i>_<j> (indices du treillis de capteurs à 50 m)' };
const ALERT_KINDS = ['hors_plage', 'station_muette', 'stations_insuffisantes', 'capteur_derive', 'incoherence_physique', 'derive_entrees', 'zone_mal_couverte', 'vent_fort_moyeu', 'cisaillement'];
const rel = (s) => nul({ type: 'string', pattern: s });

S('latest', 'GET /v1/latest — manifeste du dernier instantané publié (écrit par le Worker au /commit)', {
	required: ['snapshot_id', 'valid_time', 'generated_at', 'published_at', 'last_observation_at', 'compute_status', 'heartbeat_at', 'data_status', 'versions', 'href'],
	properties: {
		snapshot_id: r('snapshot_id'), valid_time: r('iso_utc'), generated_at: r('iso_utc'), published_at: r('iso_utc'),
		last_observation_at: nul(r('iso_utc')),
		compute_status: { enum: ['online', 'offline', 'unknown'], description: 'online seulement si le battement de cœur du service GPU a moins de 5 min' },
		heartbeat_at: nul(r('iso_utc')),
		data_status: r('data_status'), versions: r('versions'), href: { type: 'string' },
	},
});

S('times', 'GET /v1/times — instantanés publiés (paginé)', {
	required: ['total', 'next', 'items'],
	properties: {
		total: { type: 'integer', minimum: 0 }, next: { type: ['string', 'null'] },
		items: { type: 'array', items: obj(['snapshot_id', 'valid_time'], {
			snapshot_id: r('snapshot_id'), valid_time: r('iso_utc'),
			open_alerts: { type: ['integer', 'null'], minimum: 0, description: "Nombre d'alertes au statut « ouverte » (m9)" },
		}) },
	},
});

S('snapshot', "GET /v1/snapshots/{id} — résumé d'un instantané", {
	required: ['snapshot_id', 'valid_time', 'versions', 'network', 'kpi', 'physics', 'stations_summary', 'scenario', 'points', 'assets'],
	properties: {
		snapshot_id: r('snapshot_id'), valid_time: r('iso_utc'), versions: r('versions'),
		network: obj(['kind', 'sensors_total', 'sensors_visible', 'unit'], {
			kind: { enum: ['treillis_synthetique', 'stations_aneo'] },
			sensors_total: { type: 'integer', minimum: 0 },
			sensors_visible: { type: 'integer', minimum: 0, description: 'Capteurs dont une mesure entre dans cet instantané (ni muets ni exclus)' },
			unit: { const: 'capteur' },
		}),
		kpi: obj(['share_high_reliability', 'reconstruction_ms', 'open_alerts', 'hub_wind_mean_ms', 'hub_wind_max_ms', 'hub_height_agl_m'], {
			share_high_reliability: r('unit_interval'),
			reconstruction_ms: { type: ['number', 'null'], minimum: 0 },
			open_alerts: nul(counts(['information', 'avertissement', 'important', 'critique'])),
			hub_wind_mean_ms: r('speed_ms'), hub_wind_max_ms: r('speed_ms'),
			hub_height_agl_m: { type: 'number', exclusiveMinimum: 0 },
		}, { description: "null = non disponible (lot pas encore livré) ; jamais 0 pour une valeur inconnue. hub_wind_* : statistique sur le DOMAINE à hub_height_agl_m au-dessus du sol (interpolation linéaire de speed par colonne), pas sur les éoliennes (D10)" }),
		physics: nul(obj(['mass_residual_rms', 'mass_residual_p95', 'mass_residual_ok', 'ground_condition_rms_ms', 'rho_source'], {
			mass_residual_rms: { type: 'number', minimum: 0, description: 'kg·m⁻³·s⁻¹' },
			mass_residual_p95: { type: 'number', minimum: 0, description: 'kg·m⁻³·s⁻¹' },
			mass_residual_ok: { type: 'boolean', description: "Cet instant sous le seuil DSO2 (1e-4) ; le DSO2 lui-même est un agrégat sur 120 instants" },
			ground_condition_rms_ms: { type: 'number', minimum: 0, description: 'm/s : RMS de w − u·∇z_s au premier nœud valide, relief lissé à 300 m' },
			rho_source: { enum: ['atmosphere_standard', 'extrapolation_surface', 'verite_synthetique'] },
		})),
		stations_summary: nul(counts(['active', 'suspecte', 'muette', 'derive', 'exclue'])),
		scenario: { anyOf: [{ type: 'null' }, obj(['kind'], {
			kind: { enum: ['part_stations', 'panne_zone', 'station_retiree'] }, keep_fraction: { type: 'number', minimum: 0, maximum: 1 },
			zone: obj(['x_min_m', 'x_max_m', 'y_min_m', 'y_max_m'], { x_min_m: { type: 'number' }, x_max_m: { type: 'number' }, y_min_m: { type: 'number' }, y_max_m: { type: 'number' } }),
			stations: { type: 'array', uniqueItems: true, items: { type: 'string' } }, baseline_snapshot_id: r('snapshot_id'),
		})], description: 'null = reconstruction nominale ; sinon simulation (BF45, BF46)' },
		points: { type: 'array', description: 'Points déclarés (éoliennes, sites) : profils et roses des vents précalculés, facultatifs', items: obj(['id', 'kind', 'name', 'x_m', 'y_m', 'profile', 'windrose'], {
			id: POINT_ID, kind: { enum: ['eolienne', 'site'] }, name: { type: 'string' }, ...XY,
			profile: { type: 'boolean', description: 'true si /v1/profiles/{id}/{point_id} existe' },
			windrose: { type: 'boolean', description: 'true si /v1/windrose/{point_id} existe pour cet instantané' },
		}) },
		assets: obj(['meta', 'terrain', 'fields_template', 'column_template', 'profile_template', 'windrose_template', 'quality', 'alerts', 'stations', 'wind_farm', 'data_quality', 'export_netcdf', 'export_csv'], {
			meta: { type: 'string', pattern: '^/v1/meta/[0-9a-f]{8}$' },
			terrain: { type: 'string', pattern: '^/v1/terrain/[0-9a-f]{8}$' },
			fields_template: { type: 'string', description: '/v1/fields/{id}/{level}/{var} ; {level} = indice 0..nz-1' },
			column_template: { type: 'string', description: '/v1/column/{id}?i={i}&j={j}' },
			profile_template: rel('\\{point_id\\}'), windrose_template: rel('\\{site_id\\}'),
			quality: rel('^/v1/'), alerts: rel('^/v1/'), stations: rel('^/v1/'), wind_farm: rel('^/v1/'), data_quality: rel('^/v1/'),
			export_netcdf: rel('^/'), export_csv: rel('^/'),
		}, { description: 'Liens relatifs ; null = ressource absente de cet instantané' }),
	},
});

const LEVEL_VARS = {
	u: r('component_ms'), v: r('component_ms'), w: r('component_ms'), speed: r('speed_ms'), sigma_speed: r('sigma_ms'),
};

S('profile', 'GET /v1/profiles/{id}/{point_id} — profil vertical précalculé en un point déclaré', {
	required: ['point_id', ...Object.keys(IJ), 'x_m', 'y_m', 'z_terrain_m', 'nearest_sensor', 'levels', 'uncertainty'],
	properties: {
		point_id: POINT_ID, ...IJ, ...XY,
		z_terrain_m: { type: 'number', description: 'terrain[j·nx + i] du nœud utilisé (x_m, y_m = position de ce nœud, D5)' },
		nearest_sensor: nul(obj(['id', 'distance_m'], { id: SENSOR_ID, distance_m: { type: 'number', minimum: 0 } })),
		levels: { type: 'array', minItems: 1, description: 'nz niveaux exactement (contrôlé par validate.mjs, m3)', items: obj(
			['z_asl_m', 'z_agl_m', 'below_terrain', 'u', 'v', 'w', 'speed', 'sigma_speed', 'dir_from_deg', 'speed_interval', 'status', 'coverage', 'reliability', 'reliability_class'], {
				z_asl_m: { type: 'number' }, z_agl_m: { type: 'number', description: 'z_asl − z_terrain_m' },
				below_terrain: { type: 'boolean', description: 'z_agl_m < grid.min_agl_m : toutes les valeurs sont null' },
				...LEVEL_VARS, dir_from_deg: r('dir_from_deg'),
				speed_interval: r('interval'), status: nul(r('status_node')),
				coverage: r('unit_interval'), reliability: r('unit_interval'), reliability_class: nul(r('reliability_class')),
			}) },
		uncertainty: r('uncertainty_method'),
	},
});

S('column', 'GET /v1/column/{id}?i&j — valeurs brutes de la colonne (i, j), lues par le Worker dans les fichiers publiés', {
	required: [...Object.keys(IJ), 'x_m', 'y_m', 'z_terrain_m', 'levels'],
	properties: {
		...IJ, ...XY, z_terrain_m: { type: 'number' },
		levels: { type: 'array', minItems: 1, description: "Aucun calcul au-delà des conversions du contrat : NaN → null, uint8 × scale, 255 → null. Une clé par variable de meta.fields", items: obj(
			['z_asl_m', 'z_agl_m', 'below_terrain', 'u', 'v', 'w', 'speed', 'sigma_speed', 'coverage', 'reliability', 'status'], {
				z_asl_m: { type: 'number' }, z_agl_m: { type: 'number' }, below_terrain: { type: 'boolean' },
				...LEVEL_VARS, sigma_u: r('sigma_ms'), sigma_v: r('sigma_ms'), sigma_w: r('sigma_ms'),
				coverage: r('unit_interval'), reliability: r('unit_interval'),
				status: { enum: [0, 1, null], description: '1 = mesuré, 0 = estimé' },
			}) },
	},
});

S('quality', 'GET /v1/quality/{id} — fiabilité de la reconstruction et calibration (M2)', {
	required: ['uncertainty', 'by_level', 'calibration'],
	properties: {
		uncertainty: r('uncertainty_method'),
		by_level: { type: 'array', items: obj(['z_asl_m', 'valid_nodes', 'share_elevee', 'share_moyenne', 'share_faible', 'sigma_speed_median', 'coverage_median'], {
			z_asl_m: { type: 'number' }, valid_nodes: { type: 'integer', minimum: 0 }, share_elevee: r('unit_interval'), share_moyenne: r('unit_interval'), share_faible: r('unit_interval'),
			sigma_speed_median: r('sigma_ms'), coverage_median: r('unit_interval'),
		}) },
		calibration: nul(obj(['evaluated_on', 'coverage_80', 'corr_error_sigma', 'dso6_pass'], {
			evaluated_on: { type: 'string', description: 'ex. 120 instants de test, 50 % des capteurs' }, coverage_80: r('unit_interval'),
			corr_error_sigma: { type: ['number', 'null'] }, dso6_pass: { type: ['boolean', 'null'] },
		})),
	},
});

S('data-quality', "GET /v1/data-quality/{id} — qualité des données d'entrée (rapport de M3)", {
	required: ['period', 'files', 'sensors', 'interpolated_fraction', 'issues'],
	properties: {
		period: obj(['from', 'to'], { from: r('iso_utc'), to: r('iso_utc') }),
		files: counts(['received', 'accepted', 'rejected', 'quarantined']),
		sensors: obj(['total', 'observed', 'interpolated', 'muette', 'exclue'], {
			total: { type: 'integer', minimum: 0 }, observed: { type: 'integer', minimum: 0 }, interpolated: { type: 'integer', minimum: 0 },
			muette: { type: 'integer', minimum: 0 }, exclue: { type: 'integer', minimum: 0 },
		}),
		interpolated_fraction: r('unit_interval'),
		issues: { type: 'array', items: obj(['kind', 'target', 'count', 'detail'], {
			kind: { enum: ['fichier_rejete', 'quarantaine', 'capteur_muet', 'valeur_interpolee', 'hors_plage'] },
			target: { type: 'string', description: 'fichier ou capteur' }, count: { type: 'integer', minimum: 1 }, detail: { type: 'string' },
		}) },
	},
});

S('alerts', 'GET /v1/alerts/{id} — alertes et recommandations', {
	required: ['items'],
	properties: { items: { type: 'array', items: obj(['id', 'level', 'kind', 'target', 'title', 'cause', 'recommendation', 'raised_at', 'status', 'station_id', 'turbine_id', 'location', 'value', 'threshold', 'unit'], {
		id: { ...r('sha8'), description: 'sha8 de « kind|cible » : stable d\'un instantané à l\'autre' },
		level: r('alert_level'),
		kind: { enum: ALERT_KINDS, description: 'Lot responsable : hors_plage, station_muette, stations_insuffisantes M3 ; capteur_derive, incoherence_physique, derive_entrees M4 ; zone_mal_couverte M2 ; vent_fort_moyeu, cisaillement M5' },
		target: { type: 'string', description: 'Cible : capteur, éolienne, ou maille de 2 km « m<ix>_<iy> »' },
		title: { type: 'string' }, cause: { type: 'string' }, recommendation: { type: 'string' },
		raised_at: { ...r('iso_utc'), description: 'Première levée (journal JSONL de M4)' },
		status: { enum: ['ouverte', 'close'], description: "L'acquittement est géré par le Worker, hors contrat v1" },
		station_id: nul(SENSOR_ID), turbine_id: { type: ['string', 'null'] },
		location: nul(r('xy')),
		value: { type: ['number', 'null'] }, threshold: { type: ['number', 'null'] }, unit: { type: ['string', 'null'] },
	}) } },
});

S('stations', 'GET /v1/stations/{id} — capteurs (liste complète en stations_aneo, capteurs signalés seulement en treillis_synthetique)', {
	required: ['items'],
	properties: { items: { type: 'array', items: obj(['id', 'x_m', 'y_m', 'height_agl_m', 'state', 'last_seen', 'speed', 'dir_from_deg', 'bias_ms', 'quality_score'], {
		id: SENSOR_ID, ...XY, height_agl_m: { type: 'number' }, state: r('station_state'),
		last_seen: nul(r('iso_utc')), speed: r('speed_ms'), dir_from_deg: r('dir_from_deg'),
		bias_ms: { type: ['number', 'null'], description: 'écart persistant mesure − reconstruction sans le capteur' },
		quality_score: r('unit_interval'),
	}) } },
});

const CURVE = obj(['speed_ms', 'power_kw'], { speed_ms: { type: 'array', minItems: 2, items: { type: 'number', minimum: 0 } }, power_kw: { type: 'array', minItems: 2, items: { type: 'number', minimum: 0 } } });
S('wind-farm', 'GET /v1/wind-farm/{id} — parc éolien (M5)', {
	required: ['turbines', 'farm', 'power_curves'],
	properties: {
		turbines: { type: 'array', items: obj(['id', 'name', 'x_m', 'y_m', 'virtual', 'model', 'hub_agl_m', 'rotor_d_m', 'rated_kw', 'cut_in_ms', 'cut_out_ms', 'hub_speed', 'rews', 'shear_alpha', 'veer_deg', 'power_kw', 'state', 'air_density', 'air_density_source'], {
			id: POINT_ID, name: { type: 'string' }, ...XY, virtual: { type: 'boolean' }, model: { type: 'string', description: 'Clé de power_curves' },
			hub_agl_m: { type: 'number' }, rotor_d_m: { type: 'number' }, rated_kw: { type: 'number' }, cut_in_ms: { type: 'number' }, cut_out_ms: { type: 'number' },
			hub_speed: r('interval'), rews: { ...r('interval'), description: 'Vent équivalent rotor, pondéré par l\'aire' },
			shear_alpha: { type: ['number', 'null'], description: 'Exposant de loi de puissance entre le bas et le haut du rotor' },
			veer_deg: { type: ['number', 'null'], minimum: -180, exclusiveMaximum: 180, description: 'Rotation de la direction du bas vers le haut du rotor, positive dans le sens horaire avec la hauteur' },
			power_kw: r('interval'), state: { enum: ['production', 'arret_vent_faible', 'arret_vent_fort', 'indisponible'] },
			air_density: { type: ['number', 'null'], exclusiveMinimum: 0, description: 'kg/m³' },
			air_density_source: { enum: ['atmosphere_standard', 'extrapolation_surface', 'mesure', null] },
		}) },
		farm: obj(['power_kw', 'rated_kw', 'n_production', 'n_arret'], {
			power_kw: { ...r('interval'), description: 'Quantiles calculés sur les membres de l\'ensemble (pas la somme des quantiles)' },
			rated_kw: { type: 'number' }, n_production: { type: 'integer', minimum: 0 }, n_arret: { type: 'integer', minimum: 0 },
		}),
		power_curves: { type: 'object', description: 'Courbes de puissance indexées par turbines[].model', additionalProperties: CURVE },
	},
});

S('windrose', 'GET /v1/windrose/{site_id} — rose des vents et Weibull précalculées (M5, M6) pour un site ou une éolienne déclaré', {
	required: ['site_id', 'x_m', 'y_m', 'hub_agl_m', 'period', 'n_valid', 'sector_width_deg', 'speed_bin_edges_ms', 'sectors', 'weibull'],
	properties: {
		site_id: POINT_ID, ...XY, hub_agl_m: { type: 'number' },
		period: obj(['from', 'to'], { from: r('iso_utc'), to: r('iso_utc') }),
		n_valid: { type: 'integer', minimum: 0, description: "Nombre d'instants valides. L'interface DOIT l'afficher et signaler < 100 comme statistiquement faible" },
		sector_width_deg: { type: 'number', exclusiveMinimum: 0, maximum: 360, description: '360 / nombre de secteurs : secteurs de largeur égale, le premier centré sur 0' },
		speed_bin_edges_ms: { type: 'array', minItems: 2, items: { type: 'number', minimum: 0 } },
		sectors: { type: 'array', minItems: 1, description: 'Somme des fréquences = 1 à 0,01 près (contrôle de validate.mjs)', items: obj(['dir_center_deg', 'frequency', 'speed_bins'], {
			dir_center_deg: { type: 'number', minimum: 0, exclusiveMaximum: 360, description: 'Provenance (direction météo), = k · sector_width_deg' },
			frequency: { type: 'number', minimum: 0, maximum: 1 }, speed_bins: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 } },
		}) },
		weibull: nul(obj(['k', 'c_ms', 'aep_mwh', 'capacity_factor'], { k: { type: 'number', exclusiveMinimum: 0 }, c_ms: { type: 'number', exclusiveMinimum: 0 }, aep_mwh: { type: ['number', 'null'] }, capacity_factor: r('unit_interval') })),
	},
});

const FILES = { type: 'array', minItems: 1, items: obj(['path', 'sha256', 'bytes'], {
	path: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]*(/[A-Za-z0-9][A-Za-z0-9_.-]*)*$', description: 'Relatif ; chaque segment commence par une lettre ou un chiffre (ni « .. » ni « _commit »)' },
	sha256: r('sha256'), bytes: { type: 'integer', minimum: 1, maximum: 8388608 },
}) };

S('publish-manifest', "POST /v1/publish/{id}/commit — manifeste de publication d'un instantané (service GPU → Worker)", {
	required: ['snapshot_id', 'valid_time', 'generated_at', 'last_observation_at', 'data_status', 'versions', 'files'],
	properties: {
		snapshot_id: r('snapshot_id'), valid_time: r('iso_utc'), generated_at: r('iso_utc'),
		last_observation_at: nul(r('iso_utc')), data_status: r('data_status'), versions: r('versions'),
		files: { ...FILES, description: "Fichiers de l'instantané, chemins relatifs à snapshots/{id}/. Ni meta.json ni terrain.f32 (fichiers du modèle)" },
	},
});

S('model-manifest', 'POST /v1/publish/model/{sha8}/commit — manifeste de publication des fichiers par modèle (une seule fois par modèle)', {
	required: ['model_sha8', 'versions', 'files'],
	properties: {
		model_sha8: r('sha8'), versions: r('versions'),
		files: { ...FILES, description: 'Chemins relatifs à models/{sha8}/ : meta.json et terrain.f32 au moins' },
	},
});

console.log(fs.readdirSync(DIR).join(' '));
