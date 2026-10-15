// Géoréférencement du contrat v1 rév. 2 (D4) : plan tangent équirectangulaire au nœud (0, 0).
//   rotation_deg = angle de l'axe x depuis l'Est, sens antihoraire ;
//   Est = x·cosθ − y·sinθ, Nord = x·sinθ + y·cosθ (x, y relatifs au nœud (0, 0)) ;
//   lat = lat0 + Nord / m_per_deg_lat, lon = lon0 + Est / m_per_deg_lon.

import type { Meta } from '../data/contract';

export function latLon( meta: Pick<Meta, 'georef' | 'grid'>, xM: number, yM: number ): { lat: number; lon: number } {

	const g = meta.georef, t = g.rotation_deg * Math.PI / 180;
	const x = xM - meta.grid.x0_m, y = yM - meta.grid.y0_m;
	const est = x * Math.cos( t ) - y * Math.sin( t ), nord = x * Math.sin( t ) + y * Math.cos( t );
	return { lat: g.lat0 + nord / g.m_per_deg_lat, lon: g.lon0 + est / g.m_per_deg_lon };

}
