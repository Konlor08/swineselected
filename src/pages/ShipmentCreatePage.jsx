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

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw error;
  return user?.id || null;
}

function FarmSelectedCard({ title, farm, onChange }) {
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

          {"branch_id" in farm ? (
            <div style={{ color: "#64748b", fontSize: 13 }}>
              branch_id: {clean(farm.branch_id) || "-"}
            </div>
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
  const [fromFarmId, setFromFarmId] = useState(null);
  const [toFarmId, setToFarmId] = useState(null);
  const [remark, setRemark] = useState("");

  const [fromFarm, setFromFarm] = useState(null);
  const [toFarm, setToFarm] = useState(null);

  const [fromPickerOpen, setFromPickerOpen] = useState(true);
  const [toPickerOpen, setToPickerOpen] = useState(true);

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

  useEffect(() => {
    let alive = true;

    async function loadFromFarm() {
      if (!fromFarmId) {
        setFromFarm(null);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("swine_farms")
          .select("id, farm_code, farm_name, branch_id")
          .eq("id", fromFarmId)
          .single();

        if (!alive) return;
        if (error) throw error;

        setFromFarm(data || null);
      } catch (e) {
        console.error("load fromFarm error:", e);
        if (alive) {
          setFromFarm(null);
          setMsg(e?.message || "โหลดฟาร์มต้นทางไม่สำเร็จ");
        }
      }
    }

    void loadFromFarm();
    return () => {
      alive = false;
    };
  }, [fromFarmId]);

  useEffect(() => {
    let alive = true;

    async function loadToFarm() {
      if (!toFarmId) {
        setToFarm(null);
        return;
      }

      try {
        // ปลายทางตาม schema ล่าสุดอ้างอิง master_farms
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

  const isSame = useMemo(() => {
    return !!fromFarmId && !!toFarmId && fromFarmId === toFarmId;
  }, [fromFarmId, toFarmId]);

  const hardErrors = useMemo(() => {
    const errors = [];

    if (!clean(selectedDate)) {
      errors.push("กรุณาเลือกวันคัด");
    }

    if (!fromFarmId) {
      errors.push("กรุณาเลือกฟาร์มต้นทาง");
    }

    if (!toFarmId) {
      errors.push("กรุณาเลือกฟาร์มปลายทาง");
    }

    if (fromFarmId && toFarmId && fromFarmId === toFarmId) {
      errors.push("ห้ามเลือกฟาร์มต้นทางและปลายทางซ้ำกัน");
    }

    if (fromFarmId && !clean(fromFarm?.farm_code)) {
      errors.push("ฟาร์มต้นทางไม่มี farm_code");
    }

    if (toFarmId && !clean(toFarm?.id)) {
      errors.push("ฟาร์มปลายทางไม่มี id");
    }

    return errors;
  }, [selectedDate, fromFarmId, toFarmId, fromFarm?.farm_code, toFarm?.id]);

  const canSave = useMemo(() => {
    return !bootLoading && !saving && hardErrors.length === 0;
  }, [bootLoading, saving, hardErrors.length]);

  const onChangeFromFarm = useCallback((id) => {
    setMsg("");
    setFromFarmId(id || null);
    if (id) setFromPickerOpen(false);
  }, []);

  const onChangeToFarm = useCallback((id) => {
    setMsg("");
    setToFarmId(id || null);
    if (id) setToPickerOpen(false);
  }, []);

  const openEditPage = useCallback(
    (shipmentId) => {
      nav(`/edit-shipment?shipmentId=${encodeURIComponent(shipmentId)}`);
    },
    [nav]
  );

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

      if (!fromFarm?.id) {
        throw new Error("ไม่พบข้อมูลฟาร์มต้นทาง");
      }

      const fromFarmCode = clean(fromFarm.farm_code);
      if (!fromFarmCode) {
        throw new Error("ฟาร์มต้นทางไม่มี farm_code");
      }

      // กันซ้ำแบบเบา ๆ: ถ้ามี draft เดิมของ user คนเดิมในชุดเดียวกัน ให้เปิด draft เดิม
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
        from_farm_name: clean(fromFarm.farm_name) || null,
        from_branch_id: fromFarm.branch_id || null,
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
          onChange={(e) => {
            setMsg("");
            setSelectedDate(e.target.value);
          }}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
        />
      </label>

      {fromFarmId && !fromPickerOpen ? (
        <FarmSelectedCard
          title="ฟาร์มต้นทาง (คัด/ดัด/จับออก)"
          farm={fromFarm}
          onChange={() => setFromPickerOpen(true)}
        />
      ) : (
        <FarmPickerInlineAdd
          label="ฟาร์มต้นทาง (คัด/ดัด/จับออก)"
          value={fromFarmId}
          excludeId={toFarmId}
          onChange={onChangeFromFarm}
          requireBranch={false}
        />
      )}

      {toFarmId && !toPickerOpen ? (
        <FarmSelectedCard
          title="ฟาร์มปลายทาง (ส่งไป)"
          farm={toFarm}
          onChange={() => setToPickerOpen(true)}
        />
      ) : (
        <FarmPickerInlineAdd
          label="ฟาร์มปลายทาง (ส่งไป)"
          value={toFarmId}
          excludeId={fromFarmId}
          onChange={onChangeToFarm}
          requireBranch={false}
        />
      )}

      {isSame ? (
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
        ระบบจะตรวจ Error ก่อนบันทึก
        <br />
        ถ้ามี draft เดิมของ user คนเดิมในวันคัด + ต้นทาง + ปลายทาง เดียวกัน ระบบจะเปิด draft เดิมให้ทันที
      </div>
    </div>
  );
}