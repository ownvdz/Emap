CREATE TABLE SHELTER (
  SHELTER_ID        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  SOURCE_ID         VARCHAR2(50) UNIQUE,   -- shunt_fclty_sn (대피시설일련번호)
  SHELTER_TYPE      VARCHAR2(100),         -- fclty_se (시설구분)
  CAPACITY          NUMBER,                -- shunt_posbl_nmpr_co (대피가능인원수)
  AREA_SQM          NUMBER,                -- fclty_ar (시설면적)
  DETAIL_ADDRESS    VARCHAR2(300),         -- detail_adres (상세주소)
  ROAD_ADDRESS      VARCHAR2(300),         -- locplc_rdnmadr (도로명주소) - 지오코딩 기준 주소
  LEGAL_DONG_CODE   VARCHAR2(20),          -- legaldong_code
  NORMAL_USE_TYPE   VARCHAR2(100),         -- ordtm_prcuse_ty (평상시활용유형)
  IS_OPEN           VARCHAR2(10),          -- opn_at (개방여부)
  MANAGE_AGENCY     VARCHAR2(200),         -- mgc_nm (관리기관명)
  LATITUDE          NUMBER(10,7),          -- 지오코딩으로 채워짐
  LONGITUDE         NUMBER(10,7),
  GEOCODE_STATUS    VARCHAR2(20) DEFAULT 'PENDING', -- PENDING/DONE/FAILED
  RAW_DATA          CLOB,
  UPDATED_AT        TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE INDEX IDX_SHELTER_GEOCODE ON SHELTER (GEOCODE_STATUS);