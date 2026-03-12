// src/pages/ExportCsvPage.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchMyProfile } from "../lib/profile";

function todayYmdLocal() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeCsv(value) {
  const s = String(value ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(filename, rows) {
  if (!rows?.length) return;

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(",")),
  ];

  const csv = "\uFEFF" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function parseYmdToUtcDate(ymd) {
  if (!ymd || typeof ymd !== "string") return null;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function calcAgeDays(selectedDate, birthDate) {
  const s = parseYmdToUtcDate(selectedDate);
  const b = parseYmdToUtcDate(birthDate);
  if (!s || !b) return "";
  const diffMs = s.getTime() - b.getTime();
  const days = Math.floor(diffMs / 86400000);
  return days >= 0 ? days : "";
}

function chunkArray(arr, size = 200) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function sortByLabelTh(a, b) {
  return String(a?.label || "").localeCompare(String(b?.label || ""), "th");
}

function formatStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "submitted") return "submitted";
  if (s === "issued") return "issued";
  return s || "-";
}

function statusBadgeStyle(status) {
  const s = String(status || "").toLowerCase();

  if (s === "issued") {
    return {
      display: "inline-flex",
      padding: "4px 10px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 700,
      border: "1px solid #cbd5e1",
      background: "#f8fafc",
      color: "#334155",
      whiteSpace: "nowrap",
    };
  }

  return {
    display: "inline-flex",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    border: "1px solid #a7f3d0",
    background: "#ecfdf5",
    color: "#047857",
    whiteSpace: "nowrap",
  };
}

const pageWrapStyle = {
  minHeight: "100vh",
  background: "linear-gradient(180deg, #f0fdf4 0%, #f8fafc 45%, #ffffff 100%)",
  padding: "16px",
  boxSizing: "border-box",
};

const shellStyle = {
  width: "100%",
  maxWidth: 1280,
  margin: "0 auto",
  display: "grid",
  gap: 16,
};

const topCardStyle = {
  background: "#ffffff",
  border: "1px solid #d1fae5",
  borderRadius: 24,
  overflow: "hidden",
  boxShadow: "0 10px 30px rgba(16, 185, 129, 0.10)",
};

const topHeadStyle = {
  background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
  color: "#ffffff",
  padding: 20,
};

const cardStyle = {
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: 22,
  padding: 18,
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.05)",
  boxSizing: "border-box",
};

const inputStyle = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 14,
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
  outline: "none",
  minWidth: 0,
  background: "#ffffff",
};

const disabledInputStyle = {
  ...inputStyle,
  background: "#f1f5f9",
  color: "#64748b",
};

const btnBaseStyle = {
  border: 0,
  borderRadius: 14,
  padding: "11px 16px",
  fontWeight: 700,
  cursor: "pointer",
  transition: "all .15s ease",
};

const btnLightStyle = {
  ...btnBaseStyle,
  background: "#ffffff",
  color: "#334155",
  border: "1px solid #cbd5e1",
};

const btnGreenStyle = {
  ...btnBaseStyle,
  background: "#059669",
  color: "#ffffff",
};

const btnDarkStyle = {
  ...btnBaseStyle,
  background: "#0f172a",
  color: "#ffffff",
};

const msgStyle = {
  borderRadius: 16,
  padding: "12px 14px",
  fontSize: 14,
  lineHeight: 1.6,
  fontWeight: 700,
  border: "1px solid #fde68a",
  background: "#fffbeb",
  color: "#92400e",
  wordBreak: "break-word",
};

export default function ExportCsvPage() {
  const nav = useNavigate();

  const [pageLoading, setPageLoading] = useState(true);
  const [fromFarmLoading, setFromFarmLoading] = useState(false);
  const [toFarmLoading, setToFarmLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [msg, setMsg] = useState("");

  const [, setMyProfile] = useState(null);
  const [myRole, setMyRole] = useState("");

  const [selectedDate, setSelectedDate] = useState(todayYmdLocal());
  const [fromFarmCode, setFromFarmCode] = useState("");
  const [toFarmId, setToFarmId] = useState("");
  const [fromFarmQ, setFromFarmQ] = useState("");
  const [toFarmQ, setToFarmQ] = useState("");

  const [fromFarmOptions, setFromFarmOptions] = useState([]);
  const [toFarmOptions, setToFarmOptions] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);

  const canUsePage = ["admin", "user"].includes(String(myRole).toLowerCase());
  const canQueryRows = Boolean(selectedDate && fromFarmCode && toFarmId);

  useEffect(() => {
    let ignore = false;

    async function init() {
      setPageLoading(true);
      setMsg("");

      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        const uid = data?.session?.user?.id;
        if (!uid) {
          if (!ignore) {
            setMyProfile(null);
            setMyRole("");
            setMsg("ไม่พบผู้ใช้งาน กรุณา login ใหม่");
          }
          return;
        }

        const profile = await fetchMyProfile(uid);
        if (ignore) return;

        setMyProfile(profile || null);
        setMyRole(String(profile?.role || "").toLowerCase());
      } catch (e) {
        console.error("init ExportCsvPage error:", e);
        if (!ignore) {
          setMyProfile(null);
          setMyRole("");
          setMsg(e?.message || "โหลดข้อมูลเริ่มต้นไม่สำเร็จ");
        }
      } finally {
        if (!ignore) setPageLoading(false);
      }
    }

    init();

    return () => {
      ignore = true;
    };
  }, []);

  async function getCurrentUserId() {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    return user?.id || null;
  }

  const applyRoleFilter = useCallback(
    async (query) => {
      if (myRole === "admin") return query;

      const userId = await getCurrentUserId();
      if (!userId) return query.eq("created_by", "__no_user__");

      return query.eq("created_by", userId);
    },
    [myRole]
  );

  const loadFromFarmOptions = useCallback(async () => {
    setFromFarmLoading(true);

    try {
      let query = supabase
        .from("swine_shipments")
        .select("from_farm_code, from_farm_name")
        .eq("selected_date", selectedDate)
        .in("status", ["submitted", "issued"])
        .order("from_farm_name", { ascending: true });

      query = await applyRoleFilter(query);

      const { data, error } = await query;
      if (error) throw error;

      const map = new Map();

      for (const row of data || []) {
        const code = String(row?.from_farm_code || "").trim();
        const name = String(row?.from_farm_name || "").trim();
        if (!code) continue;

        if (!map.has(code)) {
          map.set(code, {
            value: code,
            label: name ? `${code} - ${name}` : code,
            code,
            name,
          });
        }
      }

      setFromFarmOptions(Array.from(map.values()).sort(sortByLabelTh));
    } catch (e) {
      console.error("loadFromFarmOptions error:", e);
      setFromFarmOptions([]);
      setMsg(e?.message || "โหลดรายการฟาร์มที่คัดไม่สำเร็จ");
    } finally {
      setFromFarmLoading(false);
    }
  }, [applyRoleFilter, selectedDate]);

  const loadToFarmOptions = useCallback(async () => {
    setToFarmLoading(true);

    try {
      let query = supabase
        .from("swine_shipments")
        .select(`
          to_farm_id,
          to_farm:swine_farms!swine_shipments_to_farm_id_fkey (
            id,
            farm_code,
            farm_name
          )
        `)
        .eq("selected_date", selectedDate)
        .eq("from_farm_code", fromFarmCode)
        .in("status", ["submitted", "issued"])
        .order("created_at", { ascending: false });

      query = await applyRoleFilter(query);

      const { data, error } = await query;
      if (error) throw error;

      const map = new Map();

      for (const row of data || []) {
        const id = String(row?.to_farm_id || "").trim();
        const farmCode = String(row?.to_farm?.farm_code || "").trim();
        const farmName = String(row?.to_farm?.farm_name || "").trim();
        if (!id) continue;

        if (!map.has(id)) {
          map.set(id, {
            value: id,
            label: farmCode ? `${farmCode} - ${farmName}` : farmName || id,
            farm_code: farmCode,
            farm_name: farmName,
          });
        }
      }

      setToFarmOptions(Array.from(map.values()).sort(sortByLabelTh));
    } catch (e) {
      console.error("loadToFarmOptions error:", e);
      setToFarmOptions([]);
      setMsg(e?.message || "โหลดรายการฟาร์มปลายทางไม่สำเร็จ");
    } finally {
      setToFarmLoading(false);
    }
  }, [applyRoleFilter, fromFarmCode, selectedDate]);

  useEffect(() => {
    if (!canUsePage || !selectedDate) {
      setFromFarmOptions([]);
      return;
    }
    loadFromFarmOptions();
  }, [canUsePage, selectedDate, loadFromFarmOptions]);

  useEffect(() => {
    if (!canUsePage || !selectedDate || !fromFarmCode) {
      setToFarmOptions([]);
      return;
    }
    loadToFarmOptions();
  }, [canUsePage, selectedDate, fromFarmCode, loadToFarmOptions]);

  async function loadSwineMapByCodes(swineCodes) {
    const uniqueCodes = Array.from(
      new Set(
        (swineCodes || [])
          .map((x) => String(x || "").trim())
          .filter(Boolean)
      )
    );

    if (!uniqueCodes.length) return {};

    const chunks = chunkArray(uniqueCodes, 200);
    const allRows = [];

    for (const chunk of chunks) {
      const { data, error } = await supabase
        .from("swines")
        .select("swine_code, house_no, flock, birth_date")
        .in("swine_code", chunk);

      if (error) throw error;
      allRows.push(...(data || []));
    }

    const map = {};
    for (const row of allRows) {
      map[String(row.swine_code)] = row;
    }
    return map;
  }

  const fetchExportBaseData = useCallback(async () => {
    let query = supabase
      .from("swine_shipments")
      .select(`
        id,
        shipment_no,
        selected_date,
        from_farm_code,
        from_farm_name,
        remark,
        to_farm_id,
        status,
        created_at,
        to_farm:swine_farms!swine_shipments_to_farm_id_fkey (
          id,
          farm_code,
          farm_name
        ),
        items:swine_shipment_items (
          id,
          swine_code,
          teats_left,
          teats_right,
          backfat,
          weight
        )
      `)
      .eq("selected_date", selectedDate)
      .eq("from_farm_code", fromFarmCode)
      .eq("to_farm_id", toFarmId)
      .in("status", ["submitted", "issued"])
      .order("created_at", { ascending: false });

    query = await applyRoleFilter(query);

    const { data, error } = await query;
    if (error) throw error;

    const allCodes = [];
    for (const shipment of data || []) {
      for (const item of shipment.items || []) {
        if (item?.swine_code) allCodes.push(item.swine_code);
      }
    }

    const swineMap = await loadSwineMapByCodes(allCodes);

    return { shipments: data || [], swineMap };
  }, [applyRoleFilter, fromFarmCode, selectedDate, toFarmId]);

  function buildFlatRows(shipments, swineMap) {
    const rows = [];

    for (const shipment of shipments || []) {
      for (const item of shipment.items || []) {
        const swine = swineMap[String(item?.swine_code || "")] || {};

        rows.push({
          shipment_id: shipment.id || "",
          shipment_no: shipment.shipment_no || "",
          shipment_status: shipment.status || "",
          selected_date: shipment.selected_date || "",
          from_farm_name: shipment.from_farm_name || "",
          house_no: swine.house_no || "",
          flock: swine.flock || "",
          to_farm_name: shipment.to_farm?.farm_name || "",
          swine_code: item?.swine_code || "",
          birth_date: swine.birth_date || "",
          age_days: calcAgeDays(shipment.selected_date, swine.birth_date),
          teats_left: item?.teats_left ?? "",
          teats_right: item?.teats_right ?? "",
          backfat: item?.backfat ?? "",
          weight: item?.weight ?? "",
          remark: shipment.remark || "",
          created_at: shipment.created_at || "",
        });
      }
    }

    return rows;
  }

  const refreshPreviewRows = useCallback(async () => {
    const { shipments, swineMap } = await fetchExportBaseData();
    const rows = buildFlatRows(shipments, swineMap);
    setPreviewRows(rows);
    return { shipments, rows };
  }, [fetchExportBaseData]);

  const handlePreview = useCallback(async () => {
    if (!canQueryRows) return;

    setPreviewLoading(true);
    setMsg("");

    try {
      const { rows } = await refreshPreviewRows();

      if (!rows.length) {
        setMsg("ไม่พบข้อมูลตามเงื่อนไขที่เลือก");
      }
    } catch (e) {
      console.error("handlePreview error:", e);
      setPreviewRows([]);
      setMsg(e?.message || "โหลดตัวอย่างข้อมูลไม่สำเร็จ");
    } finally {
      setPreviewLoading(false);
    }
  }, [canQueryRows, refreshPreviewRows]);

  const handleExport = useCallback(async () => {
    if (!canQueryRows) return;

    setExporting(true);
    setMsg("");

    try {
      const { shipments, swineMap } = await fetchExportBaseData();
      const flatRows = buildFlatRows(shipments, swineMap);

      if (!flatRows.length) {
        setMsg("ไม่พบข้อมูลสำหรับ export");
        return;
      }

      const exportRows = flatRows.map((r) => ({
        สถานะ: formatStatus(r.shipment_status),
        วันที่คัด: r.selected_date,
        ฟาร์มที่คัด: r.from_farm_name,
        โรงเรือน: r.house_no,
        flock: r.flock,
        ฟาร์มปลายทาง: r.to_farm_name,
        เบอร์หมู: r.swine_code,
        วันเกิด: r.birth_date,
        "อายุ(วัน)": r.age_days,
        เต้าซ้าย: r.teats_left,
        เต้าขวา: r.teats_right,
        backfat: r.backfat,
        น้ำหนัก: r.weight,
        หมายเหตุ: r.remark,
      }));

      const fromFarmText =
        fromFarmOptions.find((x) => x.value === fromFarmCode)?.code || "all";
      const toFarmText =
        toFarmOptions.find((x) => x.value === toFarmId)?.farm_code || "all";

      const filename = `swine_export_${selectedDate}_${fromFarmText}_${toFarmText}.csv`;

      downloadCsv(filename, exportRows);
      setMsg(`Export สำเร็จ ${exportRows.length} รายการ`);
    } catch (e) {
      console.error("handleExport error:", e);
      setMsg(e?.message || "Export CSV ไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  }, [
    canQueryRows,
    fetchExportBaseData,
    fromFarmCode,
    fromFarmOptions,
    selectedDate,
    toFarmId,
    toFarmOptions,
  ]);

  const handleSubmitConfirm = useCallback(async () => {
    if (!canQueryRows) return;

    const ok = window.confirm(
      "ยืนยัน Submit ใช่หรือไม่\nระบบจะเปลี่ยน shipment ที่เป็น submitted ให้เป็น issued และยืนยันสถานะหมูทั้งหมดเป็น issued"
    );
    if (!ok) return;

    setSubmitting(true);
    setMsg("");

    try {
      const { shipments } = await fetchExportBaseData();
      const submittedShipments = (shipments || []).filter(
        (x) => String(x?.status || "").toLowerCase() === "submitted"
      );

      if (!submittedShipments.length) {
        setMsg("ไม่พบ shipment สถานะ submitted สำหรับยืนยัน");
        return;
      }

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError) throw authError;
      if (!user?.id) throw new Error("ไม่พบผู้ใช้งาน กรุณา login ใหม่");

      const nowIso = new Date().toISOString();
      let totalSwines = 0;

      for (const shipment of submittedShipments) {
        const codes = (shipment.items || [])
          .map((x) => String(x?.swine_code || "").trim())
          .filter(Boolean);

        totalSwines += codes.length;

        if (codes.length) {
          const { error: e1 } = await supabase
            .from("swine_master")
            .update({
              delivery_state: "issued",
              issued_shipment_id: shipment.id,
              issued_at: nowIso,
              issued_by: user.id,
            })
            .in("swine_code", codes);

          if (e1) throw e1;
        }

        const { error: e2 } = await supabase
          .from("swine_shipments")
          .update({
            status: "issued",
            issued_at: nowIso,
            issued_by: user.id,
          })
          .eq("id", shipment.id)
          .eq("status", "submitted");

          if (e2) throw e2;
      }

      await refreshPreviewRows();
      await loadFromFarmOptions();
      await loadToFarmOptions();

      setMsg(
        `Submit สำเร็จ ${submittedShipments.length} shipment และยืนยันสถานะหมู ${totalSwines} ตัว เป็น issued แล้ว`
      );
    } catch (e) {
      console.error("handleSubmitConfirm error:", e);
      setMsg(e?.message || "Submit ไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }, [canQueryRows, fetchExportBaseData, loadFromFarmOptions, loadToFarmOptions, refreshPreviewRows]);

  function handleDateChange(e) {
    const value = e.target.value;
    setSelectedDate(value);
    setFromFarmCode("");
    setToFarmId("");
    setFromFarmQ("");
    setToFarmQ("");
    setFromFarmOptions([]);
    setToFarmOptions([]);
    setPreviewRows([]);
    setMsg("");
  }

  function handleFromFarmChange(e) {
    const value = e.target.value;
    setFromFarmCode(value);
    setToFarmId("");
    setToFarmQ("");
    setToFarmOptions([]);
    setPreviewRows([]);
    setMsg("");
  }

  function handleToFarmChange(e) {
    const value = e.target.value;
    setToFarmId(value);
    setPreviewRows([]);
    setMsg("");
  }

  const filteredFromFarmOptions = useMemo(() => {
    const q = String(fromFarmQ || "").trim().toLowerCase();
    if (!q) return fromFarmOptions;

    return fromFarmOptions.filter((opt) => {
      const text = `${opt.code || ""} ${opt.name || ""} ${opt.label || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [fromFarmOptions, fromFarmQ]);

  const filteredToFarmOptions = useMemo(() => {
    const q = String(toFarmQ || "").trim().toLowerCase();
    if (!q) return toFarmOptions;

    return toFarmOptions.filter((opt) => {
      const text = `${opt.farm_code || ""} ${opt.farm_name || ""} ${opt.label || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [toFarmOptions, toFarmQ]);

  const previewTop100 = useMemo(() => previewRows.slice(0, 100), [previewRows]);

  const previewStatusCounts = useMemo(() => {
    const counts = { submitted: 0, issued: 0 };
    const shipmentSeen = new Set();

    for (const row of previewRows) {
      const key = `${row.shipment_id}`;
      if (!key || shipmentSeen.has(key)) continue;
      shipmentSeen.add(key);

      const s = String(row.shipment_status || "").toLowerCase();
      if (s === "submitted") counts.submitted += 1;
      if (s === "issued") counts.issued += 1;
    }

    return counts;
  }, [previewRows]);

  if (pageLoading) {
    return (
      <div style={pageWrapStyle}>
        <div style={shellStyle}>
          <div style={cardStyle}>กำลังโหลด...</div>
        </div>
      </div>
    );
  }

  if (!canUsePage) {
    return (
      <div style={pageWrapStyle}>
        <div style={shellStyle}>
          <div style={cardStyle}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#dc2626" }}>
              ไม่มีสิทธิ์เข้าใช้งาน
            </div>
            <button
              type="button"
              onClick={() => nav(-1)}
              style={{ ...btnDarkStyle, marginTop: 14 }}
            >
              กลับ
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageWrapStyle}>
      <div style={shellStyle}>
        <div style={topCardStyle}>
          <div style={topHeadStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 900 }}>Export CSV</div>
                <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6 }}>
                  Role: <b>{myRole || "-"}</b>
                  {myRole === "admin"
                    ? " — export ได้ทุกข้อมูล"
                    : " — export ได้เฉพาะข้อมูลที่ตัวเองสร้าง"}
                </div>
                <div style={{ marginTop: 4, fontSize: 13, opacity: 0.95 }}>
                  แสดงรายการสถานะ submitted และ issued
                </div>
              </div>

              <button
                type="button"
                onClick={() => nav(-1)}
                style={{
                  ...btnBaseStyle,
                  background: "rgba(255,255,255,0.14)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.35)",
                }}
              >
                กลับ
              </button>
            </div>
          </div>

          <div
            style={{
              padding: "14px 18px 18px",
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 700,
                border: "1px solid #a7f3d0",
                background: "#ecfdf5",
                color: "#047857",
              }}
            >
              submitted: {previewStatusCounts.submitted}
            </span>

            <span
              style={{
                display: "inline-flex",
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 700,
                border: "1px solid #cbd5e1",
                background: "#f8fafc",
                color: "#334155",
              }}
            >
              issued: {previewStatusCounts.issued}
            </span>
          </div>
        </div>

        <div style={cardStyle}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 14,
            }}
          >
            <label style={{ display: "block", minWidth: 0 }}>
              <div style={{ marginBottom: 6, fontSize: 14, fontWeight: 700, color: "#334155" }}>
                วันที่คัด
              </div>
              <input
                type="date"
                value={selectedDate}
                onChange={handleDateChange}
                style={inputStyle}
              />
            </label>

            <label style={{ display: "block", minWidth: 0 }}>
              <div style={{ marginBottom: 6, fontSize: 14, fontWeight: 700, color: "#334155" }}>
                ฟาร์มที่คัด
              </div>

              <input
                type="text"
                value={fromFarmQ}
                onChange={(e) => setFromFarmQ(e.target.value)}
                placeholder={fromFarmLoading ? "กำลังโหลด..." : "ค้นหา farm code / farm name"}
                disabled={!selectedDate || fromFarmLoading}
                style={
                  !selectedDate || fromFarmLoading
                    ? { ...disabledInputStyle, marginBottom: 8 }
                    : { ...inputStyle, marginBottom: 8 }
                }
              />

              <select
                value={fromFarmCode}
                onChange={handleFromFarmChange}
                disabled={!selectedDate || fromFarmLoading}
                style={!selectedDate || fromFarmLoading ? disabledInputStyle : inputStyle}
              >
                <option value="">
                  {fromFarmLoading
                    ? "กำลังโหลด..."
                    : filteredFromFarmOptions.length
                    ? "เลือกฟาร์มที่คัด"
                    : "ไม่พบฟาร์มที่คัด"}
                </option>
                {filteredFromFarmOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                ทั้งหมด {fromFarmOptions.length} รายการ / ตรงคำค้น {filteredFromFarmOptions.length} รายการ
              </div>

              {!fromFarmLoading && selectedDate && fromFarmOptions.length === 0 ? (
                <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                  ไม่พบฟาร์มที่คัดในวันที่เลือก
                </div>
              ) : null}
            </label>

            <label style={{ display: "block", minWidth: 0 }}>
              <div style={{ marginBottom: 6, fontSize: 14, fontWeight: 700, color: "#334155" }}>
                ฟาร์มปลายทาง
              </div>

              <input
                type="text"
                value={toFarmQ}
                onChange={(e) => setToFarmQ(e.target.value)}
                placeholder={toFarmLoading ? "กำลังโหลด..." : "ค้นหา farm code / farm name"}
                disabled={!selectedDate || !fromFarmCode || toFarmLoading}
                style={
                  !selectedDate || !fromFarmCode || toFarmLoading
                    ? { ...disabledInputStyle, marginBottom: 8 }
                    : { ...inputStyle, marginBottom: 8 }
                }
              />

              <select
                value={toFarmId}
                onChange={handleToFarmChange}
                disabled={!selectedDate || !fromFarmCode || toFarmLoading}
                style={!selectedDate || !fromFarmCode || toFarmLoading ? disabledInputStyle : inputStyle}
              >
                <option value="">
                  {toFarmLoading
                    ? "กำลังโหลด..."
                    : filteredToFarmOptions.length
                    ? "เลือกฟาร์มปลายทาง"
                    : "ไม่พบฟาร์มปลายทาง"}
                </option>
                {filteredToFarmOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                ทั้งหมด {toFarmOptions.length} รายการ / ตรงคำค้น {filteredToFarmOptions.length} รายการ
              </div>

              {!toFarmLoading &&
              selectedDate &&
              fromFarmCode &&
              toFarmOptions.length === 0 ? (
                <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                  ไม่พบฟาร์มปลายทางจากเงื่อนไขที่เลือก
                </div>
              ) : null}
            </label>
          </div>

          <div
            style={{
              marginTop: 16,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={handlePreview}
              disabled={!canQueryRows || previewLoading || exporting || submitting}
              style={{
                ...btnLightStyle,
                opacity: !canQueryRows || previewLoading || exporting || submitting ? 0.6 : 1,
                cursor:
                  !canQueryRows || previewLoading || exporting || submitting
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {previewLoading ? "กำลังโหลด..." : "แสดงข้อมูล"}
            </button>

            <button
              type="button"
              onClick={handleExport}
              disabled={!canQueryRows || exporting || previewLoading || submitting}
              style={{
                ...btnGreenStyle,
                opacity: !canQueryRows || exporting || previewLoading || submitting ? 0.6 : 1,
                cursor:
                  !canQueryRows || exporting || previewLoading || submitting
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {exporting ? "กำลัง Export..." : "Export CSV"}
            </button>

            <button
              type="button"
              onClick={handleSubmitConfirm}
              disabled={!canQueryRows || submitting || previewLoading || exporting}
              style={{
                ...btnDarkStyle,
                opacity: !canQueryRows || submitting || previewLoading || exporting ? 0.6 : 1,
                cursor:
                  !canQueryRows || submitting || previewLoading || exporting
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {submitting ? "กำลัง Submit..." : "Submit"}
            </button>
          </div>

          {msg ? <div style={{ ...msgStyle, marginTop: 14 }}>{msg}</div> : null}
        </div>

        <div style={cardStyle}>
          <div
            style={{
              marginBottom: 12,
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
              Preview ({previewRows.length} รายการ)
            </div>

            {previewRows.length > 100 ? (
              <div style={{ fontSize: 13, color: "#64748b" }}>
                แสดงตัวอย่าง 100 แถวแรก
              </div>
            ) : null}
          </div>

          <div
            style={{
              overflowX: "auto",
              border: "1px solid #e5e7eb",
              borderRadius: 16,
              background: "#fff",
            }}
          >
            <table
              style={{
                width: "100%",
                minWidth: 1200,
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr style={{ background: "#f8fafc", color: "#334155" }}>
                  <th style={thStyle}>สถานะ</th>
                  <th style={thStyle}>วันที่คัด</th>
                  <th style={thStyle}>ฟาร์มที่คัด</th>
                  <th style={thStyle}>โรงเรือน</th>
                  <th style={thStyle}>flock</th>
                  <th style={thStyle}>ฟาร์มปลายทาง</th>
                  <th style={thStyle}>เบอร์หมู</th>
                  <th style={thStyle}>วันเกิด</th>
                  <th style={thStyle}>อายุ(วัน)</th>
                  <th style={thStyle}>เต้าซ้าย</th>
                  <th style={thStyle}>เต้าขวา</th>
                  <th style={thStyle}>backfat</th>
                  <th style={thStyle}>น้ำหนัก</th>
                  <th style={thStyle}>หมายเหตุ</th>
                </tr>
              </thead>

              <tbody>
                {previewTop100.length === 0 ? (
                  <tr>
                    <td colSpan={14} style={emptyTdStyle}>
                      ยังไม่มีข้อมูลแสดง
                    </td>
                  </tr>
                ) : (
                  previewTop100.map((row, idx) => (
                    <tr key={`${row.swine_code}-${row.created_at}-${idx}`}>
                      <td style={tdStyle}>
                        <span style={statusBadgeStyle(row.shipment_status)}>
                          {formatStatus(row.shipment_status)}
                        </span>
                      </td>
                      <td style={tdStyle}>{row.selected_date}</td>
                      <td style={tdStyle}>{row.from_farm_name}</td>
                      <td style={tdStyle}>{row.house_no}</td>
                      <td style={tdStyle}>{row.flock}</td>
                      <td style={tdStyle}>{row.to_farm_name}</td>
                      <td style={tdStyle}>{row.swine_code}</td>
                      <td style={tdStyle}>{row.birth_date}</td>
                      <td style={tdStyle}>{row.age_days}</td>
                      <td style={tdStyle}>{row.teats_left}</td>
                      <td style={tdStyle}>{row.teats_right}</td>
                      <td style={tdStyle}>{row.backfat}</td>
                      <td style={tdStyle}>{row.weight}</td>
                      <td style={tdStyle}>{row.remark}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const thStyle = {
  borderBottom: "1px solid #e5e7eb",
  padding: "12px 10px",
  textAlign: "left",
  whiteSpace: "nowrap",
  fontWeight: 800,
};

const tdStyle = {
  borderBottom: "1px solid #e5e7eb",
  padding: "10px",
  textAlign: "left",
  verticalAlign: "top",
  color: "#0f172a",
};

const emptyTdStyle = {
  borderBottom: "1px solid #e5e7eb",
  padding: "28px 12px",
  textAlign: "center",
  color: "#64748b",
  fontWeight: 600,
};