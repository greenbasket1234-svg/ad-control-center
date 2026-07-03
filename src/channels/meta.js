const axios = require("axios");
const BASE = "https://graph.facebook.com/v19.0";

async function request(path, params, creds) {
  const res = await axios.get(`${BASE}/${path}`, { params: { ...params, access_token: creds.accessToken }, timeout: 15000 });
  return res.data;
}

async function testConnection(creds) {
  const data = await request(`${creds.accountId}`, { fields: "name,account_status" }, creds);
  return { ok: data.account_status === 1, message: data.account_status === 1 ? `?곕룞 ?깃났 ??${data.name}` : `怨꾩젙 ?곹깭 ?댁긽 (${data.account_status})` };
}

async function fetchStats(creds, startDate, endDate) {
  const data = await request(`${creds.accountId}/insights`, {
    fields: "impressions,clicks,spend,actions,action_values",
    time_increment: 1,
    time_range: JSON.stringify({ since: startDate, until: endDate }),
    level: "account",
  }, creds);
  return (data?.data ?? []).map((row) => {
    const spend = parseFloat(row.spend ?? 0);
    const convVal = parseFloat((row.action_values ?? []).find(a => a.action_type === "purchase")?.value ?? 0);
    return {
      date:             row.date_start,
      impressions:      Math.round(Number(row.impressions ?? 0)),
      clicks:           Math.round(Number(row.clicks ?? 0)),
      cost:             Math.round(spend), // ?쒓뎅 怨꾩젙? ?대? KRW濡?諛섑솚
      conversions:      Math.round(Number((row.actions ?? []).find(a => a.action_type === "purchase")?.value ?? 0)),
      conversionAmount: Math.round(convVal), // ?쒓뎅 怨꾩젙? ?대? KRW濡?諛섑솚
    };
  });
}

module.exports = { testConnection, fetchStats };

