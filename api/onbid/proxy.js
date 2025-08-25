// api/onbid/proxy.js  (CommonJS)
// 온비드 XML → JSON 변환 프록시

const { parseStringPromise } = require("xml2js");

// 함수별 실행 설정 (Serverless)
module.exports.config = {
  regions: ['sin1'],   // 싱가포르 리전
  maxDuration: 10,
  memory: 1024
};

// 오퍼레이션 허용 목록
const ALLOWED_OPS = new Set([
  "getUnifyNewCltrList",   // 통합 새로운 물건 목록
  "getUnifyUsageCltr",     // 용도/지역/가격 등으로 물건 목록
  "getOnbidTopCodeInfo"    // 용도 상위 코드 목록
]);

// 서비스별 베이스 URL 매핑
const SERVICE_BASE = {
  ThingInfoInquireSvc: "http://openapi.onbid.co.kr/openapi/services/ThingInfoInquireSvc",
  OnbidCodeInfoInquireSvc: "http://openapi.onbid.co.kr/openapi/services/OnbidCodeInfoInquireSvc"
};

// 각 op → 어떤 서비스로 보낼지 매핑
const OP_SERVICE = {
  getUnifyNewCltrList: "ThingInfoInquireSvc",
  getUnifyUsageCltr: "ThingInfoInquireSvc",
  getOnbidTopCodeInfo: "OnbidCodeInfoInquireSvc"
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const serviceKey = process.env.ONBID_SERVICE_KEY;
    if (!serviceKey) {
      return res.status(500).json({ ok: false, error: "Missing ONBID_SERVICE_KEY" });
    }

    const { op = "getUnifyNewCltrList", ...rest } = req.query;
    if (!ALLOWED_OPS.has(op)) {
      return res.status(400).json({ ok: false, error: `Unsupported operation: ${op}` });
    }

    const svc = OP_SERVICE[op];
    const base = SERVICE_BASE[svc];

    const url = new URL(`${base}/${op}`);
    url.searchParams.set("serviceKey", serviceKey);
    Object.entries(rest).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).length) url.searchParams.set(k, v);
    });

    const r = await fetch(url.toString());
    const xmlText = await r.text();

    // XML → JSON
    const json = await parseStringPromise(xmlText, { explicitArray: false, trim: true });

    return res.status(200).json({
      ok: true,
      op,
      request: url.toString().replace(serviceKey, "****"),
      data: json
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
};
