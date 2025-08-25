// api/onbid/proxy.js  (CommonJS)
// 온비드 XML → JSON 변환 프록시 + 디버그 모드

const { parseStringPromise } = require("xml2js");

// 허용 오퍼레이션
const ALLOWED_OPS = new Set([
  "getUnifyNewCltrList",
  "getUnifyUsageCltr",
  "getOnbidTopCodeInfo"
]);

// 서비스별 베이스 URL
const SERVICE_BASE = {
  ThingInfoInquireSvc: "http://openapi.onbid.co.kr/openapi/services/ThingInfoInquireSvc",
  OnbidCodeInfoInquireSvc: "http://openapi.onbid.co.kr/openapi/services/OnbidCodeInfoInquireSvc"
};

// op → 서비스 매핑
const OP_SERVICE = {
  getUnifyNewCltrList: "ThingInfoInquireSvc",
  getUnifyUsageCltr: "ThingInfoInquireSvc",
  getOnbidTopCodeInfo: "OnbidCodeInfoInquireSvc"
};

function setCorsJson(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

// 타임아웃 fetch (4초)
async function fetchWithTimeout(url, ms = 4000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, {
      headers: { Accept: "application/xml,*/*", "User-Agent": "onbid-proxy/1.0" },
      signal: ac.signal,
      cache: "no-store"
    });
  } finally {
    clearTimeout(t);
  }
}

module.exports = async (req, res) => {
  setCorsJson(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // 0) 디버그 모드: 라우트 생존 여부/리전 확인 (온비드 호출 안 함)
    if (req.query._debug === "1") {
      return res.status(200).json({
        ok: true,
        ping: "pong",
        region: process.env.VERCEL_REGION || null,
        query: req.query
      });
    }

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

    // 1차 4초
    let xmlText;
    try {
      const r = await fetchWithTimeout(url.toString(), 4000);
      xmlText = await r.text();
    } catch (e1) {
      // 2차 3.5초 (가볍게)
      const retryUrl = new URL(url.toString());
      const prev = Number(retryUrl.searchParams.get("numOfRows") || "10");
      retryUrl.searchParams.set("numOfRows", Math.min(prev, 10).toString());
      if (retryUrl.searchParams.has("CLTR_NM")) retryUrl.searchParams.delete("CLTR_NM");

      try {
        const r2 = await fetchWithTimeout(retryUrl.toString(), 3500);
        const xml2 = await r2.text();
        const json2 = await parseStringPromise(xml2, { explicitArray: false, trim: true });
        return res.status(200).json({
          ok: true,
          op,
          request: {
            primary: url.toString().replace(serviceKey, "****"),
            retry: retryUrl.toString().replace(serviceKey, "****")
          },
          data: json2,
          note: "primary timeout; returned retry result"
        });
      } catch (e2) {
        return res.status(504).json({ ok: false, error: "Upstream timeout (Onbid)" });
      }
    }

    const json = await parseStringPromise(xmlText || "", { explicitArray: false, trim: true });
    return res.status(200).json({
      ok: true,
      op,
      region: process.env.VERCEL_REGION || null,
      request: url.toString().replace(serviceKey, "****"),
      data: json
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error", region: process.env.VERCEL_REGION || null });
  }
};
