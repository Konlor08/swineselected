// src/pages/AdminImportSwinesPage.jsx

import React, { useCallback, useMemo, useState } from "react";
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

function chunkArray(arr, size = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function toISODateMaybe(x) {
  if (!x) return null;

  if (x instanceof Date && !Number.isNaN(x.getTime())) {
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
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);

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

  if (first.length === 7) {
    return { farm_code: first, farm_name: tokens.slice(1).join(" ") || null };
  }

  if (last.length === 7) {
    return { farm_code: last, farm_name: tokens.slice(0, -1).join(" ") || null };
  }

  const idx = tokens.findIndex((t) => t.length === 7);
  if (idx >= 0) {
    const code = tokens[idx];
    const name = tokens.filter((_, i) => i !== idx).join(" ");
    return { farm_code: code, farm_name: name || null };
  }

  return { farm_code: null, farm_name: s || null };
}

/** HouseText เช่น
 * "kk กิตติพัฒน์ อุปัชฌาย์ 1001" => 1001
 * "1001 kk กิตติพัฒน์ ..." => 1001
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

  return {
    type: null,
    reason: "ไม่พบคอลัมน์ Farm/House หรือ FarmFarm Code/HouseHouse No",
  };
}

function pickColumnsAuto(row, detectedType) {
  const gender = row["Gender"] ?? row["GenderGender Code"] ?? "";
  const farmText = detectedType === "A" ? row["Farm"] : row["FarmFarm Code"];
  const houseText = detectedType === "A" ? row["House"] : row["HouseHouse No"];

  return {
    swine_code: row["Swine Code"],
    farm_text: farmText,
    house_text: houseText,
    flock: row["Flock"],
    birth_date: row["Birth Date"],
    gender,
    birth_lot: row["Birth Lot"],
    dam_code: row["Dam Code"],
    sire_code: row["Sire Code"],
    swine_breed: row["Swine Breed"],
    block: row["Block"],
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
  const gender = clean(picked.gender) || "";
  const birth_lot = clean(picked.birth_lot) || "";
  const dam_code = clean(picked.dam_code) || "";
  const sire_code = clean(picked.sire_code) || "";
  const swine_breed = clean(picked.swine_breed) || "";
  const block = clean(picked.block) || "";

  return {
    swine_code,
    farm_code: farm_code || undefined,
    farm_name: farm_name || undefined,
    house_no: house_no || undefined,
    flock: flock || undefined,
    birth_date: birth_date || undefined,
    gender: gender || undefined,
    birth_lot: birth_lot || undefined,
    dam_code: dam_code || undefined,
    sire_code: sire_code || undefined,
    swine_breed: swine_breed || undefined,
    block: block || null,
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
  const [sourceFilename, setSourceFilename] = useState("");

  const preview = useMemo(() => rows.slice(0, 50), [rows]);

  const stat = useMemo(() => {
    const hasFarm = rows.filter((r) => !!r.farm_code).length;
    const hasHouse = rows.filter((r) => !!r.house_no).length;
    const hasBirth = rows.filter((r) => !!r.birth_date).length;
    const hasFlock = rows.filter((r) => !!r.flock).length;
    const hasBlock = rows.filter((r) => clean(r.block) !== "").length;

    return {
      total: rows.length,
      bad: bad.length,
      hasFarm,
      hasHouse,
      hasBirth,
      hasFlock,
      hasBlock,
    };
  }, [rows, bad]);

  const onPickFileAB = useCallback(async (e) => {
    setMsg("");
    setRows([]);
    setBad([]);
    setDetectedType(null);
    setDetectReason("");
    setSourceFilename("");

    const f = e.target.files?.[0];
    if (!f) return;

    setBusy(true);
    try {
      setSourceFilename(f.name);

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
      const seen = new Set();

      for (let i = 0; i < raw.length; i++) {
        const picked = pickColumnsAuto(raw[i], det.type);
        const tr = transformRow(picked);

        if (!tr.swine_code) continue;

        if (!is10Digits(tr.swine_code)) {
          invalid.push({
            row: i + 2,
            swine_code: tr.swine_code,
            reason: "swine_code ต้องเป็นเลข 10 หลัก",
          });
          continue;
        }

        if (seen.has(tr.swine_code)) {
          invalid.push({
            row: i + 2,
            swine_code: tr.swine_code,
            reason: "swine_code ซ้ำในไฟล์เดียวกัน",
          });
          continue;
        }

        seen.add(tr.swine_code);
        ok.push(tr);
      }

      setRows(ok);
      setBad(invalid);

      setMsg(
        `✅ ตรวจไฟล์แล้ว: Type ${det.type} (${det.reason}) | OK=${ok.length} | BAD=${invalid.length} | Farm=${ok.filter(
          (x) => x.farm_code
        ).length} | Flock=${ok.filter((x) => x.flock).length} | House=${ok.filter(
          (x) => x.house_no
        ).length} | BirthDate=${ok.filter((x) => x.birth_date).length} | Block=${ok.filter(
          (x) => clean(x.block) !== ""
        ).length}`
      );
    } catch (err) {
      setMsg(`อ่านไฟล์ไม่สำเร็จ: ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }, []);

  const onImport = useCallback(async () => {
    if (!rows.length || busy) return;

    setBusy(true);
    setMsg("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: batchRow, error: batchErr } = await supabase
        .from("swine_import_batches")
        .insert([
          {
            source_filename: sourceFilename || `manual-import-${new Date().toISOString()}.xlsx`,
            imported_by: user?.id || null,
            note: "Import from AdminImportSwinesPage",
          },
        ])
        .select("id")
        .single();

      if (batchErr) throw batchErr;
      const batchId = batchRow.id;

      const farmCodes = [...new Set(rows.map((x) => x.farm_code).filter(Boolean))];
      let farmMap = new Map();

      if (farmCodes.length) {
        const { data: masters, error: e1 } = await supabase
          .from("master_farms")
          .select("id, farm_code")
          .in("farm_code", farmCodes);

        if (e1) throw e1;
        farmMap = new Map((masters ?? []).map((m) => [m.farm_code, m.id]));
      }

      const batchItems = rows.map((x) => ({
        batch_id: batchId,
        swine_code: x.swine_code,
        farm_code: x.farm_code ?? null,
        flock: x.flock ?? null,
        house_no: x.house_no ?? null,
        birth_date: x.birth_date ?? null,
        gender: x.gender ?? null,
        birth_lot: x.birth_lot ?? null,
        dam_code: x.dam_code ?? null,
        sire_code: x.sire_code ?? null,
        swine_breed: x.swine_breed ?? null,
        block: clean(x.block) || null,
      }));

      for (const chunk of chunkArray(batchItems, 500)) {
        const { error } = await supabase.from("swine_import_batch_items").insert(chunk);
        if (error) throw error;
      }

      const swinePayload = rows.map((x) => ({
        swine_code: x.swine_code,
        farm_code: x.farm_code ?? null,
        farm_name: x.farm_name ?? null,
        house_no: x.house_no ?? null,
        flock: x.flock ?? null,
        birth_date: x.birth_date ?? null,
        master_farm_id: x.farm_code ? farmMap.get(x.farm_code) ?? null : null,
        gender: x.gender ?? null,
        birth_lot: x.birth_lot ?? null,
        dam_code: x.dam_code ?? null,
        sire_code: x.sire_code ?? null,
        swine_breed: x.swine_breed ?? null,
        block: clean(x.block) || null,
        is_active: true,
      }));

      for (const chunk of chunkArray(swinePayload, 500)) {
        const { error } = await supabase
          .from("swines")
          .upsert(chunk, { onConflict: "swine_code" });

        if (error) throw error;
      }

      const masterPayload = rows.map((x) => ({
        swine_code: x.swine_code,
        block: clean(x.block) || null,
      }));

      for (const chunk of chunkArray(masterPayload, 500)) {
        const { error } = await supabase
          .from("swine_master")
          .upsert(chunk, { onConflict: "swine_code" });

        if (error) throw error;
      }

      const { data: applyResult, error: applyErr } = await supabase.rpc(
        "apply_swine_import_batch",
        {
          p_batch_id: batchId,
          p_archive_reason: "missing from latest import file",
        }
      );

      if (applyErr) throw applyErr;

      const summary = Array.isArray(applyResult) ? applyResult[0] : applyResult;

      setMsg(
        `✅ Import สำเร็จ: ${rows.length} แถว | batch=${batchId} | present=${summary?.present_rows ?? 0} | reactivated=${
          summary?.reactivated_rows ?? 0
        } | archived=${summary?.archived_rows ?? 0} | skipped reserved/issued=${
          summary?.skipped_reserved_or_issued ?? 0
        }`
      );
    } catch (err) {
      console.error("onImport error:", err);
      setMsg(`❌ Import ไม่สำเร็จ: ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, rows, sourceFilename]);

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
            ตรวจไฟล์ AB อัตโนมัติ → import ลง <b>swines</b>, overwrite <b>block</b>, และ archive ตัวที่หายจากไฟล์ใน flock เดียวกัน
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
            <label
              className="small"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                alignItems: "center",
              }}
            >
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
              OK: <b>{stat.total}</b> | BAD: <b>{stat.bad}</b> | Farm: <b>{stat.hasFarm}</b> | Flock:{" "}
              <b>{stat.hasFlock}</b> | House: <b>{stat.hasHouse}</b> | Birth: <b>{stat.hasBirth}</b> | Block:{" "}
              <b>{stat.hasBlock}</b>
            </div>
          </div>

          {sourceFilename ? (
            <div className="small" style={{ marginTop: 8, lineHeight: 1.6 }}>
              ไฟล์: <b>{sourceFilename}</b>
            </div>
          ) : null}

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
                    {[
                      "swine_code",
                      "farm_code",
                      "farm_name",
                      "flock",
                      "house_no",
                      "birth_date",
                      "gender",
                      "birth_lot",
                      "dam_code",
                      "sire_code",
                      "swine_breed",
                      "block",
                    ].map((h) => (
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
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>{dash(r.swine_code)}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>{dash(r.farm_code)}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", minWidth: 180 }}>{dash(r.farm_name)}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>{dash(r.flock)}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>{dash(r.house_no)}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>{dash(r.birth_date)}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>{dash(r.gender)}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>{dash(r.birth_lot)}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>{dash(r.dam_code)}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>{dash(r.sire_code)}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>{dash(r.swine_breed)}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1", whiteSpace: "nowrap" }}>{dash(r.block)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}