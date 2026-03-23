// src/pages/UserHomePage.jsx

import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { fetchMyProfile } from "../lib/profile";

const DEBUG = true;

function dlog(label, payload) {
  if (!DEBUG) return;
  const ts = new Date().toISOString();
  if (payload === undefined) {
    console.log(`[UserHomePage][${ts}] ${label}`);
  } else {
    console.log(`[UserHomePage][${ts}] ${label}`, payload);
  }
}

function derr(label, error, extra) {
  const ts = new Date().toISOString();
  console.error(`[UserHomePage][${ts}] ${label}`, {
    message: error?.message,
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
    raw: error,
    ...(extra || {}),
  });
}

const cardStyle = {
  width: "100%",
  boxSizing: "border-box",
  minWidth: 0,
};

function ActionCard({ title, desc, buttonText, onClick, disabled = false }) {
  return (
    <div
      className="card"
      style={{
        ...cardStyle,
        display: "grid",
        gap: 10,
        border: "1px solid #e5e7eb",
        borderRadius: 16,
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 900 }}>{title}</div>
      <div
        className="small"
        style={{
          color: "#475569",
          lineHeight: 1.7,
          minHeight: 44,
        }}
      >
        {desc}
      </div>
      <div>
        <button
          type="button"
          className="linkbtn"
          onClick={onClick}
          disabled={disabled}
          style={{
            minWidth: 180,
            opacity: disabled ? 0.65 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
}

export default function UserHomePage() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [myRole, setMyRole] = useState("user");
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    let alive = true;

    async function init() {
      dlog("init:start");
      setLoading(true);
      setMsg("");

      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const uid = data?.session?.user?.id || null;

        dlog("init:session", {
          hasSession: !!data?.session,
          uid,
        });

        if (!uid) {
          if (alive) {
            setMyRole("user");
            setDisplayName("");
            setLoading(false);
          }
          return;
        }

        const profile = await fetchMyProfile(uid);
        if (!alive) return;

        dlog("init:profile", profile);

        const role = String(profile?.role || "user").toLowerCase();
        const name =
          String(
            profile?.display_name ||
              profile?.username ||
              profile?.email ||
              ""
          ).trim() || "User";

        setMyRole(role);
        setDisplayName(name);
      } catch (e) {
        derr("init error", e);
        if (alive) {
          setMsg(e?.message || "โหลดข้อมูลผู้ใช้งานไม่สำเร็จ");
        }
      } finally {
        if (alive) setLoading(false);
        dlog("init:finish");
      }
    }

    init();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    dlog("role changed", { myRole });

    if (myRole === "admin") {
      dlog("redirect to /admin");
      nav("/admin", { replace: true });
    }
  }, [myRole, nav]);

  const logout = useCallback(async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setMsg("");

    dlog("logout:start");

    try {
      await supabase.auth.signOut();
      dlog("logout:signed out");
    } catch (err) {
      derr("logout error", err);
    }

    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("sb-")) localStorage.removeItem(k);
      }
      for (const k of Object.keys(sessionStorage)) {
        if (k.startsWith("sb-")) sessionStorage.removeItem(k);
      }
      dlog("logout:cleared storage");
    } catch (e2) {
      derr("logout storage clear error", e2);
    }

    window.location.replace(`/login?logout=1&ts=${Date.now()}`);
  }, []);

  if (myRole === "admin") {
    return (
      <div className="page" style={{ overflowX: "hidden" }}>
        <div
          className="card"
          style={{
            maxWidth: 520,
            margin: "60px auto",
            textAlign: "center",
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 900 }}>Admin</div>
          <div className="small" style={{ marginTop: 8 }}>
            กำลังพาไปหน้า Admin...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ overflowX: "hidden" }}>
      <div
        className="topbar"
        style={{
          flexWrap: "wrap",
          gap: 10,
          alignItems: "flex-start",
          position: "relative",
          zIndex: 20,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 900 }}>SwineSelected</div>
          <div className="small" style={{ wordBreak: "break-word", marginTop: 4 }}>
            ผู้ใช้งาน: <b>{displayName || "User"}</b>
          </div>
          <div className="small" style={{ color: "#64748b", marginTop: 4, lineHeight: 1.7 }}>
            <b>Create</b> = ใช้คัดหมูเริ่มต้น
            <br />
            <b>Edit</b> = ใช้แก้ draft และเพิ่มหมูได้ถ้าคัดไม่พอ
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            position: "relative",
            zIndex: 21,
          }}
        >
          <button
            className="linkbtn"
            type="button"
            onClick={() => {
              dlog("navigate:/shipment-create");
              nav("/shipment-create");
            }}
          >
            Create
          </button>

          <button
            className="linkbtn"
            type="button"
            onClick={() => {
              dlog("navigate:/edit-shipment");
              nav("/edit-shipment");
            }}
          >
            Edit Draft
          </button>

          <button
            className="linkbtn"
            type="button"
            onClick={() => {
              dlog("navigate:/export-csv");
              nav("/export-csv");
            }}
          >
            Export CSV
          </button>

          <button
            className="linkbtn"
            type="button"
            onClick={logout}
            style={{ position: "relative", zIndex: 22 }}
          >
            Logout
          </button>
        </div>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 1100,
          margin: "14px auto 0",
          display: "grid",
          gap: 14,
          boxSizing: "border-box",
          padding: "0 8px",
          minWidth: 0,
        }}
      >
        {loading ? (
          <div className="card" style={{ ...cardStyle, padding: 14 }}>
            <div className="small">Loading...</div>
          </div>
        ) : null}

        {msg ? (
          <div className="card" style={{ padding: 12, ...cardStyle }}>
            <div
              className="small"
              style={{
                color: msg.includes("สำเร็จ") ? "#166534" : "#b91c1c",
                fontWeight: 700,
                lineHeight: 1.7,
                wordBreak: "break-word",
              }}
            >
              {msg}
            </div>
          </div>
        ) : null}

        <div
          className="card"
          style={{
            ...cardStyle,
            display: "grid",
            gap: 10,
            border: "1px solid #e5e7eb",
            borderRadius: 16,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 900 }}>ลำดับการใช้งาน</div>
          <div className="small" style={{ color: "#475569", lineHeight: 1.8 }}>
            1) กด <b>Create</b> เพื่อเริ่มคัดหมู
            <br />
            2) เลือกวันคัด + ฟาร์มต้นทาง + ฟาร์มปลายทาง
            <br />
            3) เลือก House และรายการหมู แล้วกด Save Draft หรือ Submit
            <br />
            4) ถ้าต้องการกลับมาแก้ draft หรือเพิ่มหมูภายหลัง ให้เข้า <b>Edit Draft</b>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 14,
          }}
        >
          <ActionCard
            title="Create"
            desc="ใช้คัดหมูเริ่มต้น สร้างรายการใหม่ เลือกวันคัด ต้นทาง ปลายทาง House และรายการหมู"
            buttonText="ไปหน้า Create"
            onClick={() => {
              dlog("card navigate:/shipment-create");
              nav("/shipment-create");
            }}
            disabled={loading}
          />

          <ActionCard
            title="Edit Draft"
            desc="ใช้เปิด draft เดิม เพื่อแก้ปลายทาง วันส่ง หมายเหตุ รายการหมู และค่าหมู รวมถึงเพิ่มหมูได้ถ้าคัดไม่พอ"
            buttonText="ไปหน้า Edit"
            onClick={() => {
              dlog("card navigate:/edit-shipment");
              nav("/edit-shipment");
            }}
            disabled={loading}
          />

          <ActionCard
            title="Export CSV"
            desc="ส่งออกข้อมูลสำหรับใช้งานต่อหรือสรุปรายการที่เกี่ยวข้องกับ shipment"
            buttonText="ไปหน้า Export CSV"
            onClick={() => {
              dlog("card navigate:/export-csv");
              nav("/export-csv");
            }}
            disabled={loading}
          />
        </div>
      </div>
    </div>
  );
}