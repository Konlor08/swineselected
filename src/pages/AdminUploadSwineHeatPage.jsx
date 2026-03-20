import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase";

function clean(v) {
  return String(v ?? "").trim();
}

function normalizeHeader(s) {
  return clean(s).toLowerCase().replace(/[\s#_\-\/().]+/g, "");
}

function chunkArray(arr, size = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function excelSerialToYmd(serial) {
  if (serial == null || serial === "") return null;
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;

  const utcDays = Math.floor(n - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);

  if (Number.isNaN(dateInfo.getTime())) return null;

  const y = dateInfo.getUTCFullYear();
  const m = String(dateInfo.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateInfo.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function tryParseDateToYmd(value) {
  if (value == null || value === "") return null;

  if (typeof value === "number") {
    return excelSerialToYmd(value);
  }

  const s = clean(value);
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const dmY = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmY) {
    const dd = String(dmY[1]).padStart(2, "0");
    const mm = String(dmY[2]).padStart(2, "0");
    const yyyy = dmY[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const ymD = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymD) {
    const yyyy = ymD[1];
    const mm = String(ymD[2]).padStart(2, "0");
    const dd = String(ymD[3]).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

function getMappedValue(row, map, keys) {
  for (const key of keys) {
    const normalized = normalizeHeader(key);
    const originalKey = map[normalized];
    if (originalKey && row[originalKey] != null && clean(row[originalKey]) !== "") {
      return row[originalKey];
    }
  }
  return null;
}

function buildHeaderMap(row) {
  const map = {};
  Object.keys(row || {}).forEach((k) => {
    map[normalizeHeader(k)] = k;
  });
  return map;
}

function dedupeDates(dates) {
  const seen = new Set();
  const out = [];
  for (const d of dates) {
    if (!d) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

function formatDateTime(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

export default function AdminUploadSwineHeatPage() {
  const nav = useNavigate();
  const fileInputRef = useRef(null);

  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [msg, setMsg] = useState("");
  const [previewRows, setPreviewRows] = useState([]);
  const [validRows, setValidRows] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);
  const [uploadResult, setUploadResult] = useState(null);

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyMsg, setHistoryMsg] = useState("");
  const [historyRows, setHistoryRows] = useState([]);

  const summary = useMemo(() => {
    const total = validRows.length + invalidRows.length;
    return {
      total,
      valid: validRows.length,
      invalid: invalidRows.length,
    };
  }, [validRows, invalidRows]);

  const groupedHistory = useMemo(() => {
    const map = new Map();

    for (const row of historyRows) {
      const key = row.source_file || `NO_FILE__${row.id}`;
      if (!map.has(key)) {
        map.set(key, {
          source_file: row.source_file || "-",
          total_rows: 0,
          processed_rows: 0,
          created_at: row.created_at,
          latest_processed_at: row.processed_at,
        });
      }

      const item = map.get(key);
      item.total_rows += 1;
      if (row.is_processed) item.processed_rows += 1;

      if (row.created_at && (!item.created_at || new Date(row.created_at) > new Date(item.created_at))) {
        item.created_at = row.created_at;
      }

      if (row.processed_at && (!item.latest_processed_at || new Date(row.processed_at) > new Date(item.latest_processed_at))) {
        item.latest_processed_at = row.processed_at;
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      const aa = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bb - aa;
    });
  }, [historyRows]);

  const resetAll = useCallback(() => {
    setFileName("");
    setMsg("");
    setPreviewRows([]);
    setValidRows([]);
    setInvalidRows([]);
    setUploadResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const downloadTemplate = useCallback(() => {
    const rows = [
      {
        "Swine Code": "S001",
        "Heat #1 date": "2026-01-01",
        "Heat #2 date": "2026-01-08",
        "Heat #3 date": "2026-01-18",
        "Heat #4 date": "",
      },
      {
        "Swine Code": "S002",
        "Heat #1 date": "2026-02-01",
        "Heat #2 date": "",
        "Heat #3 date": "",
        "Heat #4 date": "",
      },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "SwineHeatTemplate");
    XLSX.writeFile(wb, "SwineHeatTemplate.xlsx");
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryMsg("");

    try {
      const { data, error } = await supabase
        .from("swine_heat_import_raw")
        .select("id, source_file, swine_code, is_processed, processed_at, created_at")
        .order("id", { ascending: false })
        .limit(1000);

      if (error) throw error;
      setHistoryRows(data || []);
    } catch (err) {
      console.error(err);
      setHistoryMsg(`โหลด upload history ไม่สำเร็จ: ${err.message || String(err)}`);
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const parseFile = useCallback(async (file) => {
    setParsing(true);
    setMsg("");
    setUploadResult(null);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: false });
      const wsName = wb.SheetNames[0];
      const ws = wb.Sheets[wsName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });

      const parsed = [];
      const invalid = [];

      rawRows.forEach((row, idx) => {
        const headerMap = buildHeaderMap(row);

        const swineCodeRaw = getMappedValue(row, headerMap, [
          "Swine Code",
          "swine_code",
          "SwineCode",
          "Pig Code",
          "pig_code",
        ]);

        const heat1Raw = getMappedValue(row, headerMap, [
          "Heat #1 date",
          "Heat1date",
          "heat_1_date",
          "heat1",
        ]);

        const heat2Raw = getMappedValue(row, headerMap, [
          "Heat #2 date",
          "Heat2date",
          "heat_2_date",
          "heat2",
        ]);

        const heat3Raw = getMappedValue(row, headerMap, [
          "Heat #3 date",
          "Heat3date",
          "heat_3_date",
          "heat3",
        ]);

        const heat4Raw = getMappedValue(row, headerMap, [
          "Heat #4 date",
          "Heat4date",
          "heat_4_date",
          "heat4",
        ]);

        const swine_code = clean(swineCodeRaw);
        const dates = dedupeDates([
          tryParseDateToYmd(heat1Raw),
          tryParseDateToYmd(heat2Raw),
          tryParseDateToYmd(heat3Raw),
          tryParseDateToYmd(heat4Raw),
        ]);

        const item = {
          row_no: idx + 2,
          swine_code,
          heat_1_date: dates[0] ?? null,
          heat_2_date: dates[1] ?? null,
          heat_3_date: dates[2] ?? null,
          heat_4_date: dates[3] ?? null,
        };

        if (!swine_code) {
          invalid.push({ ...item, error: "ไม่มี Swine Code" });
          return;
        }

        if (!dates.length) {
          invalid.push({ ...item, error: "ไม่มี Heat date ที่ใช้งานได้" });
          return;
        }

        parsed.push(item);
      });

      setFileName(file.name);
      setPreviewRows(parsed.slice(0, 20));
      setValidRows(parsed);
      setInvalidRows(invalid);
      setMsg(`อ่านไฟล์สำเร็จ: ${file.name}`);
    } catch (err) {
      console.error(err);
      setMsg(`อ่านไฟล์ไม่สำเร็จ: ${err.message || String(err)}`);
      setPreviewRows([]);
      setValidRows([]);
      setInvalidRows([]);
      setUploadResult(null);
    } finally {
      setParsing(false);
    }
  }, []);

  const onFileChange = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await parseFile(file);
    },
    [parseFile]
  );

  const handleUpload = useCallback(async () => {
    if (!validRows.length) {
      setMsg("ยังไม่มีข้อมูล valid สำหรับ upload");
      return;
    }

    setLoading(true);
    setMsg("");
    setUploadResult(null);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const userId = session?.user?.id ?? null;

      const sourceFileTag = `${fileName || "heat_upload"}__${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}`;

      const rowsToInsert = validRows.map((r) => ({
        swine_code: r.swine_code,
        heat_1_date: r.heat_1_date,
        heat_2_date: r.heat_2_date,
        heat_3_date: r.heat_3_date,
        heat_4_date: r.heat_4_date,
        source_file: sourceFileTag,
      }));

      const chunks = chunkArray(rowsToInsert, 500);

      for (const chunk of chunks) {
        const { error } = await supabase.from("swine_heat_import_raw").insert(chunk);
        if (error) throw error;
      }

      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "process_swine_heat_import_raw",
        {
          p_user_id: userId,
          p_source_file: sourceFileTag,
        }
      );

      if (rpcError) throw rpcError;

      setUploadResult(rpcData || null);
      setMsg("อัปโหลดและประมวลผลสำเร็จ");
      await loadHistory();
    } catch (err) {
      console.error(err);
      setMsg(`Upload ไม่สำเร็จ: ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [fileName, validRows, loadHistory]);

  return (
    <div className="page">
      <div className="topbar" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>Upload Swine Heat</div>
          <div className="small">อัปโหลดไฟล์ Heat Excel เพื่อบันทึก history และ rebuild heat events</div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="linkbtn" type="button" onClick={downloadTemplate}>
            Download Template
          </button>
          <button className="linkbtn" type="button" onClick={() => nav("/admin")}>
            Back to Admin
          </button>
          <button className="linkbtn" type="button" onClick={resetAll} disabled={loading || parsing}>
            Clear
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>ไฟล์ที่รองรับ</div>
        <div className="small" style={{ marginTop: 6 }}>
          คอลัมน์ที่รองรับ: <b>Swine Code</b>, <b>Heat #1 date</b>, <b>Heat #2 date</b>, <b>Heat #3 date</b>, <b>Heat #4 date</b>
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={onFileChange}
            disabled={loading || parsing}
          />

          <button
            className="linkbtn"
            type="button"
            onClick={handleUpload}
            disabled={loading || parsing || !validRows.length}
            style={{
              opacity: loading || parsing || !validRows.length ? 0.6 : 1,
              cursor: loading || parsing || !validRows.length ? "not-allowed" : "pointer",
            }}
          >
            {parsing ? "Parsing..." : loading ? "Uploading..." : "Upload เข้า DB"}
          </button>
        </div>

        {msg ? (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 10,
              background: "#f3f4f6",
              color: "#111827",
            }}
          >
            {msg}
          </div>
        ) : null}
      </div>

      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          marginBottom: 16,
        }}
      >
        {[
          ["ไฟล์", fileName || "-"],
          ["ทั้งหมด", summary.total],
          ["Valid", summary.valid],
          ["Invalid", summary.invalid],
        ].map(([label, value]) => (
          <div key={label} className="card">
            <div className="small">{label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6, wordBreak: "break-word" }}>{value}</div>
          </div>
        ))}
      </div>

      {uploadResult ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12 }}>ผลการประมวลผล</div>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              background: "#0f172a",
              color: "#e5e7eb",
              padding: 16,
              borderRadius: 12,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(uploadResult, null, 2)}
          </pre>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12 }}>Preview (20 แถวแรก)</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                {[
                  "row_no",
                  "swine_code",
                  "heat_1_date",
                  "heat_2_date",
                  "heat_3_date",
                  "heat_4_date",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: 10,
                      borderBottom: "1px solid #e5e7eb",
                      background: "#f9fafb",
                      fontSize: 13,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.length ? (
                previewRows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.row_no}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.swine_code}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.heat_1_date || "-"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.heat_2_date || "-"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.heat_3_date || "-"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.heat_4_date || "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} style={{ padding: 16, color: "#6b7280" }}>
                    ยังไม่มีข้อมูล preview
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {invalidRows.length ? (
        <div className="card" style={{ border: "1px solid #fecaca", marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12, color: "#991b1b" }}>Invalid Rows</div>
          <div style={{ overflowX: "auto", maxHeight: 360 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
              <thead>
                <tr>
                  {["row_no", "swine_code", "heat_1_date", "heat_2_date", "heat_3_date", "heat_4_date", "error"].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: 10,
                          borderBottom: "1px solid #e5e7eb",
                          background: "#fef2f2",
                          fontSize: 13,
                        }}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {invalidRows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.row_no}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.swine_code || "-"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.heat_1_date || "-"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.heat_2_date || "-"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.heat_3_date || "-"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.heat_4_date || "-"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6", color: "#b91c1c" }}>{r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>Upload History</div>
            <div className="small">แสดงรายการ import ล่าสุดจาก swine_heat_import_raw</div>
          </div>

          <button className="linkbtn" type="button" onClick={loadHistory} disabled={historyLoading}>
            {historyLoading ? "Refreshing..." : "Refresh History"}
          </button>
        </div>

        {historyMsg ? (
          <div
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 10,
              background: "#fef2f2",
              color: "#991b1b",
            }}
          >
            {historyMsg}
          </div>
        ) : null}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                {["source_file", "total_rows", "processed_rows", "status", "created_at", "latest_processed_at"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: 10,
                      borderBottom: "1px solid #e5e7eb",
                      background: "#f9fafb",
                      fontSize: 13,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupedHistory.length ? (
                groupedHistory.map((r, i) => {
                  const isDone = r.total_rows > 0 && r.total_rows === r.processed_rows;
                  return (
                    <tr key={`${r.source_file}-${i}`}>
                      <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.source_file}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.total_rows}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.processed_rows}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "4px 10px",
                            borderRadius: 999,
                            background: isDone ? "#dcfce7" : "#fef3c7",
                            color: isDone ? "#166534" : "#92400e",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {isDone ? "processed" : "pending"}
                        </span>
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{formatDateTime(r.created_at)}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{formatDateTime(r.latest_processed_at)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} style={{ padding: 16, color: "#6b7280" }}>
                    ยังไม่มี upload history
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}