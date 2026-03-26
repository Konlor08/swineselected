// src/pages/ExportCsvPage.jsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function clean(v) {
  return String(v ?? "").trim();
}

function makeScopeKey(farmCode, flock) {
  return `${clean(farmCode)}||${clean(flock)}`;
}

function emptyShipmentStatusCounts() {
  return { draft: 0, submitted: 0, issued: 0 };
}

function summarizeShipmentStatuses(shipments) {
  const counts = emptyShipmentStatusCounts();
  const seen = new Set();

  for (const shipment of shipments || []) {
    const key = clean(shipment?.id);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const s = String(shipment?.status || "").toLowerCase();
    if (s === "draft") counts.draft += 1;
    if (s === "submitted") counts.submitted += 1;
    if (s === "issued") counts.issued += 1;
  }

  return counts;
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
  if (s === "draft") return "draft";
  if (s === "submitted") return "submitted";
  if (s === "issued") return "issued";
  return s || "-";
}

function statusBadgeStyle(status) {
  const s = String(status || "").toLowerCase();

  if (s === "draft") {
    return {
      display: "inline-flex",
      padding: "4px 10px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 700,
      border: "1px solid #fde68a",
      background: "#fffbeb",
      color: "#92400e",
      whiteSpace: "nowrap",
    };
  }

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
  boxSizing: "border-box",
};

const shellStyle = {
  width: "100%",
  maxWidth: 1280,
  margin: "0 auto",
  display: "grid",
  gap: 16,
  boxSizing: "border-box",
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
};

const cardStyle = {
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: 22,
  padding: 18,
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.05)",
  boxSizing: "border-box",
  minWidth: 0,
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
  minHeight: 44,
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

const thStyle = {
  textAlign: "left",
  padding: "12px 12px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 13,
  fontWeight: 800,
  whiteSpace: "nowrap",
  verticalAlign: "top",
};

const tdStyle = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 13,
  color: "#0f172a",
  verticalAlign: "top",
};

const emptyTdStyle = {
  padding: 18,
  textAlign: "center",
  color: "#64748b",
  fontSize: 14,
};

export default function ExportCsvPage() {
  const nav = useNavigate();

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 768 : false
  );

  const [pageLoading, setPageLoading] = useState(true);
  const [fromFarmLoading, setFromFarmLoading] = useState(false);
  const [toFarmLoading, setToFarmLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [msg, setMsg] = useState("");

  const [myProfile, setMyProfile] = useState(null);
  const [myRole, setMyRole] = useState("");
  const [myScope, setMyScope] = useState([]);

  const [reportType, setReportType] = useState("raw"); // raw | not_selected

  const [dateFrom, setDateFrom] = useState(todayYmdLocal());
  const [dateTo, setDateTo] = useState(todayYmdLocal());

  const [fromFarmCode, setFromFarmCode] = useState("");
  const [toFarmId, setToFarmId] = useState("");
  const [fromFarmQ, setFromFarmQ] = useState("");
  const [toFarmQ, setToFarmQ] = useState("");

  const [fromFarmOptions, setFromFarmOptions] = useState([]);
  const [toFarmOptions, setToFarmOptions] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewShipments, setPreviewShipments] = useState([]);
  const [deliveryDateDrafts, setDeliveryDateDrafts] = useState({});
  const [savingDeliveryDateMap, setSavingDeliveryDateMap] = useState({});

  const authSeqRef = useRef(0);
  const fromFarmReqRef = useRef(0);
  const toFarmReqRef = useRef(0);
  const previewReqRef = useRef(0);

  const isAdmin = String(myRole).toLowerCase() === "admin";
  const isUser = String(myRole).toLowerCase() === "user";
  const isActive = myProfile?.is_active !== false;
  const canUsePage = isActive && (isAdmin || isUser);

  // user และ admin เลือกช่วงวันได้เหมือนกัน
  const effectiveDateFrom = dateFrom;
  const effectiveDateTo = dateTo;

  const myScopeKeySet = useMemo(() => {
    return new Set(
      (myScope || []).map((x) => makeScopeKey(x.farm_code, x.flock)).filter(Boolean)
    );
  }, [myScope]);

  const myFarmCodeSet = useMemo(() => {
    return new Set((myScope || []).map((x) => clean(x.farm_code)).filter(Boolean));
  }, [myScope]);

  const dateRangeValid = useMemo(() => {
    return Boolean(
      effectiveDateFrom &&
        effectiveDateTo &&
        String(effectiveDateFrom) <= String(effectiveDateTo)
    );
  }, [effectiveDateFrom, effectiveDateTo]);

  const canPreviewExport = useMemo(() => {
    if (!dateRangeValid) return false;

    if (reportType === "not_selected") {
      return Boolean(effectiveDateFrom && effectiveDateTo && fromFarmCode);
    }

    return isAdmin
      ? Boolean(effectiveDateFrom && effectiveDateTo)
      : Boolean(
          effectiveDateFrom &&
            effectiveDateTo &&
            fromFarmCode &&
            myFarmCodeSet.has(clean(fromFarmCode))
        );
  }, [
    dateRangeValid,
    reportType,
    effectiveDateFrom,
    effectiveDateTo,
    fromFarmCode,
    isAdmin,
    myFarmCodeSet,
  ]);

  const canSubmitRows =
    reportType === "raw" &&
    (isAdmin
      ? Boolean(
          dateRangeValid &&
            effectiveDateFrom === effectiveDateTo &&
            fromFarmCode &&
            toFarmId
        )
      : Boolean(
          dateRangeValid &&
            effectiveDateFrom === effectiveDateTo &&
            fromFarmCode &&
            toFarmId &&
            myFarmCodeSet.has(clean(fromFarmCode))
        ));

  const showDeliveryDate = reportType === "raw" && Boolean(toFarmId);

  const deliveryDateShipments = useMemo(() => {
    if (reportType !== "raw" || !toFarmId) return [];

    const rows = (previewShipments || []).filter(
      (shipment) => clean(shipment?.to_farm_id) === clean(toFarmId)
    );

    return rows.slice().sort((a, b) => {
      const da = String(a?.selected_date || "");
      const db = String(b?.selected_date || "");
      if (da !== db) return da.localeCompare(db);
      return String(a?.shipment_no || a?.id || "").localeCompare(
        String(b?.shipment_no || b?.id || "")
      );
    });
  }, [previewShipments, reportType, toFarmId]);

  const missingDeliveryDateCount = useMemo(() => {
    return deliveryDateShipments.filter((shipment) => !clean(shipment?.delivery_date)).length;
  }, [deliveryDateShipments]);

  const resetRuntimeState = useCallback(({ keepDates = true } = {}) => {
    setMsg("");
    setMyProfile(null);
    setMyRole("");
    setMyScope([]);
    setReportType("raw");
    if (!keepDates) {
      const today = todayYmdLocal();
      setDateFrom(today);
      setDateTo(today);
    }
    setFromFarmCode("");
    setToFarmId("");
    setFromFarmQ("");
    setToFarmQ("");
    setFromFarmOptions([]);
    setToFarmOptions([]);
    setPreviewRows([]);
    setPreviewShipments([]);
    setDeliveryDateDrafts({});
    setSavingDeliveryDateMap({});
  }, []);

  useEffect(() => {
    setDeliveryDateDrafts((prev) => {
      const next = {};
      const ids = new Set();

      for (const shipment of deliveryDateShipments) {
        const id = clean(shipment?.id);
        if (!id) continue;
        ids.add(id);
        next[id] = Object.prototype.hasOwnProperty.call(prev || {}, id)
          ? prev[id]
          : clean(shipment?.delivery_date);
      }

      const prevKeys = Object.keys(prev || {});
      const sameLength = prevKeys.length === ids.size;
      const sameValues = sameLength && prevKeys.every((k) => ids.has(k) && next[k] === prev[k]);
      return sameValues ? prev : next;
    });
  }, [deliveryDateShipments]);

  const handleDeliveryDateDraftChange = useCallback((shipmentId, value) => {
    const id = clean(shipmentId);
    if (!id) return;

    setDeliveryDateDrafts((prev) => ({
      ...(prev || {}),
      [id]: value,
    }));
  }, []);

  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth <= 768);
    }

    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  async function getCurrentUserId() {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    return user?.id || null;
  }

  const loadMyFarmFlockScope = useCallback(async (userId) => {
    if (!userId) return [];

    const { data, error } = await supabase
      .from("swine_shipments")
      .select("from_farm_code, from_flock")
      .eq("created_by", userId)
      .in("status", ["draft", "submitted", "issued"])
      .order("from_farm_code", { ascending: true });

    if (error) throw error;

    const map = new Map();

    for (const row of data || []) {
      const farmCode = clean(row?.from_farm_code);
      const flock = clean(row?.from_flock);
      if (!farmCode || !flock) continue;

      const key = makeScopeKey(farmCode, flock);
      if (!map.has(key)) {
        map.set(key, {
          farm_code: farmCode,
          flock,
        });
      }
    }

    return Array.from(map.values());
  }, []);

  useEffect(() => {
    let alive = true;

    async function initForCurrentSession() {
      const runId = ++authSeqRef.current;
      setPageLoading(true);
      setMsg("");
      setPreviewRows([]);

      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        if (error) throw error;

        const uid = session?.user?.id || null;
        if (!uid) {
          if (alive && authSeqRef.current === runId) {
            resetRuntimeState();
            setMsg("ไม่พบผู้ใช้งาน กรุณา login ใหม่");
          }
          return;
        }

        const profile = await fetchMyProfile(uid);
        if (!alive || authSeqRef.current !== runId) return;

        setMyProfile(profile || null);
        const role = String(profile?.role || "").toLowerCase();
        setMyRole(role);

        if (profile?.is_active === false) {
          setMyScope([]);
          setMsg("ผู้ใช้งานถูกปิดสิทธิ์");
          return;
        }

        if (role === "admin") {
          setMyScope([]);
          console.log("[ExportCsvPage] init profile", {
            uid,
            profileUserId: profile?.user_id || null,
            role,
            scopeSize: 0,
          });
          return;
        }

        const scope = await loadMyFarmFlockScope(uid);
        if (!alive || authSeqRef.current !== runId) return;
        setMyScope(scope);
        console.log("[ExportCsvPage] init profile", {
          uid,
          profileUserId: profile?.user_id || null,
          role,
          scopeSize: scope.length,
          scope,
        });
      } catch (e) {
        console.error("init ExportCsvPage error:", e);
        if (alive && authSeqRef.current === runId) {
          resetRuntimeState();
          setMsg(e?.message || "โหลดข้อมูลเริ่มต้นไม่สำเร็จ");
        }
      } finally {
        if (alive && authSeqRef.current === runId) {
          setPageLoading(false);
        }
      }
    }

    void initForCurrentSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[ExportCsvPage] auth changed", {
        event,
        uid: session?.user?.id || null,
      });
      resetRuntimeState();
      setPageLoading(true);
      void initForCurrentSession();
    });

    return () => {
      alive = false;
      subscription?.unsubscribe?.();
    };
  }, [loadMyFarmFlockScope, resetRuntimeState]);

  const filterShipmentsByScope = useCallback(
    (shipments) => {
      if (isAdmin) return shipments || [];
      if (!myScopeKeySet.size) return [];

      return (shipments || []).filter((row) =>
        myScopeKeySet.has(makeScopeKey(row?.from_farm_code, row?.from_flock))
      );
    },
    [isAdmin, myScopeKeySet]
  );

  const resetSelectionsAfterDateChange = useCallback(() => {
    previewReqRef.current += 1;
    fromFarmReqRef.current += 1;
    toFarmReqRef.current += 1;
    setFromFarmCode("");
    setToFarmId("");
    setFromFarmQ("");
    setToFarmQ("");
    setFromFarmOptions([]);
    setToFarmOptions([]);
    setPreviewRows([]);
    setPreviewShipments([]);
    setDeliveryDateDrafts({});
    setSavingDeliveryDateMap({});
    setMsg("");
  }, []);

  const loadFromFarmOptions = useCallback(async () => {
    const reqId = ++fromFarmReqRef.current;

    if (!dateRangeValid || !effectiveDateFrom || !effectiveDateTo) {
      if (reqId === fromFarmReqRef.current) setFromFarmOptions([]);
      return;
    }

    setFromFarmLoading(true);

    try {
      const { data, error } = await supabase
        .from("swine_shipments")
        .select("from_farm_code, from_farm_name, from_flock, status, selected_date")
        .gte("selected_date", effectiveDateFrom)
        .lte("selected_date", effectiveDateTo)
        .in("status", ["draft", "submitted", "issued"])
        .order("from_farm_name", { ascending: true });

      if (error) throw error;

      const scopedRows = filterShipmentsByScope(data || []);
      const rows = isAdmin ? data || [] : scopedRows;

      const map = new Map();

      for (const row of rows) {
        const code = clean(row?.from_farm_code);
        const name = clean(row?.from_farm_name);
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

      if (reqId !== fromFarmReqRef.current) return;
      setFromFarmOptions(Array.from(map.values()).sort(sortByLabelTh));
    } catch (e) {
      console.error("loadFromFarmOptions error:", e);
      if (reqId !== fromFarmReqRef.current) return;
      setFromFarmOptions([]);
      setMsg(e?.message || "โหลดรายการฟาร์มที่คัดไม่สำเร็จ");
    } finally {
      if (reqId === fromFarmReqRef.current) setFromFarmLoading(false);
    }
  }, [
    dateRangeValid,
    effectiveDateFrom,
    effectiveDateTo,
    filterShipmentsByScope,
    isAdmin,
  ]);

  const loadToFarmOptions = useCallback(async () => {
    const reqId = ++toFarmReqRef.current;

    if (
      reportType !== "raw" ||
      !dateRangeValid ||
      !effectiveDateFrom ||
      !effectiveDateTo ||
      !fromFarmCode
    ) {
      if (reqId === toFarmReqRef.current) setToFarmOptions([]);
      return;
    }

    setToFarmLoading(true);

    try {
      const { data, error } = await supabase
        .from("swine_shipments")
        .select(`
          from_farm_code,
          from_flock,
          to_farm_id,
          to_farm:master_farms!swine_shipments_to_farm_id_fkey (
            id,
            farm_code,
            farm_name
          )
        `)
        .gte("selected_date", effectiveDateFrom)
        .lte("selected_date", effectiveDateTo)
        .eq("from_farm_code", fromFarmCode)
        .in("status", ["draft", "submitted", "issued"])
        .order("created_at", { ascending: false });

      if (error) throw error;

      const scopedRows = filterShipmentsByScope(data || []);
      const rows = isAdmin ? data || [] : scopedRows;

      const map = new Map();

      for (const row of rows) {
        const id = clean(row?.to_farm_id);
        const farmCode = clean(row?.to_farm?.farm_code);
        const farmName = clean(row?.to_farm?.farm_name);
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

      if (reqId !== toFarmReqRef.current) return;
      setToFarmOptions(Array.from(map.values()).sort(sortByLabelTh));
    } catch (e) {
      console.error("loadToFarmOptions error:", e);
      if (reqId !== toFarmReqRef.current) return;
      setToFarmOptions([]);
      setMsg(e?.message || "โหลดรายการฟาร์มปลายทางไม่สำเร็จ");
    } finally {
      if (reqId === toFarmReqRef.current) setToFarmLoading(false);
    }
  }, [
    reportType,
    dateRangeValid,
    effectiveDateFrom,
    effectiveDateTo,
    fromFarmCode,
    filterShipmentsByScope,
    isAdmin,
  ]);

  useEffect(() => {
    if (!canUsePage || !dateRangeValid || !effectiveDateFrom || !effectiveDateTo) {
      setFromFarmOptions([]);
      return;
    }
    void loadFromFarmOptions();
  }, [
    canUsePage,
    dateRangeValid,
    effectiveDateFrom,
    effectiveDateTo,
    loadFromFarmOptions,
  ]);

  useEffect(() => {
    if (
      !canUsePage ||
      reportType !== "raw" ||
      !dateRangeValid ||
      !effectiveDateFrom ||
      !effectiveDateTo ||
      !fromFarmCode
    ) {
      setToFarmOptions([]);
      return;
    }
    void loadToFarmOptions();
  }, [
    canUsePage,
    reportType,
    dateRangeValid,
    effectiveDateFrom,
    effectiveDateTo,
    fromFarmCode,
    loadToFarmOptions,
  ]);

  async function loadSwineMapByCodes(swineCodes) {
    const uniqueCodes = Array.from(
      new Set((swineCodes || []).map((x) => clean(x)).filter(Boolean))
    );

    if (!uniqueCodes.length) return {};

    const chunks = chunkArray(uniqueCodes, 200);
    const allRows = [];

    for (const chunk of chunks) {
      const { data, error } = await supabase
        .from("swines")
        .select("swine_code, house_no, flock, birth_date, birth_lot, farm_code, farm_name")
        .in("swine_code", chunk);

      if (error) throw error;
      allRows.push(...(data || []));
    }

    const map = {};
    for (const row of allRows) {
      map[clean(row.swine_code)] = row;
    }
    return map;
  }

  async function loadHeatMapByCodes(swineCodes) {
    const uniqueCodes = Array.from(
      new Set((swineCodes || []).map((x) => clean(x)).filter(Boolean))
    );

    if (!uniqueCodes.length) return {};

    const chunks = chunkArray(uniqueCodes, 200);
    const allRows = [];

    for (const chunk of chunks) {
      const { data, error } = await supabase
        .from("swine_heat_report")
        .select(
          "swine_code, heat_1_date, heat_2_date, heat_3_date, heat_4_date, total_heat_count"
        )
        .in("swine_code", chunk);

      if (error) throw error;
      allRows.push(...(data || []));
    }

    const map = {};
    for (const row of allRows) {
      const totalHeat = Number(row?.total_heat_count || 0);
      map[clean(row.swine_code)] = {
        is_heat: totalHeat > 0 ? "Y" : "N",
        total_heat_count: totalHeat,
        heat_1_date: row?.heat_1_date || "",
        heat_2_date: row?.heat_2_date || "",
        heat_3_date: row?.heat_3_date || "",
        heat_4_date: row?.heat_4_date || "",
      };
    }

    return map;
  }

  async function fetchShipmentItemsMap(shipmentIds) {
    const uniqueIds = Array.from(new Set((shipmentIds || []).map((x) => clean(x)).filter(Boolean)));

    if (!uniqueIds.length) return {};

    const chunks = chunkArray(uniqueIds, 200);
    const map = {};

    for (const chunk of chunks) {
      const { data, error } = await supabase
        .from("swine_shipment_items")
        .select("id, shipment_id, swine_code, teats_left, teats_right, backfat, weight")
        .in("shipment_id", chunk);

      if (error) throw error;

      for (const row of data || []) {
        const shipmentId = clean(row?.shipment_id);
        if (!shipmentId) continue;
        if (!map[shipmentId]) map[shipmentId] = [];
        map[shipmentId].push(row);
      }
    }

    return map;
  }

  const fetchExportBaseData = useCallback(async () => {
    if (!dateRangeValid || !effectiveDateFrom || !effectiveDateTo) {
      return { shipments: [], swineMap: {}, heatMap: {} };
    }

    let query = supabase
      .from("swine_shipments")
      .select(`
        id,
        shipment_no,
        selected_date,
        delivery_date,
        from_farm_code,
        from_farm_name,
        from_flock,
        remark,
        to_farm_id,
        status,
        created_at,
        updated_at,
        to_farm:master_farms!swine_shipments_to_farm_id_fkey (
          id,
          farm_code,
          farm_name
        )
      `)
      .gte("selected_date", effectiveDateFrom)
      .lte("selected_date", effectiveDateTo)
      .in("status", ["draft", "submitted", "issued"])
      .order("created_at", { ascending: false });

    if (fromFarmCode) {
      query = query.eq("from_farm_code", fromFarmCode);
    }

    if (reportType === "raw" && toFarmId) {
      query = query.eq("to_farm_id", toFarmId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const scopedHeaders = isAdmin ? data || [] : filterShipmentsByScope(data || []);
    const itemsMap = await fetchShipmentItemsMap(scopedHeaders.map((x) => x.id));

    const shipments = scopedHeaders.map((shipment) => ({
      ...shipment,
      items: itemsMap[clean(shipment?.id)] || [],
    }));

    const allCodes = [];
    for (const shipment of shipments) {
      for (const item of shipment.items || []) {
        if (item?.swine_code) allCodes.push(item.swine_code);
      }
    }

    const [swineMap, heatMap] = await Promise.all([
      loadSwineMapByCodes(allCodes),
      loadHeatMapByCodes(allCodes),
    ]);

    return { shipments, swineMap, heatMap };
  }, [
    dateRangeValid,
    effectiveDateFrom,
    effectiveDateTo,
    fromFarmCode,
    reportType,
    toFarmId,
    isAdmin,
    filterShipmentsByScope,
  ]);

  function buildFlatRows(shipments, swineMap, heatMap, options = {}) {
    const rows = [];
    const deliveryDateEnabled = Boolean(options?.deliveryDateEnabled);

    for (const shipment of shipments || []) {
      for (const item of shipment.items || []) {
        const code = clean(item?.swine_code);
        const swine = swineMap[code] || {};
        const heat = heatMap[code] || {
          is_heat: "N",
          total_heat_count: 0,
          heat_1_date: "",
          heat_2_date: "",
          heat_3_date: "",
          heat_4_date: "",
        };

        rows.push({
          shipment_id: shipment.id || "",
          shipment_no: shipment.shipment_no || "",
          shipment_status: shipment.status || "",
          selected_date: shipment.selected_date || "",
          delivery_date: deliveryDateEnabled ? shipment.delivery_date || "-" : "",
          from_farm_code: shipment.from_farm_code || "",
          from_farm_name: shipment.from_farm_name || "",
          from_flock: shipment.from_flock || "",
          house_no: swine.house_no || "",
          flock: swine.flock || "",
          to_farm_code: shipment.to_farm?.farm_code || "",
          to_farm_name: shipment.to_farm?.farm_name || "",
          swine_code: code,
          birth_date: swine.birth_date || "",
          birth_lot: swine.birth_lot || "",
          age_days: calcAgeDays(shipment.selected_date, swine.birth_date),
          is_heat: heat.is_heat,
          total_heat_count: heat.total_heat_count,
          heat_1_date: heat.heat_1_date,
          heat_2_date: heat.heat_2_date,
          heat_3_date: heat.heat_3_date,
          heat_4_date: heat.heat_4_date,
          teats_left: item?.teats_left ?? "",
          teats_right: item?.teats_right ?? "",
          backfat: item?.backfat ?? "",
          weight: item?.weight ?? "",
          remark: shipment.remark || "",
          created_at: shipment.created_at || "",
          updated_at: shipment.updated_at || "",
        });
      }
    }

    return rows;
  }

  const fetchNotSelectedRows = useCallback(async () => {
    if (!dateRangeValid || !effectiveDateFrom || !effectiveDateTo || !fromFarmCode) {
      return [];
    }

    const allowedScopeRows = isAdmin
      ? []
      : (myScope || []).filter((x) => clean(x.farm_code) === clean(fromFarmCode));

    if (!isAdmin && allowedScopeRows.length === 0) {
      return [];
    }

    const allowedFlockSet = new Set(
      allowedScopeRows.map((x) => clean(x.flock)).filter(Boolean)
    );

    const { data: shipmentHeaders, error: shipmentError } = await supabase
      .from("swine_shipments")
      .select("id, from_farm_code, from_flock, status, selected_date")
      .gte("selected_date", effectiveDateFrom)
      .lte("selected_date", effectiveDateTo)
      .eq("from_farm_code", fromFarmCode)
      .in("status", ["draft", "submitted", "issued"]);

    if (shipmentError) throw shipmentError;

    const scopedHeaders = isAdmin
      ? shipmentHeaders || []
      : (shipmentHeaders || []).filter((row) =>
          allowedFlockSet.has(clean(row?.from_flock))
        );

    const itemsMap = await fetchShipmentItemsMap(scopedHeaders.map((x) => x.id));

    const selectedCodeSet = new Set();

    for (const shipment of scopedHeaders) {
      const items = itemsMap[clean(shipment?.id)] || [];
      for (const item of items) {
        const code = clean(item?.swine_code);
        if (code) selectedCodeSet.add(code);
      }
    }

    const { data: allSwines, error: swineError } = await supabase
      .from("swines")
      .select("id, swine_code, farm_code, farm_name, house_no, flock, birth_date, birth_lot")
      .eq("farm_code", fromFarmCode)
      .order("house_no", { ascending: true })
      .order("swine_code", { ascending: true })
      .limit(10000);

    if (swineError) throw swineError;

    const scopedSwines = isAdmin
      ? allSwines || []
      : (allSwines || []).filter((row) => allowedFlockSet.has(clean(row?.flock)));

    const notSelected = scopedSwines.filter((row) => {
      const code = clean(row?.swine_code);
      if (!code) return false;
      return !selectedCodeSet.has(code);
    });

    const heatMap = await loadHeatMapByCodes(notSelected.map((x) => x.swine_code));

    return notSelected.map((row) => {
      const code = clean(row?.swine_code);
      const heat = heatMap[code] || {
        is_heat: "N",
        total_heat_count: 0,
        heat_1_date: "",
        heat_2_date: "",
        heat_3_date: "",
        heat_4_date: "",
      };

      return {
        farm_code: row?.farm_code || "",
        farm_name: row?.farm_name || "",
        house_no: row?.house_no || "",
        flock: row?.flock || "",
        swine_code: code,
        birth_date: row?.birth_date || "",
        birth_lot: row?.birth_lot || "",
        is_heat: heat.is_heat,
        total_heat_count: heat.total_heat_count,
        heat_1_date: heat.heat_1_date,
        heat_2_date: heat.heat_2_date,
        heat_3_date: heat.heat_3_date,
        heat_4_date: heat.heat_4_date,
      };
    });
  }, [
    dateRangeValid,
    effectiveDateFrom,
    effectiveDateTo,
    fromFarmCode,
    isAdmin,
    myScope,
  ]);

  const refreshPreviewRows = useCallback(async () => {
    const reqId = ++previewReqRef.current;

    if (reportType === "not_selected") {
      const rows = await fetchNotSelectedRows();
      if (reqId === previewReqRef.current) {
        setPreviewRows(rows);
        setPreviewShipments([]);
        console.log("[ExportCsvPage] preview:not_selected", {
          uid: myProfile?.user_id || null,
          myRole,
          fromFarmCode,
          toFarmId,
          rows: rows.length,
          scopeSize: myScope.length,
        });
      }
      return { shipments: [], rows };
    }

    const { shipments, swineMap, heatMap } = await fetchExportBaseData();
    const rows = buildFlatRows(shipments, swineMap, heatMap, {
      deliveryDateEnabled: Boolean(toFarmId),
    });
    if (reqId === previewReqRef.current) {
      setPreviewRows(rows);
      setPreviewShipments(shipments);
      console.log("[ExportCsvPage] preview:raw", {
        uid: myProfile?.user_id || null,
        myRole,
        fromFarmCode,
        toFarmId,
        scopeSize: myScope.length,
        shipments: shipments.length,
        shipmentIds: shipments.map((x) => x.id),
        rows: rows.length,
        itemCountFromShipments: shipments.reduce(
          (sum, shipment) => sum + ((shipment?.items || []).length || 0),
          0
        ),
      });
    }
    return { shipments, rows };
  }, [
    reportType,
    fetchNotSelectedRows,
    fetchExportBaseData,
    myProfile,
    myRole,
    fromFarmCode,
    toFarmId,
    myScope,
  ]);

  const handleSaveDeliveryDate = useCallback(async (shipment) => {
    const shipmentId = clean(shipment?.id);
    const shipmentNo = clean(shipment?.shipment_no) || shipmentId;
    const selectedDate = clean(shipment?.selected_date);
    const targetToFarmId = clean(shipment?.to_farm_id);
    const draftValue = clean(deliveryDateDrafts[shipmentId]);

    if (!shipmentId) {
      setMsg("ไม่พบ shipment ที่ต้องการบันทึกวันที่จัดส่ง");
      return;
    }

    if (!targetToFarmId) {
      setMsg("กรุณาเลือกหรือบันทึกฟาร์มปลายทางก่อน แล้วจึงเพิ่มวันที่จัดส่ง");
      return;
    }

    if (!draftValue) {
      setMsg("กรุณาเลือกวันที่จัดส่งก่อนบันทึก");
      return;
    }

    if (selectedDate && draftValue < selectedDate) {
      setMsg(`วันที่จัดส่งของ ${shipmentNo} ต้องไม่น้อยกว่าวันที่คัด (${selectedDate})`);
      return;
    }

    setSavingDeliveryDateMap((prev) => ({
      ...(prev || {}),
      [shipmentId]: true,
    }));
    setMsg("");

    try {
      const { error } = await supabase
        .from("swine_shipments")
        .update({ delivery_date: draftValue })
        .eq("id", shipmentId);

      if (error) throw error;

      await refreshPreviewRows();
      setMsg(`บันทึกวันที่จัดส่งของ ${shipmentNo} เรียบร้อยแล้ว`);
    } catch (e) {
      console.error("handleSaveDeliveryDate error:", e);
      setMsg(e?.message || "บันทึกวันที่จัดส่งไม่สำเร็จ");
    } finally {
      setSavingDeliveryDateMap((prev) => ({
        ...(prev || {}),
        [shipmentId]: false,
      }));
    }
  }, [deliveryDateDrafts, refreshPreviewRows]);


  const handlePreview = useCallback(async () => {
    if (!canPreviewExport) return;

    setPreviewLoading(true);
    setMsg("");
    setPreviewRows([]);
    setPreviewShipments([]);
    setDeliveryDateDrafts({});
    setSavingDeliveryDateMap({});

    try {
      const { rows } = await refreshPreviewRows();

      if (!rows.length) {
        setMsg(
          reportType === "not_selected"
            ? "ไม่พบเบอร์หมูที่ไม่ถูกคัดตามเงื่อนไขที่เลือก"
            : "ไม่พบข้อมูลตามเงื่อนไขที่เลือก"
        );
      }
    } catch (e) {
      console.error("handlePreview error:", e);
      setPreviewRows([]);
      setPreviewShipments([]);
      setMsg(e?.message || "โหลดตัวอย่างข้อมูลไม่สำเร็จ");
    } finally {
      setPreviewLoading(false);
    }
  }, [canPreviewExport, reportType, refreshPreviewRows]);

  const handleExport = useCallback(async () => {
    if (!canPreviewExport) return;

    setExporting(true);
    setMsg("");

    try {
      if (reportType === "not_selected") {
        const rows = await fetchNotSelectedRows();

        if (!rows.length) {
          setMsg("ไม่พบข้อมูลสำหรับ export");
          return;
        }

        const exportRows = rows.map((r) => ({
          ฟาร์ม: r.farm_name,
          รหัสฟาร์ม: r.farm_code,
          เล้า: r.house_no,
          flock: r.flock,
          เบอร์หมู: r.swine_code,
          วันเกิด: r.birth_date,
          birth_lot: r.birth_lot,
          heat: r.is_heat,
          total_heat_count: r.total_heat_count,
          heat_1_date: r.heat_1_date,
          heat_2_date: r.heat_2_date,
          heat_3_date: r.heat_3_date,
          heat_4_date: r.heat_4_date,
        }));

        const fromFarmText =
          fromFarmOptions.find((x) => x.value === fromFarmCode)?.code ||
          clean(fromFarmCode) ||
          "all";

        const dateText =
          effectiveDateFrom === effectiveDateTo
            ? effectiveDateFrom
            : `${effectiveDateFrom}_to_${effectiveDateTo}`;

        const filename = `swine_not_selected_${dateText}_${fromFarmText}.csv`;

        downloadCsv(filename, exportRows);
        setMsg(`Export สำเร็จ ${exportRows.length} รายการ`);
        return;
      }

      const { shipments, swineMap, heatMap } = await fetchExportBaseData();
      const flatRows = buildFlatRows(shipments, swineMap, heatMap, {
        deliveryDateEnabled: Boolean(toFarmId),
      });

      if (!flatRows.length) {
        setMsg("ไม่พบข้อมูลสำหรับ export");
        return;
      }

      const exportRows = flatRows.map((r) => ({
        สถานะ: formatStatus(r.shipment_status),
        วันที่คัด: r.selected_date,
        ...(showDeliveryDate ? { วันที่จัดส่ง: r.delivery_date } : {}),
        ฟาร์มที่คัด: r.from_farm_name,
        from_flock: r.from_flock,
        ฟาร์มปลายทาง: r.to_farm_name,
        โรงเรือน: r.house_no,
        flock: r.flock,
        เบอร์หมู: r.swine_code,
        วันเกิด: r.birth_date,
        birth_lot: r.birth_lot,
        heat: r.is_heat,
        total_heat_count: r.total_heat_count,
        heat_1_date: r.heat_1_date,
        heat_2_date: r.heat_2_date,
        heat_3_date: r.heat_3_date,
        heat_4_date: r.heat_4_date,
        "อายุ(วัน)": r.age_days,
        เต้าซ้าย: r.teats_left,
        เต้าขวา: r.teats_right,
        backfat: r.backfat,
        น้ำหนัก: r.weight,
        หมายเหตุ: r.remark,
      }));

      const fromFarmText =
        fromFarmOptions.find((x) => x.value === fromFarmCode)?.code ||
        clean(fromFarmCode) ||
        "all";

      const toFarmText =
        toFarmOptions.find((x) => x.value === toFarmId)?.farm_code ||
        clean(toFarmId) ||
        "all";

      const dateText =
        effectiveDateFrom === effectiveDateTo
          ? effectiveDateFrom
          : `${effectiveDateFrom}_to_${effectiveDateTo}`;

      const filename = `swine_export_${dateText}_${fromFarmText}_${toFarmText}.csv`;

      downloadCsv(filename, exportRows);
      setMsg(`Export สำเร็จ ${exportRows.length} รายการ`);
    } catch (e) {
      console.error("handleExport error:", e);
      setMsg(e?.message || "Export CSV ไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  }, [
    canPreviewExport,
    reportType,
    fetchNotSelectedRows,
    fetchExportBaseData,
    fromFarmCode,
    fromFarmOptions,
    effectiveDateFrom,
    effectiveDateTo,
    toFarmId,
    toFarmOptions,
    showDeliveryDate,
  ]);

  const handleSubmitConfirm = useCallback(async () => {
    if (!canSubmitRows) return;

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
          .map((x) => clean(x?.swine_code))
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
  }, [
    canSubmitRows,
    fetchExportBaseData,
    loadFromFarmOptions,
    loadToFarmOptions,
    refreshPreviewRows,
  ]);

  function handleDateFromChange(e) {
    const value = e.target.value;
    setDateFrom(value);
    resetSelectionsAfterDateChange();
  }

  function handleDateToChange(e) {
    const value = e.target.value;
    setDateTo(value);
    resetSelectionsAfterDateChange();
  }

  function handleFromFarmChange(e) {
    previewReqRef.current += 1;
    toFarmReqRef.current += 1;
    const value = e.target.value;
    setFromFarmCode(value);
    setToFarmId("");
    setToFarmQ("");
    setToFarmOptions([]);
    setPreviewRows([]);
    setPreviewShipments([]);
    setMsg("");
  }

  function handleToFarmChange(e) {
    previewReqRef.current += 1;
    const value = e.target.value;
    setToFarmId(value);
    setPreviewRows([]);
    setPreviewShipments([]);
    setMsg("");
  }

  const filteredFromFarmOptions = useMemo(() => {
    const q = clean(fromFarmQ).toLowerCase();
    if (!q) return fromFarmOptions;

    return fromFarmOptions.filter((opt) => {
      const text = `${opt.code || ""} ${opt.name || ""} ${opt.label || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [fromFarmOptions, fromFarmQ]);

  const filteredToFarmOptions = useMemo(() => {
    const q = clean(toFarmQ).toLowerCase();
    if (!q) return toFarmOptions;

    return toFarmOptions.filter((opt) => {
      const text = `${opt.farm_code || ""} ${opt.farm_name || ""} ${opt.label || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [toFarmOptions, toFarmQ]);

  const previewTop100 = useMemo(() => previewRows.slice(0, 100), [previewRows]);

  const previewStatusCounts = useMemo(() => {
    if (reportType !== "raw") {
      return emptyShipmentStatusCounts();
    }

    return summarizeShipmentStatuses(previewShipments);
  }, [previewShipments, reportType]);

  const dateSummaryText = useMemo(() => {
    if (!effectiveDateFrom || !effectiveDateTo) return "-";
    if (effectiveDateFrom === effectiveDateTo) return effectiveDateFrom;
    return `${effectiveDateFrom} ถึง ${effectiveDateTo}`;
  }, [effectiveDateFrom, effectiveDateTo]);


  useEffect(() => {
    console.log("[ExportCsvPage] state", {
      uid: myProfile?.user_id || null,
      myRole,
      reportType,
      fromFarmCode,
      toFarmId,
      scopeSize: myScope.length,
      previewRows: previewRows.length,
      previewShipments: previewShipments.length,
      previewItemCountFromShipments: previewShipments.reduce(
        (sum, shipment) => sum + ((shipment?.items || []).length || 0),
        0
      ),
      fromFarmOptions: fromFarmOptions.length,
      toFarmOptions: toFarmOptions.length,
    });
  }, [
    myProfile,
    myRole,
    reportType,
    fromFarmCode,
    toFarmId,
    myScope,
    previewRows,
    previewShipments,
    fromFarmOptions,
    toFarmOptions,
  ]);

  if (pageLoading) {
    return (
      <div style={{ ...pageWrapStyle, padding: isMobile ? 12 : 16 }}>
        <div style={{ ...shellStyle, padding: isMobile ? "0 2px" : 0 }}>
          <div style={cardStyle}>กำลังโหลด...</div>
        </div>
      </div>
    );
  }

  if (!canUsePage) {
    return (
      <div style={{ ...pageWrapStyle, padding: isMobile ? 12 : 16 }}>
        <div style={{ ...shellStyle, padding: isMobile ? "0 2px" : 0 }}>
          <div style={cardStyle}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#dc2626" }}>
              ไม่มีสิทธิ์เข้าใช้งาน
            </div>
            <button
              type="button"
              onClick={() => nav(-1)}
              style={{
                ...btnDarkStyle,
                marginTop: 14,
                width: isMobile ? "100%" : "auto",
              }}
            >
              กลับ
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...pageWrapStyle, padding: isMobile ? 12 : 16 }}>
      <div
        style={{
          ...shellStyle,
          padding: isMobile ? "0 2px" : 0,
        }}
      >
        <div style={topCardStyle}>
          <div
            style={{
              ...topHeadStyle,
              padding: isMobile ? 16 : 20,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: isMobile ? "column" : "row",
                justifyContent: "space-between",
                alignItems: isMobile ? "stretch" : "flex-start",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: isMobile ? 17 : 18, fontWeight: 900 }}>
                  Export CSV
                </div>
                <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6 }}>
                  Role: <b>{myRole || "-"}</b>
                  {isAdmin
                    ? " — export ได้ทุกข้อมูล และเลือกช่วงวันที่ได้"
                    : " — export ได้เฉพาะฟาร์ม + flock ที่เคยคัด"}
                </div>
                <div style={{ marginTop: 4, fontSize: 13, opacity: 0.95 }}>
                  ประเภทรายงาน:{" "}
                  <b>{reportType === "not_selected" ? "เบอร์หมูที่ไม่ถูกคัด" : "Raw Data"}</b>
                </div>
                <div style={{ marginTop: 4, fontSize: 13, opacity: 0.95 }}>
                  ช่วงวันที่: <b>{dateSummaryText}</b>
                </div>
                {!isAdmin ? (
                  <div style={{ marginTop: 4, fontSize: 13, opacity: 0.95 }}>
                    Scope farm+flock: <b>{myScope.length}</b> คู่
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => nav(-1)}
                style={{
                  ...btnBaseStyle,
                  width: isMobile ? "100%" : "auto",
                  background: "rgba(255,255,255,0.14)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.35)",
                }}
              >
                กลับ
              </button>
            </div>
          </div>

          {reportType === "raw" ? (
            <div
              style={{
                padding: isMobile ? "12px 14px 14px" : "14px 18px 18px",
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
                  border: "1px solid #fde68a",
                  background: "#fffbeb",
                  color: "#92400e",
                }}
              >
                draft: {previewStatusCounts.draft}
              </span>

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
          ) : null}
        </div>

        <div
          style={{
            ...cardStyle,
            padding: isMobile ? 14 : 18,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "1fr"
                : "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 14,
            }}
          >
            <label style={{ display: "block", minWidth: 0 }}>
              <div
                style={{
                  marginBottom: 6,
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#334155",
                }}
              >
                ประเภทรายงาน
              </div>
              <select
                value={reportType}
                onChange={(e) => {
                  setReportType(e.target.value);
                  setPreviewRows([]);
                  setPreviewShipments([]);
                  setMsg("");
                  setToFarmId("");
                  setToFarmQ("");
                }}
                style={inputStyle}
              >
                <option value="raw">Raw Data</option>
                <option value="not_selected">เบอร์หมูที่ไม่ถูกคัด</option>
              </select>
            </label>

            <label style={{ display: "block", minWidth: 0 }}>
              <div
                style={{
                  marginBottom: 6,
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#334155",
                }}
              >
                วันที่เริ่ม
              </div>
              <input
                type="date"
                value={dateFrom}
                onChange={handleDateFromChange}
                style={inputStyle}
              />
            </label>

            <label style={{ display: "block", minWidth: 0 }}>
              <div
                style={{
                  marginBottom: 6,
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#334155",
                }}
              >
                วันที่สิ้นสุด
              </div>
              <input
                type="date"
                value={dateTo}
                onChange={handleDateToChange}
                style={inputStyle}
              />
              {!dateRangeValid ? (
                <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626" }}>
                  วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่ม
                </div>
              ) : null}
            </label>

            <label style={{ display: "block", minWidth: 0 }}>
              <div
                style={{
                  marginBottom: 6,
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#334155",
                }}
              >
                ฟาร์มที่คัด {isAdmin && reportType === "raw" ? "(ไม่บังคับ)" : ""}
              </div>

              <input
                type="text"
                value={fromFarmQ}
                onChange={(e) => setFromFarmQ(e.target.value)}
                placeholder={fromFarmLoading ? "กำลังโหลด..." : "ค้นหา farm code / farm name"}
                disabled={!dateRangeValid || fromFarmLoading}
                style={
                  !dateRangeValid || fromFarmLoading
                    ? { ...disabledInputStyle, marginBottom: 8 }
                    : { ...inputStyle, marginBottom: 8 }
                }
              />

              <select
                value={fromFarmCode}
                onChange={handleFromFarmChange}
                disabled={!dateRangeValid || fromFarmLoading}
                style={!dateRangeValid || fromFarmLoading ? disabledInputStyle : inputStyle}
              >
                <option value="">
                  {fromFarmLoading
                    ? "กำลังโหลด..."
                    : filteredFromFarmOptions.length
                    ? reportType === "not_selected"
                      ? "เลือกฟาร์มที่คัด"
                      : isAdmin
                      ? "ทุกฟาร์มที่คัด / หรือเลือก 1 ฟาร์ม"
                      : "เลือกฟาร์มที่คัด"
                    : "ไม่พบฟาร์มที่คัด"}
                </option>
                {filteredFromFarmOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
                ทั้งหมด {fromFarmOptions.length} รายการ / ตรงคำค้น {filteredFromFarmOptions.length} รายการ
              </div>
            </label>

            {reportType === "raw" ? (
              <label style={{ display: "block", minWidth: 0 }}>
                <div
                  style={{
                    marginBottom: 6,
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#334155",
                  }}
                >
                  ฟาร์มปลายทาง {isAdmin ? "(ไม่บังคับ)" : ""}
                </div>

                <input
                  type="text"
                  value={toFarmQ}
                  onChange={(e) => setToFarmQ(e.target.value)}
                  placeholder={toFarmLoading ? "กำลังโหลด..." : "ค้นหา farm code / farm name"}
                  disabled={!fromFarmCode || toFarmLoading}
                  style={
                    !fromFarmCode || toFarmLoading
                      ? { ...disabledInputStyle, marginBottom: 8 }
                      : { ...inputStyle, marginBottom: 8 }
                  }
                />

                <select
                  value={toFarmId}
                  onChange={handleToFarmChange}
                  disabled={!fromFarmCode || toFarmLoading}
                  style={!fromFarmCode || toFarmLoading ? disabledInputStyle : inputStyle}
                >
                  <option value="">
                    {toFarmLoading
                      ? "กำลังโหลด..."
                      : filteredToFarmOptions.length
                      ? isAdmin
                        ? "ทุกฟาร์มปลายทาง / หรือเลือก 1 ฟาร์ม"
                        : "เลือกฟาร์มปลายทาง"
                      : "ไม่พบฟาร์มปลายทาง"}
                  </option>
                  {filteredToFarmOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div
                style={{
                  display: "block",
                  minWidth: 0,
                  paddingTop: 28,
                  color: "#64748b",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                รายงานนี้ใช้ฟาร์มที่คัด + ช่วงวันที่
                <br />
                เพื่อตรวจว่าเบอร์หมูใดบ้างยังไม่อยู่ใน shipment สถานะ draft/submitted/issued
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: 14,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={handlePreview}
              disabled={!canPreviewExport || previewLoading || exporting || submitting}
              style={{
                ...btnLightStyle,
                width: isMobile ? "100%" : "auto",
                flex: isMobile ? "1 1 100%" : "1 1 160px",
                opacity: !canPreviewExport || previewLoading || exporting || submitting ? 0.6 : 1,
                cursor:
                  !canPreviewExport || previewLoading || exporting || submitting
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {previewLoading ? "กำลังโหลด..." : "แสดงข้อมูล"}
            </button>

            <button
              type="button"
              onClick={handleExport}
              disabled={!canPreviewExport || exporting || previewLoading || submitting}
              style={{
                ...btnGreenStyle,
                width: isMobile ? "100%" : "auto",
                flex: isMobile ? "1 1 100%" : "1 1 160px",
                opacity: !canPreviewExport || exporting || previewLoading || submitting ? 0.6 : 1,
                cursor:
                  !canPreviewExport || exporting || previewLoading || submitting
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {exporting ? "กำลัง Export..." : "Export CSV"}
            </button>

            {reportType === "raw" ? (
              <button
                type="button"
                onClick={handleSubmitConfirm}
                disabled={!canSubmitRows || submitting || previewLoading || exporting}
                style={{
                  ...btnDarkStyle,
                  width: isMobile ? "100%" : "auto",
                  flex: isMobile ? "1 1 100%" : "1 1 160px",
                  opacity: !canSubmitRows || submitting || previewLoading || exporting ? 0.6 : 1,
                  cursor:
                    !canSubmitRows || submitting || previewLoading || exporting
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {submitting ? "กำลัง Submit..." : "Submit"}
              </button>
            ) : null}
          </div>

          {!isAdmin ? (
            <div style={{ marginTop: 12, fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
              User ดูข้อมูลได้ตามฟาร์ม + flock ที่เคยคัด และเลือกช่วงวันที่เพื่อตรวจสอบย้อนหลังได้
              <br />
              แต่ Submit ใช้ได้เฉพาะเมื่อเลือกวันเดียวกัน และเลือกทั้งฟาร์มต้นทางกับฟาร์มปลายทาง
            </div>
          ) : (
            <div style={{ marginTop: 12, fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
              Admin ดูข้อมูลได้ทั้งหมด และเลือกช่วงวันที่ได้
              <br />
              แต่ Submit ใช้ได้เฉพาะเมื่อเลือกวันเดียวกัน และเลือกทั้งฟาร์มต้นทางกับฟาร์มปลายทาง
            </div>
          )}

          {reportType === "raw" && !toFarmId ? (
            <div
              style={{
                marginTop: 14,
                borderRadius: 14,
                padding: "10px 12px",
                fontSize: 13,
                lineHeight: 1.6,
                border: "1px solid #fde68a",
                background: "#fffbeb",
                color: "#92400e",
              }}
            >
              วันที่จัดส่งจะแสดงใน Preview และใน CSV ได้เมื่อเลือกฟาร์มปลายทางแล้วเท่านั้น ถ้ายังไม่บันทึกวันจัดส่ง จะแสดงเป็น -
            </div>
          ) : null}

          {msg ? <div style={{ ...msgStyle, marginTop: 14 }}>{msg}</div> : null}
        </div>


        {reportType === "raw" && toFarmId ? (
          <div
            style={{
              ...cardStyle,
              padding: isMobile ? 14 : 18,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: isMobile ? "stretch" : "center",
                flexDirection: isMobile ? "column" : "row",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>
                  เพิ่มวันที่จัดส่ง
                </div>
                <div style={{ marginTop: 4, fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
                  เลือกฟาร์มปลายทางแล้ว จึงเพิ่มวันที่จัดส่งราย shipment ได้จากหน้านี้
                  {missingDeliveryDateCount > 0
                    ? ` · ยังไม่มีวันที่จัดส่ง ${missingDeliveryDateCount} shipment`
                    : " · ทุก shipment มีวันที่จัดส่งแล้ว"}
                </div>
              </div>
            </div>

            {!deliveryDateShipments.length ? (
              <div
                style={{
                  borderRadius: 14,
                  padding: "12px 14px",
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                  color: "#475569",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                ยังไม่มี shipment ตามเงื่อนไขที่เลือกสำหรับเพิ่มวันที่จัดส่ง กรุณากด “แสดงข้อมูล” ก่อน
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>เลข shipment</th>
                      <th style={thStyle}>สถานะ</th>
                      <th style={thStyle}>วันที่คัด</th>
                      <th style={thStyle}>ฟาร์มปลายทาง</th>
                      <th style={thStyle}>จำนวนตัว</th>
                      <th style={thStyle}>วันที่จัดส่งปัจจุบัน</th>
                      <th style={thStyle}>เพิ่ม/แก้วันที่จัดส่ง</th>
                      <th style={thStyle}>บันทึก</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveryDateShipments.map((shipment) => {
                      const shipmentId = clean(shipment?.id);
                      const currentDeliveryDate = clean(shipment?.delivery_date);
                      const draftValue = deliveryDateDrafts[shipmentId] ?? currentDeliveryDate;
                      const saving = Boolean(savingDeliveryDateMap[shipmentId]);
                      const selectedDate = clean(shipment?.selected_date);
                      const itemCount = Array.isArray(shipment?.items) ? shipment.items.length : 0;
                      const invalidDate = Boolean(draftValue && selectedDate && draftValue < selectedDate);
                      const unchanged = clean(draftValue) === currentDeliveryDate;
                      const canSaveRow = Boolean(
                        shipmentId && clean(shipment?.to_farm_id) && draftValue && !invalidDate && !unchanged && !saving
                      );

                      return (
                        <tr key={shipmentId}>
                          <td style={tdStyle}>{shipment.shipment_no || shipmentId}</td>
                          <td style={tdStyle}>
                            <span style={statusBadgeStyle(shipment.status)}>{formatStatus(shipment.status)}</span>
                          </td>
                          <td style={tdStyle}>{shipment.selected_date || "-"}</td>
                          <td style={tdStyle}>{shipment.to_farm?.farm_name || "-"}</td>
                          <td style={tdStyle}>{itemCount}</td>
                          <td style={tdStyle}>{currentDeliveryDate || "-"}</td>
                          <td style={tdStyle}>
                            <div style={{ display: "grid", gap: 6 }}>
                              <input
                                type="date"
                                value={draftValue || ""}
                                min={selectedDate || undefined}
                                onChange={(e) => handleDeliveryDateDraftChange(shipmentId, e.target.value)}
                                style={inputStyle}
                              />
                              {invalidDate ? (
                                <div style={{ fontSize: 12, color: "#dc2626" }}>
                                  วันที่จัดส่งต้องไม่น้อยกว่าวันที่คัด {selectedDate}
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td style={tdStyle}>
                            <button
                              type="button"
                              onClick={() => handleSaveDeliveryDate(shipment)}
                              disabled={!canSaveRow}
                              style={{
                                ...btnGreenStyle,
                                minHeight: 38,
                                padding: "8px 12px",
                                opacity: canSaveRow ? 1 : 0.6,
                                cursor: canSaveRow ? "pointer" : "not-allowed",
                              }}
                            >
                              {saving ? "กำลังบันทึก..." : currentDeliveryDate ? "อัปเดต" : "บันทึก"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        <div
          style={{
            ...cardStyle,
            padding: isMobile ? 14 : 18,
          }}
        >
          <div
            style={{
              marginBottom: 12,
              display: "flex",
              flexDirection: isMobile ? "column" : "row",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              alignItems: isMobile ? "flex-start" : "center",
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
              WebkitOverflowScrolling: "touch",
              border: "1px solid #e5e7eb",
              borderRadius: 16,
              background: "#fff",
            }}
          >
            <table
              style={{
                width: "100%",
                minWidth:
                  reportType === "not_selected"
                    ? isMobile
                      ? 1100
                      : 1300
                    : isMobile
                    ? 2000
                    : 2450,
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                {reportType === "not_selected" ? (
                  <tr style={{ background: "#f8fafc", color: "#334155" }}>
                    <th style={thStyle}>ฟาร์ม</th>
                    <th style={thStyle}>รหัสฟาร์ม</th>
                    <th style={thStyle}>เล้า</th>
                    <th style={thStyle}>flock</th>
                    <th style={thStyle}>เบอร์หมู</th>
                    <th style={thStyle}>วันเกิด</th>
                    <th style={thStyle}>birth_lot</th>
                    <th style={thStyle}>heat</th>
                    <th style={thStyle}>total_heat_count</th>
                    <th style={thStyle}>heat_1_date</th>
                    <th style={thStyle}>heat_2_date</th>
                    <th style={thStyle}>heat_3_date</th>
                    <th style={thStyle}>heat_4_date</th>
                  </tr>
                ) : (
                  <tr style={{ background: "#f8fafc", color: "#334155" }}>
                    <th style={thStyle}>สถานะ</th>
                    <th style={thStyle}>วันที่คัด</th>
                    {showDeliveryDate ? <th style={thStyle}>วันที่จัดส่ง</th> : null}
                    <th style={thStyle}>ฟาร์มที่คัด</th>
                    <th style={thStyle}>from_flock</th>
                    <th style={thStyle}>ฟาร์มปลายทาง</th>
                    <th style={thStyle}>โรงเรือน</th>
                    <th style={thStyle}>flock</th>
                    <th style={thStyle}>เบอร์หมู</th>
                    <th style={thStyle}>วันเกิด</th>
                    <th style={thStyle}>birth_lot</th>
                    <th style={thStyle}>heat</th>
                    <th style={thStyle}>total_heat_count</th>
                    <th style={thStyle}>heat_1_date</th>
                    <th style={thStyle}>heat_2_date</th>
                    <th style={thStyle}>heat_3_date</th>
                    <th style={thStyle}>heat_4_date</th>
                    <th style={thStyle}>อายุ(วัน)</th>
                    <th style={thStyle}>เต้าซ้าย</th>
                    <th style={thStyle}>เต้าขวา</th>
                    <th style={thStyle}>backfat</th>
                    <th style={thStyle}>น้ำหนัก</th>
                    <th style={thStyle}>หมายเหตุ</th>
                  </tr>
                )}
              </thead>

              <tbody>
                {previewTop100.length === 0 ? (
                  <tr>
                    <td colSpan={reportType === "not_selected" ? 13 : showDeliveryDate ? 23 : 22} style={emptyTdStyle}>
                      ยังไม่มีข้อมูลแสดง
                    </td>
                  </tr>
                ) : reportType === "not_selected" ? (
                  previewTop100.map((row, idx) => (
                    <tr key={`${row.swine_code}-${idx}`}>
                      <td style={tdStyle}>{row.farm_name}</td>
                      <td style={tdStyle}>{row.farm_code}</td>
                      <td style={tdStyle}>{row.house_no}</td>
                      <td style={tdStyle}>{row.flock}</td>
                      <td style={tdStyle}>{row.swine_code}</td>
                      <td style={tdStyle}>{row.birth_date}</td>
                      <td style={tdStyle}>{row.birth_lot}</td>
                      <td style={tdStyle}>{row.is_heat}</td>
                      <td style={tdStyle}>{row.total_heat_count}</td>
                      <td style={tdStyle}>{row.heat_1_date}</td>
                      <td style={tdStyle}>{row.heat_2_date}</td>
                      <td style={tdStyle}>{row.heat_3_date}</td>
                      <td style={tdStyle}>{row.heat_4_date}</td>
                    </tr>
                  ))
                ) : (
                  previewTop100.map((row, idx) => (
                    <tr key={`${row.swine_code}-${row.created_at}-${idx}`}>
                      <td style={tdStyle}>
                        <span style={statusBadgeStyle(row.shipment_status)}>
                          {formatStatus(row.shipment_status)}
                        </span>
                      </td>
                      <td style={tdStyle}>{row.selected_date}</td>
                      {showDeliveryDate ? <td style={tdStyle}>{row.delivery_date}</td> : null}
                      <td style={tdStyle}>{row.from_farm_name}</td>
                      <td style={tdStyle}>{row.from_flock}</td>
                      <td style={tdStyle}>{row.to_farm_name}</td>
                      <td style={tdStyle}>{row.house_no}</td>
                      <td style={tdStyle}>{row.flock}</td>
                      <td style={tdStyle}>{row.swine_code}</td>
                      <td style={tdStyle}>{row.birth_date}</td>
                      <td style={tdStyle}>{row.birth_lot}</td>
                      <td style={tdStyle}>{row.is_heat}</td>
                      <td style={tdStyle}>{row.total_heat_count}</td>
                      <td style={tdStyle}>{row.heat_1_date}</td>
                      <td style={tdStyle}>{row.heat_2_date}</td>
                      <td style={tdStyle}>{row.heat_3_date}</td>
                      <td style={tdStyle}>{row.heat_4_date}</td>
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