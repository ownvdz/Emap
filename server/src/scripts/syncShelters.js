import 'dotenv/config';
import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { initPool, query } from '../db.js';

const API_URL = 'https://safemap.go.kr/openapi2/IF_0122';

async function fetchPage(pageNo) {
  const { data } = await axios.get(API_URL, {
    params: {
      serviceKey: process.env.SAFEMAP_SERVICE_KEY,
      pageNo,
      numOfRows: 1000,
      returnType: 'json',
    },
  });

  if (typeof data === 'string' && data.trim().startsWith('<')) {
    return await parseStringPromise(data, { explicitArray: false });
  }
  return data;
}

async function upsertShelter(item) {
  await query(
    `MERGE INTO SHELTER t
     USING (SELECT :sourceId AS SOURCE_ID FROM DUAL) s
     ON (t.SOURCE_ID = s.SOURCE_ID)
     WHEN MATCHED THEN UPDATE SET
       SHELTER_TYPE = :shelterType, CAPACITY = :capacity, AREA_SQM = :area,
       DETAIL_ADDRESS = :detailAddress, ROAD_ADDRESS = :roadAddress,
       LEGAL_DONG_CODE = :legalDongCode, NORMAL_USE_TYPE = :normalUseType,
       IS_OPEN = :isOpen, MANAGE_AGENCY = :manageAgency,
       RAW_DATA = :raw, UPDATED_AT = SYSTIMESTAMP
     WHEN NOT MATCHED THEN INSERT
       (SOURCE_ID, SHELTER_TYPE, CAPACITY, AREA_SQM, DETAIL_ADDRESS, ROAD_ADDRESS,
        LEGAL_DONG_CODE, NORMAL_USE_TYPE, IS_OPEN, MANAGE_AGENCY, RAW_DATA)
     VALUES
       (:sourceId, :shelterType, :capacity, :area, :detailAddress, :roadAddress,
        :legalDongCode, :normalUseType, :isOpen, :manageAgency, :raw)`,
    {
      sourceId: item.shunt_fclty_sn,
      shelterType: item.fclty_se,
      capacity: item.shunt_posbl_nmpr_co ? Number(item.shunt_posbl_nmpr_co) : null,
      area: item.fclty_ar ? Number(item.fclty_ar) : null,
      detailAddress: item.detail_adres,
      roadAddress: item.locplc_rdnmadr,
      legalDongCode: item.legaldong_code,
      normalUseType: item.ordtm_prcuse_ty,
      isOpen: item.opn_at,
      manageAgency: item.mgc_nm,
      raw: JSON.stringify(item),
    },
    { autoCommit: true }
  );
}

async function main() {
  await initPool();

  // 1페이지만 먼저 받아서 응답 구조 확인
  const first = await fetchPage(1);
  console.log('=== 원본 응답 (상위 800자) ===');
  console.log(JSON.stringify(first).slice(0, 800));
  console.log('===============================');

  let pageNo = 1;
  let totalCount = Infinity;
  let processed = 0;
  let data = first;

  while (processed < totalCount) {
    if (pageNo > 1) data = await fetchPage(pageNo);

    const items = data.items ?? data.response?.body?.items ?? [];
    const list = Array.isArray(items) ? items : items.item ?? [];
    totalCount = Number(data.totalCount ?? data.response?.body?.totalCount ?? list.length);

    if (list.length === 0) {
      console.log('items를 찾지 못했습니다. 위 원본 응답 구조를 확인해주세요.');
      break;
    }

    for (const item of list) {
      await upsertShelter(item);
    }

    processed += list.length;
    console.log(`수집 진행: ${processed}/${totalCount}`);
    pageNo++;
  }

  console.log('수집 완료');
  process.exit(0);
}

main().catch((e) => {
  console.error('수집 실패:', e.response?.data ?? e.message);
  process.exit(1);
});