export type Category =
  | 'CIVIL_DEFENSE'
  | 'EARTHQUAKE_OUTDOOR'
  | 'EARTHQUAKE_INDOOR'
  | 'TSUNAMI'
  | 'HEAT_SHELTER'
  | 'COLD_SHELTER';

export const CATEGORY_ORDER: Category[] = [
  'CIVIL_DEFENSE',
  'EARTHQUAKE_OUTDOOR',
  'EARTHQUAKE_INDOOR',
  'TSUNAMI',
  'HEAT_SHELTER',
  'COLD_SHELTER',
];

export const CATEGORY_INFO: Record<Category, { label: string; color: string }> = {
  CIVIL_DEFENSE: { label: '민방위', color: '#2563EB' },
  EARTHQUAKE_OUTDOOR: { label: '지진 옥외', color: '#F97316' },
  EARTHQUAKE_INDOOR: { label: '지진 실내', color: '#B45309' },
  TSUNAMI: { label: '해일', color: '#10B981' },
  HEAT_SHELTER: { label: '무더위', color: '#EC4899' },
  COLD_SHELTER: { label: '한파', color: '#06B6D4' },
};

// 처음 지도를 열 때 켜둘 종류 (실내구호소와 쉼터는 마커가 많아서 기본으로 끔)
export const DEFAULT_SELECTED: Record<Category, boolean> = {
  CIVIL_DEFENSE: true,
  EARTHQUAKE_OUTDOOR: true,
  EARTHQUAKE_INDOOR: false,
  TSUNAMI: true,
  HEAT_SHELTER: false,
  COLD_SHELTER: false,
};

export const FALLBACK_INFO = { label: '기타', color: '#6B7280' };
export const MIXED_COLOR = '#374151'; // 종류가 섞인 마커 색

// 마커가 매우 많은 종류: 더 확대해야 불러옴
export const DENSE_CATEGORIES: Category[] = ['HEAT_SHELTER', 'COLD_SHELTER'];
export const isDense = (c: Category) => DENSE_CATEGORIES.includes(c);

// 앱 지도의 배율 기준은 웹과 조금 다를 수 있어서, 실제로 보고 조절하세요
export const MIN_ZOOM_TO_LOAD = 13;
export const MIN_ZOOM_DENSE = 15;

export const infoOf = (c: Category) => CATEGORY_INFO[c] ?? FALLBACK_INFO;