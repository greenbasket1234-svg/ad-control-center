const axios = require("axios");
const BASE = "https://apis.moment.kakao.com/openapi/v4";

const hdr = (creds) => ({ Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" });

async function testConnection(creds) {
  const res = await axios.get(`${BASE}/adAccounts/${creds.accountId}`, { headers: hdr(creds), timeout: 15000 });
  return { ok: true, message: `연동 성공 — ${res.data?.name ?? creds.accountId}` };
}

async function fetchStats(creds, startDate, endDate) {
  const res = await axios.get(`${BASE}/adAccounts/${creds.accountId}/stats`, {
    headers: hdr(creds),
    params: { datePreset: "CUSTOM", startDate, endDate, breakdown: "DATE", metricsGroups: "BASIC,CONVERSION" },
    timeout: 15000,
  });
  return (res.data?.data ?? []).map(row => ({
    date: row.date,
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    cost: Number(row.cost ?? 0),
    conversions: Number(row.conversions ?? 0),
    conversionAmount: Number(row.conversionAmount ?? 0),
  }));
}

module.exports = { testConnection, fetchStats };
