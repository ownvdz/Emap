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

function toNumber(v) {
  if (v === undefined || v === null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null; // "-" 같은 값은 null
}

async function upsertShelter(item) {
  const name = item.ordtm_prcuse_ty || item.mgc_nm || null;

  await query(
    `MERGE INTO SHELTER t
     USING (SELECT :sourceId AS SOURCE_ID FROM DUAL) s
     ON (t.SOURCE_ID = s.SOURCE_ID)
     WHEN MATCHED THEN UPDATE SET
       NAME = :shelterName, SHELTER_TYPE = :shelterType, CAPACITY = :capacity, AREA_SQM = :area,
       DETAIL_ADDRESS = :detailAddress, ROAD_ADDRESS = :roadAddress,
       LEGAL_DONG_CODE = :legalDongCode, NORMAL_USE_TYPE = :normalUseType,
       IS_OPEN = :isOpen, MANAGE_AGENCY = :manageAgency,
       RAW_DATA = :rawData, UPDATED_AT = SYSTIMESTAMP
     WHEN NOT MATCHED THEN INSERT
       (SOURCE_ID, NAME, SHELTER_TYPE, CAPACITY, AREA_SQM, DETAIL_ADDRESS, ROAD_ADDRESS,
        LEGAL_DONG_CODE, NORMAL_USE_TYPE, IS_OPEN, MANAGE_AGENCY, RAW_DATA)
     VALUES
       (:sourceId, :shelterName, :shelterType, :capacity, :area, :detailAddress, :roadAddress,
        :legalDongCode, :normalUseType, :isOpen, :manageAgency, :rawData)`,
    {
      sourceId: item.shunt_fclty_sn,
      shelterName: name,
      shelterType: item.fclty_se,
      capacity: toNumber(item.shunt_posbl_nmpr_co),
      area: toNumber(item.fclty_ar),
      detailAddress: item.detail_adres,
      roadAddress: item.locplc_rdnmadr,
      legalDongCode: item.legaldong_code,
      normalUseType: item.ordtm_prcuse_ty,
      isOpen: item.opn_at,
      manageAgency: item.mgc_nm,
      rawData: JSON.stringify(item),
    },
    { autoCommit: true }
  );
}

async function main() {
  await initPool();

  let pageNo = 1;
  let processed = 0;
  let totalCount = null;

  while (true) {
    const data = await fetchPage(pageNo);

    if (data.header?.resultCode !== '00') {
      console.error('API 오류:', data.header);
      break;
    }

    const body = data.body ?? {};
    let list = body.items?.item ?? [];
    if (!Array.isArray(list)) list = [list]; // 결과가 1건이면 객체로 올 수 있음

    if (totalCount === null && body.totalCount !== undefined) {
      totalCount = Number(body.totalCount);
      console.log(`전체 건수: ${totalCount}`);
    }

    if (list.length === 0) break;

    for (const item of list) {
      await upsertShelter(item);
    }

    processed += list.length;
    console.log(`수집 진행: ${processed}${totalCount ? '/' + totalCount : ''}`);

    if (totalCount && processed >= totalCount) break;
    pageNo++;
  }

  console.log('수집 완료');
  process.exit(0);
}

main().catch((e) => {
  console.error('수집 실패:', e.response?.data ?? e.message);
  process.exit(1);
});