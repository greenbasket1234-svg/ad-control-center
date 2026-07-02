const express  = require("express");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const { pool } = require("./db");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY;

/* ── JWT 생성 ── */
function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, advertiser_id: user.advertiser_id },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/* ── 인증 미들웨어 (export해서 api.js에서 사용) ── */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "로그인이 필요합니다" });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "세션이 만료되었습니다. 다시 로그인해주세요." });
  }
}

/* ── 관리자 전용 미들웨어 ── */
function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "관리자만 접근 가능합니다" });
  next();
}

/* ── 로그인 ── */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "이메일과 비밀번호를 입력하세요" });

  try {
    const { rows } = await pool.query(
      `SELECT u.*, adv.name AS advertiser_name, adv.brand_color
       FROM users u LEFT JOIN advertisers adv ON adv.id = u.advertiser_id
       WHERE u.email = $1 AND u.is_active = TRUE`,
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다" });

    await pool.query(`UPDATE users SET last_login_at=NOW() WHERE id=$1`, [user.id]);

    res.json({
      token: makeToken(user),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        advertiser_id: user.advertiser_id,
        advertiser_name: user.advertiser_name,
        brand_color: user.brand_color,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── 내 정보 ── */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.advertiser_id, adv.name AS advertiser_name, adv.brand_color
       FROM users u LEFT JOIN advertisers adv ON adv.id=u.advertiser_id WHERE u.id=$1`,
      [req.user.id]
    );
    res.json(rows[0] || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── 관리자: 광고주 계정 생성 ── */
router.post("/users", requireAuth, requireAdmin, async (req, res) => {
  const { email, password, name, role = "advertiser", advertiser_id } = req.body;
  if (!email || !password) return res.status(400).json({ error: "이메일과 비밀번호를 입력하세요" });

  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, advertiser_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, email, name, role, advertiser_id`,
      [email.toLowerCase().trim(), hash, name, role, advertiser_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "이미 사용 중인 이메일입니다" });
    res.status(500).json({ error: e.message });
  }
});

/* ── 관리자: 사용자 목록 ── */
router.get("/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.name, u.role, u.is_active, u.last_login_at,
             u.advertiser_id, adv.name AS advertiser_name
      FROM users u LEFT JOIN advertisers adv ON adv.id=u.advertiser_id
      ORDER BY u.created_at DESC`);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── 비밀번호 변경 ── */
router.put("/users/:id/password", requireAuth, async (req, res) => {
  const targetId = Number(req.params.id);
  if (req.user.role !== "admin" && req.user.id !== targetId)
    return res.status(403).json({ error: "권한이 없습니다" });

  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8)
    return res.status(400).json({ error: "새 비밀번호는 8자 이상이어야 합니다" });

  try {
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id=$1`, [targetId]);
    if (!rows[0]) return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });

    // 본인 변경 시 현재 비밀번호 확인
    if (req.user.role !== "admin") {
      const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!ok) return res.status(401).json({ error: "현재 비밀번호가 올바르지 않습니다" });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [hash, targetId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── 관리자: 초기 어드민 계정 생성 (최초 1회) ── */
router.post("/setup", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT COUNT(*) FROM users WHERE role='admin'`);
    if (Number(rows[0].count) > 0)
      return res.status(409).json({ error: "이미 관리자 계정이 존재합니다" });

    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "이메일과 비밀번호를 입력하세요" });

    const hash = await bcrypt.hash(password, 12);
    const { rows: created } = await pool.query(
      `INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,'관리자','admin') RETURNING id, email, role`,
      [email.toLowerCase().trim(), hash]
    );
    res.status(201).json({ message: "관리자 계정 생성 완료", user: created[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, requireAuth, requireAdmin };
