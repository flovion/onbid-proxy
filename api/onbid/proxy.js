const { parseStringPromise } = require("xml2js");

const BASE = "http://openapi.onbid.co.kr/openapi/services/ThingInfoInquireSvc";
const ALLOWED_OPS = new Set(["getUnifyNewCltrList"]); // 새로운 물건 목록

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

    const url = new URL(`${BASE}/${op}`);
    url.searchParams.set("serviceKey", serviceKey);
    Object.entries(rest).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).length) url.searchParams.set(k, v);
    });

    const r = await fetch(url.toString());
    const xmlText = await r.text();
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
