// src/pages/AdminImportMasterFarmsPage.jsx

import React, { useCallback, useMemo, useState } from "react";
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

function pickFirst(row, keys) {
  for (const k of keys) {
    const v = clean(row?.[k]);
    if (v) return v;
  }
  return "";
}

function chunkArray(arr, size = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function readFirstSheetRows(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

// รองรับทั้งหัวคอลัมน์แบบเก่า + แบบใหม่
function mapToRow(row) {
  const farm_code = pickFirst(row, ["FarmCode", "farm_code", "FCode", "fcode"]);
  const farm_name31 = pickFirst(row, ["farmName31", "FarmName31", "FarmName", "farm_name31", "farm_name"]);
  const farm_name = farm_name31 || farm_code;

  const livestock = pickFirst(row, ["Livestock", "livestock"]);
  const livestock_type_text = pickFirst(row, ["LivestockTypeText", "livestock_type_text"]);
  const livestock_type = pickFirst(row, ["livestocktype", "Livestock_type", "livestock_type"]);

  const office_code = pickFirst(row, ["OfficeCode", "office_code", "รหัสสำนักงาน"]);
  const office_name = pickFirst(row, ["OfficeName", "office_name", "สำนักงาน"]);

  const region_text = pickFirst(row, ["RegionText", "region_text", "แผนกงาน-ภาค"]);

  const fcode = pickFirst(row, ["FCode", "fcode"]) || farm_code;

  // ถ้าไฟล์ไม่มี office_code ให้ใช้ office_name เป็น branch_code ชั่วคราว
  const branch_code = office_code || office_name || null;
  const branch_name = office_name || office_code || null;

  return {
    farm_code,
    farm_name,
    farm_name31: farm_name31 || null,
    livestock: livestock || null,
    livestock_type_text: livestock_type_text || null,
    livestock_type: livestock_type || null,
    office_code: office_code || null,
    office_name: office_name || null,
    region_text: region_text || null,
    fcode: fcode || null,
    branch_code,
    branch_name,
    is_active: true,
  };
}

export default function AdminImportMasterFarmsPage() {
  const nav = useNavigate();

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [rows, setRows] = useState([]);
  const [bad, setBad] = useState([]);

  const preview = useMemo(() => rows.slice(0, 50), [rows]);

  const onPickFile = useCallback(async (e) => {
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
      const dedupMap = new Map();

      for (let i = 0; i < raw.length; i++) {
        const r = mapToRow(raw[i]);

        if (!r.farm_code && !r.farm_name) continue;

        if (!r.farm_code) {
          invalid.push({ row: i + 2, farm_code: "", reason: "ไม่มี FarmCode" });
          continue;
        }

        // last row wins
        dedupMap.set(r.farm_code, r);
      }

      for (const r of dedupMap.values()) {
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
  }, []);

  const onImport = useCallback(async () => {
    if (!rows.length || busy) return;

    setBusy(true);
    setMsg("");

    try {
      const masterPayload = rows.map((r) => ({
        farm_code: r.farm_code,
        farm_name: r.farm_name || r.farm_code,
        farm_name31: r.farm_name31 || r.farm_name || r.farm_code,
        livestock: r.livestock || null,
        livestock_type_text: r.livestock_type_text || null,
        livestock_type: r.livestock_type || null,
        region_text: r.region_text || null,
        fcode: r.fcode || r.farm_code,
        office_code: r.office_code || null,
        office_name: r.office_name || null,
        branch_code: r.branch_code || null,
        branch_name: r.branch_name || null,
        is_active: true,
      }));

      const masterChunks = chunkArray(masterPayload, 500);
      for (const chunk of masterChunks) {
        const { error } = await supabase
          .from("master_farms")
          .upsert(chunk, { onConflict: "farm_code" });

        if (error) throw error;
      }

      const branchMap = new Map();
      for (const r of rows) {
        const code = clean(r.branch_code);
        const name = clean(r.branch_name);

        if (!code || !name) continue;

        branchMap.set(code, {
          branch_code: code,
          branch_name: name,
          region_text: r.region_text || null,
          is_active: true,
        });
      }

      const branches = Array.from(branchMap.values());
      const branchChunks = chunkArray(branches, 500);

      for (const chunk of branchChunks) {
        const { error } = await supabase
          .from("swine_branches")
          .upsert(chunk, { onConflict: "branch_code" });

        if (error) throw error;
      }

      setMsg(
        `✅ Import สำเร็จ: master_farms=${masterPayload.length} แถว | swine_branches=${branches.length} สาขา`
      );
    } catch (err) {
      setMsg(`❌ Import ไม่สำเร็จ: ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, rows]);

  const previewHeaders = [
    "farm_code",
    "farm_name",
    "farm_name31",
    "livestock",
    "livestock_type_text",
    "livestock_type",
    "office_code",
    "office_name",
    "region_text",
    "branch_code",
    "branch_name",
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
          <div style={{ fontSize: 20, fontWeight: 900 }}>Import Master Farms</div>
          <div className="small" style={{ lineHeight: 1.6 }}>
            Import พร้อมกัน: <b>master_farms</b> + <b>swine_branches</b>
            <br />
            รองรับทั้งไฟล์หัวคอลัมน์แบบเก่าและแบบใหม่
          </div>
        </div>

        <button className="linkbtn" type="button" onClick={() => nav("/admin")}>
          Back
        </button>
      </div>

      <div
        style={{
          maxWidth: 1200,
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
            <div className="small">ยังไม่มี preview — เลือกไฟล์ก่อน</div>
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
                      <td style={{ ...tdStyle, minWidth: 180 }}>{dash(r.farm_name31)}</td>
                      <td style={{ ...tdStyle, minWidth: 180 }}>{dash(r.livestock)}</td>
                      <td style={{ ...tdStyle, minWidth: 180 }}>{dash(r.livestock_type_text)}</td>
                      <td style={{ ...tdStyle, minWidth: 120 }}>{dash(r.livestock_type)}</td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{dash(r.office_code)}</td>
                      <td style={{ ...tdStyle, minWidth: 180 }}>{dash(r.office_name)}</td>
                      <td style={{ ...tdStyle, minWidth: 180 }}>{dash(r.region_text)}</td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{dash(r.branch_code)}</td>
                      <td style={{ ...tdStyle, minWidth: 180 }}>{dash(r.branch_name)}</td>
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

        <div className="small" style={{ maxWidth: 1200, margin: "0 auto", lineHeight: 1.7 }}>
          หลังรัน SQL แล้ว ถ้ายังเจอ schema cache เก่า ให้ refresh หน้าใหม่ 1 ครั้ง
        </div>
      </div>
    </div>
  );
}