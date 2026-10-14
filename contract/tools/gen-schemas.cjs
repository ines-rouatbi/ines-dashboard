// Génère les schémas JSON du contrat v1 (sauf common et meta, écrits à la main).
// Usage : node contract/tools/gen-schemas.cjs
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'schemas');
const C = 'common.schema.json#/$defs/';
const r = (n) => ({ $ref: C + n });
const S = (id, title, o) => fs.writeFileSync(path.join(DIR, id + '.schema.json'), JSON.stringify({
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	$id: `https://atom.zelqane.com/contract/v1/${id}.schema.json`,
	title, type: 'object', additionalProperties: false, ...o,
}, null, 2) + '\n');
const XY = { x_m: { type: 'number' }, y_m: { type: 'number' } };
const counts = (keys) => ({ type: 'object', additionalProperties: false, required: keys, properties: Object.fromEntries(keys.map((k) => [k, { type: 'integer', minimum: 0 }])) });

S('latest', 'GET /v1/latest — manifeste du dernier instantané publié', {
	required: ['snapshot_id', 'valid_time', 'generated_at', 'published_at', 'last_observation_at', 'compute_status', 'data_status', 'versions', 'href'],
	properties: {
		snapshot_id: r('snapshot_id'), valid_time: r('iso_utc'), generated_at: r('iso_utc'), published_at: r('iso_utc'),
		last_observation_at: { anyOf: [r('iso_utc'), { type: 'null' }] },
		compute_status: { enum: ['online', 'offline', 'unknown'], description: 'online seulement si le battement de cœur du service GPU a moins de 5 min' },
		heartbeat_at: { anyOf: [r('iso_utc'), { type: 'null' }] },
		data_status: { enum: ['complete', 'degrade'] }, versions: r('versions'), href: { type: 'string' },
	},
});

S('times', 'GET /v1/times — instantanés publiés (paginé)', {
	required: ['total', 'items'],
	properties: {
		total: { type: 'integer' }, next: { type: ['string', 'null'] },
		items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['snapshot_id', 'valid_time'],
			properties: { snapshot_id: r('snapshot_id'), valid_time: r('iso_utc'), open_alerts: { type: 'integer' } } } },
	},
});

S('snapshot', "GET /v1/snapshots/{id} — résumé d'un instantané", {
	required: ['snapshot_id', 'valid_time', 'versions', 'kpi', 'physics', 'stations_summary', 'scenario', 'assets'],
	properties: {
		snapshot_id: r('snapshot_id'), valid_time: r('iso_utc'), versions: r('versions'),
		kpi: { type: 'object', additionalProperties: false,
			required: ['stations_active', 'stations_total', 'share_high_reliability', 'reconstruction_ms', 'mass_residual_rms', 'open_alerts', 'hub_wind_mean_ms', 'hub_wind_max_ms', 'hub_height_agl_m'],
			properties: {
				stations_active: { type: 'integer' }, stations_total: { type: 'integer' }, share_high_reliability: r('unit_interval'),
				reconstruction_ms: { type: 'number' }, mass_residual_rms: { type: 'number', description: 'kg·m⁻³·s⁻¹ (DSO2 : ≤ 1e-4)' },
				open_alerts: counts(['information', 'avertissement', 'important', 'critique']),
				hub_wind_mean_ms: r('speed_ms'), hub_wind_max_ms: r('speed_ms'), hub_height_agl_m: { type: 'number' },
			} },
		physics: { type: 'object', additionalProperties: false,
			required: ['mass_residual_rms', 'mass_residual_p95', 'ground_condition_rms', 'roughness_ratio', 'dso2_pass'],
			properties: { mass_residual_rms: { type: 'number' }, mass_residual_p95: { type: 'number' }, ground_condition_rms: { type: 'number' }, roughness_ratio: { type: ['number', 'null'] }, dso2_pass: { type: 'boolean' } } },
		stations_summary: counts(['active', 'suspecte', 'muette', 'derive', 'exclue']),
		scenario: { anyOf: [{ type: 'null' }, { type: 'object', required: ['kind'], properties: {
			kind: { enum: ['part_stations', 'panne_zone', 'station_retiree'] }, keep_fraction: { type: 'number' },
			zone: { type: 'object', properties: { x_min_m: { type: 'number' }, x_max_m: { type: 'number' }, y_min_m: { type: 'number' }, y_max_m: { type: 'number' } } },
			stations: { type: 'array', items: { type: 'string' } }, baseline_snapshot_id: r('snapshot_id') } }],
			description: 'null = reconstruction nominale ; sinon simulation (BF45, BF46)' },
		assets: { type: 'object', additionalProperties: { type: 'string' }, required: ['fields_template'],
			description: 'Liens relatifs : fields_template ({level} = indice 0..nz-1, {var}), quality, alerts, stations, wind_farm, export_netcdf, export_csv' },
	},
});

S('profile', 'GET /v1/profiles/{id}?x_m&y_m — profil vertical', {
	required: ['x_m', 'y_m', 'z_terrain_m', 'nearest_station', 'levels', 'uncertainty'],
	properties: {
		...XY, z_terrain_m: { type: 'number' },
		nearest_station: { anyOf: [{ type: 'null' }, { type: 'object', required: ['id', 'distance_m'], additionalProperties: false, properties: { id: { type: 'string' }, distance_m: { type: 'number' } } }] },
		levels: { type: 'array', items: { type: 'object', additionalProperties: false,
			required: ['z_asl_m', 'agl_m', 'below_terrain', 'u', 'v', 'w', 'speed', 'dir_from_deg', 'speed_interval', 'status', 'coverage', 'reliability', 'reliability_class'],
			properties: {
				z_asl_m: { type: 'number' }, agl_m: { type: 'number' }, below_terrain: { type: 'boolean' },
				u: r('component_ms'), v: r('component_ms'), w: r('component_ms'), speed: r('speed_ms'), dir_from_deg: r('dir_from_deg'),
				speed_interval: r('interval'), status: { anyOf: [r('status_node'), { type: 'null' }] },
				coverage: r('unit_interval'), reliability: r('unit_interval'), reliability_class: { anyOf: [r('reliability_class'), { type: 'null' }] },
			} } },
		uncertainty: r('uncertainty_method'),
	},
});

S('quality', 'GET /v1/quality/{id} — fiabilité agrégée et calibration', {
	required: ['uncertainty', 'by_level', 'calibration'],
	properties: {
		uncertainty: r('uncertainty_method'),
		by_level: { type: 'array', items: { type: 'object', additionalProperties: false,
			required: ['z_asl_m', 'valid_nodes', 'share_elevee', 'share_moyenne', 'share_faible', 'sigma_speed_median', 'coverage_median'],
			properties: { z_asl_m: { type: 'number' }, valid_nodes: { type: 'integer' }, share_elevee: r('unit_interval'), share_moyenne: r('unit_interval'), share_faible: r('unit_interval'), sigma_speed_median: { type: ['number', 'null'] }, coverage_median: r('unit_interval') } } },
		calibration: { type: 'object', additionalProperties: false, required: ['evaluated_on', 'coverage_80', 'corr_error_sigma', 'dso6_pass'],
			properties: { evaluated_on: { type: 'string', description: 'ex. 120 instants de test, 50 % des stations' }, coverage_80: r('unit_interval'), corr_error_sigma: { type: ['number', 'null'] }, dso6_pass: { type: ['boolean', 'null'] } } },
	},
});

S('alerts', 'GET /v1/alerts/{id} — alertes et recommandations', {
	required: ['items'],
	properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false,
		required: ['id', 'level', 'kind', 'title', 'cause', 'recommendation', 'raised_at', 'status'],
		properties: {
			id: { type: 'string' }, level: r('alert_level'),
			kind: { enum: ['hors_plage', 'station_muette', 'capteur_derive', 'stations_insuffisantes', 'incoherence_physique', 'derive_entrees', 'vent_fort_moyeu', 'cisaillement', 'zone_mal_couverte'] },
			title: { type: 'string' }, cause: { type: 'string' }, recommendation: { type: 'string' },
			raised_at: r('iso_utc'), status: { enum: ['ouverte', 'acquittee', 'close'] },
			station_id: { type: ['string', 'null'] }, turbine_id: { type: ['string', 'null'] },
			location: { anyOf: [{ type: 'null' }, { type: 'object', required: ['x_m', 'y_m'], properties: XY }] },
			value: { type: ['number', 'null'] }, threshold: { type: ['number', 'null'] }, unit: { type: ['string', 'null'] },
		} } } },
});

S('stations', 'GET /v1/stations/{id} — état du réseau', {
	required: ['items'],
	properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false,
		required: ['id', 'x_m', 'y_m', 'height_agl_m', 'state', 'last_seen'],
		properties: {
			id: { type: 'string' }, ...XY, height_agl_m: { type: 'number' }, state: r('station_state'),
			last_seen: { anyOf: [r('iso_utc'), { type: 'null' }] }, speed: r('speed_ms'), dir_from_deg: r('dir_from_deg'),
			bias_ms: { type: ['number', 'null'], description: 'écart persistant mesure − reconstruction sans la station' },
			quality_score: r('unit_interval'),
		} } } },
});

S('wind-farm', 'GET /v1/wind-farm/{id} — parc éolien', {
	required: ['turbines', 'farm'],
	properties: {
		turbines: { type: 'array', items: { type: 'object', additionalProperties: false,
			required: ['id', 'name', 'x_m', 'y_m', 'virtual', 'hub_agl_m', 'rotor_d_m', 'rated_kw', 'cut_in_ms', 'cut_out_ms', 'hub_speed', 'rews', 'shear_ms', 'veer_deg', 'power_kw', 'state'],
			properties: {
				id: { type: 'string' }, name: { type: 'string' }, ...XY, virtual: { type: 'boolean' }, model: { type: 'string' },
				hub_agl_m: { type: 'number' }, rotor_d_m: { type: 'number' }, rated_kw: { type: 'number' }, cut_in_ms: { type: 'number' }, cut_out_ms: { type: 'number' },
				hub_speed: r('interval'), rews: r('interval'), shear_ms: { type: ['number', 'null'] }, veer_deg: { type: ['number', 'null'] },
				power_kw: r('interval'), state: { enum: ['production', 'arret_vent_faible', 'arret_vent_fort', 'indisponible'] }, air_density: { type: ['number', 'null'] },
			} } },
		farm: { type: 'object', additionalProperties: false, required: ['power_kw', 'rated_kw', 'n_production', 'n_arret'],
			properties: { power_kw: r('interval'), rated_kw: { type: 'number' }, n_production: { type: 'integer' }, n_arret: { type: 'integer' } } },
		power_curve: { type: 'object', additionalProperties: false, required: ['speed_ms', 'power_kw'], properties: { name: { type: 'string' }, speed_ms: { type: 'array', items: { type: 'number' } }, power_kw: { type: 'array', items: { type: 'number' } } } },
	},
});

S('windrose', 'GET /v1/windrose?x_m&y_m&hub_agl_m&from&to — rose des vents et Weibull', {
	required: ['x_m', 'y_m', 'hub_agl_m', 'period', 'n_valid', 'speed_bin_edges_ms', 'sectors', 'weibull'],
	properties: {
		...XY, hub_agl_m: { type: 'number' },
		period: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: r('iso_utc'), to: r('iso_utc') } },
		n_valid: { type: 'integer', description: "Nombre d'instants valides. L'interface DOIT l'afficher et signaler < 100 comme statistiquement faible" },
		speed_bin_edges_ms: { type: 'array', items: { type: 'number' } },
		sectors: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['dir_center_deg', 'frequency', 'speed_bins'],
			properties: { dir_center_deg: { type: 'number' }, frequency: r('unit_interval'), speed_bins: { type: 'array', items: { type: 'number' } } } } },
		weibull: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['k', 'c_ms'],
			properties: { k: { type: 'number' }, c_ms: { type: 'number' }, aep_mwh: { type: ['number', 'null'] }, capacity_factor: r('unit_interval') } }] },
	},
});

S('publish-manifest', 'POST /v1/publish/{id}/commit — manifeste de publication (service GPU → Worker)', {
	required: ['snapshot_id', 'valid_time', 'generated_at', 'last_observation_at', 'versions', 'files'],
	properties: {
		snapshot_id: r('snapshot_id'), valid_time: r('iso_utc'), generated_at: r('iso_utc'),
		last_observation_at: { anyOf: [r('iso_utc'), { type: 'null' }] }, versions: r('versions'),
		files: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['path', 'sha256', 'bytes'],
			properties: { path: { type: 'string', pattern: '^[a-z0-9_./-]+$' }, sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' }, bytes: { type: 'integer', minimum: 1, maximum: 8388608 } } } },
	},
});

console.log(fs.readdirSync(DIR).join(' '));
