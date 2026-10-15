// Types des pages Éolien et Alertes (lot F4) : alias des types GÉNÉRÉS depuis contract/schemas
// (web/src/data/contract.gen.ts, npm run contract:types). Aucun type recopié à la main.
// Règle B5 : null = « non disponible », jamais 0. Les liens de snapshot.assets peuvent être null
// (ressource d'un lot pas encore livré) : la page l'affiche « non disponible ».

import type { Alerts, Snapshot, WindFarm, WindRose } from '../../data/contract';

export type { Alerts, WindFarm, WindRose };

export type Turbine = WindFarm[ 'turbines' ][ number ];
/** Intervalle à 80 % (common.schema.json#/$defs/interval). */
export type Interval = Turbine[ 'power_kw' ];
export type TurbineState = Turbine[ 'state' ];
export type AirDensitySource = Turbine[ 'air_density_source' ];

export type Alert = Alerts[ 'items' ][ number ];
export type AlertLevel = Alert[ 'level' ];
export type AlertKind = Alert[ 'kind' ];

export type SnapshotPoint = Snapshot[ 'points' ][ number ];
/** Liens des ressources de l'instantané ; chacun peut être null. */
export type SnapshotAssets = Snapshot[ 'assets' ];

/** Sous ce nombre d'instants valides, une rose des vents est « statistiquement faible » (contrat). */
export const WINDROSE_MIN_VALID = 100;
