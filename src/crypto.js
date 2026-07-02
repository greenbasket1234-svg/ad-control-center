const CryptoJS = require("crypto-js");

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY 환경변수가 설정되지 않았습니다");
  return key;
}

function encrypt(obj) {
  return CryptoJS.AES.encrypt(JSON.stringify(obj), getKey()).toString();
}

function decrypt(enc) {
  if (!enc) return {};
  try {
    const bytes = CryptoJS.AES.decrypt(enc, getKey());
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
  } catch {
    return {};
  }
}

module.exports = { encrypt, decrypt };
