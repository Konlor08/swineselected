// src/pages/AdminImportSwinesPage.jsx

import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase";

function clean(s) {
  return String(s ?? "").trim();
}

function dash(v) {
  const s = clean(v);
  return s ? s : "-";
}

function is10Digits(s) {
  return /^[0-9]{10}$/.test(clean(s));
}

function isAllDigits(s) {
  return /^[0-9]+$/.test(clean(s));
}

function toISODateMaybe(x) {
  if (!x) return null;

  if (x instanceof Date && !isNaN(x.getTime())) {
    return x.toISOString().slice(0, 10);
  }

  if (typeof x === "number") {
    const d = XLSX.SSF.parse_date_code(x);
    if (d?.y && d?.m && d?.d) {
      const js = new Date(Date.UTC(d.y, d.m - 1, d.d));
      return js.toISOString().slice(0, 10);
    }
  }

  const s = clean(x);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);

  return null;
}

/** FarmText เช่น
 * Type A: "RE ลำไย วงศ์ตา 2006S56"
 * Type B: "2006FF9 RE กิตติศักดิ์ ..."
 * => farm_code = token ยาว 7, farm_name = ที่เหลือ
 */
function parseFarmText(farmText) {
  const s = clean(farmText).replace(/\s+/g, " ");
  if (!s) return { farm_code: null, farm_name: null };

  const tokens = s.split(" ");
  const first = tokens[0];
  const last = tokens[tokens.length - 1];

  if (first.length === 7) return { farm_code: first, farm_name: tokens.slice(1).join(" ") || null };
  if (last.length === 7) return { farm_code: last, farm_name: tokens.slice(0, -1).join(" ") || null };

  const idx = tokens.findIndex((t) => t.length === 7);
  if (idx >= 0) {
    const code = tokens[idx];
    const name = tokens.filter((_, i) => i !== idx).join(" ");
    return { farm_code: code, farm_name: name || null };
  }

  return { farm_code: null, farm_name: s || null };
}

/** HouseText เช่น
 * "RE ... 1001" หรือ "1001 RE ..."
 * => house_no = token เลขล้วน
 */
function parseHouseNo(houseText) {
  const s = clean(houseText).replace(/\s+/g, " ");
  if (!s) return null;

  const tokens = s.split(" ");
  const first = tokens[0];
  const last = tokens[tokens.length - 1];

  if (isAllDigits(first)) return first;
  if (isAllDigits(last)) return last;
  return tokens.find((t) => isAllDigits(t)) ?? null;
}

async function readFirstSheetRows(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, {
    type: "array",
    cellDates: true,
  });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function detectABTypeFromRows(rows) {
  const keys = new Set();
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    Object.keys(rows[i] || {}).forEach((k) => keys.add(k));
  }

  const hasA = keys.has("Farm") || keys.has("House");
  const hasB = keys.has("FarmFarm Code") || keys.has("HouseHouse No");

  if (hasA && !hasB) return { type: "A", reason: 'พบคอลัมน์ "Farm/House"' };
  if (hasB && !hasA) return { type: "B", reason: 'พบคอลัมน์ "FarmFarm Code/HouseHouse No"' };
  if (hasA && hasB) return { type: "B", reason: 'พบทั้ง 2 แบบ → ใช้ "Type B" เป็นหลัก' };

  return { type: null, reason: "ไม่พบคอลัมน์ Farm/House หรือ FarmFarm Code/HouseHouse No" };
}

function pickColumnsAuto(row, detectedType) {
  if (detectedType === "A") {
    return {
      swine_code: row["Swine Code"],
      farm_text: row["Farm"],
      house_text: row["House"],
      flock: row["Flock"],
      birth_date: row["Birth Date"],
    };
  }

  if (detectedType === "B") {
    return {
      swine_code: row["Swine Code"],
      farm_text: row["FarmFarm Code"],
      house_text: row["HouseHouse No"],
      flock: row["Flock"],
      birth_date: row["Birth Date"],
    };
  }

  return {
    swine_code: row["Swine Code"],
    farm_text: "",
    house_text: "",
    flock: row["Flock"],
    birth_date: row["Birth Date"],
  };
}

function transformRow(picked) {
  const swine_code = clean(picked.swine_code);
  const farm = parseFarmText(picked.farm_text);
  const house = parseHouseNo(picked.house_text);

  const farm_code = farm?.farm_code ? clean(farm.farm_code) : "";
  const farm_name = farm?.farm_name ? clean(farm.farm_name) : "";
  const house_no = house ? String(house) : "";
  const flock = clean(picked.flock) || "";
  const birth_date = toISODateMaybe(picked.birth_date) || "";

  return {
    swine_code,
    farm_code: farm_code ? farm_code : undefined,
    farm_name: farm_name ? farm_name : undefined,
    house_no: house_no ? house_no : undefined,
    flock: flock ? flock : undefined,
    birth_date: birth_date ? birth_date : undefined,
  };
}

export default function AdminImportSwinesPage() {
  const nav = useNavigate();

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [rows, setRows] = useState([]);
  const [bad, setBad] = useState([]);
  const [detectedType, setDetectedType] = useState(null);
  const [detectReason, setDetectReason] = useState("");

  const preview = useMemo(() => rows.slice(0, 50), [rows]);

  const stat = useMemo(() => {
    const hasFarm = rows.filter((r) => !!r.farm_code).length;
    const hasHouse = rows.filter((r) => !!r.house_no).length;
    const hasBirth = rows.filter((r) => !!r.birth_date).length;
    return { total: rows.length, bad: bad.length, hasFarm, hasHouse, hasBirth };
  }, [rows, bad]);

  async function onPickFileAB(e) {
    setMsg("");
    setRows([]);
    setBad([]);
    setDetectedType(null);
    setDetectReason("");

    const f = e.target.files?.[0];
    if (!f) return;

    setBusy(true);
    try {
      const raw = await readFirstSheetRows(f);

      const det = detectABTypeFromRows(raw);
      setDetectedType(det.type);
      setDetectReason(det.reason);

      if (!det.type) {
        setMsg(`❌ ไฟล์นี้ไม่ใช่ไฟล์ AB: ${det.reason}`);
        return;
      }

      const ok = [];
      const invalid = [];

      for (let i = 0; i < raw.length; i++) {
        const picked = pickColumnsAuto(raw[i], det.type);
        const tr = transformRow(picked);

        if (!tr.swine_code) continue;

        if (!is10Digits(tr.swine_code)) {
          invalid.push({ row: i + 2, swine_code: tr.swine_code, reason: "swine_code ต้องเป็นเลข 10 หลัก" });
          continue;
        }

        ok.push(tr);
      }

      setRows(ok);
      setBad(invalid);

      setMsg(
        `✅ ตรวจไฟล์แล้ว: Type ${det.type} (${det.reason}) | OK=${ok.length} | BAD=${invalid.length} | FarmCode=${ok.filter(
          (x) => x.farm_code
        ).length} | House=${ok.filter((x) => x.house_no).length} | BirthDate=${ok.filter((x) => x.birth_date).length}`
      );
    } catch (err) {
      setMsg(`อ่านไฟล์ไม่สำเร็จ: ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function onImport() {
    if (!rows.length) return;

    setBusy(true);
    setMsg("");

    try {
      const farmCodes = [...new Set(rows.map((x) => x.farm_code).filter(Boolean))];
      let farmMap = new Map();

      if (farmCodes.length) {
        const { data: masters, error: e1 } = await supabase
          .from("master_farms")
          .select("id,farm_code")
          .in("farm_code", farmCodes);

        if (e1) throw e1;
        farmMap = new Map((masters ?? []).map((m) => [m.farm_code, m.id]));
      }

      const payload = rows.map((x) => ({
        swine_code: x.swine_code,
        farm_code: x.farm_code,
        farm_name: x.farm_name,
        house_no: x.house_no,
        flock: x.flock,
        birth_date: x.birth_date,
        master_farm_id: x.farm_code ? farmMap.get(x.farm_code) ?? null : null,
      }));

      const { error: e2 } = await supabase.from("swines").upsert(payload, { onConflict: "swine_code" });
      if (e2) throw e2;

      setMsg(`✅ Import สำเร็จ: ${payload.length} แถว (ไม่ทับค่าเดิมด้วยค่าว่าง/null)`);
    } catch (err) {
      setMsg(`❌ Import ไม่สำเร็จ: ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div
        className="topbar"
        style={{
          flexWrap: "wrap",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>Import Swines (Excel)</div>
          <div className="small" style={{ lineHeight: 1.6 }}>
            ระบบตรวจไฟล์ AB เอง (ไม่ต้องเลือก Type) → map Farm/House/Flock/Birth Date ลง DB: <b>swines</b>
          </div>
        </div>

        <button className="linkbtn" type="button" onClick={() => nav("/admin")}>
          Back
        </button>
      </div>

      <div
        style={{
          maxWidth: 1100,
          margin: "14px auto 0",
          display: "grid",
          gap: 14,
        }}
      >
        <div className="card">
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <label className="small" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span>File AB:</span>
              <input type="file" accept=".xlsx,.xls" onChange={onPickFileAB} disabled={busy} />
            </label>

            <button
              className="btn"
              type="button"
              onClick={onImport}
              disabled={busy || rows.length === 0}
              style={{ width: "min(220px, 100%)" }}
            >
              {busy ? "Working..." : "Import to DB"}
            </button>

            <div className="small" style={{ lineHeight: 1.6 }}>
              OK: <b>{stat.total}</b> | BAD: <b>{stat.bad}</b> | Farm: <b>{stat.hasFarm}</b> | House:{" "}
              <b>{stat.hasHouse}</b> | Birth: <b>{stat.hasBirth}</b>
            </div>
          </div>

          {detectedType ? (
            <div className="small" style={{ marginTop: 8, lineHeight: 1.6 }}>
              ตรวจพบชนิดไฟล์: <b>Type {detectedType}</b> — {detectReason}
            </div>
          ) : null}

          {msg ? (
            <div className="small" style={{ marginTop: 10, lineHeight: 1.7, wordBreak: "break-word" }}>
              {msg}
            </div>
          ) : null}

          {bad.length ? (
            <div className="small" style={{ marginTop: 10, lineHeight: 1.7 }}>
              ⚠️ ข้อมูลไม่ผ่าน (10 รายการแรก):
              {bad.slice(0, 10).map((x, i) => (
                <div key={i} style={{ wordBreak: "break-word" }}>
                  Row {x.row}: <b>{x.swine_code}</b> — {x.reason}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>Preview (50 rows)</div>

          {!preview.length ? (
            <div className="small">ยังไม่มี preview — เลือกไฟล์ AB ก่อน</div>
          ) : (
            <div
              style={{
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
                border: "1px solid #f3f4f6",
                borderRadius: 12,
              }}
            >
              <table style={{ width: "max-content", minWidth: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["swine_code", "farm_code", "farm_name", "house_no", "flock", "birth_date"].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: 8,
                          borderBottom: "1px solid #e5e7eb",
                          whiteSpace: "nowrap",
                          fontSize: 13,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, idx) => (
                    <tr key={idx}>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>
                        {dash(r.swine_code)}
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>
                        {dash(r.farm_code)}
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", minWidth: 180 }}>
                        {dash(r.farm_name)}
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>
                        {dash(r.house_no)}
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>
                        {dash(r.flock)}
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>
                        {dash(r.birth_date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Auto Mapping Rule</div>
          <div className="small" style={{ lineHeight: 1.8 }}>
            • ตรวจหัวคอลัมน์: ถ้ามี <b>Farm/House</b> → Type A, ถ้ามี <b>FarmFarm Code/HouseHouse No</b> → Type B <br />
            • farm_code = token ยาว 7 ตัวจากข้อความ Farm <br />
            • farm_name = ข้อความที่เหลือหลังตัด farm_code <br />
            • house_no = token เลขล้วนจากข้อความ House (เช่น 1001) <br />
            • birth_date = จากคอลัมน์ “Birth Date” ในไฟล์ AB เท่านั้น (เก็บเป็น YYYY-MM-DD)
          </div>
        </div>
      </div>
    </div>
  );
}