const naver  = require("./naver");
const meta   = require("./meta");
const kakao  = require("./kakao");
const others = require("./others");

module.exports = { naver, meta, kakao, ...others };
