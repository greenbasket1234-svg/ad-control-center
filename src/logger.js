const { pool } = require("./db");

async function log(type, message, options = {}) {
  const { channel, advertiserId, advertiserName, detail, status = "info" } = options;
  try {
    await pool.query(
      `INSERT INTO activity_logs (type, channel, advertiser_id, advertiser_name, message, detail, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [type, channel||null, advertiserId||null, advertiserName||null, message, detail||null, status]
    );
  } catch(e) {
    console.error("[Logger] 로그 저장 실패:", e.message);
  }
}

const logger = {
  info:    (msg, opts) => log("info",    msg, { ...opts, status:"info" }),
  success: (msg, opts) => log("info",    msg, { ...opts, status:"success" }),
  error:   (msg, opts) => log("error",   msg, { ...opts, status:"error" }),
  warning: (msg, opts) => log("warning", msg, { ...opts, status:"warning" }),
  batch:   (msg, opts) => log("batch",   msg, opts),
  connect: (msg, opts) => log("connect", msg, opts),
};

module.exports = logger;
