// Types du contrat v1 (révision 2), GÉNÉRÉS depuis contract/schemas/ (voir contract.gen.ts).
//
// Ce module ré-exporte les types générés et ajoute quelques alias pratiques. Ne jamais
// recopier un type à la main : après une PR du contrat, `npm run contract:types`.

import type { Alerts, Column, Meta, Profile, Snapshot, Stations, Times, WindFarm } from './contract.gen';

export type * from './contract.gen';

/** Variables disponibles en binaire via GET /v1/fields/{id}/{level}/{var} (voir meta.fields). */
export const FIELD_VARS = [ 'u', 'v', 'w', 'speed', 'sigma_speed', 'sigma_u', 'sigma_v', 'sigma_w', 'coverage', 'reliability', 'status' ] as const;
export type FieldVar = typeof FIELD_VARS[ number ];

/** Codage d'une variable (meta.encoding[var]). */
export type Encodage = NonNullable<Meta[ 'encoding' ][ string ]>;
/** Un niveau d'une colonne brute /v1/column. */
export type ColumnLevel = Column[ 'levels' ][ number ];
/** Un niveau d'un profil (précalculé ou calculé par le front). */
export type ProfileLevel = Profile[ 'levels' ][ number ];
/** Point déclaré (éolienne, site) d'un instantané. */
export type SnapshotPoint = Snapshot[ 'points' ][ number ];
/** Une alerte. */
export type Alert = Alerts[ 'items' ][ number ];
/** Un capteur (ANEO, ou c<i>_<j> sur le treillis synthétique). */
export type Station = Stations[ 'items' ][ number ];
/** Une éolienne. */
export type Turbine = WindFarm[ 'turbines' ][ number ];
/** Un instantané de la liste /v1/times. */
export type TimeItem = Times[ 'items' ][ number ];

/** Corps d'erreur JSON de l'API (ex. 404 { error: "absent" }). */
export interface ApiErrorBody { error: string; message?: string }
