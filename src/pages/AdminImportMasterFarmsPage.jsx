// src/pages/AdminImportMasterFarmsPage.jsx

import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase";

function clean(v) {
  return String(v ?? "").trim();
}

function dash(v) {
  const s = clean(v);
  return s ? s : "-";
}

async function readFirstSheetRows(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

// อ่านตามหัวคอลัมน์จริงใน MFarm.xlsx
function mapToRow(row) {
  const farm_code = clean(row["FarmCode"]);
  const fcode = clean(row["FCode"]);
  const farm_name = clean(row["FarmName"]);

  const office_code = clean(row["รหัสสำนักงาน"]);
  const office_name = clean(row["สำนักงาน"]);

  const region_text = clean(row["แผนกงาน-ภาค"]);
  const livestock_type = clean(row["Livestock_type"]);

  return {
    farm_code,
    farm_name,
    office_code: office_code || null,
    office_name: office_name || null,
    region_text: region_text || null,
    livestock_type: livestock_type || null,
    fcode: fcode || null,
    is_active: true,
  };
}

async function withTimeout(promise, ms = 20000, label = "Request") {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timeout (${ms}ms)`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}

export default function AdminImportMasterFarmsPage() {
  const nav = useNavigate();

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [rows, setRows] = useState([]);
  const [bad, setBad] = useState([]);

  const preview = useMemo(() => rows.slice(0, 50), [rows]);

  async function onPickFile(e) {
    setMsg("");
    setRows([]);
    setBad([]);

    const f = e.target.files?.[0];
    if (!f) return;

    setBusy(true);
    try {
      const raw = await readFirstSheetRows(f);

      const ok = [];
      const invalid = [];

      for (let i = 0; i < raw.length; i++) {
        const r = mapToRow(raw[i]);

        if (!r.farm_code && !r.farm_name) continue;

        if (!r.farm_code) {
          invalid.push({ row: i + 2, farm_code: "", reason: "ไม่มี FarmCode" });
          continue;
        }
        if (!r.farm_name) {
          invalid.push({ row: i + 2, farm_code: r.farm_code, reason: "ไม่มี FarmName" });
          continue;
        }

        ok.push(r);
      }

      setRows(ok);
      setBad(invalid);
      setMsg(`โหลดไฟล์สำเร็จ ✅ OK=${ok.length} | BAD=${invalid.length}`);
    } catch (err) {
      setMsg(`อ่านไฟล์ไม่สำเร็จ: ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function onImport() {
    if (!rows.length || busy) return;

    setBusy(true);
    setMsg("");

    try {
      const masterPayload = rows.map((r) => ({
        farm_code: r.farm_code,
        farm_name: r.farm_name,
        region_text: r.region_text || null,
        fcode: r.fcode || null,
        office_code: r.office_code || null,
        office_name: r.office_name || null,
        livestock_type: r.livestock_type || null,
        branch_code: r.office_code || null,
        branch_name: r.office_name || null,
        is_active: true,
      }));

      const p1 = supabase.from("master_farms").upsert(masterPayload, { onConflict: "farm_code" });
      const { error: e1 } = await withTimeout(p1, 20000, "Upsert master_farms");
      if (e1) throw e1;

      const m = new Map();
      for (const r of rows) {
        const code = clean(r.office_code);
        const name = clean(r.office_name);
        if (!code || !name) continue;

        m.set(code, {
          branch_code: code,
          branch_name: name,
          region_text: r.region_text || null,
          is_active: true,
        });
      }

      const branches = Array.from(m.values());

      if (branches.length) {
        const p2 = supabase.from("swine_branches").upsert(branches, { onConflict: "branch_code" });
        const { error: e2 } = await withTimeout(p2, 20000, "Upsert swine_branches");
        if (e2) throw e2;
      }

      setMsg(
        `✅ Import สำเร็จ: master_farms=${masterPayload.length} แถว | swine_branches=${branches.length} สาขา`
      );
    } catch (err) {
      setMsg(`❌ Import ไม่สำเร็จ: ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const previewHeaders = [
    "farm_code",
    "farm_name",
    "office_code",
    "office_name",
    "region_text",
    "livestock_type",
    "fcode",
    "is_active",
  ];

  const thStyle = {
    textAlign: "left",
    padding: 10,
    borderBottom: "1px solid #e5e7eb",
    whiteSpace: "nowrap",
    fontSize: 13,
  };

  const tdStyle = {
    padding: 10,
    borderBottom: "1px solid #f1f1f1",
    verticalAlign: "top",
    fontSize: 14,
  };

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
          <div style={{ fontSize: 20, fontWeight: 900 }}>Import Master Farms (MFarm.xlsx)</div>
          <div className="small" style={{ lineHeight: 1.6 }}>
            Import 2 ตารางพร้อมกัน: master_farms + swine_branches (จาก รหัสสำนักงาน/สำนักงาน/แผนกงาน-ภาค)
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
            <input type="file" accept=".xlsx,.xls" onChange={onPickFile} disabled={busy} />

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
              OK: <b>{rows.length}</b> | BAD: <b>{bad.length}</b> | Preview:{" "}
              <b>{Math.min(50, rows.length)}</b>
            </div>
          </div>

          {msg ? (
            <div className="small" style={{ marginTop: 10, lineHeight: 1.7, wordBreak: "break-word" }}>
              {msg}
            </div>
          ) : null}

          {bad.length ? (
            <div className="small" style={{ marginTop: 10, lineHeight: 1.7 }}>
              ⚠️ แถวไม่ผ่าน (10 รายการแรก):
              {bad.slice(0, 10).map((x, i) => (
                <div key={i} style={{ wordBreak: "break-word" }}>
                  Row {x.row}: FarmCode=<b>{dash(x.farm_code)}</b> — {x.reason}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>Preview (50 rows)</div>

          {!preview.length ? (
            <div className="small">ยังไม่มี preview — เลือกไฟล์ MFarm.xlsx ก่อน</div>
          ) : (
            <div
              style={{
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
                border: "1px solid #f3f4f6",
                borderRadius: 12,
              }}
            >
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "max-content",
                  minWidth: "100%",
                }}
              >
                <thead>
                  <tr>
                    {previewHeaders.map((h) => (
                      <th key={h} style={thStyle}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, idx) => (
                    <tr key={idx}>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{dash(r.farm_code)}</td>
                      <td style={{ ...tdStyle, minWidth: 180 }}>{dash(r.farm_name)}</td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{dash(r.office_code)}</td>
                      <td style={{ ...tdStyle, minWidth: 180 }}>{dash(r.office_name)}</td>
                      <td style={{ ...tdStyle, minWidth: 180 }}>{dash(r.region_text)}</td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{dash(r.livestock_type)}</td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{dash(r.fcode)}</td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                        {r.is_active ? "true" : "false"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="small" style={{ maxWidth: 1100, margin: "0 auto", lineHeight: 1.7 }}>
          ✅ ถ้าเพิ่งเพิ่มคอลัมน์ใน DB แล้ว import ยัง error เรื่อง schema cache ให้รัน SQL:{" "}
          <b>NOTIFY pgrst, 'reload schema';</b>
        </div>
      </div>
    </div>
  );
}