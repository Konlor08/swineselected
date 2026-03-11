import React from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AdminDashboardPage() {
  const nav = useNavigate();

  async function logout(e) {
    try {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      console.log("LOGOUT CLICK");
      void supabase.auth.signOut({ scope: "local" });

      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k);
        for (const k of Object.keys(sessionStorage)) if (k.startsWith("sb-")) sessionStorage.removeItem(k);
      } catch {}
    } finally {
      window.location.href = `${window.location.origin}/login`;
    }
  }

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
        <div
          className="tile"
          role="button"
          tabIndex={0}
          onClick={() => nav("/admin/import-swines")}
          onKeyDown={(e) => e.key === "Enter" && nav("/admin/import-swines")}
        >
          <div className="tileTitle">Import Swines (Excel)</div>
          <div className="small">นำเข้าจาก 2 รูปแบบไฟล์ + แปลง FarmCode/Farmname/House</div>
        </div>

        <div
          className="tile"
          role="button"
          tabIndex={0}
          onClick={() => nav("/admin/import-master-farms")}
          onKeyDown={(e) => e.key === "Enter" && nav("/admin/import-master-farms")}
        >
          <div className="tileTitle">Master Farms</div>
          <div className="small">นำเข้า/อัปเดต master_farms จาก MFarm.xlsx</div>
        </div>

        <div
          className="tile"
          role="button"
          tabIndex={0}
          onClick={() => nav("/admin/users")}
          onKeyDown={(e) => e.key === "Enter" && nav("/admin/users")}
        >
          <div className="tileTitle">Users / Roles</div>
          <div className="small">จัดการผู้ใช้: role, team, branch, เปิด/ปิดการใช้งาน</div>
        </div>

        <div
          className="tile"
          role="button"
          tabIndex={0}
          onClick={() => nav("/export-csv")}
          onKeyDown={(e) => e.key === "Enter" && nav("/export-csv")}
        >
          <div className="tileTitle">Export CSV</div>
          <div className="small">เลือกวันที่คัด ฟาร์มที่คัด และฟาร์มปลายทาง เพื่อ export รายการหมู</div>
        </div>

        <div
          className="tile"
          role="button"
          tabIndex={0}
          onClick={() => nav("/edit-shipment")}
          onKeyDown={(e) => e.key === "Enter" && nav("/edit-shipment")}
        >
          <div className="tileTitle">Edit Shipment</div>
          <div className="small">ค้นหาและแก้ไขรายการ shipment สถานะ draft</div>
        </div>
      </div>
    </div>
  );
}