import oracledb from 'oracledb';

let pool;

export async function initPool() {
  pool = await oracledb.createPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING,
    configDir: process.env.WALLET_DIR,
    walletLocation: process.env.WALLET_DIR,
    walletPassword: process.env.WALLET_PASSWORD,
    poolMin: 1,
    poolMax: 5,
  });
  console.log('Oracle pool created');
}

export async function query(sql, binds = [], options = {}) {
  const conn = await pool.getConnection();
  try {
    return await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      ...options,
    });
  } finally {
    await conn.close();
  }
}