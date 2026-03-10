import React from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AdminHomePage() {
  const nav = useNavigate();

  async function logout() {
    try {
      await supabase.auth.signOut({ scope: "local" });
      try {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith("sb-")) localStorage.removeItem(k);
        }
        for (const k of Object.keys(sessionStorage)) {
          if (k.startsWith("sb-")) sessionStorage.removeItem(k);
        }
      } catch {}
    } finally {
      window.location.href = `${window.location.origin}/login`;
    }
  }

  const tileStyle = {
    background: "white",
    border: "1px solid #e5e7eb",
    borderRadius: 18,
    padding: 18,
    cursor: "pointer",
    boxShadow: "0 6px 18px rgba(0,0,0,0.05)",
  };

  return (
    <div className="page">
      <div className="topbar" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>Admin</div>
          <div className="small">จัดการข้อมูลระบบ และเปิดหน้าทำงานจริง</div>
        </div>

        <button className="linkbtn" type="button" onClick={logout}>
          Logout
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
          marginTop: 16,
        }}
      >
        <div
          style={tileStyle}
          role="button"
          tabIndex={0}
          onClick={() => nav("/admin/import-swines")}
          onKeyDown={(e) => e.key === "Enter" && nav("/admin/import-swines")}
        >
          <div style={{ fontSize: 18, fontWeight: 800 }}>Import Swines (Excel)</div>
          <div className="small" style={{ marginTop: 6 }}>
            นำเข้าข้อมูลหมูจาก Excel
          </div>
        </div>

        <div
          style={tileStyle}
          role="button"
          tabIndex={0}
          onClick={() => nav("/admin/import-master-farms")}
          onKeyDown={(e) => e.key === "Enter" && nav("/admin/import-master-farms")}
        >
          <div style={{ fontSize: 18, fontWeight: 800 }}>Master Farms</div>
          <div className="small" style={{ marginTop: 6 }}>
            นำเข้าและอัปเดต master_farms
          </div>
        </div>

        <div
          style={tileStyle}
          role="button"
          tabIndex={0}
          onClick={() => nav("/admin/users")}
          onKeyDown={(e) => e.key === "Enter" && nav("/admin/users")}
        >
          <div style={{ fontSize: 18, fontWeight: 800 }}>Users / Roles</div>
          <div className="small" style={{ marginTop: 6 }}>
            จัดการผู้ใช้ สิทธิ์ ทีม และสาขา
          </div>
        </div>

        <div
          style={tileStyle}
          role="button"
          tabIndex={0}
          onClick={() => nav("/user-home")}
          onKeyDown={(e) => e.key === "Enter" && nav("/user-home")}
        >
          <div style={{ fontSize: 18, fontWeight: 800 }}>บันทึกคัดหมูส่ง</div>
          <div className="small" style={{ marginTop: 6 }}>
            เปิดหน้าจอบันทึกจริง: draft → scan → save → submit / cancel
          </div>
        </div>
      </div>
    </div>
  );
}