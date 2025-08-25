const { parseStringPromise } = require("xml2js");

// 허용 오퍼레이션
const ALLOWED_OPS = new Set([
  "getUnifyNewCltrList",
  "getUnifyUsageCltr",
  "getOnbidTopCodeInfo"
]);

// 서비스 매핑
const SERVICE_BASE = {
  ThingInfoInquireSvc: "http://openapi.onbid.co.kr/openapi/services/ThingInfoInquireSvc",
  OnbidCodeInfoInquireSvc: "http://openapi.onbid.co.kr/openapi/services/OnbidCodeInfoInquireSvc"
};

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

// fetch에 타임아웃 걸기
async function fetchWithTimeout(url, { timeoutMs = 8000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { "Accept": "application/xml,*/*" },
      signal: ac.signal,
      cache: "no-store"
    });
    return r;
  } finally {
    clearTimeout(t);
  }
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const serviceKey = process.env.ONBID_SERVICE_KEY;
    if (!serviceKey) return res.status(500).json({ ok: false, error: "Missing ONBID_SERVICE_KEY" });

    // 기본 op 선택 로직(지역 파라미터 있으면 getUnifyUsageCltr)
    const { op: rawOp, ...rest } = req.query;
    const wantsRegion = !!(rest.SIDO || rest.SGK || rest.EMD);
    const op = rawOp || (wantsRegion ? "getUnifyUsageCltr" : "getUnifyNewCltrList");

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

    // 1차 호출(8초 타임아웃)
    let resp, xmlText;
    try {
      resp = await fetchWithTimeout(url.toString(), { timeoutMs: 8000 });
      xmlText = await resp.text();
    } catch (e) {
      // 2차 재시도: rows 줄이고(기본 10) 키워드 제거(있다면)로 빠르게 재조회
      const retryUrl = new URL(url.toString());
      const prevRows = Number(retryUrl.searchParams.get("numOfRows") || "10");
      retryUrl.searchParams.set("numOfRows", Math.min(prevRows, 10).toString());
      if (retryUrl.searchParams.has("CLTR_NM")) retryUrl.searchParams.delete("CLTR_NM");

      const r2 = await fetchWithTimeout(retryUrl.toString(), { timeoutMs: 8000 });
      const xml2 = await r2.text();

      // 재시도 결과 반환
      const json2 = await parseStringPromise(xml2, { explicitArray: false, trim: true });
      return res.status(200).json({
        ok: true,
        op,
        request: {
          primary: url.toString().replace(serviceKey, "****"),
          retry: retryUrl.toString().replace(serviceKey, "****")
        },
        data: json2,
        note: "primary request timed out; returned retried result (reduced rows / removed CLTR_NM)"
      });
    }

    // 정상 응답 파싱
    const json = await parseStringPromise(xmlText || "", { explicitArray: false, trim: true });
    return res.status(200).json({
      ok: true,
      op,
      request: url.toString().replace(serviceKey, "****"),
      data: json
    });
  } catch (e) {
    const msg = e?.name === "AbortError" ? "Gateway timeout to upstream (Onbid)" : (e?.message || "Unknown error");
    return res.status(504).json({ ok: false, error: msg });
  }
};
