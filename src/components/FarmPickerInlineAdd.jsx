import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

function clean(s) {
  return String(s ?? "").trim();
}

const inputStyle = {
  padding: 10,
  borderRadius: 10,
  border: "1px solid #ddd",
  width: "100%",
  boxSizing: "border-box",
};

const sectionCardStyle = {
  border: "1px solid #ddd",
  borderRadius: 12,
  background: "white",
  overflow: "hidden",
};

function labelText(f) {
  const code = clean(f?.farm_code);
  const name = clean(f?.farm_name);
  if (code && name) return `${code} - ${name}`;
  if (!code && name) return `(no code) - ${name}`;
  if (code && !name) return code;
  return "-";
}

export default function FarmPickerInlineAdd({
  label = "เลือกฟาร์ม",
  value = null,
  excludeId = null,
  onChange,
  beforeChange,
  requireBranch,
}) {
  void requireBranch;
  const [farms, setFarms] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [openAdd, setOpenAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newFarm, setNewFarm] = useState({
    farm_code: "",
    farm_name: "",
  });

  const currentValue = useMemo(() => {
    if (!value) return null;
    if (typeof value === "string") return clean(value) || null;
    if (typeof value === "object") return clean(value?.id) || null;
    return null;
  }, [value]);

  async function loadFarms() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("master_farms")
        .select("id, farm_code, farm_name, is_active")
        .eq("is_active", true)
        .order("farm_name", { ascending: true });

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
    return (farms || []).find((f) => clean(f.id) === clean(currentValue)) || null;
  }, [farms, currentValue]);

  useEffect(() => {
    setPickerOpen(!currentValue);
  }, [currentValue]);

  const options = useMemo(() => {
    const qq = clean(q).toLowerCase();

    return (farms || [])
      .filter((f) => (excludeId ? clean(f.id) !== clean(excludeId) : true))
      .filter((f) => {
        if (!qq) return true;
        const t = `${clean(f.farm_code)} ${clean(f.farm_name)}`.toLowerCase();
        return t.includes(qq);
      })
      .slice(0, 12);
  }, [farms, q, excludeId]);

  function resetAddForm() {
    setNewFarm({ farm_code: "", farm_name: "" });
  }

  async function canProceedChange(nextValue) {
    if (clean(nextValue) === clean(currentValue)) return true;

    try {
      if (!beforeChange) return true;
      const ok = await Promise.resolve(beforeChange());
      return ok !== false;
    } catch (e) {
      console.error("beforeChange error:", e);
      return false;
    }
  }

  async function applyChange(nextValue) {
    if (clean(nextValue) === clean(currentValue)) {
      onChange?.(nextValue);
      setPickerOpen(false);
      return;
    }

    const ok = await canProceedChange(nextValue);
    if (!ok) return;

    onChange?.(nextValue);
    setPickerOpen(false);
    setQ("");
  }

  async function addFarmNow() {
    const farm_code = clean(newFarm.farm_code) || null;
    const farm_name = clean(newFarm.farm_name);

    if (!farm_name) {
      alert("กรุณากรอก Farm Name");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        farm_code,
        farm_name,
        is_active: true,
      };

      const { data, error } = await supabase
        .from("master_farms")
        .insert([payload])
        .select("id, farm_code, farm_name, is_active")
        .single();

      if (error) throw error;

      setFarms((prev) => [data, ...(prev || [])]);
      setOpenAdd(false);
      resetAddForm();
      setQ("");
      await applyChange(data.id);
    } catch (e) {
      console.error("addFarmNow error:", e);
      alert(e?.message || "เพิ่มฟาร์มไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>{label}</div>
      </div>

      <div style={{ ...sectionCardStyle, padding: 12, display: "grid", gap: 10 }}>
        <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>ฟาร์มที่เลือกอยู่</div>
        <div
          style={{
            border: "1px solid #d1d5db",
            borderRadius: 12,
            padding: "12px 14px",
            background: selected ? "#f8fafc" : "#fff",
          }}
        >
          <div style={{ fontWeight: 800, color: "#111827", wordBreak: "break-word" }}>
            {selected ? labelText(selected) : "ยังไม่ได้เลือกฟาร์มปลายทาง"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setPickerOpen((v) => !v)}>
            {pickerOpen ? "ซ่อนรายการฟาร์ม" : selected ? "เปลี่ยนฟาร์มปลายทาง" : "เลือกฟาร์มปลายทาง"}
          </button>

          <button type="button" onClick={() => setOpenAdd(true)}>
            + เพิ่มฟาร์มใหม่
          </button>

          <button type="button" onClick={loadFarms} disabled={loading}>
            {loading ? "กำลังโหลด..." : "รีเฟรช"}
          </button>

          {currentValue ? (
            <button
              type="button"
              onClick={() => {
                void applyChange(null);
              }}
            >
              ล้างค่า
            </button>
          ) : null}
        </div>
      </div>

      {pickerOpen ? (
        <div style={{ ...sectionCardStyle, padding: 12, display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>เลือกรายการฟาร์มปลายทางใหม่</div>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="พิมพ์ค้นหา farm code / farm name…"
            style={inputStyle}
          />

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
                onClick={() => {
                  void applyChange(f.id);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: 0,
                  borderBottom: "1px solid #eee",
                  background: clean(f.id) === clean(currentValue) ? "#f3f4f6" : "white",
                  cursor: "pointer",
                }}
                title={labelText(f)}
              >
                <div style={{ fontWeight: 700 }}>{labelText(f)}</div>
              </button>
            ))}

            {!loading && options.length === 0 ? (
              <div style={{ padding: 12, color: "#666" }}>ไม่พบฟาร์มที่ค้นหา</div>
            ) : null}

            {loading ? (
              <div style={{ padding: 12, color: "#666" }}>กำลังโหลดรายการฟาร์ม...</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {openAdd ? (
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

            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Farm Code</div>
                <input
                  value={newFarm.farm_code}
                  onChange={(e) =>
                    setNewFarm((prev) => ({ ...prev, farm_code: e.target.value }))
                  }
                  placeholder="เช่น 3006P42"
                  style={inputStyle}
                />
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Farm Name</div>
                <input
                  value={newFarm.farm_name}
                  onChange={(e) =>
                    setNewFarm((prev) => ({ ...prev, farm_name: e.target.value }))
                  }
                  placeholder="ชื่อฟาร์ม"
                  style={inputStyle}
                />
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => {
                    setOpenAdd(false);
                    resetAddForm();
                  }}
                >
                  ยกเลิก
                </button>
                <button type="button" onClick={addFarmNow} disabled={saving}>
                  {saving ? "กำลังบันทึก..." : "บันทึกฟาร์มใหม่"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
