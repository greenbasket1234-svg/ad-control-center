require("dotenv").config();
const { pool }    = require("./db");
const channels    = require("./channels");
const { decrypt } = require("./crypto");
const logger      = require("./logger");

function dateRange(mode = "yesterday") {
  const today = new Date(); today.setHours(0,0,0,0);
  const days  = { yesterday:1, last7:7, last30:30 }[mode] ?? 1;
  const start = new Date(today); start.setDate(today.getDate() - days);
  const end   = new Date(today); end.setDate(today.getDate() - 1);
  return { startDate: start.toISOString().slice(0,10), endDate: end.toISOString().slice(0,10) };
}

async function upsertStats(advertiserId, channel, stats) {
  if (!stats?.length) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const s of stats) {
      // 모든 값을 JS에서 정수로 변환 후 단순 INSERT
      const impr = Math.round(Number(s.impressions) || 0);
      const clk  = Math.round(Number(s.clicks) || 0);
      const cost = Math.round(Number(s.cost) || 0);
      const conv = Math.round(Number(s.conversions) || 0);
      const amt  = Math.round(Number(s.conversionAmount) || 0);

      // 파생 지표는 JS에서 계산 (SQL 타입 추론 오류 방지)
      const ctr  = impr > 0 ? parseFloat((clk / impr * 100).toFixed(4)) : 0;
      const cpc  = clk  > 0 ? parseFloat((cost / clk).toFixed(2)) : 0;
      const cpm  = impr > 0 ? parseFloat((cost / impr * 1000).toFixed(2)) : 0;
      const roas = cost > 0 ? parseFloat((amt / cost * 100).toFixed(2)) : 0;

      await client.query(`
        INSERT INTO daily_stats
          (advertiser_id, channel, date, impressions, clicks, cost, conversions, conversion_amount, ctr, cpc, cpm, roas, fetched_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        ON CONFLICT (advertiser_id, channel, date) DO UPDATE SET
          impressions=$4, clicks=$5, cost=$6, conversions=$7, conversion_amount=$8,
          ctr=$9, cpc=$10, cpm=$11, roas=$12, fetched_at=NOW()
      `, [advertiserId, channel, s.date, impr, clk, cost, conv, amt, ctr, cpc, cpm, roas]);
    }
    await client.query("COMMIT");
  } catch(e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function runBatch(mode = "yesterday") {
  const { startDate, endDate } = dateRange(mode);
  console.log(`\n===== 배치 시작: ${startDate} ~ ${endDate} =====`);
  await logger.batch(`배치 시작 (${mode}): ${startDate} ~ ${endDate}`, { status:"info" });

  const { rows } = await pool.query(`
    SELECT ac.id, ac.advertiser_id, ac.channel, ac.credentials_enc, adv.name
    FROM ad_accounts ac JOIN advertisers adv ON adv.id=ac.advertiser_id
    WHERE ac.status='connected' AND adv.is_active=TRUE ORDER BY adv.name, ac.channel`);
  let ok=0, fail=0;
  for (const acc of rows) {
    const ch = channels[acc.channel];
    if (!ch) continue;
    const creds = decrypt(acc.credentials_enc);
    try {
      const stats = await ch.fetchStats(creds, startDate, endDate);
      await upsertStats(acc.advertiser_id, acc.channel, stats);
      // 성공 시: last_synced_at만 업데이트, status는 건드리지 않음
      await pool.query(
        `UPDATE ad_accounts SET last_synced_at=NOW(), error_message=NULL WHERE id=$1`,
        [acc.id]
      );
      console.log(`  [완료] ${acc.name}/${acc.channel} ${stats.length}건`);
      await logger.batch(`데이터 수집 완료: ${stats.length}건`, {
        channel: acc.channel, advertiserId: acc.advertiser_id,
        advertiserName: acc.name, status:"success"
      });
      ok++;
    } catch(e) {
      console.error(`  [오류] ${acc.name}/${acc.channel}: ${e.message}`);
      // 실패 시: error_message만 기록, status(연결됨)는 절대 변경하지 않음
      await pool.query(
        `UPDATE ad_accounts SET error_message=$1 WHERE id=$2`,
        [e.message, acc.id]
      );
      await logger.error(`데이터 수집 실패: ${e.message}`, {
        channel: acc.channel, advertiserId: acc.advertiser_id,
        advertiserName: acc.name, detail: e.message
      });
      fail++;
    }
    await new Promise(r => setTimeout(r, 400));
  }
  const summary = `배치 완료 — 성공 ${ok}건 / 실패 ${fail}건`;
  console.log(`===== ${summary} =====`);
  await logger.batch(summary, { status: fail>0 ? "warning" : "success" });
  return { ok, fail };
}

if (require.main === module) {
  runBatch(process.argv[2] || "yesterday").then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
}
module.exports = { runBatch };
