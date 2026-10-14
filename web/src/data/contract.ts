// Types du contrat v1, GÉNÉRÉS depuis contract/schemas/ (voir contract.gen.ts).
//
// Ce module ré-exporte les types générés et ajoute quelques alias pratiques. Ne jamais
// recopier un type à la main : après une PR du contrat, `npm run contract:types`.

import type { Alerts, Profile, Stations, Times, WindFarm } from './contract.gen';

export type * from './contract.gen';

/** Variables disponibles en binaire via GET /v1/fields/{id}/{level}/{var}. */
export const FIELD_VARS = [ 'u', 'v', 'w', 'speed', 'sigma_u', 'sigma_v', 'sigma_w', 'coverage', 'reliability', 'status' ] as const;
export type FieldVar = typeof FIELD_VARS[ number ];

/** Un niveau d'un profil vertical. */
export type ProfileLevel = Profile[ 'levels' ][ number ];
/** Une alerte. */
export type Alert = Alerts[ 'items' ][ number ];
/** Une station ANEO. */
export type Station = Stations[ 'items' ][ number ];
/** Une éolienne. */
export type Turbine = WindFarm[ 'turbines' ][ number ];
/** Un instantané de la liste /v1/times. */
export type TimeItem = Times[ 'items' ][ number ];

/** Corps d'erreur JSON de l'API (ex. 404 { error: "absent" }). */
export interface ApiErrorBody { error: string; message?: string }
