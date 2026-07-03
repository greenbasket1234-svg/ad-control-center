const express   = require("express");
const { pool }  = require("./db");
const { encrypt, decrypt } = require("./crypto");
const channels  = require("./channels");
const { runBatch } = require("./batch");
const { requireAuth, requireAdmin } = require("./auth");
const logger    = require("./logger");

const router = express.Router();
router.use(requireAuth);

/* ?€?€ ?Œë¦¼ / ë¡œê·¸ ?€?€ */
router.get("/logs", async (req, res) => {
  const { limit=50, type, status } = req.query;
  try {
    let q = `SELECT * FROM activity_logs WHERE 1=1`;
    const p = [];
    if (type)   { p.push(type);   q += ` AND type=$${p.length}`; }
    if (status) { p.push(status); q += ` AND status=$${p.length}`; }
    p.push(Number(limit));
    q += ` ORDER BY created_at DESC LIMIT $${p.length}`;
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ?€?€ ê´‘ê³ ì£?ëª©ë¡ (ê´€ë¦¬ìž: ?„ì²´ / ê´‘ê³ ì£? ë³¸ì¸ë§? ?€?€ */
router.get("/advertisers", async (req, res) => {
  try {
    let where = "WHERE adv.is_active=TRUE";
    const params = [];
    if (req.user.role !== "admin") {
      params.push(req.user.advertiser_id);
      where += ` AND adv.id=$${params.length}`;
    }
    const { rows } = await pool.query(`
      SELECT adv.*, COALESCE(json_agg(json_build_object(
        'id',ac.id,'channel',ac.channel,'status',ac.status,
        'error_message',ac.error_message,'last_synced_at',ac.last_synced_at,'last_tested_at',ac.last_tested_at
      )) FILTER (WHERE ac.id IS NOT NULL),'[]') AS accounts
      FROM advertisers adv LEFT JOIN ad_accounts ac ON ac.advertiser_id=adv.id
      ${where} GROUP BY adv.id ORDER BY adv.name`, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ?€?€ ê´‘ê³ ì£??±ë¡ (ê´€ë¦¬ìžë§? ?€?€ */
router.post("/advertisers", requireAdmin, async (req, res) => {
  const { name, brand_color, monthly_budget, accounts=[] } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "ê´‘ê³ ì£¼ëª…???…ë ¥?˜ì„¸?? });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO advertisers (name,brand_color,monthly_budget) VALUES ($1,$2,$3) RETURNING *`,
      [name.trim(), brand_color||"#2563eb", monthly_budget||0]);
    for (const acc of accounts) {
      if (!acc.channel) continue;
      await client.query(
        `INSERT INTO ad_accounts (advertiser_id,channel,status,credentials_enc) VALUES ($1,$2,'pending',$3)
         ON CONFLICT (advertiser_id,channel) DO UPDATE SET credentials_enc=$3,status='pending',error_message=NULL`,
        [rows[0].id, acc.channel, encrypt(acc.credentials)]);
    }
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch(e) { await client.query("ROLLBACK"); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

/* ?€?€ ê´‘ê³ ì£??˜ì • (ê´€ë¦¬ìžë§? ?€?€ */
router.put("/advertisers/:id", requireAdmin, async (req, res) => {
  const { name, brand_color, monthly_budget, accounts=[] } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // name???ˆì„ ?Œë§Œ ê¸°ë³¸?•ë³´ ?…ë°?´íŠ¸
    if (name) {
      await client.query(`UPDATE advertisers SET name=$1,brand_color=$2,monthly_budget=$3,updated_at=NOW() WHERE id=$4`,
        [name, brand_color, monthly_budget||0, req.params.id]);
    }

    for (const acc of accounts) {
      if (!acc.channel) continue;
      const creds = acc.credentials || {};
      // ?œìˆ˜ ë¬¸ìž??API ?¤ë§Œ ?€??      const cleanCreds = Object.fromEntries(
        Object.entries(creds).filter(([k,v]) =>
          v && typeof v === "string" && v.trim() !== "" && v !== "***"
        )
      );
      if (Object.keys(cleanCreds).length > 0) {
        await client.query(
          `INSERT INTO ad_accounts (advertiser_id,channel,status,credentials_enc)
           VALUES ($1,$2,'pending',$3)
           ON CONFLICT (advertiser_id,channel) DO UPDATE
           SET credentials_enc=$3, status='pending', error_message=NULL`,
          [req.params.id, acc.channel, encrypt(cleanCreds)]);
        console.log(`[?€???„ë£Œ] advertiser:${req.params.id} channel:${acc.channel} keys:${Object.keys(cleanCreds).join(',')}`);
      }
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch(e) {
    await client.query("ROLLBACK");
    console.error("[PUT advertisers] ?¤ë¥˜:", e.message);
    res.status(500).json({ error: e.message });
  }
  finally { client.release(); }
});

/* ?€?€ ê´‘ê³ ì£??? œ (ê´€ë¦¬ìžë§? ?€?€ */
router.delete("/advertisers/:id", requireAdmin, async (req, res) => {
  await pool.query(`UPDATE advertisers SET is_active=FALSE WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

/* ?€?€ ì±„ë„ ?°ë™ ?ŒìŠ¤???€?€ */
router.post("/advertisers/:id/channels/:channel/test", async (req, res) => {
  if (req.user.role !== "admin" && req.user.advertiser_id !== Number(req.params.id))
    return res.status(403).json({ error: "ê¶Œí•œ???†ìŠµ?ˆë‹¤" });

  const { id, channel } = req.params;
  const { credentials, saveResult=true } = req.body || {};
  // saveResult=false ë©?DB status ë³€ê²?????(?°ë™ ?ŒìŠ¤??ë²„íŠ¼??

  const ch = channels[channel];
  if (!ch) return res.status(400).json({ error: `ë¯¸ì???ì±„ë„: ${channel}` });

  try {
    let creds = credentials;
    // ë¹?credentialsë©?DB?ì„œ ë¡œë“œ
    if (!creds || !Object.values(creds).some(v => v && v !== "***")) {
      const { rows } = await pool.query(
        `SELECT credentials_enc FROM ad_accounts WHERE advertiser_id=$1 AND channel=$2`, [id, channel]
      );
      if (!rows[0]) return res.status(404).json({ error: "?±ë¡??ê³„ì • ?†ìŒ" });
      creds = decrypt(rows[0].credentials_enc);
    }

    const result = await ch.testConnection(creds);

    if (saveResult) {
      // ???±ë¡ ?œì—ë§?DB status ?…ë°?´íŠ¸
      await pool.query(
        `INSERT INTO ad_accounts (advertiser_id,channel,status,credentials_enc,last_tested_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (advertiser_id,channel) DO UPDATE
         SET status=$3, credentials_enc=$4, last_tested_at=NOW(),
             error_message=CASE WHEN $3='connected' THEN NULL ELSE ad_accounts.error_message END`,
        [id, channel, result.ok ? "connected" : "error", encrypt(creds)]
      );

      const { rows: advRows } = await pool.query(`SELECT name FROM advertisers WHERE id=$1`, [id]);
      const advName = advRows[0]?.name || id;
      if (result.ok) {
        await logger.connect(`${advName} / ${channel} ?°ë™ ?±ê³µ`, {
          channel, advertiserId: Number(id), advertiserName: advName,
          detail: result.message, status: "success"
        });
      } else {
        await logger.error(`${advName} / ${channel} ?°ë™ ?¤íŒ¨`, {
          channel, advertiserId: Number(id), advertiserName: advName,
          detail: result.message, status: "error"
        });
      }
    }

    // last_tested_atë§??…ë°?´íŠ¸ (readonly ëª¨ë“œ?ì„œ??
    if (!saveResult) {
      await pool.query(
        `UPDATE ad_accounts SET last_tested_at=NOW() WHERE advertiser_id=$1 AND channel=$2`,
        [id, channel]
      ).catch(() => {});
    }

    res.json(result);
  } catch(e) {
    if (saveResult) {
      await pool.query(
        `UPDATE ad_accounts SET last_tested_at=NOW() WHERE advertiser_id=$1 AND channel=$2`,
        [e.message, id, channel]
      ).catch(() => {});
    }
    res.status(400).json({ ok: false, message: e.message });
  }
});

/* ?€?€ ?µê³„: ì±„ë„ ë¯¹ìŠ¤ ?€?€ */
router.get("/stats/channel-mix", async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    let where = "WHERE ds.date BETWEEN $1 AND $2 AND adv.is_active=TRUE";
    const params = [startDate, endDate];
    if (req.user.role !== "admin") {
      params.push(req.user.advertiser_id);
      where += ` AND ds.advertiser_id=$${params.length}`;
    }
    const { rows } = await pool.query(`
      SELECT adv.id,adv.name,adv.brand_color,adv.monthly_budget,ds.channel,SUM(ds.cost) AS cost
      FROM daily_stats ds JOIN advertisers adv ON adv.id=ds.advertiser_id
      ${where}
      GROUP BY adv.id,adv.name,adv.brand_color,adv.monthly_budget,ds.channel ORDER BY adv.name,ds.channel`,
      params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ?€?€ ?µê³„: ë§¤ì²´ë³??±ê³¼ ?€?€ */
router.get("/stats/by-channel", async (req, res) => {
  const { startDate, endDate, advertiserId } = req.query;
  try {
    let where = "WHERE ds.date BETWEEN $1 AND $2 AND adv.is_active=TRUE";
    const params = [startDate, endDate];
    // ê´‘ê³ ì£?ê³„ì •?€ ë¬´ì¡°ê±?ë³¸ì¸ ê²ƒë§Œ
    const filterAdv = req.user.role !== "admin" ? req.user.advertiser_id : advertiserId;
    if (filterAdv) { params.push(filterAdv); where += ` AND ds.advertiser_id=$${params.length}`; }

    const { rows } = await pool.query(`
      SELECT ds.channel,
        SUM(ds.impressions) AS impressions, SUM(ds.clicks) AS clicks, SUM(ds.cost) AS cost,
        SUM(ds.conversions) AS conversions, SUM(ds.conversion_amount) AS conversion_amount,
        ROUND(SUM(ds.clicks)::numeric/NULLIF(SUM(ds.impressions),0)*100,2) AS ctr,
        ROUND(SUM(ds.cost)::numeric/NULLIF(SUM(ds.clicks),0),0) AS cpc,
        ROUND(SUM(ds.cost)::numeric/NULLIF(SUM(ds.impressions),0)*1000,0) AS cpm,
        ROUND(SUM(ds.conversion_amount)::numeric/NULLIF(SUM(ds.cost),0)*100,0) AS roas
      FROM daily_stats ds JOIN advertisers adv ON adv.id=ds.advertiser_id
      ${where} GROUP BY ds.channel ORDER BY cost DESC`, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ?€?€ ?µê³„: ?¼ë³„ ì¶”ì´ ?€?€ */
router.get("/stats/daily", async (req, res) => {
  const { startDate, endDate, advertiserId, channel } = req.query;
  try {
    let q = `SELECT date,SUM(impressions) AS impressions,SUM(clicks) AS clicks,SUM(cost) AS cost,SUM(conversions) AS conversions,SUM(conversion_amount) AS conversion_amount FROM daily_stats WHERE date BETWEEN $1 AND $2`;
    const p = [startDate, endDate];
    const filterAdv = req.user.role !== "admin" ? req.user.advertiser_id : advertiserId;
    if (filterAdv) { p.push(filterAdv); q += ` AND advertiser_id=$${p.length}`; }
    if (channel)   { p.push(channel);   q += ` AND channel=$${p.length}`; }
    q += ` GROUP BY date ORDER BY date`;
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ?€?€ ?˜ë™ ë°°ì¹˜ (ê´€ë¦¬ìžë§? ?€?€ */
router.post("/batch", requireAdmin, async (req, res) => {
  const { mode="yesterday" } = req.body||{};
  res.json({ message: `ë°°ì¹˜ ?œìž‘ (${mode})` });
  runBatch(mode).catch(console.error);
});

module.exports = router;
