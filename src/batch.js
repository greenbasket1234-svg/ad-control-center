require("dotenv").config();
const { pool }    = require("./db");
const channels    = require("./channels");
const { decrypt } = require("./crypto");

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
      const [impr,clk,cost,conv,amt] = [s.impressions||0, s.clicks||0, s.cost||0, s.conversions||0, s.conversionAmount||0];
      await client.query(`
        INSERT INTO daily_stats (advertiser_id,channel,date,impressions,clicks,cost,conversions,conversion_amount,ctr,cpc,cpm,roas,fetched_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
          ROUND(($5::numeric/NULLIF($4,0))*100,4),
          ROUND($6::numeric/NULLIF($5,0),2),
          ROUND(($6::numeric/NULLIF($4,0))*1000,2),
          ROUND(($8::numeric/NULLIF($6,0))*100,2), NOW())
        ON CONFLICT (advertiser_id,channel,date) DO UPDATE SET
          impressions=$4,clicks=$5,cost=$6,conversions=$7,conversion_amount=$8,
          ctr=ROUND(($5::numeric/NULLIF($4,0))*100,4),
          cpc=ROUND($6::numeric/NULLIF($5,0),2),
          cpm=ROUND(($6::numeric/NULLIF($4,0))*1000,2),
          roas=ROUND(($8::numeric/NULLIF($6,0))*100,2),
          fetched_at=NOW()`,
        [advertiserId, channel, s.date, impr, clk, cost, conv, amt]);
    }
    await client.query("COMMIT");
  } catch(e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

async function runBatch(mode = "yesterday") {
  const { startDate, endDate } = dateRange(mode);
  console.log(`\n===== 배치 시작: ${startDate} ~ ${endDate} =====`);
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
      await pool.query(`UPDATE ad_accounts SET last_synced_at=NOW(),error_message=NULL WHERE id=$1`, [acc.id]);
      console.log(`  [완료] ${acc.name}/${acc.channel} ${stats.length}건`);
      ok++;
    } catch(e) {
      console.error(`  [오류] ${acc.name}/${acc.channel}: ${e.message}`);
      await pool.query(`UPDATE ad_accounts SET status='error',error_message=$1 WHERE id=$2`, [e.message, acc.id]);
      fail++;
    }
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(`===== 완료: 성공 ${ok} / 실패 ${fail} =====`);
  return { ok, fail };
}

if (require.main === module) {
  runBatch(process.argv[2] || "yesterday").then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
}
module.exports = { runBatch };
