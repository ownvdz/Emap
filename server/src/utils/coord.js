import proj4 from 'proj4';

// Bessel 중부원점 TM (EPSG:5174) 정의
proj4.defs(
  'EPSG:5174',
  '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 ' +
  '+x_0=200000 +y_0=500000 +ellps=bessel ' +
  '+towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43 +units=m +no_defs'
);

export function tmToWgs84(x, y) {
  const [lng, lat] = proj4('EPSG:5174', 'EPSG:4326', [x, y]);
  return { latitude: lat, longitude: lng };
}