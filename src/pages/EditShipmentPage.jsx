// src/pages/EditShipmentPage.jsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchMyProfile } from "../lib/profile";
import { formatDateDisplay } from "../lib/dateFormat";
import FarmPickerInlineAdd from "../components/FarmPickerInlineAdd.jsx";

const ACTIVE_STATUSES = ["draft", "submitted", "issued"];
const PAGE_SIZE = 1000;
const SHIPMENT_ID_CHUNK_SIZE = 500;
const SWINE_CODE_CHUNK_SIZE = 500;

function clean(v) {
  return String(v ?? "").trim();
}

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function withTimeout(promise, ms = 20000, label = "request") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT: ${label}`)), ms)
    ),
  ]);
}

function toIntOrNull(v) {
  const s = clean(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toNumOrNull(v) {
  const s = clean(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function countAffectedRows(data) {
  if (Array.isArray(data)) return data.length;
  if (data) return 1;
  return 0;
}

function ensureAffectedRows(data, label, expectedMin = 1) {
  const affected = countAffectedRows(data);
  if (affected < expectedMin) {
    throw new Error(`NO_ROWS_AFFECTED: ${label}`);
  }
  return affected;
}

function getRawErrorMessage(error) {
  if (!error) return "";
  if (typeof error === "string") return clean(error);
  return clean(
    error?.message ||
      error?.details ||
      error?.hint ||
      error?.error_description ||
      error?.description ||
      ""
  );
}

function isLikelyNetworkError(error) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const raw = getRawErrorMessage(error).toLowerCase();

  return (
    raw.includes("failed to fetch") ||
    raw.includes("fetch failed") ||
    raw.includes("networkerror") ||
    raw.includes("network request failed") ||
    raw.includes("load failed") ||
    raw.includes("err_network") ||
    raw.includes("err_internet_disconnected") ||
    raw.includes("internet disconnected") ||
    raw.includes("connection refused") ||
    raw.includes("connection reset") ||
    raw.includes("dns") ||
    raw.includes("offline")
  );
}

function isLikelyTimeoutError(error) {
  const raw = getRawErrorMessage(error).toLowerCase();
  return raw.includes("timeout") || raw.includes("timed out");
}

function getFriendlyErrorMessage(error, fallback = "เกิดข้อผิดพลาด") {
  if (isLikelyNetworkError(error)) {
    return "เชื่อมต่อ server ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
  }
  if (isLikelyTimeoutError(error)) {
    return "เซิร์ฟเวอร์ตอบกลับช้าเกินไป กรุณาลองใหม่อีกครั้ง";
  }
  return getRawErrorMessage(error) || fallback;
}

function formatActionError(actionLabel, error, fallback = "เกิดข้อผิดพลาด") {
  const detail = getFriendlyErrorMessage(error, fallback);
  return actionLabel ? `${actionLabel}: ${detail}` : detail;
}

function applySelectedDateRange(query, fromDate, toDate) {
  let q = query;
  const from = clean(fromDate);
  const to = clean(toDate);
  if (from) q = q.gte("selected_date", from);
  if (to) q = q.lte("selected_date", to);
  return q;
}

function toMillis(selectedDate, createdAt) {
  const a = createdAt ? Date.parse(createdAt) : NaN;
  if (Number.isFinite(a)) return a;
  const b = selectedDate ? Date.parse(selectedDate) : NaN;
  if (Number.isFinite(b)) return b;
  return 0;
}

function compareLatestDesc(a, b) {
  const diff =
    toMillis(b?.latest_selected_date, b?.latest_created_at) -
    toMillis(a?.latest_selected_date, a?.latest_created_at);

  if (diff !== 0) return diff;

  return String(a?.label || a?.value || "").localeCompare(
    String(b?.label || b?.value || ""),
    "th"
  );
}

function readSavedStepSelection() {
  if (typeof window === "undefined") {
    return {
      fromFarmCode: "",
      fromFlock: "",
      filterDateFrom: "",
      filterDateTo: "",
      swineSearchQ: "",
    };
  }

  try {
    const raw = window.sessionStorage.getItem("editShipmentStepSelection");
    if (!raw) {
      return {
        fromFarmCode: "",
        fromFlock: "",
        filterDateFrom: "",
        filterDateTo: "",
        swineSearchQ: "",
      };
    }

    const parsed = JSON.parse(raw);
    return {
      fromFarmCode: clean(parsed?.fromFarmCode),
      fromFlock: clean(parsed?.fromFlock),
      filterDateFrom: clean(parsed?.filterDateFrom),
      filterDateTo: clean(parsed?.filterDateTo),
      swineSearchQ: clean(parsed?.swineSearchQ),
    };
  } catch {
    return {
      fromFarmCode: "",
      fromFlock: "",
      filterDateFrom: "",
      filterDateTo: "",
      swineSearchQ: "",
    };
  }
}

function saveStepSelection(selection) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      "editShipmentStepSelection",
      JSON.stringify({
        fromFarmCode: clean(selection?.fromFarmCode),
        fromFlock: clean(selection?.fromFlock),
        filterDateFrom: clean(selection?.filterDateFrom),
        filterDateTo: clean(selection?.filterDateTo),
        swineSearchQ: clean(selection?.swineSearchQ),
        savedAt: new Date().toISOString(),
      })
    );
  } catch {
    // ignore
  }
}

function buildDraftFarmData(rows) {
  const farmMap = new Map();

  for (const row of rows || []) {
    const farmCode = clean(row?.from_farm_code);
    const farmName = clean(row?.from_farm_name);
    const flock = clean(row?.from_flock);
    const selectedDate = clean(row?.selected_date);
    const createdAt = clean(row?.created_at);

    if (!farmCode || !flock) continue;

    if (!farmMap.has(farmCode)) {
      farmMap.set(farmCode, {
        farm_code: farmCode,
        farm_name: farmName,
        value: farmCode,
        label: farmName ? `${farmCode} - ${farmName}` : farmCode,
        latest_selected_date: selectedDate,
        latest_created_at: createdAt,
        flock_map: new Map(),
      });
    }

    const farm = farmMap.get(farmCode);

    if (!farm.farm_name && farmName) {
      farm.farm_name = farmName;
      farm.label = `${farmCode} - ${farmName}`;
    }

    if (
      toMillis(selectedDate, createdAt) >
      toMillis(farm.latest_selected_date, farm.latest_created_at)
    ) {
      farm.latest_selected_date = selectedDate;
      farm.latest_created_at = createdAt;
    }

    if (!farm.flock_map.has(flock)) {
      farm.flock_map.set(flock, {
        value: flock,
        label: flock,
        latest_selected_date: selectedDate,
        latest_created_at: createdAt,
      });
    }

    const flockEntry = farm.flock_map.get(flock);

    if (
      toMillis(selectedDate, createdAt) >
      toMillis(flockEntry.latest_selected_date, flockEntry.latest_created_at)
    ) {
      flockEntry.latest_selected_date = selectedDate;
      flockEntry.latest_created_at = createdAt;
    }
  }

  const farmOptions = Array.from(farmMap.values())
    .map((farm) => ({
      ...farm,
      flocks: Array.from(farm.flock_map.values()).sort(compareLatestDesc),
    }))
    .sort(compareLatestDesc);

  return { farmOptions };
}

function getDiscardConfirmMessage(actionText = "ดำเนินการต่อ") {
  return `มีการแก้ไข/กรอกข้อมูลค้างไว้ ต้องการยกเลิกข้อมูลที่ยังไม่บันทึกแล้ว${actionText}ใช่หรือไม่`;
}

function chunkArray(arr, size = 1000) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function fetchAllPages(fetcher, pageSize = PAGE_SIZE) {
  let from = 0;
  const rows = [];

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await fetcher(from, to);
    if (error) throw error;

    const page = Array.isArray(data) ? data : [];
    rows.push(...page);

    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

function qrImageUrl(text) {
  const s = clean(text);
  if (!s) return "";
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(s)}`;
}

const fullInputStyle = {
  width: "100%",
  padding: 10,
  borderRadius: 12,
  border: "1px solid #ddd",
  boxSizing: "border-box",
  minWidth: 0,
};

const smallInputStyle = {
  width: "100%",
  padding: 10,
  borderRadius: 10,
  border: "1px solid #ddd",
  boxSizing: "border-box",
  minWidth: 0,
};

const cardStyle = {
  width: "100%",
  boxSizing: "border-box",
  minWidth: 0,
};

const selectedCardStyle = {
  background: "#fef9c3",
  boxShadow: "inset 0 0 0 1px #fde68a",
};

function QrPreviewBox({ value }) {
  const qrUrl = qrImageUrl(value);

  return (
    <div
      style={{
        height: "100%",
        minHeight: 120,
        border: "4px solid #f2df00",
        borderRadius: 4,
        background: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "grid", gap: 10, justifyItems: "center", width: "100%" }}>
        <img
          src={qrUrl}
          alt={`QR ${value}`}
          style={{
            width: "100%",
            maxWidth: 220,
            aspectRatio: "1 / 1",
            objectFit: "contain",
            display: "block",
            background: "#fff",
          }}
        />
        <div
          style={{
            fontSize: 13,
            fontWeight: 800,
            color: "#374151",
            wordBreak: "break-all",
            textAlign: "center",
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

export default function EditShipmentPage() {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const savedSelection = useMemo(() => readSavedStepSelection(), []);
  const today = todayYmdLocal();

  const initialFarmCode =
    clean(searchParams.get("fromFarmCode")) || clean(savedSelection.fromFarmCode);
  const initialFlock =
    clean(searchParams.get("fromFlock")) || clean(savedSelection.fromFlock);
  const initialDateFrom =
    clean(searchParams.get("fromDate")) || clean(savedSelection.filterDateFrom) || today;
  const initialDateTo =
    clean(searchParams.get("toDate")) || clean(savedSelection.filterDateTo) || today;
  const initialSwineSearchQ =
    clean(searchParams.get("swineCode")) || clean(savedSelection.swineSearchQ);

  const [pageLoading, setPageLoading] = useState(true);
  const [myRole, setMyRole] = useState("");
  const [userId, setUserId] = useState("");
  const [msg, setMsg] = useState("");
  const [bootError, setBootError] = useState("");
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );

  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissionMap, setPermissionMap] = useState({});

  const [loadingDraftOptions, setLoadingDraftOptions] = useState(false);
  const [farmOptions, setFarmOptions] = useState([]);
  const [draftFarmMap, setDraftFarmMap] = useState(new Map());

  const [filterDateFrom, setFilterDateFrom] = useState(initialDateFrom);
  const [filterDateTo, setFilterDateTo] = useState(initialDateTo);
  const [selectedFarmCode, setSelectedFarmCode] = useState(initialFarmCode);
  const [selectedFlock, setSelectedFlock] = useState(initialFlock);

  const [swineSearchQ, setSwineSearchQ] = useState(initialSwineSearchQ);
  const [swineSearchLoading, setSwineSearchLoading] = useState(false);
  const [swineSearchResults, setSwineSearchResults] = useState([]);
  const [selectedSwineResultKey, setSelectedSwineResultKey] = useState("");
  const [swineSearchMode, setSwineSearchMode] = useState("idle");

  const [selectedShipmentId, setSelectedShipmentId] = useState("");
  const [shipmentHeader, setShipmentHeader] = useState(null);
  const [selectedDraftItem, setSelectedDraftItem] = useState(null);
  const [draftOriginalSnapshot, setDraftOriginalSnapshot] = useState(null);

  const [editRemark, setEditRemark] = useState("");
  const [editToFarmId, setEditToFarmId] = useState("");
  const [editToFarmMeta, setEditToFarmMeta] = useState(null);
  const [editDeliveryDate, setEditDeliveryDate] = useState("");

  const [savingDraftItem, setSavingDraftItem] = useState(false);
  const [deletingDraftItem, setDeletingDraftItem] = useState(false);

  const [createToFarmId, setCreateToFarmId] = useState("");
  const [createTeatsLeft, setCreateTeatsLeft] = useState("");
  const [createTeatsRight, setCreateTeatsRight] = useState("");
  const [createBackfat, setCreateBackfat] = useState("");
  const [createWeight, setCreateWeight] = useState("");
  const [creatingQuickShipment, setCreatingQuickShipment] = useState(false);

  const searchRequestRef = useRef(0);

  const canUsePage = myRole === "admin" || myRole === "user";
  const isAdmin = myRole === "admin";
  const permissionsReady = isAdmin || permissionsLoaded;

  const dateRangeInvalid =
    !!filterDateFrom && !!filterDateTo && filterDateFrom > filterDateTo;

  const selectedFarm = useMemo(() => {
    return farmOptions.find((x) => clean(x.value) === clean(selectedFarmCode)) || null;
  }, [farmOptions, selectedFarmCode]);

  const flockOptions = useMemo(() => {
    if (!selectedFarmCode) return [];
    const farm = draftFarmMap.get(clean(selectedFarmCode));
    return Array.isArray(farm?.flocks) ? farm.flocks : [];
  }, [draftFarmMap, selectedFarmCode]);

  const selectedSwineResult = useMemo(() => {
    return (
      swineSearchResults.find((row) => clean(row?.key) === clean(selectedSwineResultKey)) ||
      null
    );
  }, [swineSearchResults, selectedSwineResultKey]);

  const hasDirtyDraftChanges = useMemo(() => {
    if (!selectedSwineResult || selectedSwineResult.source_type !== "draft") {
      return false;
    }
    if (!draftOriginalSnapshot) return false;

    return (
      clean(selectedDraftItem?.teats_left) !== clean(draftOriginalSnapshot?.teats_left) ||
      clean(selectedDraftItem?.teats_right) !== clean(draftOriginalSnapshot?.teats_right) ||
      clean(selectedDraftItem?.backfat) !== clean(draftOriginalSnapshot?.backfat) ||
      clean(selectedDraftItem?.weight) !== clean(draftOriginalSnapshot?.weight) ||
      clean(editRemark) !== clean(draftOriginalSnapshot?.remark) ||
      clean(editToFarmId) !== clean(draftOriginalSnapshot?.to_farm_id) ||
      clean(editDeliveryDate) !== clean(draftOriginalSnapshot?.delivery_date)
    );
  }, [
    selectedSwineResult,
    draftOriginalSnapshot,
    selectedDraftItem,
    editRemark,
    editToFarmId,
    editDeliveryDate,
  ]);

  const hasDirtyCreateChanges = useMemo(() => {
    if (!selectedSwineResult || selectedSwineResult.source_type !== "available") {
      return false;
    }

    return (
      !!clean(createToFarmId) ||
      !!clean(createTeatsLeft) ||
      !!clean(createTeatsRight) ||
      !!clean(createBackfat) ||
      !!clean(createWeight)
    );
  }, [
    selectedSwineResult,
    createToFarmId,
    createTeatsLeft,
    createTeatsRight,
    createBackfat,
    createWeight,
  ]);

  const hasUnsavedEditorChanges = hasDirtyDraftChanges || hasDirtyCreateChanges;

  useEffect(() => {
    function handleOnline() {
      setIsOffline(false);
    }
    function handleOffline() {
      setIsOffline(true);
    }

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      }
    };
  }, []);

  const handleBack = useCallback(() => {
    try {
      if (typeof window !== "undefined" && window.history.length > 1) {
        nav(-1);
        return;
      }
    } catch (e) {
      console.error("handleBack error:", e);
    }

    nav("/", { replace: true });
  }, [nav]);

  const clearQuickCreateForm = useCallback(() => {
    setCreateToFarmId("");
    setCreateTeatsLeft("");
    setCreateTeatsRight("");
    setCreateBackfat("");
    setCreateWeight("");
  }, []);

  const clearDraftEditor = useCallback(() => {
    setSelectedShipmentId("");
    setShipmentHeader(null);
    setSelectedDraftItem(null);
    setDraftOriginalSnapshot(null);
    setEditRemark("");
    setEditToFarmId("");
    setEditToFarmMeta(null);
    setEditDeliveryDate("");
  }, []);

  const clearCurrentSelectionAndEditor = useCallback(() => {
    setSelectedSwineResultKey("");
    clearQuickCreateForm();
    clearDraftEditor();
  }, [clearQuickCreateForm, clearDraftEditor]);

  const confirmDiscardPendingChanges = useCallback(
    (actionText = "ดำเนินการต่อ") => {
      if (!hasUnsavedEditorChanges) return true;
      return window.confirm(getDiscardConfirmMessage(actionText));
    },
    [hasUnsavedEditorChanges]
  );

  useEffect(() => {
    let alive = true;

    async function init() {
      setPageLoading(true);
      setBootError("");
      setMsg("");

      try {
        const { data } = await supabase.auth.getSession();
        const uid = data?.session?.user?.id;

        if (!uid) {
          if (alive) {
            setMyRole("");
            setUserId("");
            setPermissionsLoaded(false);
          }
          return;
        }

        const profile = await fetchMyProfile(uid);
        if (!alive) return;

        const role = String(profile?.role || "user").toLowerCase();
        setMyRole(role);
        setUserId(uid);
        setPermissionsLoaded(role === "admin");
      } catch (e) {
        console.error("EditShipmentPage init error:", e);
        if (alive) {
          const friendly = formatActionError(
            "โหลดข้อมูลเริ่มต้นไม่สำเร็จ",
            e,
            "โหลดข้อมูลเริ่มต้นไม่สำเร็จ"
          );
          setBootError(friendly);
          setMsg(friendly);
        }
      } finally {
        if (alive) setPageLoading(false);
      }
    }

    void init();
    return () => {
      alive = false;
    };
  }, []);

  const loadUserFarmPermissions = useCallback(async () => {
    if (!userId || isAdmin) {
      setPermissionMap({});
      setPermissionsLoaded(true);
      return;
    }

    setPermissionsLoading(true);
    setPermissionsLoaded(false);

    try {
      const { data, error } = await supabase
        .from("swine_shipments")
        .select("from_farm_code, from_farm_name, from_flock, created_at")
        .eq("created_by", userId)
        .order("created_at", { ascending: false })
        .limit(5000);

      if (error) throw error;

      const map = {};
      for (const row of data || []) {
        const farmCode = clean(row?.from_farm_code);
        const farmName = clean(row?.from_farm_name);
        const flock = clean(row?.from_flock);
        if (!farmCode || !flock) continue;

        if (!map[farmCode]) {
          map[farmCode] = {
            farm_code: farmCode,
            farm_name: farmName,
            flocks: [],
          };
        }

        if (!map[farmCode].flocks.includes(flock)) {
          map[farmCode].flocks.push(flock);
        }

        if (!map[farmCode].farm_name && farmName) {
          map[farmCode].farm_name = farmName;
        }
      }

      setPermissionMap(map);
    } catch (e) {
      console.error("loadUserFarmPermissions error:", e);
      setPermissionMap({});
      setMsg(
        formatActionError(
          "โหลดสิทธิ์ฟาร์มของผู้ใช้ไม่สำเร็จ",
          e,
          "โหลดสิทธิ์ฟาร์มของผู้ใช้ไม่สำเร็จ"
        )
      );
    } finally {
      setPermissionsLoading(false);
      setPermissionsLoaded(true);
    }
  }, [userId, isAdmin]);

  useEffect(() => {
    if (!userId) return;
    if (isOffline) return;

    if (isAdmin) {
      setPermissionsLoaded(true);
      return;
    }

    void loadUserFarmPermissions();
  }, [userId, isAdmin, loadUserFarmPermissions, isOffline]);

  const loadDraftFarmOptions = useCallback(async () => {
    if (!permissionsReady || isOffline || dateRangeInvalid) {
      setFarmOptions([]);
      setDraftFarmMap(new Map());
      return;
    }

    setLoadingDraftOptions(true);

    try {
      let query = supabase
        .from("swine_shipments")
        .select(
          "from_farm_code, from_farm_name, from_flock, selected_date, created_at, status"
        )
        .eq("status", "draft")
        .order("selected_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5000);

      query = applySelectedDateRange(query, filterDateFrom, filterDateTo);

      const { data, error } = await query;
      if (error) throw error;

      let rows = data || [];

      if (!isAdmin) {
        rows = rows.filter((row) => {
          const farmCode = clean(row?.from_farm_code);
          const flock = clean(row?.from_flock);
          const allowedFlocks = Array.isArray(permissionMap[farmCode]?.flocks)
            ? permissionMap[farmCode].flocks
            : [];
          return !!farmCode && !!flock && allowedFlocks.includes(flock);
        });
      }

      const built = buildDraftFarmData(rows);
      const mapForState = new Map();
      for (const farm of built.farmOptions) {
        mapForState.set(clean(farm.farm_code), farm);
      }

      setFarmOptions(built.farmOptions);
      setDraftFarmMap(mapForState);
    } catch (e) {
      console.error("loadDraftFarmOptions error:", e);
      setFarmOptions([]);
      setDraftFarmMap(new Map());
      setMsg(
        formatActionError(
          "โหลดรายการฟาร์มและ flock ที่ยัง draft ไม่สำเร็จ",
          e,
          "โหลดรายการฟาร์มและ flock ที่ยัง draft ไม่สำเร็จ"
        )
      );
    } finally {
      setLoadingDraftOptions(false);
    }
  }, [
    permissionsReady,
    isOffline,
    isAdmin,
    permissionMap,
    filterDateFrom,
    filterDateTo,
    dateRangeInvalid,
  ]);

  useEffect(() => {
    if (!canUsePage) return;
    if (!permissionsReady) return;
    if (isOffline) return;
    if (!filterDateFrom || !filterDateTo) return;
    void loadDraftFarmOptions();
  }, [
    canUsePage,
    permissionsReady,
    isOffline,
    filterDateFrom,
    filterDateTo,
    loadDraftFarmOptions,
  ]);

  useEffect(() => {
    if (!farmOptions.length) {
      if (selectedFarmCode) setSelectedFarmCode("");
      return;
    }

    const currentExists = farmOptions.some(
      (x) => clean(x.value) === clean(selectedFarmCode)
    );
    if (currentExists) return;

    const preferred =
      farmOptions.find((x) => clean(x.value) === clean(initialFarmCode)) || null;

    setSelectedFarmCode(clean(preferred?.value) || clean(farmOptions[0]?.value));
  }, [farmOptions, initialFarmCode, selectedFarmCode]);

  useEffect(() => {
    if (!selectedFarmCode) {
      if (selectedFlock) setSelectedFlock("");
      return;
    }

    if (!flockOptions.length) {
      if (selectedFlock) setSelectedFlock("");
      return;
    }

    const currentExists = flockOptions.some(
      (x) => clean(x.value) === clean(selectedFlock)
    );
    if (currentExists) return;

    const preferred =
      flockOptions.find((x) => clean(x.value) === clean(initialFlock)) || null;

    setSelectedFlock(clean(preferred?.value) || clean(flockOptions[0]?.value));
  }, [selectedFarmCode, flockOptions, initialFlock, selectedFlock]);

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);

        if (clean(filterDateFrom)) next.set("fromDate", clean(filterDateFrom));
        else next.delete("fromDate");

        if (clean(filterDateTo)) next.set("toDate", clean(filterDateTo));
        else next.delete("toDate");

        if (clean(selectedFarmCode)) next.set("fromFarmCode", clean(selectedFarmCode));
        else next.delete("fromFarmCode");

        if (clean(selectedFlock)) next.set("fromFlock", clean(selectedFlock));
        else next.delete("fromFlock");

        if (clean(swineSearchQ)) next.set("swineCode", clean(swineSearchQ));
        else next.delete("swineCode");

        return next;
      },
      { replace: true }
    );
  }, [
    filterDateFrom,
    filterDateTo,
    selectedFarmCode,
    selectedFlock,
    swineSearchQ,
    setSearchParams,
  ]);

  useEffect(() => {
    saveStepSelection({
      fromFarmCode: selectedFarmCode,
      fromFlock: selectedFlock,
      filterDateFrom,
      filterDateTo,
      swineSearchQ,
    });
  }, [filterDateFrom, filterDateTo, selectedFarmCode, selectedFlock, swineSearchQ]);

  const userCanAccessShipment = useCallback(
    (shipment) => {
      if (isAdmin) return true;
      const farmCode = clean(shipment?.from_farm_code);
      const flock = clean(shipment?.from_flock);
      if (!farmCode || !flock) return false;

      const allowedFlocks = Array.isArray(permissionMap[farmCode]?.flocks)
        ? permissionMap[farmCode].flocks
        : [];
      return allowedFlocks.includes(flock);
    },
    [isAdmin, permissionMap]
  );

  const deleteEmptyDraftHeader = useCallback(async (shipmentId) => {
    const id = clean(shipmentId);
    if (!id) return;

    try {
      const { count, error: countError } = await supabase
        .from("swine_shipment_items")
        .select("id", { count: "exact", head: true })
        .eq("shipment_id", id);

      if (countError) throw countError;
      if ((count || 0) > 0) return;

      const { error } = await supabase
        .from("swine_shipments")
        .delete()
        .eq("id", id)
        .eq("status", "draft");

      if (error) throw error;
    } catch (cleanupError) {
      console.warn("deleteEmptyDraftHeader warning:", cleanupError);
    }
  }, []);

  const findReusableDraftHeader = useCallback(async () => {
    if (!clean(userId)) return null;
    if (!clean(selectedFarmCode)) return null;
    if (!clean(selectedFlock)) return null;
    if (!clean(createToFarmId)) return null;
    if (!clean(selectedSwineResult?.house_no)) return null;

    const { data, error } = await supabase
      .from("swine_shipments")
      .select("id")
      .eq("created_by", userId)
      .eq("status", "draft")
      .eq("selected_date", today)
      .eq("from_farm_code", clean(selectedFarmCode))
      .eq("from_flock", clean(selectedFlock))
      .eq("to_farm_id", clean(createToFarmId))
      .eq("source_house_no", clean(selectedSwineResult?.house_no))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data?.id || null;
  }, [userId, selectedFarmCode, selectedFlock, createToFarmId, selectedSwineResult?.house_no, today]);

  const openDraftShipmentForSwine = useCallback(
    async (shipmentId, swineCode, opts = {}) => {
      const { silent = false } = opts;
      if (!shipmentId || !swineCode) return;

      if (isOffline) {
        if (!silent) {
          setMsg(
            "เปิด shipment ไม่ได้: เชื่อมต่อ server ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"
          );
        }
        return;
      }

      setSelectedShipmentId(shipmentId);
      if (!silent) setMsg("");

      try {
        const { data, error } = await supabase
          .from("swine_shipments")
          .select(`
            id,
            shipment_no,
            selected_date,
            delivery_date,
            from_farm_code,
            from_farm_name,
            from_flock,
            to_farm_id,
            remark,
            status,
            created_at,
            updated_at,
            to_farm:master_farms!swine_shipments_to_farm_id_fkey (
              id,
              farm_code,
              farm_name
            ),
            items:swine_shipment_items (
              id,
              selection_no,
              swine_id,
              swine_code,
              teats_left,
              teats_right,
              backfat,
              weight,
              swine:swines!swine_shipment_items_swine_id_fkey (
                id,
                house_no,
                flock,
                birth_date
              )
            )
          `)
          .eq("id", shipmentId)
          .eq("status", "draft")
          .single();

        if (error) throw error;
        if (!data) throw new Error("ไม่พบ shipment");
        if (!userCanAccessShipment(data)) {
          throw new Error("คุณไม่มีสิทธิ์เข้าถึง shipment นี้");
        }

        const item = (data.items || []).find(
          (x) => clean(x.swine_code) === clean(swineCode)
        );
        if (!item) throw new Error("ไม่พบรายการหมูใน shipment นี้");

        setShipmentHeader(data);
        setEditRemark(data.remark || "");
        setEditToFarmId(clean(data.to_farm_id));
        setEditToFarmMeta(data.to_farm || null);
        setEditDeliveryDate(clean(data.delivery_date));

        const draftItemState = {
          id: item.id,
          swine_id: item.swine_id,
          swine_code: clean(item.swine_code),
          selection_no: item.selection_no ?? null,
          house_no: clean(item.swine?.house_no),
          flock: clean(item.swine?.flock),
          birth_date: item.swine?.birth_date || "",
          teats_left: item.teats_left ?? "",
          teats_right: item.teats_right ?? "",
          backfat: item.backfat ?? "",
          weight: item.weight ?? "",
        };

        setSelectedDraftItem(draftItemState);
        setDraftOriginalSnapshot({
          teats_left: draftItemState.teats_left,
          teats_right: draftItemState.teats_right,
          backfat: draftItemState.backfat,
          weight: draftItemState.weight,
          remark: data.remark || "",
          to_farm_id: clean(data.to_farm_id),
          delivery_date: clean(data.delivery_date),
        });
      } catch (e) {
        console.error("openDraftShipmentForSwine error:", e);
        clearDraftEditor();
        if (!silent) {
          setMsg(
            formatActionError(
              "เปิดรายการคัดไม่สำเร็จ",
              e,
              "เปิดรายการคัดไม่สำเร็จ"
            )
          );
        }
      }
    },
    [isOffline, userCanAccessShipment, clearDraftEditor]
  );

  useEffect(() => {
    let alive = true;

    async function loadEditToFarmMeta() {
      if (!editToFarmId) {
        setEditToFarmMeta(null);
        return;
      }

      if (isOffline) {
        if (
          clean(shipmentHeader?.to_farm_id) === clean(editToFarmId) &&
          shipmentHeader?.to_farm
        ) {
          setEditToFarmMeta(shipmentHeader.to_farm);
        }
        return;
      }

      try {
        const { data, error } = await supabase
          .from("master_farms")
          .select("id, farm_code, farm_name")
          .eq("id", editToFarmId)
          .single();

        if (!alive) return;
        if (error) throw error;
        setEditToFarmMeta(data || null);
      } catch (e) {
        console.error("loadEditToFarmMeta error:", e);
        if (alive) {
          setEditToFarmMeta(null);
          setMsg(
            formatActionError(
              "โหลดข้อมูลฟาร์มปลายทางไม่สำเร็จ",
              e,
              "โหลดข้อมูลฟาร์มปลายทางไม่สำเร็จ"
            )
          );
        }
      }
    }

    void loadEditToFarmMeta();
    return () => {
      alive = false;
    };
  }, [editToFarmId, isOffline, shipmentHeader]);

  const findBlockingShipmentsBySwineCodes = useCallback(
    async (swineCodes, excludeShipmentId = "") => {
      const cleanCodes = Array.from(new Set((swineCodes || []).map(clean).filter(Boolean)));
      const blockingMap = new Map();
      if (!cleanCodes.length) return blockingMap;

      for (const codeChunk of chunkArray(cleanCodes, SWINE_CODE_CHUNK_SIZE)) {
        const itemRows = await fetchAllPages((from, to) =>
          supabase
            .from("swine_shipment_items")
            .select("shipment_id, swine_code")
            .in("swine_code", codeChunk)
            .order("shipment_id", { ascending: true })
            .range(from, to)
        );

        const shipmentIds = Array.from(
          new Set(
            (itemRows || [])
              .map((x) => clean(x?.shipment_id))
              .filter((id) => id && id !== clean(excludeShipmentId))
          )
        );

        const shipmentMap = new Map();

        for (const idChunk of chunkArray(shipmentIds, SHIPMENT_ID_CHUNK_SIZE)) {
          if (!idChunk.length) continue;

          const { data: shipmentRows, error: shipmentError } = await supabase
            .from("swine_shipments")
            .select(
              "id, status, selected_date, created_at, created_by, from_farm_code, from_farm_name, from_flock, source_house_no, shipment_no"
            )
            .in("id", idChunk)
            .in("status", ACTIVE_STATUSES);

          if (shipmentError) throw shipmentError;

          for (const sh of shipmentRows || []) {
            if (userCanAccessShipment(sh) || clean(sh?.status) !== "draft") {
              shipmentMap.set(clean(sh?.id), sh);
            }
          }
        }

        for (const item of itemRows || []) {
          const code = clean(item?.swine_code);
          const shipmentId = clean(item?.shipment_id);
          if (!code || !shipmentId || shipmentId === clean(excludeShipmentId)) continue;
          const shipment = shipmentMap.get(shipmentId);
          if (!shipment) continue;

          if (!blockingMap.has(code)) {
            blockingMap.set(code, shipment);
          }
        }
      }

      return blockingMap;
    },
    [userCanAccessShipment]
  );

  const handleSelectSearchResult = useCallback(
    async (row) => {
      if (!row) return;
      if (!confirmDiscardPendingChanges("เปิดรายการใหม่")) return;

      setSelectedSwineResultKey(clean(row.key));
      clearQuickCreateForm();
      clearDraftEditor();

      if (row.source_type === "draft" && Array.isArray(row.draft_matches) && row.draft_matches.length === 1) {
        await openDraftShipmentForSwine(row.draft_matches[0].shipment_id, row.swine_code, {
          silent: true,
        });
      }
    },
    [confirmDiscardPendingChanges, clearDraftEditor, clearQuickCreateForm, openDraftShipmentForSwine]
  );

  const runSwineSearch = useCallback(
    async (queryText) => {
      const q = clean(queryText);

      if (
        !q ||
        isOffline ||
        !selectedFarmCode ||
        !selectedFlock ||
        !filterDateFrom ||
        !filterDateTo ||
        dateRangeInvalid
      ) {
        setSwineSearchLoading(false);
        setSwineSearchResults([]);
        setSelectedSwineResultKey("");
        setSwineSearchMode("idle");
        return;
      }

      const requestId = ++searchRequestRef.current;
      setSwineSearchLoading(true);

      try {
        let shipmentQuery = supabase
          .from("swine_shipments")
          .select(
            "id, shipment_no, selected_date, created_at, from_farm_code, from_farm_name, from_flock, status"
          )
          .eq("status", "draft")
          .eq("from_farm_code", selectedFarmCode)
          .eq("from_flock", selectedFlock)
          .order("selected_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(5000);

        shipmentQuery = applySelectedDateRange(
          shipmentQuery,
          filterDateFrom,
          filterDateTo
        );

        const { data: shipmentRows, error: shipmentError } = await shipmentQuery;
        if (shipmentError) throw shipmentError;
        if (requestId !== searchRequestRef.current) return;

        const shipmentList = (shipmentRows || []).filter((row) => userCanAccessShipment(row));
        const shipmentMap = new Map(shipmentList.map((row) => [clean(row.id), row]));
        const shipmentIds = shipmentList.map((row) => row.id).filter(Boolean);

        if (shipmentIds.length > 0) {
          const { data: itemRowsResult, error: itemError } = await supabase
            .from("swine_shipment_items")
            .select(`
              id,
              swine_id,
              swine_code,
              shipment_id,
              swine:swines!swine_shipment_items_swine_id_fkey (
                id,
                house_no
              )
            `)
            .in("shipment_id", shipmentIds)
            .ilike("swine_code", `%${q}%`)
            .order("swine_code", { ascending: true })
            .limit(200);

          if (itemError) throw itemError;
          if (requestId !== searchRequestRef.current) return;

          const resultMap = new Map();

          for (const row of itemRowsResult || []) {
            const swineCode = clean(row?.swine_code);
            const shipmentId = clean(row?.shipment_id);
            const shipment = shipmentMap.get(shipmentId);
            if (!swineCode || !shipment) continue;

            if (!resultMap.has(swineCode)) {
              resultMap.set(swineCode, {
                key: `draft:${swineCode}`,
                source_type: "draft",
                swine_id: row?.swine_id || "",
                swine_code: swineCode,
                house_no: clean(row?.swine?.house_no),
                draft_matches: [],
              });
            }

            const entry = resultMap.get(swineCode);
            const exists = entry.draft_matches.some(
              (x) => clean(x.shipment_id) === shipmentId
            );

            if (!exists) {
              entry.draft_matches.push({
                shipment_id: shipmentId,
                shipment_no: clean(shipment?.shipment_no),
                selected_date: clean(shipment?.selected_date),
                created_at: clean(shipment?.created_at),
              });
            }
          }

          const draftResults = Array.from(resultMap.values())
            .map((row) => ({
              ...row,
              draft_match_count: row.draft_matches.length,
            }))
            .sort((a, b) =>
              String(a.swine_code).localeCompare(String(b.swine_code), "th")
            );

          if (draftResults.length > 0) {
            setSwineSearchResults(draftResults);
            setSelectedSwineResultKey((prev) => {
              const exists = draftResults.some((row) => clean(row?.key) === clean(prev));
              return exists ? prev : "";
            });
            setSwineSearchMode("draft");
            return;
          }
        }

        const { data: swineRows, error: swineError } = await supabase
          .from("swines")
          .select("id, swine_code, house_no, farm_code, flock, birth_date")
          .eq("farm_code", selectedFarmCode)
          .eq("flock", selectedFlock)
          .ilike("swine_code", `%${q}%`)
          .order("swine_code", { ascending: true })
          .limit(200);

        if (swineError) throw swineError;
        if (requestId !== searchRequestRef.current) return;

        const candidateRows = (swineRows || []).map((row) => ({
          ...row,
          swine_code: clean(row?.swine_code),
        }));
        const candidateCodes = candidateRows.map((row) => clean(row?.swine_code)).filter(Boolean);

        if (candidateCodes.length > 0) {
          const blockingMap = await findBlockingShipmentsBySwineCodes(candidateCodes);
          if (requestId !== searchRequestRef.current) return;

          const availableResults = candidateRows
            .filter((row) => !blockingMap.has(clean(row?.swine_code)))
            .map((row) => ({
              key: `available:${clean(row?.id) || clean(row?.swine_code)}`,
              source_type: "available",
              swine_id: row?.id || "",
              swine_code: clean(row?.swine_code),
              house_no: clean(row?.house_no),
              flock: clean(row?.flock),
              birth_date: row?.birth_date || "",
              draft_matches: [],
              draft_match_count: 0,
            }))
            .sort((a, b) =>
              String(a.swine_code).localeCompare(String(b.swine_code), "th")
            );

          if (availableResults.length > 0) {
            setSwineSearchResults(availableResults);
            setSelectedSwineResultKey((prev) => {
              const exists = availableResults.some((row) => clean(row?.key) === clean(prev));
              return exists ? prev : "";
            });
            setSwineSearchMode("available");
            return;
          }

          const blockedResults = candidateRows
            .filter((row) => blockingMap.has(clean(row?.swine_code)))
            .map((row) => {
              const blocking = blockingMap.get(clean(row?.swine_code));
              return {
                key: `blocked:${clean(row?.id) || clean(row?.swine_code)}`,
                source_type: "blocked",
                swine_id: row?.id || "",
                swine_code: clean(row?.swine_code),
                house_no: clean(row?.house_no),
                flock: clean(row?.flock),
                birth_date: row?.birth_date || "",
                blocking_status: clean(blocking?.status),
                blocking_selected_date: clean(blocking?.selected_date),
                blocking_shipment_id: clean(blocking?.id),
                blocking_shipment_no: clean(blocking?.shipment_no),
              };
            })
            .sort((a, b) =>
              String(a.swine_code).localeCompare(String(b.swine_code), "th")
            );

          if (blockedResults.length > 0) {
            setSwineSearchResults(blockedResults);
            setSelectedSwineResultKey("");
            setSwineSearchMode("blocked");
            return;
          }
        }

        setSwineSearchResults([]);
        setSelectedSwineResultKey("");
        setSwineSearchMode("none");
      } catch (e) {
        if (requestId !== searchRequestRef.current) return;
        console.error("runSwineSearch error:", e);
        setSwineSearchResults([]);
        setSelectedSwineResultKey("");
        setSwineSearchMode("none");
        setMsg(
          formatActionError(
            "ค้นหาเบอร์หมูไม่สำเร็จ",
            e,
            "ค้นหาเบอร์หมูไม่สำเร็จ"
          )
        );
      } finally {
        if (requestId === searchRequestRef.current) {
          setSwineSearchLoading(false);
        }
      }
    },
    [
      dateRangeInvalid,
      filterDateFrom,
      filterDateTo,
      isOffline,
      selectedFarmCode,
      selectedFlock,
      userCanAccessShipment,
      findBlockingShipmentsBySwineCodes,
    ]
  );

  useEffect(() => {
    const q = clean(swineSearchQ);

    if (!q || !selectedFarmCode || !selectedFlock || dateRangeInvalid) {
      searchRequestRef.current += 1;
      setSwineSearchLoading(false);
      setSwineSearchResults([]);
      setSelectedSwineResultKey("");
      setSwineSearchMode("idle");
      return;
    }

    const timer = window.setTimeout(() => {
      void runSwineSearch(q);
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [swineSearchQ, selectedFarmCode, selectedFlock, dateRangeInvalid, runSwineSearch]);

  async function handleSaveDraftSelectedSwine() {
    if (!shipmentHeader?.id || !selectedDraftItem?.id) {
      setMsg("ไม่พบรายการ draft ที่ต้องการบันทึก");
      return;
    }

    setSavingDraftItem(true);
    setMsg("");

    try {
      const nowIso = new Date().toISOString();

      const headerRes = await withTimeout(
        supabase
          .from("swine_shipments")
          .update({
            to_farm_id: clean(editToFarmId) || null,
            remark: clean(editRemark) || null,
            delivery_date: clean(editDeliveryDate) || null,
            updated_at: nowIso,
          })
          .eq("id", shipmentHeader.id)
          .eq("status", "draft")
          .select("id"),
        15000,
        "update shipment header"
      );

      if (headerRes.error) throw headerRes.error;
      ensureAffectedRows(headerRes.data, "update shipment header");

      const itemRes = await withTimeout(
        supabase
          .from("swine_shipment_items")
          .update({
            teats_left: toIntOrNull(selectedDraftItem.teats_left),
            teats_right: toIntOrNull(selectedDraftItem.teats_right),
            backfat: toNumOrNull(selectedDraftItem.backfat),
            weight: toNumOrNull(selectedDraftItem.weight),
            updated_at: nowIso,
          })
          .eq("id", selectedDraftItem.id)
          .select("id"),
        15000,
        "update selected swine item"
      );

      if (itemRes.error) throw itemRes.error;
      ensureAffectedRows(itemRes.data, "update selected swine item");

      setMsg("บันทึกข้อมูลสำเร็จ ✅");

      const currentSearch = clean(swineSearchQ);
      clearCurrentSelectionAndEditor();
      if (currentSearch) {
        await runSwineSearch(currentSearch);
      }
    } catch (e) {
      console.error("handleSaveDraftSelectedSwine error:", e);
      setMsg(
        formatActionError(
          "บันทึกรายการหมูไม่สำเร็จ",
          e,
          "บันทึกรายการหมูไม่สำเร็จ"
        )
      );
    } finally {
      setSavingDraftItem(false);
    }
  }

  async function handleDeleteDraftSelectedSwine() {
    if (!shipmentHeader?.id || !selectedDraftItem?.id) {
      setMsg("ไม่พบรายการหมูที่ต้องการลบ");
      return;
    }

    if (
      !window.confirm(`ลบหมู ${selectedDraftItem.swine_code} ออกจาก shipment นี้ใช่หรือไม่`)
    ) {
      return;
    }

    setDeletingDraftItem(true);
    setMsg("");

    try {
      const deleteRes = await withTimeout(
        supabase
          .from("swine_shipment_items")
          .delete()
          .eq("id", selectedDraftItem.id)
          .select("id"),
        15000,
        "delete selected swine item"
      );

      if (deleteRes.error) throw deleteRes.error;
      ensureAffectedRows(deleteRes.data, "delete selected swine item");

      await deleteEmptyDraftHeader(shipmentHeader.id);

      setMsg("ลบหมูออกจาก shipment สำเร็จ ✅");

      const currentSearch = clean(swineSearchQ);
      clearCurrentSelectionAndEditor();
      if (currentSearch) {
        await runSwineSearch(currentSearch);
      }
    } catch (e) {
      console.error("handleDeleteDraftSelectedSwine error:", e);
      setMsg(
        formatActionError(
          "ลบหมูออกจาก shipment ไม่สำเร็จ",
          e,
          "ลบหมูออกจาก shipment ไม่สำเร็จ"
        )
      );
    } finally {
      setDeletingDraftItem(false);
    }
  }

  async function handleCreateQuickShipment() {
    if (isOffline) {
      setMsg(
        "บันทึกไม่สำเร็จ: เชื่อมต่อ server ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"
      );
      return;
    }

    if (!selectedSwineResult || selectedSwineResult.source_type !== "available") {
      setMsg("กรุณาเลือกเบอร์หมูที่ยังคัดได้ก่อน");
      return;
    }

    if (!clean(createToFarmId)) {
      setMsg("กรุณาเลือกฟาร์มที่จะส่ง");
      return;
    }

    setCreatingQuickShipment(true);
    setMsg("");

    let createdShipmentId = "";
    let createdNewHeader = false;

    try {
      const swineCode = clean(selectedSwineResult.swine_code);
      const blockingMap = await findBlockingShipmentsBySwineCodes([swineCode]);
      const blocking = blockingMap.get(swineCode);

      if (blocking) {
        throw new Error(
          `เบอร์ ${swineCode} อยู่ใน shipment สถานะ ${clean(blocking.status) || "-"} แล้ว`
        );
      }

      const reusableId = await findReusableDraftHeader();
      let shipmentId = clean(reusableId);

      if (!shipmentId) {
        const nowIso = new Date().toISOString();

        const headerRes = await withTimeout(
          supabase
            .from("swine_shipments")
            .insert({
              created_by: userId || null,
              created_at: nowIso,
              updated_at: nowIso,
              status: "draft",
              selected_date: today,
              from_farm_code: clean(selectedFarmCode),
              from_farm_name: clean(selectedFarm?.farm_name || selectedFarm?.label),
              from_flock: clean(selectedFlock),
              to_farm_id: clean(createToFarmId),
              source_house_no: clean(selectedSwineResult.house_no) || null,
              remark: null,
              delivery_date: null,
              reservation_status: "consumed",
            })
            .select("id")
            .single(),
          15000,
          "create quick shipment header"
        );

        if (headerRes.error) throw headerRes.error;
        shipmentId = clean(headerRes.data?.id);
        if (!shipmentId) throw new Error("สร้าง shipment ใหม่ไม่สำเร็จ");
        createdShipmentId = shipmentId;
        createdNewHeader = true;
      }

      const itemRes = await withTimeout(
        supabase
          .from("swine_shipment_items")
          .insert({
            shipment_id: shipmentId,
            swine_id: selectedSwineResult.swine_id || null,
            swine_code: swineCode,
            selection_no: 1,
            teats_left: toIntOrNull(createTeatsLeft),
            teats_right: toIntOrNull(createTeatsRight),
            backfat: toNumOrNull(createBackfat),
            weight: toNumOrNull(createWeight),
            updated_at: new Date().toISOString(),
          })
          .select("id"),
        15000,
        "create quick shipment item"
      );

      if (itemRes.error) throw itemRes.error;
      ensureAffectedRows(itemRes.data, "create quick shipment item");

      const resequenceRes = await supabase.rpc("resequence_shipment_group_append_end", {
        p_selected_date: today,
        p_from_farm_code: clean(selectedFarmCode) || null,
        p_to_farm_id: clean(createToFarmId) || null,
        p_priority_shipment_id: shipmentId,
      });

      if (resequenceRes.error) throw resequenceRes.error;

      setMsg("บันทึกการคัดสำเร็จ ✅");

      const currentSearch = clean(swineSearchQ);
      clearCurrentSelectionAndEditor();
      if (currentSearch) {
        await runSwineSearch(currentSearch);
      }
    } catch (e) {
      if (createdNewHeader && clean(createdShipmentId)) {
        await deleteEmptyDraftHeader(createdShipmentId);
      }

      console.error("handleCreateQuickShipment error:", e);
      setMsg(
        formatActionError(
          "บันทึกการคัดไม่สำเร็จ",
          e,
          "บันทึกการคัดไม่สำเร็จ"
        )
      );
    } finally {
      setCreatingQuickShipment(false);
    }
  }

  if (pageLoading) {
    return (
      <div className="page">
        <div className="card" style={{ maxWidth: 720, margin: "40px auto" }}>
          Loading...
        </div>
      </div>
    );
  }

  if (bootError && !canUsePage) {
    return (
      <div className="page">
        <div
          className="card"
          style={{
            maxWidth: 720,
            margin: "40px auto",
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 800, color: "#b91c1c" }}>
            {bootError}
          </div>
          <div className="small" style={{ color: "#666", lineHeight: 1.7 }}>
            เมื่อเชื่อมต่ออินเทอร์เน็ตได้แล้ว ให้ลองโหลดหน้าใหม่อีกครั้ง
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="linkbtn" type="button" onClick={() => window.location.reload()}>
              ลองใหม่
            </button>
            <button className="linkbtn" type="button" onClick={handleBack}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!canUsePage) {
    return (
      <div className="page">
        <div className="card" style={{ maxWidth: 720, margin: "40px auto" }}>
          ไม่มีสิทธิ์เข้าใช้งาน
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ overflowX: "hidden" }}>
      <div
        className="topbar"
        style={{
          flexWrap: "wrap",
          gap: 10,
          alignItems: "flex-start",
          position: "relative",
          zIndex: 20,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>Edit Shipment</div>
          <div style={{ color: "#6b7280", fontSize: 13, lineHeight: 1.7 }}>
            status-based • draft / submitted / issued = คัดแล้ว • ไม่ใช้ reserve เป็นตัวตัดสิน
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="linkbtn" type="button" onClick={handleBack}>
            Back
          </button>
        </div>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 1180,
          margin: "14px auto 0",
          display: "grid",
          gap: 14,
          boxSizing: "border-box",
          padding: "0 8px 24px",
          minWidth: 0,
        }}
      >
        {msg ? (
          <div className="card" style={{ ...cardStyle, padding: 12 }}>
            <div
              style={{
                color: msg.includes("สำเร็จ") ? "#166534" : "#b91c1c",
                fontWeight: 700,
                lineHeight: 1.7,
                wordBreak: "break-word",
                fontSize: 13,
              }}
            >
              {msg}
            </div>
          </div>
        ) : null}

        {isOffline ? (
          <div className="card" style={{ ...cardStyle, padding: 12 }}>
            <div style={{ color: "#92400e", fontWeight: 700 }}>
              ขณะนี้ออฟไลน์ ระบบจะยังไม่สามารถโหลดข้อมูลจากเซิร์ฟเวอร์ได้
            </div>
          </div>
        ) : null}

        <div className="card" style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 900 }}>ตัวกรอง</div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                วันที่เริ่มต้น
              </div>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => {
                  if (!confirmDiscardPendingChanges("เปลี่ยนช่วงวันที่")) return;
                  setFilterDateFrom(e.target.value);
                  clearCurrentSelectionAndEditor();
                }}
                style={fullInputStyle}
              />
              <div className="small" style={{ marginTop: 6, color: "#666" }}>
                {formatDateDisplay(filterDateFrom)}
              </div>
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                วันที่สิ้นสุด
              </div>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => {
                  if (!confirmDiscardPendingChanges("เปลี่ยนช่วงวันที่")) return;
                  setFilterDateTo(e.target.value);
                  clearCurrentSelectionAndEditor();
                }}
                style={fullInputStyle}
              />
              <div className="small" style={{ marginTop: 6, color: "#666" }}>
                {formatDateDisplay(filterDateTo)}
              </div>
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                ฟาร์ม
              </div>
              <select
                value={selectedFarmCode}
                onChange={(e) => {
                  if (!confirmDiscardPendingChanges("เปลี่ยนฟาร์ม")) return;
                  setSelectedFarmCode(e.target.value);
                  clearCurrentSelectionAndEditor();
                }}
                style={fullInputStyle}
                disabled={loadingDraftOptions || permissionsLoading}
              >
                <option value="">
                  {loadingDraftOptions || permissionsLoading ? "กำลังโหลด..." : "เลือกฟาร์ม"}
                </option>
                {farmOptions.map((farm) => (
                  <option key={farm.value} value={farm.value}>
                    {farm.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                Flock
              </div>
              <select
                value={selectedFlock}
                onChange={(e) => {
                  if (!confirmDiscardPendingChanges("เปลี่ยน flock")) return;
                  setSelectedFlock(e.target.value);
                  clearCurrentSelectionAndEditor();
                }}
                style={fullInputStyle}
                disabled={!selectedFarmCode || loadingDraftOptions}
              >
                <option value="">{!selectedFarmCode ? "เลือกฟาร์มก่อน" : "เลือก flock"}</option>
                {flockOptions.map((flock) => (
                  <option key={flock.value} value={flock.value}>
                    {flock.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {dateRangeInvalid ? (
            <div className="small" style={{ color: "#b91c1c", fontWeight: 700 }}>
              วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด
            </div>
          ) : null}
        </div>

        <div
          className="card"
          style={{
            ...cardStyle,
            display: "grid",
            gap: 12,
            gridTemplateColumns: "minmax(0, 1fr)",
          }}
        >
          <div style={{ fontWeight: 900 }}>ค้นหาเบอร์หมู</div>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(0, 1fr)" }}>
            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                เบอร์หมู
              </div>
              <input
                value={swineSearchQ}
                onChange={(e) => {
                  if (
                    clean(e.target.value) !== clean(swineSearchQ) &&
                    clean(swineSearchQ) &&
                    hasUnsavedEditorChanges &&
                    !confirmDiscardPendingChanges("ค้นหาใหม่")
                  ) {
                    return;
                  }
                  if (clean(e.target.value) !== clean(swineSearchQ)) {
                    clearCurrentSelectionAndEditor();
                  }
                  setSwineSearchQ(e.target.value);
                }}
                placeholder={
                  !selectedFarmCode || !selectedFlock
                    ? "เลือกฟาร์มและ flock ก่อน"
                    : "พิมพ์ swine code..."
                }
                style={fullInputStyle}
                disabled={!selectedFarmCode || !selectedFlock || dateRangeInvalid}
              />
            </div>
          </div>

          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              overflow: "hidden",
              background: "#fff",
            }}
          >
            {swineSearchLoading ? (
              <div style={{ padding: 12, color: "#666" }}>กำลังค้นหา...</div>
            ) : swineSearchMode === "idle" ? (
              <div style={{ padding: 12, color: "#666" }}>กรอกเบอร์หมูเพื่อค้นหา</div>
            ) : swineSearchResults.length === 0 ? (
              <div style={{ padding: 12, color: "#666" }}>ไม่พบข้อมูล</div>
            ) : (
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {swineSearchResults.map((row) => {
                  const active = clean(selectedSwineResultKey) === clean(row?.key);

                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => void handleSelectSearchResult(row)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        border: 0,
                        borderBottom: "1px solid #f3f4f6",
                        background: active ? "#fef9c3" : "#fff",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>{row.swine_code}</div>

                      {row.source_type === "draft" ? (
                        <div style={{ marginTop: 4, fontSize: 12, color: "#374151" }}>
                          อยู่ใน draft {row.draft_match_count} รายการ
                        </div>
                      ) : row.source_type === "available" ? (
                        <div style={{ marginTop: 4, fontSize: 12, color: "#166534" }}>
                          ยังคัดได้
                        </div>
                      ) : (
                        <div style={{ marginTop: 4, fontSize: 12, color: "#b91c1c" }}>
                          อยู่ในสถานะ {row.blocking_status || "-"} แล้ว
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {selectedSwineResult?.source_type === "draft" ? (
          <div className="card" style={{ ...cardStyle, display: "grid", gap: 12 }}>
            <div style={{ fontWeight: 900 }}>Draft ที่พบสำหรับเบอร์ {selectedSwineResult.swine_code}</div>

            <div style={{ display: "grid", gap: 10 }}>
              {(selectedSwineResult.draft_matches || []).map((m) => {
                const isOpen = clean(selectedShipmentId) === clean(m.shipment_id);

                return (
                  <div
                    key={m.shipment_id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      padding: 12,
                      ...(isOpen ? selectedCardStyle : {}),
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>
                      Shipment: {m.shipment_no || m.shipment_id}
                    </div>
                    <div style={{ marginTop: 4, color: "#6b7280", fontSize: 12 }}>
                      วันที่คัด: {formatDateDisplay(m.selected_date)}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        onClick={() =>
                          void openDraftShipmentForSwine(m.shipment_id, selectedSwineResult.swine_code)
                        }
                      >
                        {isOpen ? "กำลังแก้ไขรายการนี้" : "เปิดแก้ไข"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {selectedSwineResult?.source_type === "available" ? (
          <div className="card" style={{ ...cardStyle, display: "grid", gap: 14 }}>
            <div style={{ fontWeight: 900 }}>สร้าง draft ใหม่จากเบอร์ที่ยังคัดได้</div>

            <div
              style={{
                display: "grid",
                gap: 14,
                gridTemplateColumns: selectedSwineResult ? "minmax(0, 1fr) 280px" : "1fr",
                alignItems: "stretch",
              }}
            >
              <div style={{ display: "grid", gap: 12 }}>
                <div
                  style={{
                    border: "1px solid #dbeafe",
                    borderRadius: 12,
                    padding: 12,
                    background: "#f8fbff",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{selectedSwineResult.swine_code}</div>
                  <div style={{ marginTop: 6, color: "#6b7280", fontSize: 12, lineHeight: 1.6 }}>
                    เล้า: {clean(selectedSwineResult.house_no) || "-"} | Flock:{" "}
                    {clean(selectedSwineResult.flock) || "-"} | วันเกิด:{" "}
                    {formatDateDisplay(selectedSwineResult.birth_date)}
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>ฟาร์มปลายทาง</div>
                  <FarmPickerInlineAdd
                    label="ฟาร์มปลายทาง"
                    value={createToFarmId}
                    excludeId={null}
                    onChange={(id) => setCreateToFarmId(id || "")}
                    requireBranch={false}
                  />
                </div>

                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>เต้านมซ้าย</div>
                    <input
                      value={createTeatsLeft}
                      onChange={(e) => setCreateTeatsLeft(e.target.value)}
                      inputMode="numeric"
                      style={smallInputStyle}
                    />
                  </div>

                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>เต้านมขวา</div>
                    <input
                      value={createTeatsRight}
                      onChange={(e) => setCreateTeatsRight(e.target.value)}
                      inputMode="numeric"
                      style={smallInputStyle}
                    />
                  </div>

                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>น้ำหนัก</div>
                    <input
                      value={createWeight}
                      onChange={(e) => setCreateWeight(e.target.value)}
                      inputMode="decimal"
                      style={smallInputStyle}
                    />
                  </div>

                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Backfat</div>
                    <input
                      value={createBackfat}
                      onChange={(e) => setCreateBackfat(e.target.value)}
                      inputMode="decimal"
                      style={smallInputStyle}
                    />
                  </div>
                </div>

                <div>
                  <button type="button" onClick={() => void handleCreateQuickShipment()} disabled={creatingQuickShipment}>
                    {creatingQuickShipment ? "กำลังบันทึก..." : "บันทึกการคัด"}
                  </button>
                </div>
              </div>

              <QrPreviewBox value={selectedSwineResult.swine_code} />
            </div>
          </div>
        ) : null}

        {selectedSwineResult?.source_type === "blocked" ? (
          <div className="card" style={{ ...cardStyle, display: "grid", gap: 12 }}>
            <div style={{ fontWeight: 900 }}>สถานะปัจจุบันของเบอร์หมู</div>
            <div
              style={{
                border: "1px solid #fecaca",
                borderRadius: 12,
                padding: 12,
                background: "#fff7f7",
              }}
            >
              <div style={{ fontWeight: 800 }}>{selectedSwineResult.swine_code}</div>
              <div style={{ marginTop: 6, color: "#991b1b", fontSize: 13, lineHeight: 1.7 }}>
                เบอร์นี้อยู่ใน shipment สถานะ {selectedSwineResult.blocking_status || "-"} แล้ว
                {selectedSwineResult.blocking_selected_date
                  ? ` (วันที่ ${formatDateDisplay(selectedSwineResult.blocking_selected_date)})`
                  : ""}
              </div>
            </div>
          </div>
        ) : null}

        {shipmentHeader && selectedDraftItem ? (
          <div className="card" style={{ ...cardStyle, display: "grid", gap: 14 }}>
            <div style={{ fontWeight: 900 }}>แก้ไข draft</div>

            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 12,
                background: "#fafafa",
              }}
            >
              <div style={{ fontWeight: 800 }}>
                Shipment: {shipmentHeader.shipment_no || shipmentHeader.id}
              </div>
              <div style={{ marginTop: 6, color: "#6b7280", fontSize: 12, lineHeight: 1.7 }}>
                ฟาร์มต้นทาง: {clean(shipmentHeader.from_farm_code)} -{" "}
                {clean(shipmentHeader.from_farm_name) || "-"} | Flock:{" "}
                {clean(shipmentHeader.from_flock) || "-"} | วันที่คัด:{" "}
                {formatDateDisplay(shipmentHeader.selected_date)}
              </div>
              <div style={{ marginTop: 6, color: "#6b7280", fontSize: 12, lineHeight: 1.7 }}>
                เบอร์หมู: {selectedDraftItem.swine_code} | เล้า: {selectedDraftItem.house_no || "-"} | วันเกิด:{" "}
                {formatDateDisplay(selectedDraftItem.birth_date)}
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>ฟาร์มปลายทาง</div>
              <FarmPickerInlineAdd
                label="ฟาร์มปลายทาง"
                value={editToFarmId}
                excludeId={null}
                onChange={(id) => setEditToFarmId(id || "")}
                requireBranch={false}
              />
            </div>

            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>เต้านมซ้าย</div>
                <input
                  value={selectedDraftItem.teats_left}
                  onChange={(e) =>
                    setSelectedDraftItem((prev) =>
                      prev ? { ...prev, teats_left: e.target.value } : prev
                    )
                  }
                  inputMode="numeric"
                  style={smallInputStyle}
                />
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>เต้านมขวา</div>
                <input
                  value={selectedDraftItem.teats_right}
                  onChange={(e) =>
                    setSelectedDraftItem((prev) =>
                      prev ? { ...prev, teats_right: e.target.value } : prev
                    )
                  }
                  inputMode="numeric"
                  style={smallInputStyle}
                />
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>น้ำหนัก</div>
                <input
                  value={selectedDraftItem.weight}
                  onChange={(e) =>
                    setSelectedDraftItem((prev) =>
                      prev ? { ...prev, weight: e.target.value } : prev
                    )
                  }
                  inputMode="decimal"
                  style={smallInputStyle}
                />
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Backfat</div>
                <input
                  value={selectedDraftItem.backfat}
                  onChange={(e) =>
                    setSelectedDraftItem((prev) =>
                      prev ? { ...prev, backfat: e.target.value } : prev
                    )
                  }
                  inputMode="decimal"
                  style={smallInputStyle}
                />
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Delivery Date</div>
                <input
                  type="date"
                  value={editDeliveryDate}
                  onChange={(e) => setEditDeliveryDate(e.target.value)}
                  style={smallInputStyle}
                />
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>หมายเหตุ</div>
              <textarea
                value={editRemark}
                onChange={(e) => setEditRemark(e.target.value)}
                rows={3}
                style={{ ...fullInputStyle, resize: "vertical" }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => void handleSaveDraftSelectedSwine()}
                disabled={savingDraftItem}
              >
                {savingDraftItem ? "กำลังบันทึก..." : "Save"}
              </button>

              <button
                type="button"
                onClick={() => void handleDeleteDraftSelectedSwine()}
                disabled={deletingDraftItem}
              >
                {deletingDraftItem ? "กำลังลบ..." : "ลบหมูออกจาก shipment"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}