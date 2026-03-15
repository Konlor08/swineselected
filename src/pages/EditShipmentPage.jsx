// src/pages/EditShipmentPage.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchMyProfile } from "../lib/profile";

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

function qrUrl(text) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(
    text || ""
  )}`;
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

  const [pageLoading, setPageLoading] = useState(true);
  const [myRole, setMyRole] = useState("");
  const [msg, setMsg] = useState("");

  const [filterDate, setFilterDate] = useState(todayYmdLocal());
  const [filterFromFarmCode, setFilterFromFarmCode] = useState("");
  const [filterToFarmId, setFilterToFarmId] = useState("");

  const [fromFarmLoading, setFromFarmLoading] = useState(false);
  const [toFarmLoading, setToFarmLoading] = useState(false);
  const [shipmentListLoading, setShipmentListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [fromFarmOptions, setFromFarmOptions] = useState([]);
  const [toFarmOptions, setToFarmOptions] = useState([]);
  const [shipmentList, setShipmentList] = useState([]);

  const [selectedShipmentId, setSelectedShipmentId] = useState("");
  const [shipmentHeader, setShipmentHeader] = useState(null);
  const [editRemark, setEditRemark] = useState("");

  const [itemRows, setItemRows] = useState([]);
  const [selectedEditItemId, setSelectedEditItemId] = useState("");
  const [editSwineQ, setEditSwineQ] = useState("");
  const [removedItemRows, setRemovedItemRows] = useState([]);
  const [newItemRows, setNewItemRows] = useState([]);

  const [availableSwines, setAvailableSwines] = useState([]);
  const [addHouse, setAddHouse] = useState("");
  const [addSwineQ, setAddSwineQ] = useState("");

  const canUsePage = myRole === "admin" || myRole === "user";
  const canSearch = !!filterDate && !!filterFromFarmCode && !!filterToFarmId;

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

        setMyRole(String(profile?.role || "user").toLowerCase());
      } catch (e) {
        console.error("EditShipmentPage init error:", e);
        if (alive) setMsg(e?.message || "โหลดข้อมูลเริ่มต้นไม่สำเร็จ");
      } finally {
        if (alive) setPageLoading(false);
      }
    }

    init();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!canUsePage || !filterDate) {
      setFromFarmOptions([]);
      return;
    }
    loadFromFarmOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUsePage, filterDate, myRole]);

  useEffect(() => {
    if (!canUsePage || !filterDate || !filterFromFarmCode) {
      setToFarmOptions([]);
      return;
    }
    loadToFarmOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUsePage, filterDate, filterFromFarmCode, myRole]);

  useEffect(() => {
    if (!itemRows.length) {
      setSelectedEditItemId("");
      return;
    }

    setSelectedEditItemId((prev) => {
      if (prev && itemRows.some((x) => x.id === prev)) return prev;
      return itemRows[0].id;
    });
  }, [itemRows]);

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

      const uid = await getCurrentUserId();
      if (!uid) {
        return query.eq("created_by", "__no_user__");
      }

      return query.eq("created_by", uid);
    },
    [myRole]
  );

  function clearEditor() {
    setSelectedShipmentId("");
    setShipmentHeader(null);
    setEditRemark("");
    setItemRows([]);
    setSelectedEditItemId("");
    setEditSwineQ("");
    setRemovedItemRows([]);
    setNewItemRows([]);
    setAvailableSwines([]);
    setAddHouse("");
    setAddSwineQ("");
  }

  function handleDateChange(value) {
    setFilterDate(value);
    setFilterFromFarmCode("");
    setFilterToFarmId("");
    setFromFarmOptions([]);
    setToFarmOptions([]);
    setShipmentList([]);
    clearEditor();
    setMsg("");
  }

  function handleFromFarmChange(value) {
    setFilterFromFarmCode(value);
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

  async function loadFromFarmOptions() {
    setFromFarmLoading(true);

    try {
      let query = supabase
        .from("swine_shipments")
        .select("from_farm_code, from_farm_name")
        .eq("selected_date", filterDate)
        .eq("status", "draft")
        .order("from_farm_name", { ascending: true });

      query = await applyRoleFilter(query);

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
          to_farm:swine_farms!swine_shipments_to_farm_id_fkey (
            id,
            farm_code,
            farm_name
          )
        `)
        .eq("selected_date", filterDate)
        .eq("from_farm_code", filterFromFarmCode)
        .eq("status", "draft")
        .order("created_at", { ascending: false });

      query = await applyRoleFilter(query);

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
    let query = supabase
      .from("swine_shipments")
      .select(`
        id,
        shipment_no,
        selected_date,
        from_farm_code,
        from_farm_name,
        to_farm_id,
        remark,
        status,
        created_at,
        to_farm:swine_farms!swine_shipments_to_farm_id_fkey (
          id,
          farm_code,
          farm_name
        ),
        items:swine_shipment_items (
          id
        )
      `)
      .eq("selected_date", filterDate)
      .eq("from_farm_code", filterFromFarmCode)
      .eq("to_farm_id", filterToFarmId)
      .eq("status", "draft")
      .order("created_at", { ascending: false });

    query = await applyRoleFilter(query);

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((row) => ({
      ...row,
      item_count: Array.isArray(row.items) ? row.items.length : 0,
    }));
  }

  async function handleSearch() {
    if (!canSearch) {
      setMsg("กรุณาเลือกวันคัด + ฟาร์มต้นทาง + ฟาร์มปลายทาง");
      return;
    }

    setShipmentListLoading(true);
    setMsg("");
    clearEditor();

    try {
      const rows = await fetchShipmentList();
      setShipmentList(rows);

      if (!rows.length) {
        setMsg("ไม่พบ shipment สถานะ draft ตามเงื่อนไขที่เลือก");
      }
    } catch (e) {
      console.error("handleSearch error:", e);
      setShipmentList([]);
      setMsg(e?.message || "ค้นหา shipment ไม่สำเร็จ");
    } finally {
      setShipmentListLoading(false);
    }
  }

  async function refreshShipmentList() {
    if (!canSearch) return;

    try {
      const rows = await fetchShipmentList();
      setShipmentList(rows);
    } catch (e) {
      console.error("refreshShipmentList error:", e);
      setMsg(e?.message || "รีเฟรชรายการ draft ไม่สำเร็จ");
      throw e;
    }
  }

  async function loadAvailableSwinesOfFarm(fromFarmCode) {
    if (!fromFarmCode) {
      setAvailableSwines([]);
      return;
    }

    setAvailableLoading(true);

    try {
      const { data: farmSwines, error: e1 } = await supabase
        .from("swines")
        .select("id, swine_code, farm_code, house_no, flock, birth_date")
        .eq("farm_code", fromFarmCode)
        .order("house_no", { ascending: true })
        .order("swine_code", { ascending: true })
        .limit(5000);

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
          if (code) {
            availableCodeSet.add(code);
          }
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
  }

  async function openShipment(shipmentId, opts = {}) {
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
          from_farm_code,
          from_farm_name,
          to_farm_id,
          remark,
          status,
          created_at,
          to_farm:swine_farms!swine_shipments_to_farm_id_fkey (
            id,
            farm_code,
            farm_name
          ),
          items:swine_shipment_items (
            id,
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

      query = await applyRoleFilter(query);

      const { data, error } = await query;
      if (error) throw error;
      if (!data) throw new Error("ไม่พบ shipment");

      const mappedItems = (data.items || [])
        .map((it) => ({
          id: it.id,
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
        .sort((a, b) =>
          String(a.swine_code || "").localeCompare(String(b.swine_code || ""))
        );

      setShipmentHeader(data);
      setEditRemark(data.remark || "");
      setItemRows(mappedItems);
      setSelectedEditItemId(mappedItems[0]?.id || "");
      setEditSwineQ("");
      setRemovedItemRows([]);
      setNewItemRows([]);
      setAddHouse("");
      setAddSwineQ("");

      await loadAvailableSwinesOfFarm(data.from_farm_code);
    } catch (e) {
      console.error("openShipment error:", e);
      setShipmentHeader(null);
      setEditRemark("");
      setItemRows([]);
      setSelectedEditItemId("");
      setEditSwineQ("");
      setRemovedItemRows([]);
      setNewItemRows([]);
      setAvailableSwines([]);
      if (!silent) {
        setMsg(e?.message || "เปิด shipment เพื่อแก้ไขไม่สำเร็จ");
      }
      throw e;
    } finally {
      setDetailLoading(false);
    }
  }

  function setExistingField(itemId, field, value) {
    setItemRows((prev) =>
      prev.map((row) => (row.id === itemId ? { ...row, [field]: value } : row))
    );
  }

  function setNewField(tempId, field, value) {
    setNewItemRows((prev) =>
      prev.map((row) => (row.temp_id === tempId ? { ...row, [field]: value } : row))
    );
  }

  function handleEditSwineSearch(value) {
    setEditSwineQ(value);

    const q = clean(value).toLowerCase();
    if (!q) {
      setSelectedEditItemId(itemRows[0]?.id || "");
      return;
    }

    const exact = itemRows.find(
      (row) => String(row.swine_code || "").toLowerCase() === q
    );
    if (exact) {
      setSelectedEditItemId(exact.id);
      return;
    }

    const firstMatched = itemRows.find((row) =>
      String(row.swine_code || "").toLowerCase().includes(q)
    );
    setSelectedEditItemId(firstMatched?.id || "");
  }

  function removeExistingItem(itemId) {
    const row = itemRows.find((x) => x.id === itemId);
    if (!row) return;

    if (!window.confirm(`ลบหมู ${row.swine_code} ออกจาก shipment นี้ใช่หรือไม่`)) {
      return;
    }

    const nextItems = itemRows.filter((x) => x.id !== itemId);

    setItemRows(nextItems);
    setRemovedItemRows((prev) =>
      [...prev, row].sort((a, b) =>
        String(a.swine_code || "").localeCompare(String(b.swine_code || ""))
      )
    );
    setSelectedEditItemId(nextItems[0]?.id || "");
    setEditSwineQ("");
  }

  function undoRemoveExistingItem(itemId) {
    const row = removedItemRows.find((x) => x.id === itemId);
    if (!row) return;

    setRemovedItemRows((prev) => prev.filter((x) => x.id !== itemId));
    setItemRows((prev) =>
      [...prev, row].sort((a, b) =>
        String(a.swine_code || "").localeCompare(String(b.swine_code || ""))
      )
    );
  }

  function addNewSwine(swine) {
    if (!swine?.id) return;

    const alreadyAdded = newItemRows.some((x) => x.swine_id === swine.id);
    if (alreadyAdded) return;

    setNewItemRows((prev) =>
      [
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
      ].sort((a, b) =>
        String(a.swine_code || "").localeCompare(String(b.swine_code || ""))
      )
    );
  }

  function removeNewSwine(tempId) {
    setNewItemRows((prev) => prev.filter((x) => x.temp_id !== tempId));
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
    const newCodes = new Set(newItemRows.map((x) => clean(x.swine_code)).filter(Boolean));

    return (availableSwines || [])
      .filter((s) => {
        const houseValue = clean(s.house_no);
        if (addHouse === "__BLANK__") {
          if (houseValue) return false;
        } else if (houseValue !== addHouse) {
          return false;
        }

        const code = clean(s.swine_code);
        if (newCodes.has(code)) return false;

        if (q && !String(code).toLowerCase().includes(q)) return false;
        return true;
      })
      .slice(0, 30);
  }, [availableSwines, addHouse, addSwineQ, newItemRows]);

  const filteredEditItems = useMemo(() => {
    const q = clean(editSwineQ).toLowerCase();
    if (!q) return itemRows;

    return itemRows.filter((row) =>
      String(row.swine_code || "").toLowerCase().includes(q)
    );
  }, [itemRows, editSwineQ]);

  const selectedEditItem = useMemo(() => {
    return itemRows.find((x) => x.id === selectedEditItemId) || null;
  }, [itemRows, selectedEditItemId]);

  async function handleSaveChanges() {
    if (!shipmentHeader?.id) {
      setMsg("กรุณาเลือก shipment ก่อน");
      return;
    }

    setSaving(true);
    let step = "เริ่มต้น";
    setMsg("กำลังเริ่มบันทึก...");

    try {
      const shipmentId = shipmentHeader.id;

      step = "อัปเดตหมายเหตุ shipment";
      setMsg("กำลังอัปเดตหมายเหตุ shipment...");
      const headerPayload = {
        remark: clean(editRemark) || null,
      };

      const res1 = await withTimeout(
        supabase
          .from("swine_shipments")
          .update(headerPayload)
          .eq("id", shipmentId)
          .select("id"),
        15000,
        "update swine_shipments"
      );
      if (res1.error) throw res1.error;
      ensureAffectedRows(res1.data, "update swine_shipments");

      step = "อัปเดตรายการหมูเดิม";
      setMsg("กำลังอัปเดตรายการหมูเดิม...");
      for (const row of itemRows) {
        const res = await withTimeout(
          supabase
            .from("swine_shipment_items")
            .update({
              teats_left: toIntOrNull(row.teats_left),
              teats_right: toIntOrNull(row.teats_right),
              backfat: toNumOrNull(row.backfat),
              weight: toNumOrNull(row.weight),
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
        setMsg("กำลังเพิ่มรายการหมูใหม่...");
        const insertRows = newItemRows.map((row) => ({
          shipment_id: shipmentId,
          swine_id: row.swine_id,
          swine_code: clean(row.swine_code),
          teats_left: toIntOrNull(row.teats_left),
          teats_right: toIntOrNull(row.teats_right),
          backfat: toNumOrNull(row.backfat),
          weight: toNumOrNull(row.weight),
        }));

        const res2 = await withTimeout(
          supabase.from("swine_shipment_items").insert(insertRows).select("id, swine_code"),
          15000,
          "insert swine_shipment_items"
        );
        if (res2.error) throw res2.error;
        if (countAffectedRows(res2.data) !== insertRows.length) {
          throw new Error(
            `INSERT_MISMATCH: swine_shipment_items inserted ${countAffectedRows(
              res2.data
            )}/${insertRows.length}`
          );
        }

        const newCodes = insertRows.map((x) => clean(x.swine_code)).filter(Boolean);
        if (newCodes.length) {
          step = "เปลี่ยนสถานะหมูใหม่เป็น reserved";
          setMsg("กำลังเปลี่ยนสถานะหมูใหม่เป็น reserved...");
          const res3 = await withTimeout(
            supabase
              .from("swine_master")
              .update({ delivery_state: "reserved" })
              .in("swine_code", newCodes)
              .select("swine_code"),
            15000,
            "reserve new swines"
          );
          if (res3.error) throw res3.error;
          if (countAffectedRows(res3.data) !== newCodes.length) {
            throw new Error(
              `RESERVE_MISMATCH: swine_master updated ${countAffectedRows(
                res3.data
              )}/${newCodes.length}`
            );
          }
        }
      }

      if (removedItemRows.length) {
        const removedIds = removedItemRows.map((x) => x.id).filter(Boolean);
        const removedCodes = removedItemRows.map((x) => clean(x.swine_code)).filter(Boolean);

        if (removedIds.length) {
          step = "ลบรายการหมูที่เอาออก";
          setMsg("กำลังลบรายการหมูที่เอาออก...");
          const res4 = await withTimeout(
            supabase
              .from("swine_shipment_items")
              .delete()
              .in("id", removedIds)
              .select("id"),
            15000,
            "delete removed swine_shipment_items"
          );
          if (res4.error) throw res4.error;
          if (countAffectedRows(res4.data) !== removedIds.length) {
            throw new Error(
              `DELETE_MISMATCH: swine_shipment_items deleted ${countAffectedRows(
                res4.data
              )}/${removedIds.length}`
            );
          }
        }

        if (removedCodes.length) {
          step = "ปล่อยสถานะหมูกลับเป็น available";
          setMsg("กำลังปล่อยสถานะหมูกลับเป็น available...");
          const res5 = await withTimeout(
            supabase
              .from("swine_master")
              .update({ delivery_state: "available" })
              .in("swine_code", removedCodes)
              .select("swine_code"),
            15000,
            "release removed swines"
          );
          if (res5.error) throw res5.error;
          if (countAffectedRows(res5.data) !== removedCodes.length) {
            throw new Error(
              `RELEASE_MISMATCH: swine_master updated ${countAffectedRows(
                res5.data
              )}/${removedCodes.length}`
            );
          }
        }
      }

      step = "รีโหลด shipment หลังบันทึก";
      setMsg("กำลังรีโหลด shipment หลังบันทึก...");
      await openShipment(shipmentId, { silent: true });

      step = "รีเฟรชรายการ draft";
      setMsg("กำลังรีเฟรชรายการ draft...");
      await refreshShipmentList();

      setMsg("บันทึกการแก้ไขสำเร็จ ✅ สถานะยังคงเป็น draft");
    } catch (e) {
      console.error("handleSaveChanges error:", {
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

  async function handleCancelShipment() {
    if (!shipmentHeader?.id) {
      setMsg("กรุณาเลือก shipment ก่อน");
      return;
    }

    const ok = window.confirm(
      "ยืนยันยกเลิก shipment นี้ใช่หรือไม่\nระบบจะเปลี่ยนสถานะเป็น cancelled และปล่อยเบอร์หมูกลับเป็น available"
    );
    if (!ok) return;

    setCancelling(true);
    let step = "เริ่มต้น";
    setMsg("");

    try {
      const shipmentId = shipmentHeader.id;

      step = "โหลดรายการหมูใน shipment";
      setMsg("กำลังโหลดรายการหมูใน shipment...");
      const { data: currentItems, error: e1 } = await supabase
        .from("swine_shipment_items")
        .select("id, swine_code")
        .eq("shipment_id", shipmentId);

      if (e1) throw e1;

      const codes = (currentItems || [])
        .map((x) => clean(x.swine_code))
        .filter(Boolean);

      if (codes.length) {
        step = "ปล่อยสถานะหมูกลับเป็น available";
        setMsg("กำลังปล่อยสถานะหมูกลับเป็น available...");
        const rel = await withTimeout(
          supabase
            .from("swine_master")
            .update({ delivery_state: "available" })
            .in("swine_code", codes)
            .select("swine_code"),
          15000,
          "release shipment swines"
        );
        if (rel.error) throw rel.error;
        if (countAffectedRows(rel.data) !== codes.length) {
          throw new Error(
            `RELEASE_MISMATCH: swine_master updated ${countAffectedRows(
              rel.data
            )}/${codes.length}`
          );
        }
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      step = "เปลี่ยนสถานะ shipment เป็น cancelled";
      setMsg("กำลังเปลี่ยนสถานะ shipment เป็น cancelled...");
      const payload = {
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: user?.id || null,
      };

      const res2 = await withTimeout(
        supabase
          .from("swine_shipments")
          .update(payload)
          .eq("id", shipmentId)
          .eq("status", "draft")
          .select("id"),
        15000,
        "cancel shipment"
      );
      if (res2.error) throw res2.error;
      ensureAffectedRows(res2.data, "cancel shipment");

      // เอาออกจากรายการบนหน้าจอทันที
      setShipmentList((prev) => prev.filter((row) => row.id !== shipmentId));

      // ล้าง editor
      clearEditor();

      // รีเฟรชซ้ำจากฐานข้อมูลอีกครั้ง
      await refreshShipmentList();

      setMsg("ยกเลิก shipment สำเร็จ ✅");
    } catch (e) {
      console.error("handleCancelShipment error:", {
        step,
        message: e?.message,
        code: e?.code,
        details: e?.details,
        hint: e?.hint,
        raw: e,
      });

      setMsg(
        `ยกเลิก shipment ไม่สำเร็จ ที่ขั้นตอน: ${step}${
          e?.message ? ` | ${e.message}` : ""
        }${e?.details ? ` | details: ${e.details}` : ""}${
          e?.hint ? ` | hint: ${e.hint}` : ""
        }`
      );
    } finally {
      setCancelling(false);
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
          <div style={{ fontSize: 18, fontWeight: 800 }}>แก้ไข Shipment (Draft)</div>
          <div className="small" style={{ wordBreak: "break-word" }}>
            ค้นหาจากวันคัด + ฟาร์มต้นทาง + ฟาร์มปลายทาง แล้วเลือก draft ที่ต้องการแก้ไข
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

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 10,
            }}
          >
            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                วันคัด
              </div>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => handleDateChange(e.target.value)}
                style={fullInputStyle}
              />
            </div>

            <div>
              <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                ฟาร์มต้นทาง
              </div>
              <select
                value={filterFromFarmCode}
                onChange={(e) => handleFromFarmChange(e.target.value)}
                disabled={!filterDate || fromFarmLoading}
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
                disabled={!filterDate || !filterFromFarmCode || toFarmLoading}
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
                          วันคัด: <b>{row.selected_date || "-"}</b> | ต้นทาง:{" "}
                          <b>{row.from_farm_name || row.from_farm_code || "-"}</b> |
                          ปลายทาง: <b>{row.to_farm?.farm_name || "-"}</b>
                        </div>
                        <div className="small" style={{ marginTop: 6, color: "#666" }}>
                          สถานะ: <b>{row.status || "-"}</b>
                        </div>
                        <div className="small" style={{ marginTop: 6, color: "#666" }}>
                          สร้างเมื่อ: {row.created_at || "-"} | จำนวนหมู:{" "}
                          <b>{row.item_count}</b> ตัว
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
                    value={shipmentHeader.selected_date || ""}
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
                      shipmentHeader.from_farm_name || shipmentHeader.from_farm_code || ""
                    }
                    readOnly
                    style={{ ...fullInputStyle, background: "#f8fafc" }}
                  />
                </div>

                <div>
                  <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                    ฟาร์มปลายทาง
                  </div>
                  <input
                    value={shipmentHeader.to_farm?.farm_name || ""}
                    readOnly
                    style={{ ...fullInputStyle, background: "#f8fafc" }}
                  />
                </div>
              </div>

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
              <div style={{ fontWeight: 800 }}>
                เบอร์หมูที่คัดแล้ว ({itemRows.length})
              </div>

              {itemRows.length === 0 ? (
                <div className="small" style={{ color: "#666" }}>
                  ยังไม่มีหมูใน shipment นี้
                </div>
              ) : (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 10,
                    }}
                  >
                    <div>
                      <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                        ค้นหาเบอร์หมู
                      </div>
                      <input
                        value={editSwineQ}
                        onChange={(e) => handleEditSwineSearch(e.target.value)}
                        placeholder="พิมพ์เบอร์หมู..."
                        style={fullInputStyle}
                      />
                    </div>

                    <div>
                      <div className="small" style={{ marginBottom: 6, fontWeight: 700 }}>
                        หรือเลือกจากรายการ
                      </div>
                      <select
                        value={selectedEditItemId}
                        onChange={(e) => {
                          setSelectedEditItemId(e.target.value);
                        }}
                        style={fullInputStyle}
                      >
                        <option value="">เลือกเบอร์หมู</option>
                        {filteredEditItems.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.swine_code}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="small" style={{ color: "#666" }}>
                    พบ <b>{filteredEditItems.length}</b> รายการ
                  </div>

                  {selectedEditItem ? (
                    <div
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
                            {selectedEditItem.swine_code}
                          </div>
                          <div className="small" style={{ marginTop: 6, color: "#666" }}>
                            House: {selectedEditItem.house_no || "-"} | Flock:{" "}
                            {selectedEditItem.flock || "-"} | วันเกิด:{" "}
                            {selectedEditItem.birth_date || "-"}
                          </div>
                        </div>

                        <button
                          className="linkbtn"
                          type="button"
                          onClick={() => removeExistingItem(selectedEditItem.id)}
                        >
                          ลบออกจาก shipment
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
                          value={selectedEditItem.teats_left}
                          onChange={(e) =>
                            setExistingField(selectedEditItem.id, "teats_left", e.target.value)
                          }
                          placeholder="เต้าซ้าย"
                          inputMode="numeric"
                          style={smallInputStyle}
                        />
                        <input
                          value={selectedEditItem.teats_right}
                          onChange={(e) =>
                            setExistingField(selectedEditItem.id, "teats_right", e.target.value)
                          }
                          placeholder="เต้าขวา"
                          inputMode="numeric"
                          style={smallInputStyle}
                        />
                        <input
                          value={selectedEditItem.backfat}
                          onChange={(e) =>
                            setExistingField(selectedEditItem.id, "backfat", e.target.value)
                          }
                          placeholder="Backfat"
                          inputMode="decimal"
                          style={smallInputStyle}
                        />
                        <input
                          value={selectedEditItem.weight}
                          onChange={(e) =>
                            setExistingField(selectedEditItem.id, "weight", e.target.value)
                          }
                          placeholder="น้ำหนัก"
                          inputMode="decimal"
                          style={smallInputStyle}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="small" style={{ color: "#666" }}>
                      ไม่พบเบอร์หมูตามคำค้น
                    </div>
                  )}
                </>
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
                        <div style={{ fontWeight: 700 }}>{row.swine_code}</div>
                        <button
                          className="linkbtn"
                          type="button"
                          onClick={() => undoRemoveExistingItem(row.id)}
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
                    onChange={(e) => setAddSwineQ(e.target.value)}
                    placeholder="พิมพ์ swine code..."
                    disabled={!addHouse}
                    style={fullInputStyle}
                  />
                </div>
              </div>

              {!addHouse ? (
                <div className="small" style={{ color: "#666" }}>
                  * กรุณาเลือก House ก่อน เพื่อแสดงเบอร์หมูสำหรับเพิ่ม
                </div>
              ) : (
                <div
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 12,
                    maxHeight: 420,
                    overflowY: "auto",
                    overflowX: "hidden",
                    padding: 10,
                  }}
                >
                  {addCandidateSwines.length === 0 ? (
                    <div className="small" style={{ color: "#666" }}>
                      ไม่พบหมู available ใน House นี้
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {addCandidateSwines.map((swine) => (
                        <div
                          key={swine.id}
                          style={{
                            border: "1px solid #e5e7eb",
                            borderRadius: 14,
                            padding: 12,
                            display: "grid",
                            gridTemplateColumns: "1fr auto",
                            gap: 12,
                            alignItems: "start",
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 800, wordBreak: "break-word" }}>
                              {swine.swine_code}
                            </div>
                            <div className="small" style={{ marginTop: 6, color: "#666" }}>
                              House: {swine.house_no || "-"} | Flock: {swine.flock || "-"} |
                              วันเกิด: {swine.birth_date || "-"}
                            </div>

                            <div
                              style={{
                                marginTop: 10,
                                background: "#fff",
                                border: "1px solid #e5e7eb",
                                borderRadius: 12,
                                padding: 10,
                                width: "fit-content",
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: "#555",
                                  marginBottom: 8,
                                }}
                              >
                                QR Code
                              </div>
                              <img
                                src={qrUrl(swine.swine_code)}
                                alt={`QR ${swine.swine_code}`}
                                loading="lazy"
                                style={{
                                  width: 140,
                                  height: 140,
                                  display: "block",
                                  borderRadius: 8,
                                  background: "#fff",
                                }}
                              />
                              <div
                                style={{
                                  marginTop: 8,
                                  fontSize: 12,
                                  color: "#555",
                                  wordBreak: "break-word",
                                  textAlign: "center",
                                }}
                              >
                                {swine.swine_code}
                              </div>
                            </div>
                          </div>

                          <button
                            className="linkbtn"
                            type="button"
                            onClick={() => addNewSwine(swine)}
                          >
                            เพิ่มเข้า shipment
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

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
                            {row.swine_code}
                          </div>
                          <div className="small" style={{ marginTop: 6, color: "#666" }}>
                            House: {row.house_no || "-"} | Flock: {row.flock || "-"} |
                            วันเกิด: {row.birth_date || "-"}
                          </div>
                        </div>

                        <button
                          className="linkbtn"
                          type="button"
                          onClick={() => removeNewSwine(row.temp_id)}
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

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                width: "100%",
                minWidth: 0,
              }}
            >
              <button
                className="linkbtn"
                type="button"
                onClick={handleSaveChanges}
                disabled={!shipmentHeader?.id || saving || cancelling}
                style={{ flex: "1 1 180px", minWidth: 0 }}
              >
                {saving ? "Saving..." : "บันทึกการแก้ไข"}
              </button>

              <button
                className="linkbtn"
                type="button"
                onClick={handleCancelShipment}
                disabled={!shipmentHeader?.id || saving || cancelling}
                style={{ flex: "1 1 180px", minWidth: 0 }}
              >
                {cancelling ? "Cancelling..." : "ยกเลิก Shipment"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
