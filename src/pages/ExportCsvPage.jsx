// src/pages/ExportCsvPage.jsx

import React, { useEffect, useMemo, useState } from "react";
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

function statusBadgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "issued") {
    return "bg-slate-100 text-slate-700 border-slate-200";
  }
  if (s === "submitted") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export default function ExportCsvPage() {
  const nav = useNavigate();

  const [pageLoading, setPageLoading] = useState(true);
  const [fromFarmLoading, setFromFarmLoading] = useState(false);
  const [toFarmLoading, setToFarmLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [msg, setMsg] = useState("");

  const [myProfile, setMyProfile] = useState(null);
  const [myRole, setMyRole] = useState("");

  const [selectedDate, setSelectedDate] = useState(todayYmdLocal());
  const [fromFarmCode, setFromFarmCode] = useState("");
  const [toFarmId, setToFarmId] = useState("");

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

  useEffect(() => {
    if (!canUsePage || !selectedDate) {
      setFromFarmOptions([]);
      return;
    }
    loadFromFarmOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUsePage, myRole, selectedDate]);

  useEffect(() => {
    if (!canUsePage || !selectedDate || !fromFarmCode) {
      setToFarmOptions([]);
      return;
    }
    loadToFarmOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUsePage, myRole, selectedDate, fromFarmCode]);

  async function getCurrentUserId() {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    return user?.id || null;
  }

  async function applyRoleFilter(query) {
    if (myRole === "admin") return query;

    const userId = await getCurrentUserId();
    if (!userId) return query.eq("created_by", "__no_user__");

    return query.eq("created_by", userId);
  }

  async function loadFromFarmOptions() {
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
  }

  async function loadToFarmOptions() {
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
  }

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

  async function fetchExportBaseData() {
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
  }

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

  async function refreshPreviewRows() {
    const { shipments, swineMap } = await fetchExportBaseData();
    const rows = buildFlatRows(shipments, swineMap);
    setPreviewRows(rows);
    return { shipments, rows };
  }

  async function handlePreview() {
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
  }

  async function handleExport() {
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
        "สถานะ": formatStatus(r.shipment_status),
        "วันที่คัด": r.selected_date,
        "ฟาร์มที่คัด": r.from_farm_name,
        "โรงเรือน": r.house_no,
        "flock": r.flock,
        "ฟาร์มปลายทาง": r.to_farm_name,
        "เบอร์หมู": r.swine_code,
        "วันเกิด": r.birth_date,
        "อายุ(วัน)": r.age_days,
        "เต้าซ้าย": r.teats_left,
        "เต้าขวา": r.teats_right,
        "backfat": r.backfat,
        "น้ำหนัก": r.weight,
        "หมายเหตุ": r.remark,
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
  }

  async function handleSubmitConfirm() {
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
  }

  function handleDateChange(e) {
    const value = e.target.value;
    setSelectedDate(value);
    setFromFarmCode("");
    setToFarmId("");
    setFromFarmOptions([]);
    setToFarmOptions([]);
    setPreviewRows([]);
    setMsg("");
  }

  function handleFromFarmChange(e) {
    const value = e.target.value;
    setFromFarmCode(value);
    setToFarmId("");
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
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-slate-50 to-white px-4 py-6">
        <div className="mx-auto max-w-7xl rounded-3xl border border-white bg-white/90 p-8 shadow-xl shadow-emerald-100/40">
          <div className="text-slate-700">กำลังโหลด...</div>
        </div>
      </div>
    );
  }

  if (!canUsePage) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-slate-50 to-white px-4 py-6">
        <div className="mx-auto max-w-7xl rounded-3xl border border-white bg-white/90 p-8 shadow-xl shadow-emerald-100/40">
          <div className="text-lg font-semibold text-red-600">ไม่มีสิทธิ์เข้าใช้งาน</div>
          <button
            type="button"
            onClick={() => nav(-1)}
            className="mt-4 rounded-xl bg-slate-800 px-4 py-2 text-white transition hover:bg-slate-900"
          >
            กลับ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-slate-50 to-white px-4 py-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-xl shadow-emerald-100/40">
          <div className="bg-gradient-to-r from-emerald-600 to-emerald-500 px-6 py-5 text-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold">Export CSV</h1>
                <p className="mt-1 text-sm text-emerald-50/95">
                  Role: <span className="font-semibold">{myRole || "-"}</span>
                  {myRole === "admin"
                    ? " — export ได้ทุกข้อมูล"
                    : " — export ได้เฉพาะข้อมูลที่ตัวเองสร้าง"}
                </p>
                <p className="mt-1 text-sm text-emerald-100">
                  แสดงรายการสถานะ submitted และ issued
                </p>
              </div>

              <button
                type="button"
                onClick={() => nav(-1)}
                className="rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-white transition hover:bg-white/20"
              >
                กลับ
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 px-6 py-4">
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
              submitted: {previewStatusCounts.submitted}
            </span>
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
              issued: {previewStatusCounts.issued}
            </span>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-100/60">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="block">
              <div className="mb-1 text-sm font-medium text-slate-700">วันที่คัด</div>
              <input
                type="date"
                value={selectedDate}
                onChange={handleDateChange}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2.5 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-sm font-medium text-slate-700">ฟาร์มที่คัด</div>
              <select
                value={fromFarmCode}
                onChange={handleFromFarmChange}
                disabled={!selectedDate || fromFarmLoading}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2.5 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100"
              >
                <option value="">
                  {fromFarmLoading ? "กำลังโหลด..." : "เลือกฟาร์มที่คัด"}
                </option>
                {fromFarmOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {!fromFarmLoading && selectedDate && fromFarmOptions.length === 0 ? (
                <div className="mt-1 text-xs text-slate-500">
                  ไม่พบฟาร์มที่คัดในวันที่เลือก
                </div>
              ) : null}
            </label>

            <label className="block">
              <div className="mb-1 text-sm font-medium text-slate-700">ฟาร์มปลายทาง</div>
              <select
                value={toFarmId}
                onChange={handleToFarmChange}
                disabled={!selectedDate || !fromFarmCode || toFarmLoading}
                className="w-full rounded-2xl border border-slate-300 px-3 py-2.5 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100"
              >
                <option value="">
                  {toFarmLoading ? "กำลังโหลด..." : "เลือกฟาร์มปลายทาง"}
                </option>
                {toFarmOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {!toFarmLoading &&
              selectedDate &&
              fromFarmCode &&
              toFarmOptions.length === 0 ? (
                <div className="mt-1 text-xs text-slate-500">
                  ไม่พบฟาร์มปลายทางจากเงื่อนไขที่เลือก
                </div>
              ) : null}
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handlePreview}
              disabled={!canQueryRows || previewLoading || exporting || submitting}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {previewLoading ? "กำลังโหลด..." : "แสดงข้อมูล"}
            </button>

            <button
              type="button"
              onClick={handleExport}
              disabled={!canQueryRows || exporting || previewLoading || submitting}
              className="rounded-2xl bg-emerald-600 px-4 py-2.5 font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exporting ? "กำลัง Export..." : "Export CSV"}
            </button>

            <button
              type="button"
              onClick={handleSubmitConfirm}
              disabled={!canQueryRows || submitting || previewLoading || exporting}
              className="rounded-2xl bg-slate-800 px-4 py-2.5 font-medium text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "กำลัง Submit..." : "Submit"}
            </button>
          </div>

          {msg ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {msg}
            </div>
          ) : null}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-100/60">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-lg font-semibold text-slate-900">
              Preview ({previewRows.length} รายการ)
            </div>
            {previewRows.length > 100 ? (
              <div className="text-sm text-slate-500">แสดงตัวอย่าง 100 แถวแรก</div>
            ) : null}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100 text-left text-slate-700">
                  <th className="border px-3 py-2">สถานะ</th>
                  <th className="border px-3 py-2">วันที่คัด</th>
                  <th className="border px-3 py-2">ฟาร์มที่คัด</th>
                  <th className="border px-3 py-2">โรงเรือน</th>
                  <th className="border px-3 py-2">flock</th>
                  <th className="border px-3 py-2">ฟาร์มปลายทาง</th>
                  <th className="border px-3 py-2">เบอร์หมู</th>
                  <th className="border px-3 py-2">วันเกิด</th>
                  <th className="border px-3 py-2">อายุ(วัน)</th>
                  <th className="border px-3 py-2">เต้าซ้าย</th>
                  <th className="border px-3 py-2">เต้าขวา</th>
                  <th className="border px-3 py-2">backfat</th>
                  <th className="border px-3 py-2">น้ำหนัก</th>
                  <th className="border px-3 py-2">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {previewTop100.length === 0 ? (
                  <tr>
                    <td
                      colSpan={14}
                      className="border px-3 py-8 text-center text-slate-500"
                    >
                      ยังไม่มีข้อมูลแสดง
                    </td>
                  </tr>
                ) : (
                  previewTop100.map((row, idx) => (
                    <tr
                      key={`${row.swine_code}-${row.created_at}-${idx}`}
                      className="hover:bg-slate-50"
                    >
                      <td className="border px-3 py-2">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusBadgeClass(
                            row.shipment_status
                          )}`}
                        >
                          {formatStatus(row.shipment_status)}
                        </span>
                      </td>
                      <td className="border px-3 py-2">{row.selected_date}</td>
                      <td className="border px-3 py-2">{row.from_farm_name}</td>
                      <td className="border px-3 py-2">{row.house_no}</td>
                      <td className="border px-3 py-2">{row.flock}</td>
                      <td className="border px-3 py-2">{row.to_farm_name}</td>
                      <td className="border px-3 py-2">{row.swine_code}</td>
                      <td className="border px-3 py-2">{row.birth_date}</td>
                      <td className="border px-3 py-2">{row.age_days}</td>
                      <td className="border px-3 py-2">{row.teats_left}</td>
                      <td className="border px-3 py-2">{row.teats_right}</td>
                      <td className="border px-3 py-2">{row.backfat}</td>
                      <td className="border px-3 py-2">{row.weight}</td>
                      <td className="border px-3 py-2">{row.remark}</td>
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