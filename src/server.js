require("dotenv").config();
const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const cron     = require("node-cron");
const { initDB } = require("./db");
const { runBatch } = require("./batch");
const apiRouter   = require("./api");

const app = express();

app.use(cors({
  origin: [
    process.env.CLIENT_URL,
    /\.up\.railway\.app$/,  // Railway 도메인 전체 허용
    "http://localhost:3000",
    "http://localhost:4000",
  ].filter(Boolean),
  credentials: true,
}));
app.use(express.json());

/* API 라우터 */
app.use("/api", apiRouter);

/* 프론트 정적 파일 서빙 (public 폴더) */
app.use(express.static(path.join(__dirname, "../public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public", "index.html"));
});

/* 헬스체크 */
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString() }));

/* 매일 오전 6시 자동 배치 */
cron.schedule("0 6 * * *", () => {
  console.log("[CRON] 일별 배치 시작");
  runBatch("yesterday").catch(console.error);
}, { timezone: "Asia/Seoul" });

const PORT = process.env.PORT || 4000;
(async () => {
  await initDB();
  app.listen(PORT, () => {
    console.log(`\n광고관제소 서버 실행 → http://localhost:${PORT}`);
  });
})();
