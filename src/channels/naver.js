const crypto = require("crypto");
const axios = require("axios");

const BASE = "https://api.naver.com";

function sign(timestamp, method, uri, secretKey) {
  return crypto.createHmac("sha256", secretKey)
    .update(`${timestamp}.${method}.${uri}`)
    .digest("base64");
}

function makeHeaders(method, uri, creds) {
  const ts = Date.now().toString();
  return {
    "Content-Type": "application/json; charset=UTF-8",
    "X-Timestamp": ts,
    "X-API-KEY": creds.apiKey,
    "X-Customer": creds.customerId,
    "X-Signature": sign(ts, method, uri, creds.secretKey),
  };
}

async function request(method, uri, params, creds) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await axios({ method, url: BASE + uri + qs, headers: makeHeaders(method, uri, creds), timeout: 15000 });
  return res.data;
}

async function testConnection(creds) {
  const data = await request("GET", "/ncc/campaigns", { pageSize: 1 }, creds);
  return { ok: true, message: `연동 성공 — 캠페인 ${data.campaigns?.length ?? 0}개 확인` };
}

async function fetchStats(creds, startDate, endDate) {
  const toND = (d) => d.replace(/-/g, "");
  const campData = await request("GET", "/ncc/campaigns", { pageSize: 500 }, creds);
  const campaigns = campData?.campaigns ?? [];
  if (!campaigns.length) return [];

  const ids = campaigns.map((c) => c.nccCampaignId);
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));

  const rows = [];
  for (const chunk of chunks) {
    const data = await request("GET", "/stats", {
      ids: chunk.join(","),
      fields: "impCnt,clkCnt,salesAmt,ctr,cpc,crto,convAmt,ror",
      timeRange: JSON.stringify({ since: toND(startDate), until: toND(endDate) }),
      timeUnit: "DAY",
      breakdown: "noBreakdown",
    }, creds);
    for (const item of data?.data ?? []) {
      for (const row of item.data ?? []) {
        const ds = String(row.since ?? row.date ?? "");
        const date = ds.length === 8 ? `${ds.slice(0,4)}-${ds.slice(4,6)}-${ds.slice(6,8)}` : ds;
        rows.push({ date, impressions: Number(row.impCnt??0), clicks: Number(row.clkCnt??0), cost: Number(row.salesAmt??0), conversions: Number(row.crto??0), conversionAmount: Number(row.convAmt??0) });
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }

  const map = {};
  for (const r of rows) {
    if (!map[r.date]) map[r.date] = { date: r.date, impressions:0, clicks:0, cost:0, conversions:0, conversionAmount:0 };
    Object.keys(r).filter(k=>k!=="date").forEach(k => map[r.date][k] += r[k]);
  }
  return Object.values(map);
}

module.exports = { testConnection, fetchStats };
