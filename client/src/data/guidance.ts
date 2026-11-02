import type { Category } from '../components/ShelterMap';

export interface Guidance {
  title: string;
  steps: string[];
  shelterCategory?: Category;
  shelterLabel?: string;   // 대피장소 버튼에 쓸 이름
  note?: string;
  sourceLabel: string;
  sourceUrl: string;
}

const SOURCE_LABEL = '행정안전부 국민행동요령 (국민재난안전포털)';
const SOURCE_URL = 'https://www.safekorea.go.kr';

// 공식 국민행동요령을 요약한 것입니다. 사용 전 국민재난안전포털의 원문과 반드시 대조하세요.
export const GUIDANCE: Record<string, Guidance> = {
  지진: {
    title: '지진이 발생했을 때',
    steps: [
      '흔들리는 동안에는 튼튼한 탁자 아래로 들어가 탁자 다리를 잡고 몸을 보호하세요. 탁자가 없으면 방석 등으로 머리를 보호하세요.',
      '흔들림이 멈추면 전기와 가스를 차단하고, 문을 열어 출구를 확보하세요.',
      '건물 밖으로 나갈 때는 엘리베이터를 타지 말고 계단을 이용하세요. 발을 보호할 수 있는 신발을 신으세요.',
      '밖에서는 가방이나 손으로 머리를 보호하고, 건물과 거리를 두며 떨어지는 물건에 유의해 운동장·공원 같은 넓은 공간으로 대피하세요. 차량은 이용하지 마세요.',
      '대피한 뒤에는 라디오나 공공기관의 안내방송 등 확인된 정보에 따라 행동하세요. 근거 없는 소문은 믿지 마세요.',
      '해안에 있을 때 지진해일 특보가 발령되면 높은 곳으로 이동하세요.',
    ],
    shelterCategory: 'EARTHQUAKE',
    shelterLabel: '지진 실내구호소 보기',
    note: '지진 실내구호소는 대피한 뒤 임시로 머무르는 시설입니다. 먼저 넓은 곳으로 안전하게 대피하세요.',
    sourceLabel: SOURCE_LABEL,
    sourceUrl: SOURCE_URL,
  },

  지진해일: {
    title: '지진해일이 우려될 때',
    steps: [
      '해안에서 강한 진동을 느끼거나 지진해일 특보를 들으면 즉시 높은 곳으로 대피하세요. 지진해일 긴급대피장소나 언덕·야산 같은 높은 곳, 또는 3층 이상 건물이 안전합니다.',
      '수영, 보트, 낚시, 야영 등을 즉시 멈추고 바닷가와 해안 저지대, 지하실에서 나와 대피하세요.',
      '대피하지 못했다면 1층보다 2층, 2층보다 3층처럼 더 높은 곳으로 올라가세요. 목조 주택은 떠내려갈 수 있으니 벽돌이나 철근콘크리트 건물로 이동하세요.',
      '해안에 가까울수록 위험합니다. 해안에서 멀고 급경사가 없는 높은 지대로 이동하세요.',
      '라디오·TV, 공공기관의 안내방송 등 공식 정보를 계속 확인하세요.',
    ],
    shelterCategory: 'TSUNAMI',
    shelterLabel: '지진해일 긴급대피장소 보기',
    sourceLabel: SOURCE_LABEL,
    sourceUrl: SOURCE_URL,
  },

  민방공: {
    title: '민방공 경보가 발령됐을 때',
    steps: [
      '경계경보(공격이 예상될 때): 즉시 대피할 준비를 하고, 어린이와 노약자를 먼저 대피시키세요.',
      '대피 전에 화재 위험이 있는 가스와 유류를 안전한 곳으로 옮기고, 전열기 코드를 뽑으세요.',
      '공습경보(공격이 임박했거나 진행 중일 때): 가까운 대피소나 지하철역, 지하상가 등 지하 시설로 신속히 대피하세요.',
      '운전 중이면 가까운 빈터나 도로 오른쪽에 차를 세우고 승객과 함께 대피하세요. 키는 꽂아 두세요.',
      '밤에는 불을 끄거나 불빛이 밖으로 새지 않게 하세요.',
      '대피한 뒤에는 라디오·TV 등 정부 방송을 계속 들으며 안내에 따라 행동하세요.',
      '화생방·핵 경보는 행동요령이 다릅니다. 아래 공식 안내를 반드시 확인하세요.',
    ],
    shelterCategory: 'CIVIL_DEFENSE',
    shelterLabel: '민방위대피소 보기',
    sourceLabel: SOURCE_LABEL,
    sourceUrl: SOURCE_URL,
  },
};

// 대응하는 행동요령이 없는 재난(호우, 태풍 등)에 쓰는 기본 안내
export const GENERIC_GUIDANCE: Guidance = {
  title: '재난문자 안내',
  steps: [
    '문자에 적힌 안내와 지시를 먼저 따르세요.',
    '라디오·TV, 공공기관의 안내방송 등 공식 정보를 계속 확인하세요.',
    '재난 종류별 행동요령은 아래 공식 안내에서 확인할 수 있습니다.',
  ],
  sourceLabel: SOURCE_LABEL,
  sourceUrl: SOURCE_URL,
};