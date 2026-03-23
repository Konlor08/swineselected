// src/pages/ShipmentCreatePage.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatDateDisplay } from "../lib/dateFormat";
import FarmPickerInlineAdd from "../components/FarmPickerInlineAdd.jsx";

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

function sortByLabel(a, b) {
  return String(a?.label || "").localeCompare(String(b?.label || ""), "th");
}

function uniqBy(arr, getKey) {
  const map = new Map();
  for (const item of arr || []) {
    const key = getKey(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw error;
  return user?.id || null;
}

function FarmSelectedCard({ title, farm, subtitle, onChange }) {
  return (
    <div
      style={{
        border: "1px solid #dbe4ea",
        borderRadius: 14,
        padding: 12,
        background: "#f8fafc",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ fontWeight: 900 }}>{title}</div>

      {farm ? (
        <>
          <div style={{ fontSize: 18, fontWeight: 900 }}>
            {clean(farm.farm_code) || "-"} - {clean(farm.farm_name) || "-"}
          </div>

          {subtitle ? (
            <div style={{ color: "#64748b", fontSize: 13 }}>{subtitle}</div>
          ) : null}
        </>
      ) : (
        <div style={{ color: "#64748b", fontSize: 13 }}>ยังไม่ได้เลือกฟาร์ม</div>
      )}

      <div>
        <button type="button" onClick={onChange}>
          เปลี่ยนฟาร์ม
        </button>
      </div>
    </div>
  );
}

function SwineChip({ item, onRemove }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid #bbf7d0",
        background: "#f0fdf4",
        fontSize: 13,
      }}
    >
      <span style={{ fontWeight: 700 }}>{clean(item?.swine_code) || "-"}</span>
      {clean(item?.house_no) ? <span>บ้าน {item.house_no}</span> : null}
      {clean(item?.block) ? <span>• Block {item.block}</span> : null}
      <button
        type="button"
        onClick={onRemove}
        style={{
          border: 0,
          background: "transparent",
          cursor: "pointer",
          color: "#166534",
          fontWeight: 900,
        }}
      >
        ×
      </button>
    </div>
  );
}

export default function ShipmentCreatePage() {
  const nav = useNavigate();

  const [bootLoading, setBootLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [currentUserId, setCurrentUserId] = useState("");
  const [lastDraftId, setLastDraftId] = useState("");

  const [selectedDate, setSelectedDate] = useState(todayYmdLocal());

  const [fromQ, setFromQ] = useState("");
  const [fromLoading, setFromLoading] = useState(false);
  const [fromOptions, setFromOptions] = useState([]);
  const [fromFarm, setFromFarm] = useState(null);
  const [fromPickerOpen, setFromPickerOpen] = useState(true);

  const [swineQ, setSwineQ] = useState("");
  const [swineLoading, setSwineLoading] = useState(false);
  const [swineOptions, setSwineOptions] = useState([]);
  const [selectedSwines, setSelectedSwines] = useState([]);
  const [swinePickerOpen, setSwinePickerOpen] = useState(true);
  const [swineLoadHint, setSwineLoadHint] = useState("");

  const [toFarmId, setToFarmId] = useState(null);
  const [toFarm, setToFarm] = useState(null);
  const [toPickerOpen, setToPickerOpen] = useState(true);

  const [remark, setRemark] = useState("");

  useEffect(() => {
    let alive = true;

    async function init() {
      setBootLoading(true);
      try {
        const uid = await getCurrentUserId();
        if (!alive) return;
        setCurrentUserId(uid || "");
      } catch (e) {
        console.error("ShipmentCreatePage init error:", e);
        if (alive) setMsg(e?.message || "โหลดข้อมูลเริ่มต้นไม่สำเร็จ");
      } finally {
        if (alive) setBootLoading(false);
      }
    }

    void init();
    return () => {
      alive = false;
    };
  }, []);

  const loadFromFarms = useCallback(async () => {
    setFromLoading(true);
    setMsg("");

    try {
      const { data, error } = await supabase
        .from("v_swine_source_farms")
        .select(
          "farm_code, farm_name, flock, swine_count, first_saved_date, cutoff_date, is_selectable"
        )
        .eq("is_selectable", true)
        .order("farm_code", { ascending: true });

      if (error) throw error;

      const arr = (data || [])
        .map((r) => ({
          farm_code: clean(r.farm_code),
          farm_name: clean(r.farm_name) || clean(r.farm_code),
          flock: clean(r.flock),
          branch_id: null,
          swine_count: Number(r.swine_count || 0),
          first_saved_date: r.first_saved_date || null,
          cutoff_date: r.cutoff_date || null,
          is_selectable: r.is_selectable !== false,
          label: `${clean(r.farm_code)} - ${clean(r.farm_name) || clean(r.farm_code)}`,
        }))
        .filter((x) => x.farm_code && x.is_selectable);

      setFromOptions(arr);
    } catch (e) {
      console.error("loadFromFarms error:", e);
      setFromOptions([]);
      setMsg(e?.message || "โหลดฟาร์มต้นทางไม่สำเร็จ");
    } finally {
      setFromLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFromFarms();
  }, [loadFromFarms]);

  useEffect(() => {
    let alive = true;

    async function loadToFarm() {
      if (!toFarmId) {
        setToFarm(null);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("master_farms")
          .select("id, farm_code, farm_name")
          .eq("id", toFarmId)
          .single();

        if (!alive) return;
        if (error) throw error;

        setToFarm(data || null);
      } catch (e) {
        console.error("loadToFarm error:", e);
        if (alive) {
          setToFarm(null);
          setMsg(e?.message || "โหลดฟาร์มปลายทางไม่สำเร็จ");
        }
      }
    }

    void loadToFarm();
    return () => {
      alive = false;
    };
  }, [toFarmId]);

  const filteredFromOptions = useMemo(() => {
    const q = clean(fromQ).toLowerCase();

    const result = !q
      ? fromOptions.slice(0, 30)
      : fromOptions
          .filter((x) =>
            `${x.farm_code} ${x.farm_name} ${x.flock}`.toLowerCase().includes(q)
          )
          .slice(0, 30);

    return result.sort(sortByLabel);
  }, [fromOptions, fromQ]);

  const filteredSwineOptions = useMemo(() => {
    const q = clean(swineQ).toLowerCase();

    const result = !q
      ? swineOptions.slice(0, 100)
      : swineOptions
          .filter((x) =>
            `${x.swine_code} ${x.farm_code} ${x.farm_name} ${x.house_no} ${x.block}`
              .toLowerCase()
              .includes(q)
          )
          .slice(0, 100);

    return result.sort(sortByLabel);
  }, [swineOptions, swineQ]);

  const selectedSwineCodes = useMemo(() => {
    return new Set(selectedSwines.map((x) => clean(x.swine_code)));
  }, [selectedSwines]);

  const isSameFarm = useMemo(() => {
    return (
      !!clean(fromFarm?.farm_code) &&
      !!clean(toFarm?.farm_code) &&
      clean(fromFarm?.farm_code) === clean(toFarm?.farm_code)
    );
  }, [fromFarm?.farm_code, toFarm?.farm_code]);

  useEffect(() => {
    setSelectedSwines([]);
    setSwineQ("");
    setSwineOptions([]);
    setSwinePickerOpen(true);
    setSwineLoadHint("");
    setLastDraftId("");
  }, [fromFarm?.farm_code, fromFarm?.flock, selectedDate]);

  const loadSwines = useCallback(async () => {
    const farmCode = clean(fromFarm?.farm_code);

    if (!farmCode) {
      setSwineOptions([]);
      setSwineLoadHint("");
      return;
    }

    setSwineLoading(true);
    setSwineLoadHint("");

    try {
      const { data, error } = await supabase
        .from("swines")
        .select("id, swine_code, farm_code, farm_name, house_no, block")
        .eq("farm_code", farmCode)
        .order("swine_code", { ascending: true });

      if (error) throw error;

      const arr = uniqBy(
        (data || []).map((r) => ({
          id: r.id || null,
          swine_id: r.id || null,
          swine_code: clean(r.swine_code),
          farm_code: clean(r.farm_code),
          farm_name: clean(r.farm_name),
          house_no: clean(r.house_no),
          block: clean(r.block),
          label: `${clean(r.swine_code)}${clean(r.house_no) ? ` • บ้าน ${clean(r.house_no)}` : ""}${
            clean(r.block) ? ` • Block ${clean(r.block)}` : ""
          }`,
        })),
        (x) => clean(x.swine_code)
      ).filter((x) => x.swine_code);

      setSwineOptions(arr);
      setSwineLoadHint(arr.length > 0 ? `พบ ${arr.length} เบอร์` : "ไม่พบเบอร์หมูของฟาร์มนี้");
    } catch (e) {
      console.error("loadSwines error:", e);
      setSwineOptions([]);
      setSwineLoadHint(e?.message || "โหลดเบอร์หมูไม่สำเร็จ");
    } finally {
      setSwineLoading(false);
    }
  }, [fromFarm?.farm_code]);

  useEffect(() => {
    if (!fromFarm?.farm_code) return;
    void loadSwines();
  }, [fromFarm?.farm_code, loadSwines]);

  const hardErrors = useMemo(() => {
    const errors = [];

    if (!clean(selectedDate)) {
      errors.push("กรุณาเลือกวันคัด");
    }

    if (!fromFarm?.farm_code) {
      errors.push("กรุณาเลือกฟาร์มต้นทางจากรายการที่คัดได้");
    }

    if (!clean(toFarmId)) {
      errors.push("กรุณาเลือกฟาร์มปลายทาง");
    }

    if (selectedSwines.length <= 0) {
      errors.push("กรุณาเลือกเบอร์หมูอย่างน้อย 1 ตัว");
    }

    if (isSameFarm) {
      errors.push("ห้ามเลือกฟาร์มต้นทางและปลายทางซ้ำกัน");
    }

    if (fromFarm && !clean(fromFarm?.farm_code)) {
      errors.push("ฟาร์มต้นทางไม่มี farm_code");
    }

    if (toFarmId && !clean(toFarm?.id)) {
      errors.push("ฟาร์มปลายทางไม่มี id");
    }

    return errors;
  }, [selectedDate, fromFarm, toFarmId, toFarm?.id, selectedSwines.length, isSameFarm]);

  const canSave = useMemo(() => {
    return !bootLoading && !saving && hardErrors.length === 0;
  }, [bootLoading, saving, hardErrors.length]);

  const handleSelectFromFarm = useCallback((farm) => {
    setMsg("");
    setFromFarm(farm || null);
    setSelectedSwines([]);
    setSwineQ("");
    setSwineOptions([]);
    setSwinePickerOpen(true);
    setSwineLoadHint("");
    setLastDraftId("");
    if (farm) setFromPickerOpen(false);
  }, []);

  const clearFromFarm = useCallback(() => {
    setFromFarm(null);
    setFromQ("");
    setFromPickerOpen(true);
    setSelectedSwines([]);
    setSwineQ("");
    setSwineOptions([]);
    setSwinePickerOpen(true);
    setSwineLoadHint("");
    setLastDraftId("");
  }, []);

  const toggleSwine = useCallback((swine) => {
    const code = clean(swine?.swine_code);
    if (!code) return;

    setMsg("");
    setLastDraftId("");

    setSelectedSwines((prev) => {
      const exists = prev.some((x) => clean(x.swine_code) === code);
      if (exists) {
        return prev.filter((x) => clean(x.swine_code) !== code);
      }
      return [...prev, swine].sort((a, b) =>
        clean(a.swine_code).localeCompare(clean(b.swine_code), "th")
      );
    });
  }, []);

  const removeSelectedSwine = useCallback((swineCode) => {
    const code = clean(swineCode);
    setSelectedSwines((prev) => prev.filter((x) => clean(x.swine_code) !== code));
    setLastDraftId("");
  }, []);

  const clearSwine = useCallback(() => {
    setSelectedSwines([]);
    setSwineQ("");
    setSwinePickerOpen(true);
    setLastDraftId("");
  }, []);

  const onChangeToFarm = useCallback((id) => {
    setMsg("");
    setToFarmId(id || null);
    if (id) setToPickerOpen(false);
    setLastDraftId("");
  }, []);

  const saveDraft = useCallback(async () => {
    if (hardErrors.length > 0) {
      setMsg(hardErrors.join(" | "));
      return;
    }

    setSaving(true);
    setMsg("");
    setLastDraftId("");

    try {
      const uid = currentUserId || (await getCurrentUserId());
      if (!uid) {
        throw new Error("ไม่พบผู้ใช้งานปัจจุบัน");
      }

      const fromFarmCode = clean(fromFarm?.farm_code);
      if (!fromFarmCode) {
        throw new Error("ฟาร์มต้นทางไม่มี farm_code");
      }

      const selectedItems = uniqBy(
        selectedSwines
          .map((x) => ({
            swine_code: clean(x.swine_code),
            swine_id: x.swine_id || x.id || null,
            block: clean(x.block) || null,
          }))
          .filter((x) => x.swine_code),
        (x) => x.swine_code
      );

      if (selectedItems.length <= 0) {
        throw new Error("ยังไม่ได้เลือกเบอร์หมู");
      }

      const { data: existingDraft, error: existingErr } = await supabase
        .from("swine_shipments")
        .select("id")
        .eq("selected_date", selectedDate)
        .eq("from_farm_code", fromFarmCode)
        .eq("to_farm_id", toFarmId)
        .eq("status", "draft")
        .eq("created_by", uid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingErr) throw existingErr;

      let shipmentId = existingDraft?.id || null;

      if (!shipmentId) {
        const payload = {
          selected_date: selectedDate,
          from_farm_code: fromFarmCode || null,
          from_farm_name: clean(fromFarm?.farm_name) || null,
          from_flock: clean(fromFarm?.flock) || null,
          from_branch_id: fromFarm?.branch_id || null,
          to_farm_id: toFarmId,
          remark: clean(remark) || null,
          status: "draft",
          created_by: uid,
        };

        const { data, error } = await supabase
          .from("swine_shipments")
          .insert([payload])
          .select("id")
          .single();

        if (error) throw error;
        if (!data?.id) throw new Error("สร้าง draft ไม่สำเร็จ");
        shipmentId = data.id;
      } else {
        const { error: updateErr } = await supabase
          .from("swine_shipments")
          .update({
            remark: clean(remark) || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", shipmentId);

        if (updateErr) throw updateErr;

        const { error: deleteItemsErr } = await supabase
          .from("swine_shipment_items")
          .delete()
          .eq("shipment_id", shipmentId);

        if (deleteItemsErr) throw deleteItemsErr;
      }

      const itemPayload = selectedItems.map((x, idx) => ({
        shipment_id: shipmentId,
        swine_code: x.swine_code,
        swine_id: x.swine_id || null,
        block: x.block || null,
        selection_no: idx + 1,
      }));

      const { error: itemErr } = await supabase
        .from("swine_shipment_items")
        .insert(itemPayload);

      if (itemErr) throw itemErr;

      setLastDraftId(shipmentId);
      setMsg(
        `บันทึก Draft สำเร็จ ✅ จำนวน ${selectedItems.length} ตัว`
      );
    } catch (e) {
      console.error("saveDraft error:", e);
      setMsg(e?.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }, [
    currentUserId,
    fromFarm,
    hardErrors,
    remark,
    selectedDate,
    selectedSwines,
    toFarmId,
  ]);

  if (bootLoading) {
    return (
      <div style={{ padding: 16 }}>
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "grid", gap: 14 }}>
      <h2 style={{ margin: 0 }}>Create Shipment</h2>

      <div
        style={{
          padding: 12,
          borderRadius: 12,
          border: "1px solid #dbe4ea",
          background: "#f8fafc",
          color: "#334155",
          lineHeight: 1.7,
        }}
      >
        หน้านี้จะสร้าง Draft ที่ <b>swine_shipments</b> แล้วบันทึกรายการหมูที่เลือกลง
        <b> swine_shipment_items</b>
      </div>

      {msg ? (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            border: msg.includes("สำเร็จ")
              ? "1px solid #bbf7d0"
              : "1px solid #fecaca",
            background: msg.includes("สำเร็จ") ? "#f0fdf4" : "#fef2f2",
            color: msg.includes("สำเร็จ") ? "#166534" : "#991b1b",
            fontWeight: 700,
            lineHeight: 1.7,
          }}
        >
          {msg}
        </div>
      ) : null}

      <label style={{ display: "grid", gap: 6, maxWidth: 260 }}>
        วันคัด
        <input
          type="date"
          value={selectedDate}
          max={todayYmdLocal()}
          onChange={(e) => {
            setMsg("");
            setLastDraftId("");
            setSelectedDate(e.target.value);
          }}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
        />
        <div style={{ color: "#64748b", fontSize: 12 }}>
          แสดงผล: {formatDateDisplay(selectedDate)}
        </div>
      </label>

      {fromFarm && !fromPickerOpen ? (
        <FarmSelectedCard
          title="ฟาร์มต้นทาง (คัด/ดัด/จับออก)"
          farm={fromFarm}
          subtitle={
            fromFarm?.flock
              ? `Flock: ${fromFarm.flock}${
                  Number.isFinite(fromFarm?.swine_count)
                    ? ` | คัดได้ ${fromFarm.swine_count} ตัว`
                    : ""
                }`
              : Number.isFinite(fromFarm?.swine_count)
              ? `คัดได้ ${fromFarm.swine_count} ตัว`
              : ""
          }
          onChange={() => setFromPickerOpen(true)}
        />
      ) : (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 12,
            display: "grid",
            gap: 10,
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
            <div style={{ fontWeight: 900 }}>
              ฟาร์มต้นทาง (คัด/ดัด/จับออก) — เลือกจากรายการที่คัดได้
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={loadFromFarms} disabled={fromLoading}>
                {fromLoading ? "กำลังโหลด..." : "รีเฟรช"}
              </button>

              <button type="button" onClick={clearFromFarm} disabled={fromLoading}>
                ล้างค่า
              </button>
            </div>
          </div>

          <input
            value={fromQ}
            onChange={(e) => setFromQ(e.target.value)}
            placeholder="พิมพ์ค้นหา farm code / farm name / flock…"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              overflow: "hidden",
              maxHeight: 320,
              overflowY: "auto",
            }}
          >
            {fromLoading ? (
              <div style={{ padding: 12, color: "#666" }}>กำลังโหลด...</div>
            ) : filteredFromOptions.length > 0 ? (
              filteredFromOptions.map((f) => {
                const active =
                  clean(fromFarm?.farm_code) === clean(f.farm_code) &&
                  clean(fromFarm?.flock) === clean(f.flock);

                return (
                  <button
                    key={`${f.farm_code}__${f.flock || "-"}__${f.farm_name}`}
                    type="button"
                    onClick={() => handleSelectFromFarm(f)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: 0,
                      borderBottom: "1px solid #eee",
                      background: active ? "#fef9c3" : "white",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 800, wordBreak: "break-word" }}>
                      {f.farm_code} - {f.farm_name}
                    </div>

                    <div style={{ marginTop: 4, fontSize: 12, color: "#666" }}>
                      Flock: <b>{f.flock || "-"}</b>
                      {Number.isFinite(f.swine_count) ? (
                        <>
                          {" "}
                          | คัดได้ <b>{f.swine_count}</b> ตัว
                        </>
                      ) : null}
                    </div>
                  </button>
                );
              })
            ) : (
              <div style={{ padding: 12, color: "#666" }}>ไม่พบฟาร์มต้นทาง</div>
            )}
          </div>
        </div>
      )}

      {fromFarm ? (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 12,
            display: "grid",
            gap: 10,
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
            <div style={{ fontWeight: 900 }}>
              เบอร์หมู — เลือกได้หลายตัวจากฟาร์มต้นทาง
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={loadSwines} disabled={swineLoading}>
                {swineLoading ? "กำลังโหลด..." : "รีเฟรช"}
              </button>

              <button type="button" onClick={clearSwine} disabled={swineLoading}>
                ล้างรายการเลือก
              </button>

              <button
                type="button"
                onClick={() => setSwinePickerOpen((v) => !v)}
                disabled={swineLoading}
              >
                {swinePickerOpen ? "ซ่อนรายการ" : "แสดงรายการ"}
              </button>
            </div>
          </div>

          <input
            value={swineQ}
            onChange={(e) => setSwineQ(e.target.value)}
            placeholder="พิมพ์ค้นหา swine code / house / block…"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />

          {swineLoadHint ? (
            <div style={{ color: "#64748b", fontSize: 12 }}>{swineLoadHint}</div>
          ) : null}

          <div
            style={{
              border: "1px solid #dbe4ea",
              borderRadius: 12,
              padding: 10,
              background: "#f8fafc",
              display: "grid",
              gap: 8,
            }}
          >
            <div style={{ fontWeight: 800 }}>
              เลือกแล้ว {selectedSwines.length} ตัว
            </div>

            {selectedSwines.length > 0 ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {selectedSwines.map((item) => (
                  <SwineChip
                    key={clean(item.swine_code)}
                    item={item}
                    onRemove={() => removeSelectedSwine(item.swine_code)}
                  />
                ))}
              </div>
            ) : (
              <div style={{ color: "#64748b", fontSize: 13 }}>
                ยังไม่ได้เลือกเบอร์หมู
              </div>
            )}
          </div>

          {swinePickerOpen ? (
            <div
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                overflow: "hidden",
                maxHeight: 360,
                overflowY: "auto",
              }}
            >
              {swineLoading ? (
                <div style={{ padding: 12, color: "#666" }}>กำลังโหลด...</div>
              ) : filteredSwineOptions.length > 0 ? (
                filteredSwineOptions.map((s) => {
                  const active = selectedSwineCodes.has(clean(s.swine_code));

                  return (
                    <button
                      key={clean(s.swine_code)}
                      type="button"
                      onClick={() => toggleSwine(s)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        border: 0,
                        borderBottom: "1px solid #eee",
                        background: active ? "#dcfce7" : "white",
                        cursor: "pointer",
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
                        <div style={{ fontWeight: 800, wordBreak: "break-word" }}>
                          {s.swine_code || "-"}
                        </div>
                        <div style={{ fontSize: 12, color: active ? "#166534" : "#666" }}>
                          {active ? "เลือกแล้ว" : "กดเพื่อเลือก"}
                        </div>
                      </div>

                      <div style={{ marginTop: 4, fontSize: 12, color: "#666" }}>
                        {s.farm_code || "-"}
                        {s.farm_name ? ` - ${s.farm_name}` : ""}
                        {s.house_no ? ` | บ้าน ${s.house_no}` : ""}
                        {s.block ? ` | Block ${s.block}` : ""}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div style={{ padding: 12, color: "#666" }}>ไม่พบเบอร์หมู</div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {toFarmId && !toPickerOpen ? (
        <FarmSelectedCard
          title="ฟาร์มปลายทาง (ส่งไป) — เพิ่มใหม่ได้"
          farm={toFarm}
          onChange={() => setToPickerOpen(true)}
        />
      ) : (
        <FarmPickerInlineAdd
          label="ฟาร์มปลายทาง (ส่งไป) — เพิ่มใหม่ได้"
          value={toFarmId}
          excludeId={null}
          onChange={onChangeToFarm}
          requireBranch={false}
        />
      )}

      {isSameFarm ? (
        <div style={{ color: "crimson", fontWeight: 700 }}>
          ห้ามเลือกฟาร์มต้นทางและปลายทางซ้ำกัน
        </div>
      ) : null}

      <label style={{ display: "grid", gap: 6 }}>
        หมายเหตุ
        <textarea
          value={remark}
          onChange={(e) => {
            setMsg("");
            setRemark(e.target.value);
          }}
          rows={3}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
        />
      </label>

      {hardErrors.length > 0 ? (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            background: "#fff7ed",
            border: "1px solid #fdba74",
            color: "#9a3412",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 6 }}>ยัง Save Draft ไม่ได้</div>
          <div style={{ display: "grid", gap: 4 }}>
            {hardErrors.map((x, i) => (
              <div key={i}>- {x}</div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={saveDraft} disabled={!canSave}>
          {saving ? "กำลังบันทึก..." : "Save Draft"}
        </button>

        <button
          type="button"
          onClick={() => {
            if (lastDraftId) {
              nav(`/edit-shipment?id=${encodeURIComponent(lastDraftId)}`);
            } else {
              nav("/edit-shipment");
            }
          }}
        >
          {lastDraftId ? "เปิด Draft ที่เพิ่งบันทึก" : "ไปหน้า Edit Draft"}
        </button>
      </div>

      <div style={{ color: "#666", fontSize: 12, lineHeight: 1.7 }}>
        ถ้ามี Draft เดิมของ user คนเดิมในวันคัด + ต้นทาง + ปลายทาง เดียวกัน
        ระบบจะใช้ draft เดิม แล้วลบรายการหมูเดิมใน draft นั้นก่อน จากนั้น insert รายการใหม่แทน
      </div>
    </div>
  );
}