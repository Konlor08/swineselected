// src/components/FarmPickerInlineAdd.jsx (FULL FILE)
// ✅ FIX: "farm_code" ไม่บังคับแล้ว (บังคับแค่ farm_name)
// ✅ UI: แสดงชื่อฟาร์มเป็นหลัก ถ้าไม่มี code จะโชว์ "(no code)"
// ✅ Search: ค้นหาจาก farm_code + farm_name ได้เหมือนเดิม
// ✅ Insert: ส่ง farm_code = null ถ้าว่าง

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

function clean(s) {
  return String(s ?? "").trim();
}

export default function FarmPickerInlineAdd({
  label = "เลือกฟาร์ม",
  value = null,          // selected farm id
  excludeId = null,      // exclude one farm id (กันเลือกซ้ำ)
  onChange,              // (id|null) => void
  requireBranch = false, // ถ้า branch_id ใน DB เป็น NOT NULL ให้ตั้ง true แล้วกรอก branch_id ตอนเพิ่ม
}) {
  const [farms, setFarms] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const [openAdd, setOpenAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  // ฟอร์มเพิ่มฟาร์ม
  const [newFarm, setNewFarm] = useState({
    farm_code: "",
    farm_name: "",
    branch_id: "",
  });

  async function loadFarms() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("swine_farms")
        .select("id, farm_code, farm_name, branch_id, is_active")
        .eq("is_active", true)
        // ✅ ถ้า farm_code เป็น null บางแถว order อาจดูแปลกนิดหน่อย แต่ใช้งานได้
        .order("farm_code", { ascending: true, nullsFirst: false });

      if (error) throw error;
      setFarms(data || []);
    } catch (e) {
      console.error("loadFarms error:", e);
      setFarms([]);
      alert(e?.message || "โหลดรายการฟาร์มไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFarms();
  }, []);

  const selected = useMemo(() => {
    return (farms || []).find((f) => f.id === value) || null;
  }, [farms, value]);

  const options = useMemo(() => {
    const qq = clean(q).toLowerCase();

    return (farms || [])
      .filter((f) => (excludeId ? f.id !== excludeId : true))
      .filter((f) => {
        if (!qq) return true;
        const t = `${clean(f.farm_code)} ${clean(f.farm_name)}`.toLowerCase();
        return t.includes(qq);
      })
      .slice(0, 12);
  }, [farms, q, excludeId]);

  function resetAddForm() {
    setNewFarm({ farm_code: "", farm_name: "", branch_id: "" });
  }

  async function addFarmNow() {
    const farm_code_raw = clean(newFarm.farm_code);
    const farm_name = clean(newFarm.farm_name);
    const branch_id = clean(newFarm.branch_id) || null;

    // ✅ farm_code ไม่บังคับแล้ว
    if (!farm_name) {
      alert("กรุณากรอก Farm Name");
      return;
    }
    if (requireBranch && !branch_id) {
      alert("กรุณากรอก Branch ID (จำเป็น)");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        farm_code: farm_code_raw ? farm_code_raw : null, // ✅ ว่าง => null
        farm_name,
        branch_id,
        is_active: true,
      };

      const { data, error } = await supabase
        .from("swine_farms")
        .insert([payload])
        .select("id, farm_code, farm_name, branch_id, is_active")
        .single();

      if (error) throw error;

      // เพิ่มเข้า list ทันที + เลือกให้เลย
      setFarms((prev) => [data, ...(prev || [])]);
      onChange?.(data.id);

      setOpenAdd(false);
      resetAddForm();
      setQ("");
    } catch (e) {
      console.error("addFarmNow error:", e);
      alert(e?.message || "เพิ่มฟาร์มไม่สำเร็จ (อาจติด RLS หรือ farm_code ซ้ำ)");
    } finally {
      setSaving(false);
    }
  }

  function labelText(f) {
    const code = clean(f?.farm_code);
    const name = clean(f?.farm_name);
    if (code && name) return `${code} - ${name}`;
    if (!code && name) return `(no code) - ${name}`;
    if (code && !name) return code;
    return "-";
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontWeight: 700 }}>{label}</div>

        <button type="button" onClick={() => setOpenAdd(true)}>
          + เพิ่มฟาร์มใหม่
        </button>

        <button type="button" onClick={loadFarms} disabled={loading}>
          {loading ? "กำลังโหลด..." : "รีเฟรช"}
        </button>

        {value && (
          <button type="button" onClick={() => onChange?.(null)}>
            ล้างค่า
          </button>
        )}
      </div>

      {/* Search */}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="พิมพ์ค้นหา farm code / farm name…"
        style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
      />

      {/* Options list */}
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          overflow: "hidden",
          background: "white",
        }}
      >
        {options.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange?.(f.id)}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "10px 12px",
              border: 0,
              borderBottom: "1px solid #eee",
              background: f.id === value ? "#f3f4f6" : "white",
              cursor: "pointer",
            }}
            title={labelText(f)}
          >
            <div style={{ fontWeight: 700 }}>{labelText(f)}</div>
          </button>
        ))}

        {!loading && options.length === 0 && (
          <div style={{ padding: 12, color: "#666" }}>ไม่พบฟาร์มที่ค้นหา</div>
        )}

        {loading && (
          <div style={{ padding: 12, color: "#666" }}>กำลังโหลดรายการฟาร์ม...</div>
        )}
      </div>

      {/* Selected label */}
      <div style={{ color: "#444" }}>
        เลือกอยู่: <b>{selected ? labelText(selected) : "-"}</b>
      </div>

      {/* Modal */}
      {openAdd && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "grid",
            placeItems: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              width: 520,
              maxWidth: "92vw",
              background: "white",
              borderRadius: 14,
              padding: 16,
              boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>เพิ่มฟาร์มใหม่</div>
              <button
                type="button"
                onClick={() => {
                  setOpenAdd(false);
                  resetAddForm();
                }}
              >
                ปิด
              </button>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                Farm Code (ไม่บังคับ)
                <input
                  value={newFarm.farm_code}
                  onChange={(e) => setNewFarm((s) => ({ ...s, farm_code: e.target.value }))}
                  placeholder="เช่น 2006IE8 (เว้นว่างได้)"
                  style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Farm Name *
                <input
                  value={newFarm.farm_name}
                  onChange={(e) => setNewFarm((s) => ({ ...s, farm_name: e.target.value }))}
                  placeholder="เช่น PJ.15 ธัญญ์-1-04"
                  style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                Branch ID {requireBranch ? "*" : "(เว้นว่างได้)"}
                <input
                  value={newFarm.branch_id}
                  onChange={(e) => setNewFarm((s) => ({ ...s, branch_id: e.target.value }))}
                  placeholder={requireBranch ? "จำเป็นต้องกรอก UUID" : "uuid ของสาขา หรือเว้นว่าง"}
                  style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
                />
              </label>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => {
                    setOpenAdd(false);
                    resetAddForm();
                  }}
                  disabled={saving}
                >
                  ยกเลิก
                </button>
                <button type="button" onClick={addFarmNow} disabled={saving}>
                  {saving ? "กำลังบันทึก..." : "บันทึกและเลือกทันที"}
                </button>
              </div>

              <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>
                * ถ้ากดเพิ่มไม่ผ่าน มักจะเป็น (1) RLS ไม่อนุญาต insert (2) farm_code ซ้ำ (3) branch_id เป็น NOT NULL แต่ไม่ได้กรอก
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
