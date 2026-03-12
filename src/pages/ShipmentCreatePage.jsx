import React, { useCallback, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import FarmPickerInlineAdd from "../components/FarmPickerInlineAdd.jsx";

export default function ShipmentCreatePage() {
  const [saving, setSaving] = useState(false);

  const [fromFarmId, setFromFarmId] = useState(null);
  const [toFarmId, setToFarmId] = useState(null);
  const [remark, setRemark] = useState("");

  const isSame = useMemo(() => {
    return !!fromFarmId && !!toFarmId && fromFarmId === toFarmId;
  }, [fromFarmId, toFarmId]);

  const canSave = useMemo(() => {
    return !!fromFarmId && !!toFarmId && !isSame;
  }, [fromFarmId, toFarmId, isSame]);

  const saveDraft = useCallback(async () => {
    if (!canSave) {
      alert("กรุณาเลือกฟาร์มต้นทางและปลายทางให้ครบ และห้ามซ้ำกัน");
      return;
    }

    setSaving(true);
    try {
      const { data: fromFarm, error: fromErr } = await supabase
        .from("swine_farms")
        .select("id, farm_code, farm_name, branch_id")
        .eq("id", fromFarmId)
        .single();

      if (fromErr) throw fromErr;
      if (!fromFarm) throw new Error("ไม่พบข้อมูลฟาร์มต้นทาง");

      const payload = {
        from_farm_code: fromFarm.farm_code || null,
        from_farm_name: fromFarm.farm_name || null,
        from_branch_id: fromFarm.branch_id || null,
        to_farm_id: toFarmId,
        remark: remark || null,
        status: "draft",
      };

      const { data, error } = await supabase
        .from("swine_shipments")
        .insert([payload])
        .select("*")
        .single();

      if (error) throw error;

      alert(`บันทึก Draft สำเร็จ (id: ${data.id})`);
    } catch (e) {
      console.error("saveDraft error:", e);
      alert(e?.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }, [canSave, fromFarmId, remark, toFarmId]);

  return (
    <div style={{ padding: 16, display: "grid", gap: 14 }}>
      <h2 style={{ margin: 0 }}>สร้าง Shipment</h2>

      <FarmPickerInlineAdd
        label="ฟาร์มต้นทาง (คัด/ดัด/จับออก)"
        value={fromFarmId}
        excludeId={toFarmId}
        onChange={setFromFarmId}
        requireBranch={false}
      />

      <FarmPickerInlineAdd
        label="ฟาร์มปลายทาง (ส่งไป)"
        value={toFarmId}
        excludeId={fromFarmId}
        onChange={setToFarmId}
        requireBranch={false}
      />

      {isSame && (
        <div style={{ color: "crimson", fontWeight: 700 }}>
          ห้ามเลือกฟาร์มต้นทางและปลายทางซ้ำกัน
        </div>
      )}

      <label style={{ display: "grid", gap: 6 }}>
        หมายเหตุ
        <textarea
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          rows={3}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
        />
      </label>

      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" onClick={saveDraft} disabled={saving || !canSave}>
          {saving ? "กำลังบันทึก..." : "Save Draft"}
        </button>
      </div>

      <div style={{ color: "#666", fontSize: 12 }}>
        หมายเหตุ: ถ้าบันทึกไม่ผ่านเพราะ RLS ให้ตรวจ policy ของตาราง swine_farms
        (select) และ swine_shipments (insert)
      </div>
    </div>
  );
}
