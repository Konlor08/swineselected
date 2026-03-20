// src/pages/ShipmentCreatePage.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
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

export default function ShipmentCreatePage() {
  const nav = useNavigate();

  const [bootLoading, setBootLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [currentUserId, setCurrentUserId] = useState("");

  const [selectedDate, setSelectedDate] = useState(todayYmdLocal());

  // ต้นทาง = เลือกจากเบอร์หมูที่คัดได้
  const [fromQ, setFromQ] = useState("");
  const [fromLoading, setFromLoading] = useState(false);
  const [fromOptions, setFromOptions] = useState([]);
  const [fromFarm, setFromFarm] = useState(null);
  const [fromPickerOpen, setFromPickerOpen] = useState(true);

  // ปลายทาง = ยังใช้ picker ปกติ
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
        console.error("load toFarm error:", e);
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

  const isSameFarm = useMemo(() => {
    return (
      !!clean(fromFarm?.farm_code) &&
      !!clean(toFarm?.farm_code) &&
      clean(fromFarm?.farm_code) === clean(toFarm?.farm_code)
    );
  }, [fromFarm?.farm_code, toFarm?.farm_code]);

  const hardErrors = useMemo(() => {
    const errors = [];

    if (!clean(selectedDate)) {
      errors.push("กรุณาเลือกวันคัด");
    }

    if (!fromFarm?.farm_code) {
      errors.push("กรุณาเลือกฟาร์มต้นทางจากรายการเบอร์หมูที่คัดได้");
    }

    if (!clean(toFarmId)) {
      errors.push("กรุณาเลือกฟาร์มปลายทาง");
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
  }, [selectedDate, fromFarm, toFarmId, toFarm?.id, isSameFarm]);

  const canSave = useMemo(() => {
    return !bootLoading && !saving && hardErrors.length === 0;
  }, [bootLoading, saving, hardErrors.length]);

  const openEditPage = useCallback(
    (shipmentId) => {
      nav(`/edit-shipment?shipmentId=${encodeURIComponent(shipmentId)}`);
    },
    [nav]
  );

  const handleSelectFromFarm = useCallback((farm) => {
    setMsg("");
    setFromFarm(farm || null);
    if (farm) setFromPickerOpen(false);
  }, []);

  const clearFromFarm = useCallback(() => {
    setFromFarm(null);
    setFromQ("");
    setFromPickerOpen(true);
  }, []);

  const onChangeToFarm = useCallback((id) => {
    setMsg("");
    setToFarmId(id || null);
    if (id) setToPickerOpen(false);
  }, []);

  const saveDraft = useCallback(async () => {
    if (hardErrors.length > 0) {
      setMsg(hardErrors.join(" | "));
      return;
    }

    setSaving(true);
    setMsg("");

    try {
      const uid = currentUserId || (await getCurrentUserId());
      if (!uid) {
        throw new Error("ไม่พบผู้ใช้งานปัจจุบัน");
      }

      const fromFarmCode = clean(fromFarm?.farm_code);
      if (!fromFarmCode) {
        throw new Error("ฟาร์มต้นทางไม่มี farm_code");
      }

      // กัน draft ซ้ำของ user เดิมในชุดเดียวกัน
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

      if (existingDraft?.id) {
        openEditPage(existingDraft.id);
        return;
      }

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

      openEditPage(data.id);
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
    openEditPage,
    remark,
    selectedDate,
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
      <h2 style={{ margin: 0 }}>สร้าง Shipment</h2>

      {msg ? (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#991b1b",
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
            setSelectedDate(e.target.value);
          }}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
        />
      </label>

      {fromFarm && !fromPickerOpen ? (
        <FarmSelectedCard
          title="ฟาร์มต้นทาง (คัด/ดัด/จับออก) — เลือกจากเบอร์หมู"
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
              ฟาร์มต้นทาง (คัด/ดัด/จับออก) — เลือกจากเบอร์หมู
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
      </div>

      <div style={{ color: "#666", fontSize: 12, lineHeight: 1.7 }}>
        ฟาร์มต้นทางจะเลือกจาก <b>v_swine_source_farms</b> ซึ่งเป็นรายการที่มีเบอร์หมูคัดได้
        <br />
        ถ้ามี draft เดิมของ user คนเดิมในวันคัด + ต้นทาง + ปลายทาง เดียวกัน ระบบจะเปิด draft เดิมให้อัตโนมัติ
      </div>
    </div>
  );
}