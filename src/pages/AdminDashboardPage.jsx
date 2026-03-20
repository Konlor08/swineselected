import React, { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AdminDashboardPage() {
  const nav = useNavigate();

  const logout = useCallback(async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (err) {
      console.error("logout failed:", err);
    }

    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k);
      for (const k of Object.keys(sessionStorage)) if (k.startsWith("sb-")) sessionStorage.removeItem(k);
    } catch {}

    window.location.href = `${window.location.origin}/login`;
  }, []);

  const tiles = useMemo(
    () => [
      {
        path: "/admin/import-swines",
        title: "Import Swines (Excel)",
        desc: "นำเข้าจาก 2 รูปแบบไฟล์ + แปลง FarmCode/Farmname/House",
      },
      {
        path: "/admin/import-master-farms",
        title: "Master Farms",
        desc: "นำเข้า/อัปเดต master_farms จาก MFarm.xlsx",
      },
      {
        path: "/admin/swine-heat-upload",
        title: "Upload Swine Heat",
        desc: "อัปโหลดไฟล์ Heat Excel เพื่อบันทึก history, rebuild heat events และออกรายงาน",
      },
      {
        path: "/admin/users",
        title: "Users / Roles",
        desc: "จัดการผู้ใช้: role, team, branch, เปิด/ปิดการใช้งาน",
      },
      {
        path: "/export-csv",
        title: "Export CSV",
        desc: "เลือกวันที่คัด ฟาร์มที่คัด และฟาร์มปลายทาง เพื่อ export รายการหมู",
      },
      {
        path: "/edit-shipment",
        title: "Edit Shipment",
        desc: "ค้นหาและแก้ไขรายการ shipment สถานะ draft",
      },
    ],
    []
  );

  return (
    <div className="page">
      <div className="topbar" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>Admin Dashboard</div>
          <div className="small">จัดการข้อมูล / นำเข้า Excel</div>
        </div>

        <button className="linkbtn" type="button" onClick={logout} style={{ position: "relative", zIndex: 9999 }}>
          Logout
        </button>
      </div>

      <div className="grid">
        {tiles.map(({ path, title, desc }) => (
          <div
            key={path}
            className="tile"
            role="button"
            tabIndex={0}
            onClick={() => nav(path)}
            onKeyDown={(e) => e.key === "Enter" && nav(path)}
          >
            <div className="tileTitle">{title}</div>
            <div className="small">{desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}