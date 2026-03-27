// src/pages/EditShipmentPage.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchMyProfile } from "../lib/profile";
import { formatDateDisplay, formatDateTimeDisplay } from "../lib/dateFormat";
import FarmPickerInlineAdd from "../components/FarmPickerInlineAdd.jsx";

function clean(s) {
  return String(s ?? "").trim();
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

function sortByLabel(a, b) {
  return String(a?.label || "").localeCompare(String(b?.label || ""), "th");
}

function chunkArray(arr, size = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
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

function sortShipmentItems(a, b) {
  const aNo = Number.isFinite(Number(a?.selection_no))
    ? Number(a.selection_no)
    : 999999999;
  const bNo = Number.isFinite(Number(b?.selection_no))
    ? Number(b.selection_no)
    : 999999999;

  if (aNo !== bNo) return aNo - bNo;

  return String(a?.swine_code || "").localeCompare(String(b?.swine_code || ""));
}

function applyNewItemPreviewNumbers(rows, startNo) {
  return (rows || []).map((row, idx) => ({
    ...row,
    preview_selection_no: startNo + idx,
  }));
}

function applySelectedDateRange(query, fromDate, toDate) {
  let q = query;
  const from = clean(fromDate);
  const to = clean(toDate);

  if (from) q = q.gte("selected_date", from);
  if (to) q = q.lte("selected_date", to);

  return q;
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

export default function EditShipmentPage() {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const shipmentIdFromUrl = clean(
    searchParams.get("id") || searchParams.get("shipmentId")
  );

  const today = todayYmdLocal();

  const [pageLoading, setPageLoading] = useState(true);
  const [myRole, setMyRole] = useState("");
  const [msg, setMsg] = useState("");

  const [userFarmCode, setUserFarmCode] = useState("");
  const [userFarmName, setUserFarmName] = useState("");
  const [userFlock, setUserFlock] = useState("");

  const [filterDateFrom, setFilterDateFrom] = useState(today);
  const [filterDateTo, setFilterDateTo] = useState(today);
  const [filterFromFarmCode, setFilterFromFarmCode] = useState("");
  const [filterToFarmId, setFilterToFarmId] = useState("");

  const [fromFarmLoading, setFromFarmLoading] = useState(false);
  const [toFarmLoading, setToFarmLoading] = useState(false);
  const [shipmentListLoading, setShipmentListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [fromFarmOptions, setFromFarmOptions] = useState([]);
  const [toFarmOptions, setToFarmOptions] = useState([]);
  const [shipmentList, setShipmentList] = useState([]);

  const [selectedShipmentId, setSelectedShipmentId] = useState("");
  const [shipmentHeader, setShipmentHeader] = useState(null);
  const [editRemark, setEditRemark] = useState("");
  const [editToFarmId, setEditToFarmId] = useState("");
  const [editToFarmMeta, setEditToFarmMeta] = useState(null);
  const [editDeliveryDate, setEditDeliveryDate] = useState("");

  const [itemRows, setItemRows] = useState([]);
  const [removedItemRows, setRemovedItemRows] = useState([]);
  const [newItemRows, setNewItemRows] = useState([]);

  const [availableSwines, setAvailableSwines] = useState([]);
  const [addHouse, setAddHouse] = useState("");
  const [addSwineQ, setAddSwineQ] = useState("");
  const [selectedCandidateSwineId, setSelectedCandidateSwineId] = useState("");

  const canUsePage = myRole === "admin" || myRole === "user";
  const dateRangeInvalid =
    !!filterDateFrom && !!filterDateTo && filterDateFrom > filterDateTo;

  const canSearch =
    !!filterDateFrom &&
    !!filterDateTo &&
    !dateRangeInvalid &&
    !!filterFromFarmCode &&
    !!filterToFarmId;

  useEffect(() => {
    let alive = true;

    async function init() {
      setPageLoading(true);
      setMsg("");

      try {
        const { data } = await supabase.auth.getSession();
        const uid = data?.session?.user?.id;
        if (!uid) {
          if (alive) setMyRole("");
          return;
        }

        const profile = await fetchMyProfile(uid);
        if (!alive) return;

        const nextRole = String(profile?.role || "user").toLowerCase();
        const nextFarmCode = clean(profile?.farm_code);
        const nextFarmName = clean(profile?.farm_name);
        const nextFlock = clean(profile?.flock);

        setMyRole(nextRole);
        setUserFarmCode(nextFarmCode);
        setUserFarmName(nextFarmName);
        setUserFlock(nextFlock);

        if (nextRole !== "admin") {
          setFilterFromFarmCode(nextFarmCode || "");

          if (!nextFarmCode || !nextFlock) {
            setMsg("ไม่พบ farm/flock ใน profile ของผู้ใช้งาน");
          }
        }
      } catch (e) {
        console.error("EditShipmentPage init error:", e);
        if (alive) setMsg(e?.message || "โหลดข้อมูลเริ่มต้นไม่สำเร็จ");
      } finally {
        if (alive) setPageLoading(false);
      }
    }

    void init();
    return () => {
      alive = false;
    };
  }, []);

  const applyRoleFilter = useCallback(
    async (query, opts = {}) => {
      if (myRole === "admin") return query;

      const farmCode = clean(opts.farmCode || userFarmCode);
      const flock = clean(opts.flock || userFlock);

      if (!farmCode) {
        return query.eq("from_farm_code", "__no_farm__");
      }

      query = query.eq("from_farm_code", farmCode);

      if (opts.useFromFlock) {
        if (!flock) {
          return query.eq("from_flock", "__no_flock__");
        }
        query = query.eq("from_flock", flock);
      }

      return query;
    },
    [myRole, userFarmCode, userFlock]
  );

  const clearShipmentIdFromUrl = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("id");
      next.delete("shipmentId");
      return next;
    });
  }, [setSearchParams]);

  const setShipmentIdToUrl = useCallback(
    (shipmentId) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("id", shipmentId);
        next.delete("shipmentId");
        return next;
      });
    },
    [setSearchParams]
  );

  const clearEditor = useCallback(
    ({ clearUrl = true } = {}) => {
      setSelectedShipmentId("");
      setShipmentHeader(null);
      setEditRemark("");
      setEditToFarmId("");
      setEditToFarmMeta(null);
      setEditDeliveryDate("");

      setItemRows([]);
      setRemovedItemRows([]);
      setNewItemRows([]);
      setAvailableSwines([]);
      setAddHouse("");
      setAddSwineQ("");
      setSelectedCandidateSwineId("");

      if (clearUrl) {
        clearShipmentIdFromUrl();
      }
    },
    [clearShipmentIdFromUrl]
  );

  const editIsSameFarm = useMemo(() => {
    return (
      !!clean(shipmentHeader?.from_farm_code) &&
      !!clean(editToFarmMeta?.farm_code) &&
      clean(shipmentHeader?.from_farm_code) === clean(editToFarmMeta?.farm_code)
    );
  }, [shipmentHeader?.from_farm_code, editToFarmMeta?.farm_code]);

  const existingItemCodeSet = useMemo(() => {
    return new Set(itemRows.map((x) => clean(x.swine_code)).filter(Boolean));
  }, [itemRows]);

  const newItemCodeSet = useMemo(() => {
    return new Set(newItemRows.map((x) => clean(x.swine_code)).filter(Boolean));
  }, [newItemRows]);

  const previewStartNo = useMemo(() => itemRows.length + 1, [itemRows.length]);

  useEffect(() => {
    setNewItemRows((prev) => applyNewItemPreviewNumbers(prev, previewStartNo));
  }, [previewStartNo]);

  useEffect(() => {
    if (!canUsePage || !filterDateFrom || !filterDateTo || dateRangeInvalid) {
      setFromFarmOptions([]);
      return;
    }
    void loadFromFarmOptions();
  }, [
    canUsePage,
    filterDateFrom,
    filterDateTo,
    dateRangeInvalid,
    myRole,
    userFarmCode,
    userFarmName,
    userFlock,
  ]);

  useEffect(() => {
    if (
      !canUsePage ||
      !filterDateFrom ||
      !filterDateTo ||
      dateRangeInvalid ||
      !filterFromFarmCode
    ) {
      setToFarmOptions([]);
      return;
    }
    void loadToFarmOptions();
  }, [
    canUsePage,
    filterDateFrom,
    filterDateTo,
    dateRangeInvalid,
    filterFromFarmCode,
    myRole,
    userFarmCode,
    userFlock,
  ]);

  useEffect(() => {
    let alive = true;

    async function loadEditToFarmMeta() {
      if (!editToFarmId) {
        setEditToFarmMeta(null);
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
        if (alive) setEditToFarmMeta(null);
      }
    }

    void loadEditToFarmMeta();
    return () => {
      alive = false;
    };
  }, [editToFarmId]);

  const fetchShipmentListByFilters = useCallback(
    async ({ selectedDateFrom, selectedDateTo, fromFarmCode, toFarmId }) => {
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
          to_farm_id,
          remark,
          status,
          created_at,
          updated_at,
          to_farm:master_farms!swine_shipments_to_farm_id_fkey (
            id,
            farm_code,
            farm_name
          )
        `)
        .eq("from_farm_code", fromFarmCode)
        .eq("to_farm_id", toFarmId)
        .eq("status", "draft")
        .order("selected_date", { ascending: false })
        .order("created_at", { ascending: false });

      query = applySelectedDateRange(query, selectedDateFrom, selectedDateTo);
      query = await applyRoleFilter(query, { useFromFlock: true });

      const { data, error } = await query;
      if (error) throw error;

      return data || [];
    },
    [applyRoleFilter]
  );

  async function loadFromFarmOptions() {
    setFromFarmLoading(true);

    try {
      if (myRole !== "admin") {
        const fixedCode = clean(userFarmCode);
        const fixedName = clean(userFarmName);

        if (!fixedCode) {
          setFromFarmOptions([]);
          return;
        }

        const fixedOption = {
          value: fixedCode,
          label: fixedName ? `${fixedCode} - ${fixedName}` : fixedCode,
          code: fixedCode,
          name: fixedName,
        };

        setFromFarmOptions([fixedOption]);
        setFilterFromFarmCode(fixedCode);
        return;
      }

      let query = supabase
        .from("swine_shipments")
        .select("from_farm_code, from_farm_name")
        .eq("status", "draft")
        .order("from_farm_name", { ascending: true });

      query = applySelectedDateRange(query, filterDateFrom, filterDateTo);
      query = await applyRoleFilter(query, { useFromFlock: true });

      const { data, error } = await query;
      if (error) throw error;

      const map = new Map();

      for (const row of data || []) {
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

      setFromFarmOptions(Array.from(map.values()).sort(sortByLabel));
    } catch (e) {
      console.error("loadFromFarmOptions error:", e);
      setFromFarmOptions([]);
      setMsg(e?.message || "โหลดฟาร์มต้นทางไม่สำเร็จ");
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
          to_farm:master_farms!swine_shipments_to_farm_id_fkey (
            id,
            farm_code,
            farm_name
          )
        `)
        .eq("from_farm_code", filterFromFarmCode)
        .eq("status", "draft")
        .order("created_at", { ascending: false });

      query = applySelectedDateRange(query, filterDateFrom, filterDateTo);
      query = await applyRoleFilter(query, { useFromFlock: true });

      const { data, error } = await query;
      if (error) throw error;

      const map = new Map();

      for (const row of data || []) {
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

      setToFarmOptions(Array.from(map.values()).sort(sortByLabel));
    } catch (e) {
      console.error("loadToFarmOptions error:", e);
      setToFarmOptions([]);
      setMsg(e?.message || "โหลดฟาร์มปลายทางไม่สำเร็จ");
    } finally {
      setToFarmLoading(false);
    }
  }

  async function fetchShipmentList() {
    return fetchShipmentListByFilters({
      selectedDateFrom: filterDateFrom,
      selectedDateTo: filterDateTo,
      fromFarmCode: filterFromFarmCode,
      toFarmId: filterToFarmId,
    });
  }

  async function refreshShipmentList(args = null) {
    try {
      const rows = await fetchShipmentListByFilters({
        selectedDateFrom: args?.selectedDateFrom ?? filterDateFrom,
        selectedDateTo: args?.selectedDateTo ?? filterDateTo,
        fromFarmCode: args?.fromFarmCode ?? filterFromFarmCode,
        toFarmId: args?.toFarmId ?? filterToFarmId,
      });
      setShipmentList(rows);
    } catch (e) {
      console.error("refreshShipmentList error:", e);
      setMsg(e?.message || "รีเฟรชรายการ draft ไม่สำเร็จ");
      throw e;
    }
  }

  const loadAvailableSwinesOfFarm = useCallback(
    async (fromFarmCode, fromFlock) => {
      const safeFarmCode =
        myRole === "admin"
          ? clean(fromFarmCode)
          : clean(userFarmCode || fromFarmCode);

      const safeFlock =
        myRole === "admin" ? clean(fromFlock) : clean(userFlock || fromFlock);

      if (!safeFarmCode || !safeFlock) {
        setAvailableSwines([]);
        return;
      }

      setAvailableLoading(true);

      try {
        let swineQuery = supabase
          .from("swines")
          .select("id, swine_code, farm_code, house_no, flock, birth_date")
          .eq("farm_code", safeFarmCode)
          .eq("flock", safeFlock)
          .order("house_no", { ascending: true })
          .order("swine_code", { ascending: true })
          .limit(5000);

        const { data: farmSwines, error: e1 } = await swineQuery;
        if (e1) throw e1;

        const swines = (farmSwines || []).map((x) => ({
          ...x,
          swine_code: clean(x.swine_code),
          house_no: clean(x.house_no),
          flock: clean(x.flock),
        }));

        const codes = swines.map((x) => x.swine_code).filter(Boolean);

        if (!codes.length) {
          setAvailableSwines([]);
          return;
        }

        const codeChunks = chunkArray(codes, 500);
        const availableCodeSet = new Set();

        for (const chunk of codeChunks) {
          const { data: availableRows, error: e2 } = await supabase
            .from("swine_master")
            .select("swine_code")
            .eq("delivery_state", "available")
            .in("swine_code", chunk);

          if (e2) throw e2;

          for (const row of availableRows || []) {
            const code = clean(row?.swine_code);
            if (code) availableCodeSet.add(code);
          }
        }

        const availableOnly = swines.filter((x) =>
          availableCodeSet.has(clean(x.swine_code))
        );

        setAvailableSwines(availableOnly);
      } catch (e) {
        console.error("loadAvailableSwinesOfFarm error:", e);
        setAvailableSwines([]);
        setMsg(e?.message || "โหลดรายการหมูสำหรับเพิ่มไม่สำเร็จ");
      } finally {
        setAvailableLoading(false);
      }
    },
    [myRole, userFarmCode, userFlock]
  );

  const openShipment = useCallback(
    async (shipmentId, opts = {}) => {
      const { silent = false } = opts;

      if (!shipmentId) return;

      setDetailLoading(true);
      if (!silent) setMsg("");
      setSelectedShipmentId(shipmentId);

      try {
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
              created_at,
              updated_at,
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

        query = await applyRoleFilter(query, { useFromFlock: true });

        const { data, error } = await query;
        if (error) throw error;
        if (!data) throw new Error("ไม่พบ shipment");

        const mappedItems = (data.items || [])
          .map((it) => ({
            id: it.id,
            selection_no: it.selection_no ?? null,
            swine_id: it.swine_id,
            swine_code: clean(it.swine_code),
            teats_left: it.teats_left ?? "",
            teats_right: it.teats_right ?? "",
            backfat: it.backfat ?? "",
            weight: it.weight ?? "",
            house_no: clean(it.swine?.house_no),
            flock: clean(it.swine?.flock),
            birth_date: it.swine?.birth_date || "",
          }))
          .sort(sortShipmentItems);

        setShipmentHeader(data);
        setEditRemark(data.remark || "");
        setEditToFarmId(clean(data.to_farm_id));
        setEditToFarmMeta(data.to_farm || null);
        setEditDeliveryDate(clean(data.delivery_date));

        setItemRows(mappedItems);
        setRemovedItemRows([]);
        setNewItemRows([]);
        setAddHouse("");
        setAddSwineQ("");
        setSelectedCandidateSwineId("");

        setFilterFromFarmCode((prev) => clean(prev) || clean(data.from_farm_code) || "");
        setFilterToFarmId((prev) => clean(prev) || clean(data.to_farm_id) || "");

        setShipmentIdToUrl(shipmentId);

        const [rows] = await Promise.all([
          fetchShipmentListByFilters({
            selectedDateFrom: filterDateFrom || data.selected_date,
            selectedDateTo: filterDateTo || data.selected_date,
            fromFarmCode: filterFromFarmCode || data.from_farm_code,
            toFarmId: filterToFarmId || data.to_farm_id,
          }),
          loadAvailableSwinesOfFarm(data.from_farm_code, data.from_flock),
        ]);

        setShipmentList(rows);
      } catch (e) {
        console.error("openShipment error:", e);
        setShipmentHeader(null);
        setEditRemark("");
        setEditToFarmId("");
        setEditToFarmMeta(null);
        setEditDeliveryDate("");
        setItemRows([]);
        setRemovedItemRows([]);
        setNewItemRows([]);
        setAvailableSwines([]);
        setAddHouse("");
        setAddSwineQ("");
        setSelectedCandidateSwineId("");
        if (!silent) setMsg(e?.message || "เปิด shipment เพื่อแก้ไขไม่สำเร็จ");
        throw e;
      } finally {
        setDetailLoading(false);
      }
    },
    [
      applyRoleFilter,
      fetchShipmentListByFilters,
      filterDateFrom,
      filterDateTo,
      filterFromFarmCode,
      filterToFarmId,
      loadAvailableSwinesOfFarm,
      setShipmentIdToUrl,
    ]
  );

  useEffect(() => {
    if (pageLoading || !canUsePage || !shipmentIdFromUrl) return;
    if (
      selectedShipmentId === shipmentIdFromUrl &&
      shipmentHeader?.id === shipmentIdFromUrl
    ) {
      return;
    }

    let alive = true;

    async function run() {
      try {
        await openShipment(shipmentIdFromUrl, { silent: true });
      } catch (e) {
        console.error("auto open by url error:", e);
        if (alive) setMsg(e?.message || "เปิด draft จาก URL ไม่สำเร็จ");
      }
    }

    void run();
    return () => {
      alive = false;
    };
  }, [
    pageLoading,
    canUsePage,
    shipmentIdFromUrl,
    selectedShipmentId,
    shipmentHeader?.id,
    openShipment,
  ]);

  function resetSearchStateAfterDateChange() {
    setFilterFromFarmCode(myRole === "admin" ? "" : clean(userFarmCode));
    setFilterToFarmId("");
    setFromFarmOptions([]);
    setToFarmOptions([]);
    setShipmentList([]);
    clearEditor();
    setMsg("");
  }

  function handleDateFromChange(value) {
    setFilterDateFrom(value);
    resetSearchStateAfterDateChange();
  }

  function handleDateToChange(value) {
    setFilterDateTo(value);
    resetSearchStateAfterDateChange();
  }

  function handleFromFarmChange(value) {
    const nextValue = myRole === "admin" ? value : clean(userFarmCode);
    setFilterFromFarmCode(nextValue);
    setFilterToFarmId("");
    setToFarmOptions([]);
    setShipmentList([]);
    clearEditor();
    setMsg("");
  }

  function handleToFarmChange(value) {
    setFilterToFarmId(value);
    setShipmentList([]);
    clearEditor();
    setMsg("");
  }

  async function handleSearch() {
    if (!filterDateFrom || !filterDateTo) {
      setMsg("กรุณาเลือกวันคัดเริ่มต้นและวันคัดสิ้นสุด");
      return;
    }

    if (dateRangeInvalid) {
      setMsg("วันคัดเริ่มต้นต้องไม่มากกว่าวันคัดสิ้นสุด");
      return;
    }

    if (!filterFromFarmCode || !filterToFarmId) {
      setMsg("กรุณาเลือกฟาร์มต้นทาง + ฟาร์มปลายทาง");
      return;
    }

    setShipmentListLoading(true);
    setMsg("");
    clearEditor();

    try {
      const rows = await fetchShipmentList();
      setShipmentList(rows);

      if (!rows.length) {
        setMsg("ไม่พบ shipment สถานะ draft ตามช่วงวันที่และเงื่อนไขที่เลือก");
      }
    } catch (e) {
      console.error("handleSearch error:", e);
      setShipmentList([]);
      setMsg(e?.message || "ค้นหา shipment ไม่สำเร็จ");
    } finally {
      setShipmentListLoading(false);
    }
  }

  function setExistingField(itemId, field, value) {
    setItemRows((prev) =>
      prev.map((row) => (row.id === itemId ? { ...row, [field]: value } : row))
    );
  }

  function setNewField(tempId, field, value) {
    setNewItemRows((prev) =>
      prev.map((row) =>
        row.temp_id === tempId ? { ...row, [field]: value } : row
      )
    );
  }

  function removeExistingItem(itemId) {
    const row = itemRows.find((x) => x.id === itemId);
    if (!row) return;

    if (!window.confirm(`ลบหมู ${row.swine_code} ออกจาก draft นี้ใช่หรือไม่`)) {
      return;
    }

    const nextItems = itemRows.filter((x) => x.id !== itemId);
    setItemRows(nextItems);
    setRemovedItemRows((prev) => [...prev, row].sort(sortShipmentItems));
  }

  function undoRemoveExistingItem(itemId) {
    const row = removedItemRows.find((x) => x.id === itemId);
    if (!row) return;

    setRemovedItemRows((prev) => prev.filter((x) => x.id !== itemId));
    setItemRows((prev) => [...prev, row].sort(sortShipmentItems));
  }

  const houseOptions = useMemo(() => {
    const map = new Map();

    for (const s of availableSwines || []) {
      const raw = clean(s.house_no);
      const value = raw || "__BLANK__";
      const label = raw || "(ไม่ระบุ House)";
      if (!map.has(value)) {
        map.set(value, { value, label });
      }
    }

    return Array.from(map.values()).sort(sortByLabel);
  }, [availableSwines]);

  const addCandidateSwines = useMemo(() => {
    if (!addHouse) return [];

    const q = clean(addSwineQ).toLowerCase();

    return (availableSwines || [])
      .filter((s) => {
        const houseValue = clean(s.house_no);

        if (addHouse === "__BLANK__") {
          if (houseValue) return false;
        } else if (houseValue !== addHouse) {
          return false;
        }

        const code = clean(s.swine_code);
        if (!code) return false;
        if (existingItemCodeSet.has(code)) return false;
        if (newItemCodeSet.has(code)) return false;
        if (q && !code.toLowerCase().includes(q)) return false;

        return true;
      })
      .slice(0, 100);
  }, [availableSwines, addHouse, addSwineQ, existingItemCodeSet, newItemCodeSet]);

  const selectedCandidateSwine = useMemo(() => {
    return (
      addCandidateSwines.find(
        (x) => String(x.id) === String(selectedCandidateSwineId)
      ) || null
    );
  }, [addCandidateSwines, selectedCandidateSwineId]);

  function addNewSwine(swine) {
    if (!swine?.id) return;

    const alreadyInExisting = itemRows.some((x) => x.swine_id === swine.id);
    const alreadyInNew = newItemRows.some((x) => x.swine_id === swine.id);

    if (alreadyInExisting || alreadyInNew) return;

    setNewItemRows((prev) => {
      const next = [
        ...prev,
        {
          temp_id: `new-${swine.id}-${Date.now()}`,
          swine_id: swine.id,
          swine_code: clean(swine.swine_code),
          house_no: clean(swine.house_no),
          flock: clean(swine.flock),
          birth_date: swine.birth_date || "",
          teats_left: "",
          teats_right: "",
          backfat: "",
          weight: "",
        },
      ];

      return applyNewItemPreviewNumbers(next, previewStartNo);
    });

    setSelectedCandidateSwineId("");
  }

  function removeNewSwine(tempId) {
    setNewItemRows((prev) => {
      const next = prev.filter((x) => x.temp_id !== tempId);
      return applyNewItemPreviewNumbers(next, previewStartNo);
    });
  }

  async function resequenceAfterSave({ shipmentId, oldGroup, newGroup }) {
    const sameGroup =
      clean(oldGroup?.selectedDate) === clean(newGroup?.selectedDate) &&
      clean(oldGroup?.fromFarmCode) === clean(newGroup?.fromFarmCode) &&
      clean(oldGroup?.toFarmId) === clean(newGroup?.toFarmId);

    const runGroupResequenceAppendEnd = async (group, priorityShipmentId, label) => {
      if (
        !clean(group?.selectedDate) ||
        !clean(group?.fromFarmCode) ||
        !clean(group?.toFarmId)
      ) {
        return;
      }

      const res = await withTimeout(
        supabase.rpc("resequence_shipment_group_append_end", {
          p_selected_date: group.selectedDate,
          p_from_farm_code: group.fromFarmCode,
          p_to_farm_id: group.toFarmId,
          p_priority_shipment_id: priorityShipmentId || null,
        }),
        15000,
        label
      );

      if (res.error) throw res.error;
    };

    if (sameGroup) {
      await runGroupResequenceAppendEnd(newGroup, null, "resequence current group");
      return;
    }

    await runGroupResequenceAppendEnd(
      newGroup,
      shipmentId,
      "resequence new group append end"
    );

    await runGroupResequenceAppendEnd(oldGroup, null, "resequence old group");
  }

  async function handleSaveAll() {
    if (!shipmentHeader?.id) {
      setMsg("กรุณาเลือก shipment ก่อน");
      return;
    }

    if (!clean(editToFarmId)) {
      setMsg("กรุณาเลือกฟาร์มปลายทาง");
      return;
    }

    if (editIsSameFarm) {
      setMsg("ห้ามเลือกฟาร์มต้นทางและปลายทางซ้ำกัน");
      return;
    }

    setSaving(true);
    setMsg("");
    let step = "เริ่มต้น";

    try {
      const shipmentId = shipmentHeader.id;
      const nowIso = new Date().toISOString();

      const oldGroup = {
        selectedDate: clean(shipmentHeader.selected_date),
        fromFarmCode: clean(shipmentHeader.from_farm_code),
        toFarmId: clean(shipmentHeader.to_farm_id),
      };

      const nextGroup = {
        selectedDate: clean(shipmentHeader.selected_date),
        fromFarmCode: clean(shipmentHeader.from_farm_code),
        toFarmId: clean(editToFarmId),
      };

      step = "อัปเดตหัว shipment";
      const headerRes = await withTimeout(
        supabase
          .from("swine_shipments")
          .update({
            to_farm_id: clean(editToFarmId) || null,
            delivery_date: clean(editDeliveryDate) || null,
            remark: clean(editRemark) || null,
            updated_at: nowIso,
          })
          .eq("id", shipmentId)
          .eq("status", "draft")
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
            )
          `),
        15000,
        "update shipment header"
      );

      if (headerRes.error) throw headerRes.error;
      ensureAffectedRows(headerRes.data, "update shipment header");

      const updatedHeader = Array.isArray(headerRes.data)
        ? headerRes.data[0]
        : headerRes.data;

      step = "อัปเดตค่าหมูเดิม";
      for (const row of itemRows) {
        const res = await withTimeout(
          supabase
            .from("swine_shipment_items")
            .update({
              teats_left: toIntOrNull(row.teats_left),
              teats_right: toIntOrNull(row.teats_right),
              backfat: toNumOrNull(row.backfat),
              weight: toNumOrNull(row.weight),
              updated_at: nowIso,
            })
            .eq("id", row.id)
            .select("id"),
          15000,
          `update swine_shipment_items ${row.id}`
        );

        if (res.error) throw res.error;
        ensureAffectedRows(res.data, `update swine_shipment_items ${row.id}`);
      }

      if (newItemRows.length) {
        step = "เพิ่มรายการหมูใหม่";
        const insertRows = newItemRows.map((row, idx) => ({
          shipment_id: shipmentId,
          swine_id: row.swine_id,
          swine_code: clean(row.swine_code),
          selection_no: previewStartNo + idx,
          teats_left: toIntOrNull(row.teats_left),
          teats_right: toIntOrNull(row.teats_right),
          backfat: toNumOrNull(row.backfat),
          weight: toNumOrNull(row.weight),
          updated_at: nowIso,
        }));

        const insertRes = await withTimeout(
          supabase
            .from("swine_shipment_items")
            .insert(insertRows)
            .select("id, swine_code"),
          15000,
          "insert swine_shipment_items"
        );

        if (insertRes.error) throw insertRes.error;
        if (countAffectedRows(insertRes.data) !== insertRows.length) {
          throw new Error(
            `INSERT_MISMATCH: swine_shipment_items inserted ${countAffectedRows(
              insertRes.data
            )}/${insertRows.length}`
          );
        }

        const newCodes = insertRows.map((x) => clean(x.swine_code)).filter(Boolean);
        if (newCodes.length) {
          step = "เปลี่ยนสถานะหมูใหม่เป็น reserved";
          const reserveRes = await withTimeout(
            supabase
              .from("swine_master")
              .update({
                delivery_state: "reserved",
                updated_at: nowIso,
              })
              .in("swine_code", newCodes)
              .select("swine_code"),
            15000,
            "reserve new swines"
          );

          if (reserveRes.error) throw reserveRes.error;
          if (countAffectedRows(reserveRes.data) !== newCodes.length) {
            throw new Error(
              `RESERVE_MISMATCH: swine_master updated ${countAffectedRows(
                reserveRes.data
              )}/${newCodes.length}`
            );
          }
        }
      }

      if (removedItemRows.length) {
        const removedIds = removedItemRows.map((x) => x.id).filter(Boolean);
        const removedCodes = removedItemRows
          .map((x) => clean(x.swine_code))
          .filter(Boolean);

        if (removedIds.length) {
          step = "ลบรายการหมูที่เอาออก";
          const deleteRes = await withTimeout(
            supabase
              .from("swine_shipment_items")
              .delete()
              .in("id", removedIds)
              .select("id"),
            15000,
            "delete removed swine_shipment_items"
          );

          if (deleteRes.error) throw deleteRes.error;
          if (countAffectedRows(deleteRes.data) !== removedIds.length) {
            throw new Error(
              `DELETE_MISMATCH: swine_shipment_items deleted ${countAffectedRows(
                deleteRes.data
              )}/${removedIds.length}`
            );
          }
        }

        if (removedCodes.length) {
          step = "ปล่อยสถานะหมูกลับเป็น available";
          const releaseRes = await withTimeout(
            supabase
              .from("swine_master")
              .update({
                delivery_state: "available",
                updated_at: nowIso,
              })
              .in("swine_code", removedCodes)
              .select("swine_code"),
            15000,
            "release removed swines"
          );

          if (releaseRes.error) throw releaseRes.error;
          if (countAffectedRows(releaseRes.data) !== removedCodes.length) {
            throw new Error(
              `RELEASE_MISMATCH: swine_master updated ${countAffectedRows(
                releaseRes.data
              )}/${removedCodes.length}`
            );
          }
        }
      }

      step = "จัดลำดับกลุ่มใหม่";
      await resequenceAfterSave({
        shipmentId,
        oldGroup,
        newGroup: nextGroup,
      });

      step = "รีโหลด shipment หลังบันทึก";
      await openShipment(shipmentId, { silent: true });
      await refreshShipmentList({
        selectedDateFrom: filterDateFrom,
        selectedDateTo: filterDateTo,
        fromFarmCode: nextGroup.fromFarmCode,
        toFarmId: nextGroup.toFarmId,
      });

      if (updatedHeader?.id) {
        setShipmentHeader(updatedHeader);
      }
      setFilterToFarmId(nextGroup.toFarmId);
      setMsg("บันทึกข้อมูลสำเร็จ ✅");
    } catch (e) {
      console.error("handleSaveAll error:", {
        step,
        message: e?.message,
        code: e?.code,
        details: e?.details,
        hint: e?.hint,
        raw: e,
      });

      setMsg(
        `บันทึกไม่สำเร็จ ที่ขั้นตอน: ${step}${
          e?.message ? ` | ${e.message}` : ""
        }${e?.details ? ` | details: ${e.details}` : ""}${
          e?.hint ? ` | hint: ${e.hint}` : ""
        }`
      );
    } finally {
      setSaving(false);
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
          <div style={{ fontSize: 18, fontWeight: 800 }}>Edit Shipment (Draft)</div>
          <div className="small" style={{ wordBreak: "break-word" }}>
            บันทึกครั้งเดียวครบ: header + ค่าหมู + เพิ่ม/ลบหมู + reserve/release +
            resequence
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="linkbtn" type="button" onClick={() => nav(-1)}>
            Back
          </button>
        </div>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 1200,
          margin: "14px auto 0",
          display: "grid",
          gap: 14,
          boxSizing: "border-box",
          padding: "0 8px",
          minWidth: 0,
        }}
      >
        {msg ? (
          <div className="card" style={{ padding: 12, ...cardStyle }}>
            <div
              className="small"
              style={{
                color: msg.includes("สำเร็จ") ? "#166534" : "#b91c1c",
                fontWeight: 700,
                lineHeight: 1.7,
                wordBreak: "break-word",
              }}
            >
              {msg}
            </div>
          </div>
        ) : null}

        <div className="card" style={{ display: "grid", gap: 12, ...cardStyle }}>
          <div style={{ fontWeight: 800 }}>ค้นหา Shipment สถานะ Draft</div>

          {myRole !== "admin" ? (
            <div
              className="small"
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                padding: 10,
                borderRadius: 10,
                color: "#334155",
              }}
            >
              สิทธิ์ผู้ใช้ถูกกรองตาม Farm: <b>{userFarmCode || "-"}</b> และ Flock:{" "}
              <b>{userFlock || "-"}</b>
            </div>
          ) : null}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 10,
            }}
          >
            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                วันคัดเริ่มต้น
              </div>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => handleDateFromChange(e.target.value)}
                style={fullInputStyle}
              />
              <div className="small" style={{ marginTop: 6, color: "#666" }}>
                แสดงผล: {formatDateDisplay(filterDateFrom)}
              </div>
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                วันคัดสิ้นสุด
              </div>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => handleDateToChange(e.target.value)}
                style={fullInputStyle}
              />
              <div className="small" style={{ marginTop: 6, color: "#666" }}>
                แสดงผล: {formatDateDisplay(filterDateTo)}
              </div>
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                ฟาร์มต้นทาง
              </div>
              <select
                value={filterFromFarmCode}
                onChange={(e) => handleFromFarmChange(e.target.value)}
                disabled={
                  !filterDateFrom ||
                  !filterDateTo ||
                  dateRangeInvalid ||
                  fromFarmLoading ||
                  myRole !== "admin"
                }
                style={fullInputStyle}
              >
                <option value="">
                  {fromFarmLoading ? "กำลังโหลด..." : "เลือกฟาร์มต้นทาง"}
                </option>
                {fromFarmOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                ฟาร์มปลายทาง
              </div>
              <select
                value={filterToFarmId}
                onChange={(e) => handleToFarmChange(e.target.value)}
                disabled={
                  !filterDateFrom ||
                  !filterDateTo ||
                  dateRangeInvalid ||
                  !filterFromFarmCode ||
                  toFarmLoading
                }
                style={fullInputStyle}
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
            </div>
          </div>

          {dateRangeInvalid ? (
            <div className="small" style={{ color: "#b91c1c", fontWeight: 700 }}>
              วันคัดเริ่มต้นต้องไม่มากกว่าวันคัดสิ้นสุด
            </div>
          ) : (
            <div className="small" style={{ color: "#666" }}>
              ถ้าต้องการค้นหาแค่วันเดียว ให้เลือกวันเริ่มต้นและวันสิ้นสุดเป็นวันเดียวกัน
            </div>
          )}

          <div>
            <button
              className="linkbtn"
              type="button"
              onClick={handleSearch}
              disabled={!canSearch || shipmentListLoading}
            >
              {shipmentListLoading ? "กำลังค้นหา..." : "ค้นหา Draft"}
            </button>
          </div>
        </div>

        <div className="card" style={{ display: "grid", gap: 10, ...cardStyle }}>
          <div style={{ fontWeight: 800 }}>
            รายการ Draft ที่พบ ({shipmentList.length})
          </div>

          {shipmentList.length === 0 ? (
            <div className="small" style={{ color: "#666" }}>
              ยังไม่มีรายการแสดง
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {shipmentList.map((row) => {
                const active = selectedShipmentId === row.id;
                return (
                  <div
                    key={row.id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 14,
                      padding: 12,
                      ...(active ? selectedCardStyle : null),
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, wordBreak: "break-word" }}>
                          {row.shipment_no || row.id}
                        </div>
                        <div className="small" style={{ marginTop: 6, color: "#444" }}>
                          วันคัด: <b>{formatDateDisplay(row.selected_date)}</b> | ต้นทาง:{" "}
                          <b>{row.from_farm_name || row.from_farm_code || "-"}</b> |
                          ปลายทาง: <b>{row.to_farm?.farm_name || "-"}</b>
                        </div>
                        <div className="small" style={{ marginTop: 6, color: "#666" }}>
                          Flock ต้นทาง: <b>{row.from_flock || "-"}</b>
                        </div>
                        <div className="small" style={{ marginTop: 6, color: "#666" }}>
                          วันส่ง: <b>{formatDateDisplay(row.delivery_date)}</b>
                        </div>
                        <div className="small" style={{ marginTop: 6, color: "#666" }}>
                          สถานะ: <b>{row.status || "-"}</b>
                        </div>
                        <div className="small" style={{ marginTop: 6, color: "#666" }}>
                          สร้างเมื่อ: {formatDateTimeDisplay(row.created_at)}
                        </div>
                        <div className="small" style={{ marginTop: 6, color: "#666" }}>
                          แก้ไขล่าสุด: {formatDateTimeDisplay(row.updated_at)}
                        </div>
                        <div className="small" style={{ marginTop: 6, color: "#666" }}>
                          หมายเหตุ: {row.remark || "-"}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center" }}>
                        <button
                          className="linkbtn"
                          type="button"
                          onClick={() => openShipment(row.id)}
                          disabled={detailLoading}
                        >
                          {detailLoading && selectedShipmentId === row.id
                            ? "กำลังเปิด..."
                            : "เปิดแก้ไข"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {shipmentHeader ? (
          <>
            <div className="card" style={{ display: "grid", gap: 12, ...cardStyle }}>
              <div style={{ fontWeight: 800 }}>ข้อมูล Shipment</div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 10,
                }}
              >
                <div>
                  <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                    Shipment
                  </div>
                  <input
                    value={shipmentHeader.shipment_no || shipmentHeader.id || ""}
                    readOnly
                    style={{ ...fullInputStyle, background: "#f8fafc" }}
                  />
                </div>

                <div>
                  <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                    วันคัด
                  </div>
                  <input
                    value={formatDateDisplay(shipmentHeader.selected_date)}
                    readOnly
                    style={{ ...fullInputStyle, background: "#f8fafc" }}
                  />
                </div>

                <div>
                  <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                    ฟาร์มต้นทาง
                  </div>
                  <input
                    value={
                      shipmentHeader.from_farm_name ||
                      shipmentHeader.from_farm_code ||
                      ""
                    }
                    readOnly
                    style={{ ...fullInputStyle, background: "#f8fafc" }}
                  />
                </div>

                <div>
                  <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                    Flock ต้นทาง
                  </div>
                  <input
                    value={shipmentHeader.from_flock || ""}
                    readOnly
                    style={{ ...fullInputStyle, background: "#f8fafc" }}
                  />
                </div>

                <div style={{ minWidth: 0 }}>
                  <FarmPickerInlineAdd
                    label="ฟาร์มปลายทาง"
                    value={editToFarmId}
                    excludeId={null}
                    onChange={(id) => {
                      setMsg("");
                      setEditToFarmId(id || "");
                    }}
                    requireBranch={false}
                  />
                </div>

                <div>
                  <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                    วันส่งปลายทาง
                  </div>
                  <input
                    type="date"
                    value={editDeliveryDate}
                    onChange={(e) => setEditDeliveryDate(e.target.value)}
                    style={fullInputStyle}
                  />
                  <div className="small" style={{ marginTop: 6, color: "#666" }}>
                    แสดงผล: {formatDateDisplay(editDeliveryDate)}
                  </div>
                </div>
              </div>

              {editIsSameFarm ? (
                <div style={{ color: "crimson", fontWeight: 700 }}>
                  ห้ามเลือกฟาร์มต้นทางและปลายทางซ้ำกัน
                </div>
              ) : null}

              <div>
                <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                  หมายเหตุ
                </div>
                <textarea
                  value={editRemark}
                  onChange={(e) => setEditRemark(e.target.value)}
                  rows={3}
                  style={{ ...fullInputStyle, resize: "vertical" }}
                  placeholder="ใส่หมายเหตุ (ถ้ามี)"
                />
              </div>
            </div>

            <div className="card" style={{ display: "grid", gap: 12, ...cardStyle }}>
              <div style={{ fontWeight: 800 }}>เบอร์หมูใน Draft ({itemRows.length})</div>

              {itemRows.length === 0 ? (
                <div className="small" style={{ color: "#666" }}>
                  ยังไม่มีหมูใน draft นี้
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {itemRows.map((row) => (
                    <div
                      key={row.id}
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 14,
                        padding: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, wordBreak: "break-word" }}>
                            #{row.selection_no || "-"} — {row.swine_code}
                          </div>
                          <div className="small" style={{ marginTop: 6, color: "#666" }}>
                            House: {row.house_no || "-"} | Flock: {row.flock || "-"} |
                            วันเกิด: {formatDateDisplay(row.birth_date)}
                          </div>
                        </div>

                        <button
                          className="linkbtn"
                          type="button"
                          onClick={() => removeExistingItem(row.id)}
                          disabled={saving}
                        >
                          ลบออกจาก draft
                        </button>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                          gap: 8,
                          marginTop: 10,
                        }}
                      >
                        <input
                          value={row.teats_left}
                          onChange={(e) =>
                            setExistingField(row.id, "teats_left", e.target.value)
                          }
                          placeholder="เต้าซ้าย"
                          inputMode="numeric"
                          style={smallInputStyle}
                        />
                        <input
                          value={row.teats_right}
                          onChange={(e) =>
                            setExistingField(row.id, "teats_right", e.target.value)
                          }
                          placeholder="เต้าขวา"
                          inputMode="numeric"
                          style={smallInputStyle}
                        />
                        <input
                          value={row.backfat}
                          onChange={(e) =>
                            setExistingField(row.id, "backfat", e.target.value)
                          }
                          placeholder="Backfat"
                          inputMode="decimal"
                          style={smallInputStyle}
                        />
                        <input
                          value={row.weight}
                          onChange={(e) =>
                            setExistingField(row.id, "weight", e.target.value)
                          }
                          placeholder="น้ำหนัก"
                          inputMode="decimal"
                          style={smallInputStyle}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {removedItemRows.length > 0 ? (
                <div
                  style={{
                    border: "1px dashed #f59e0b",
                    borderRadius: 14,
                    padding: 12,
                    background: "#fffbeb",
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 10 }}>
                    รายการรอลบ ({removedItemRows.length})
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    {removedItemRows.map((row) => (
                      <div
                        key={row.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          flexWrap: "wrap",
                          alignItems: "center",
                          border: "1px solid #fde68a",
                          borderRadius: 12,
                          padding: 10,
                          background: "#fff",
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>
                          #{row.selection_no || "-"} — {row.swine_code}
                        </div>
                        <button
                          className="linkbtn"
                          type="button"
                          onClick={() => undoRemoveExistingItem(row.id)}
                          disabled={saving}
                        >
                          Undo
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="card" style={{ display: "grid", gap: 12, ...cardStyle }}>
              <div style={{ fontWeight: 800 }}>เพิ่มเบอร์หมู</div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 10,
                }}
              >
                <div>
                  <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                    House
                  </div>
                  <select
                    value={addHouse}
                    onChange={(e) => {
                      setAddHouse(e.target.value);
                      setAddSwineQ("");
                      setSelectedCandidateSwineId("");
                    }}
                    disabled={availableLoading}
                    style={fullInputStyle}
                  >
                    <option value="">
                      {availableLoading ? "กำลังโหลด..." : "เลือก House"}
                    </option>
                    {houseOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                    ค้นหาเบอร์หมู
                  </div>
                  <input
                    value={addSwineQ}
                    onChange={(e) => {
                      setAddSwineQ(e.target.value);
                      setSelectedCandidateSwineId("");
                    }}
                    placeholder="พิมพ์ swine code..."
                    disabled={!addHouse}
                    style={fullInputStyle}
                  />
                </div>

                <div>
                  <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                    เลือกเบอร์หมู
                  </div>
                  <select
                    value={selectedCandidateSwineId}
                    onChange={(e) => setSelectedCandidateSwineId(e.target.value)}
                    disabled={!addHouse}
                    style={fullInputStyle}
                  >
                    <option value="">
                      {!addHouse ? "เลือก House ก่อน" : "เลือกเบอร์หมู"}
                    </option>
                    {addCandidateSwines.map((swine) => (
                      <option key={swine.id} value={swine.id}>
                        {swine.swine_code}
                        {clean(swine.house_no) ? ` | House ${clean(swine.house_no)}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!addHouse ? (
                <div className="small" style={{ color: "#666" }}>
                  * กรุณาเลือก House ก่อน เพื่อแสดงเบอร์หมูสำหรับเพิ่ม
                </div>
              ) : addCandidateSwines.length === 0 ? (
                <div className="small" style={{ color: "#666" }}>
                  ไม่พบหมู available ใน House นี้ หรือหมูถูกเลือกไปแล้ว
                </div>
              ) : selectedCandidateSwine ? (
                <div
                  style={{
                    border: "1px solid #dbeafe",
                    borderRadius: 12,
                    padding: 10,
                    background: "#f8fbff",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{selectedCandidateSwine.swine_code}</div>
                  <div className="small" style={{ marginTop: 6, color: "#666" }}>
                    House: {clean(selectedCandidateSwine.house_no) || "-"} | Flock:{" "}
                    {clean(selectedCandidateSwine.flock) || "-"} | วันเกิด:{" "}
                    {formatDateDisplay(selectedCandidateSwine.birth_date)}
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <button
                      className="linkbtn"
                      type="button"
                      onClick={() => addNewSwine(selectedCandidateSwine)}
                      disabled={saving}
                    >
                      เพิ่มเข้า Draft
                    </button>
                  </div>
                </div>
              ) : null}

              {newItemRows.length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontWeight: 800 }}>
                    รายการหมูที่เพิ่มใหม่ ({newItemRows.length})
                  </div>

                  {newItemRows.map((row) => (
                    <div
                      key={row.temp_id}
                      style={{
                        border: "1px solid #86efac",
                        borderRadius: 14,
                        padding: 12,
                        background: "#f0fdf4",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, wordBreak: "break-word" }}>
                            #{row.preview_selection_no} — {row.swine_code}
                          </div>
                          <div className="small" style={{ marginTop: 6, color: "#666" }}>
                            House: {row.house_no || "-"} | Flock: {row.flock || "-"} |
                            วันเกิด: {formatDateDisplay(row.birth_date)}
                          </div>
                        </div>

                        <button
                          className="linkbtn"
                          type="button"
                          onClick={() => removeNewSwine(row.temp_id)}
                          disabled={saving}
                        >
                          เอาออก
                        </button>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                          gap: 8,
                          marginTop: 10,
                        }}
                      >
                        <input
                          value={row.teats_left}
                          onChange={(e) =>
                            setNewField(row.temp_id, "teats_left", e.target.value)
                          }
                          placeholder="เต้าซ้าย"
                          inputMode="numeric"
                          style={smallInputStyle}
                        />
                        <input
                          value={row.teats_right}
                          onChange={(e) =>
                            setNewField(row.temp_id, "teats_right", e.target.value)
                          }
                          placeholder="เต้าขวา"
                          inputMode="numeric"
                          style={smallInputStyle}
                        />
                        <input
                          value={row.backfat}
                          onChange={(e) =>
                            setNewField(row.temp_id, "backfat", e.target.value)
                          }
                          placeholder="Backfat"
                          inputMode="decimal"
                          style={smallInputStyle}
                        />
                        <input
                          value={row.weight}
                          onChange={(e) =>
                            setNewField(row.temp_id, "weight", e.target.value)
                          }
                          placeholder="น้ำหนัก"
                          inputMode="decimal"
                          style={smallInputStyle}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="linkbtn"
                type="button"
                onClick={handleSaveAll}
                disabled={!shipmentHeader?.id || saving}
              >
                {saving ? "Saving..." : "บันทึกทั้งหมด"}
              </button>

              <button
                className="linkbtn"
                type="button"
                onClick={() => {
                  clearEditor();
                  setMsg("");
                }}
                disabled={saving}
              >
                ปิดการแก้ไข
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}