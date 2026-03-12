import React, { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AdminHomePage() {
  const nav = useNavigate();

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (err) {
      console.error("logout failed:", err);
    }

    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k);
      for (const k of Object.keys(sessionStorage)) if (k.startsWith("sb-")) sessionStorage.removeItem(k);
    } catch {
      // ignore storage cleanup errors
    }

    window.location.href = `${window.location.origin}/login`;
  }, []);

  const tileStyle = useMemo(
    () => ({
      background: "white",
      border: "1px solid #e5e7eb",
      borderRadius: 18,
      padding: 18,
      cursor: "pointer",
      boxShadow: "0 6px 18px rgba(0,0,0,0.05)",
    }),
    []
  );

  const tiles = useMemo(
    () => [
      {
        path: "/admin/import-swines",
        title: "Import Swines (Excel)",
        desc: "นำเข้าข้อมูลหมูจาก Excel",
      },
      {
        path: "/admin/import-master-farms",
        title: "Master Farms",
        desc: "นำเข้าและอัปเดต master_farms",
      },
      {
        path: "/admin/users",
        title: "Users / Roles",
        desc: "จัดการผู้ใช้ สิทธิ์ ทีม และสาขา",
      },
      {
        path: "/user-home",
        title: "บันทึกคัดหมูส่ง",
        desc: "เปิดหน้าจอบันทึก: draft → scan → save → submit / cancel",
      },
      {
        path: "/export-csv",
        title: "Export CSV",
        desc: "เลือกวันที่คัด ฟาร์มที่คัด และฟาร์มปลายทาง เพื่อ export รายการหมู",
      },
    ],
    []
  );

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
        {tiles.map(({ path, title, desc }) => (
          <div
            key={path}
            style={tileStyle}
            role="button"
            tabIndex={0}
            onClick={() => nav(path)}
            onKeyDown={(e) => e.key === "Enter" && nav(path)}
          >
            <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
            <div className="small" style={{ marginTop: 6 }}>
              {desc}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
