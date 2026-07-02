const axios = require("axios");

/* ── 당근 ── */
async function testConnectionDaangn(creds) {
  const res = await axios.get("https://advertising.api.daangn.com/v1/ad-accounts/me", {
    headers: { Authorization: `Bearer ${creds.apiKey}` }, timeout: 15000,
  });
  return { ok: true, message: `연동 성공 — ${res.data?.name ?? "당근 광고 계정"}` };
}
async function fetchStatsDaangn(creds, startDate, endDate) {
  const res = await axios.get(`https://advertising.api.daangn.com/v1/ad-accounts/${creds.accountId}/reports/daily`, {
    headers: { Authorization: `Bearer ${creds.apiKey}` }, params: { startDate, endDate }, timeout: 15000,
  });
  return (res.data?.data ?? []).map(row => ({ date: row.date, impressions: Number(row.impressions??0), clicks: Number(row.clicks??0), cost: Number(row.spend??0), conversions: Number(row.conversions??0), conversionAmount: Number(row.conversionValue??0) }));
}

/* ── 틱톡 ── */
async function testConnectionTiktok(creds) {
  const res = await axios.get("https://business-api.tiktok.com/open_api/v1.3/advertiser/info/", {
    headers: { "Access-Token": creds.accessToken }, params: { advertiser_ids: JSON.stringify([creds.advertiserId]) }, timeout: 15000,
  });
  const adv = res.data?.data?.list?.[0];
  return { ok: !!adv, message: adv ? `연동 성공 — ${adv.advertiser_name}` : "계정을 찾을 수 없습니다" };
}
async function fetchStatsTiktok(creds, startDate, endDate) {
  const res = await axios.post("https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/",
    { advertiser_id: creds.advertiserId, report_type: "BASIC", dimensions: ["stat_time_day"], metrics: ["spend","impressions","clicks","conversion","value"], start_date: startDate, end_date: endDate, page_size: 100 },
    { headers: { "Access-Token": creds.accessToken, "Content-Type": "application/json" }, timeout: 15000 }
  );
  return (res.data?.data?.list ?? []).map(row => ({ date: row.dimensions?.stat_time_day?.slice(0,10), impressions: Number(row.metrics?.impressions??0), clicks: Number(row.metrics?.clicks??0), cost: Math.round(Number(row.metrics?.spend??0)*1350), conversions: Number(row.metrics?.conversion??0), conversionAmount: Math.round(Number(row.metrics?.value??0)*1350) }));
}

/* ── 구글 ── */
async function refreshGoogleToken(creds) {
  const res = await axios.post("https://oauth2.googleapis.com/token", {
    client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: creds.refreshToken, grant_type: "refresh_token",
  });
  return res.data.access_token;
}
async function testConnectionGoogle(creds) {
  const token = await refreshGoogleToken(creds);
  const custId = creds.customerId.replace(/-/g, "");
  const res = await axios.post(`https://googleads.googleapis.com/v16/customers/${custId}/googleAds:searchStream`,
    { query: "SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1" },
    { headers: { Authorization: `Bearer ${token}`, "developer-token": creds.developerToken, "Content-Type": "application/json" }, timeout: 15000 }
  );
  const name = res.data?.[0]?.results?.[0]?.customer?.descriptiveName;
  return { ok: !!name, message: `연동 성공 — ${name ?? custId}` };
}
async function fetchStatsGoogle(creds, startDate, endDate) {
  const token = await refreshGoogleToken(creds);
  const custId = creds.customerId.replace(/-/g, "");
  const res = await axios.post(`https://googleads.googleapis.com/v16/customers/${custId}/googleAds:searchStream`,
    { query: `SELECT segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'` },
    { headers: { Authorization: `Bearer ${token}`, "developer-token": creds.developerToken, "Content-Type": "application/json" }, timeout: 30000 }
  );
  const rows = [];
  for (const batch of res.data ?? [])
    for (const r of batch.results ?? [])
      rows.push({ date: r.segments.date, impressions: Number(r.metrics.impressions??0), clicks: Number(r.metrics.clicks??0), cost: Math.round(Number(r.metrics.costMicros??0)/10), conversions: Math.round(Number(r.metrics.conversions??0)), conversionAmount: Math.round(Number(r.metrics.conversionsValue??0)*1000) });
  return rows;
}

module.exports = {
  daangn: { testConnection: testConnectionDaangn, fetchStats: fetchStatsDaangn },
  tiktok: { testConnection: testConnectionTiktok, fetchStats: fetchStatsTiktok },
  google: { testConnection: testConnectionGoogle, fetchStats: fetchStatsGoogle },
};
