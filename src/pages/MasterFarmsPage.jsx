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

async function readFirstSheetRows(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function pickMFarm(row) {
  return {
    farm_code: clean(row["FarmCode"]),
    fcode: clean(row["FCode"]) || null,
    farm_name: clean(row["FarmName"]),
    sloc: clean(row["Sloc"]) || null,
    house: clean(row["House"]) || null,
    office_code: clean(row["รหัสสำนักงาน"]) || null,
    office_name: clean(row["สำนักงาน"]) || null,
    region_code: clean(row["แผนกงาน-ภาค"]) || null,
    livestock_type: clean(row["Livestock_type"]) || null,
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
        const r = pickMFarm(raw[i]);

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
      setMsg(`โหลดไฟล์สำเร็จ ✅ OK=${ok.length} | BAD=${invalid.length} (preview 50)`);
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
      const { error } = await supabase
        .from("master_farms")
        .upsert(rows, { onConflict: "farm_code" });

      if (error) throw error;

      setMsg(`✅ Import สำเร็จ: ${rows.length} แถว (upsert by farm_code)`);
    } catch (err) {
      setMsg(`❌ Import ไม่สำเร็จ: ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>Import Master Farms (MFarm.xlsx)</div>
          <div className="small">
            อ่านคอลัมน์ตามไฟล์: FarmCode, FCode, FarmName, Sloc, House, รหัสสำนักงาน, สำนักงาน,
            แผนกงาน-ภาค, Livestock_type
          </div>
        </div>

        <button className="linkbtn" type="button" onClick={() => nav("/admin")}>
          Back
        </button>
      </div>

      <div style={{ maxWidth: 1100, margin: "14px auto 0" }}>
        <div className="card">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input type="file" accept=".xlsx,.xls" onChange={onPickFile} disabled={busy} />

            <button
              className="btn"
              type="button"
              onClick={onImport}
              disabled={busy || rows.length === 0}
              style={{ width: 220 }}
            >
              {busy ? "Working..." : "Import to DB"}
            </button>

            <div className="small">
              OK: <b>{rows.length}</b> | BAD: <b>{bad.length}</b> | Preview: <b>{Math.min(50, rows.length)}</b>
            </div>
          </div>

          {msg ? (
            <div className="small" style={{ marginTop: 10 }}>
              {msg}
            </div>
          ) : null}

          {bad.length ? (
            <div className="small" style={{ marginTop: 10 }}>
              ⚠️ แถวไม่ผ่าน (10 รายการแรก):
              {bad.slice(0, 10).map((x, i) => (
                <div key={i}>
                  Row {x.row}: FarmCode=<b>{dash(x.farm_code)}</b> — {x.reason}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="card" style={{ marginTop: 14, overflow: "auto" }}>
          <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>Preview (50 rows)</div>

          {!preview.length ? (
            <div className="small">ยังไม่มี preview — เลือกไฟล์ MFarm.xlsx ก่อน</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {[
                    "farm_code",
                    "fcode",
                    "farm_name",
                    "sloc",
                    "house",
                    "office_code",
                    "office_name",
                    "region_code",
                    "livestock_type",
                    "is_active",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: 8,
                        borderBottom: "1px solid #e5e7eb",
                        whiteSpace: "nowrap",
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
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{dash(r.farm_code)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{dash(r.fcode)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{dash(r.farm_name)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{dash(r.sloc)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{dash(r.house)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{dash(r.office_code)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{dash(r.office_name)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{dash(r.region_code)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{dash(r.livestock_type)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f1f1f1" }}>{r.is_active ? "true" : "false"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}