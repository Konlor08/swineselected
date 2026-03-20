// src/App.jsx

import React, { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { fetchMyProfile } from "./lib/profile";

import LoginPage from "./pages/LoginPage.jsx";
import AdminDashboardPage from "./pages/AdminDashboardPage.jsx";
import AdminImportSwinesPage from "./pages/AdminImportSwinesPage.jsx";
import AdminImportMasterFarmsPage from "./pages/AdminImportMasterFarmsPage.jsx";
import AdminUsersPage from "./pages/AdminUsersPage.jsx";
import AdminUploadSwineHeatPage from "./pages/AdminUploadSwineHeatPage.jsx";
import UserDashboardPage from "./pages/UserDashboardPage.jsx";
import UserHomePage from "./pages/UserHomePage.jsx";
import DisabledPage from "./pages/DisabledPage.jsx";
import NoProfilePage from "./pages/NoProfilePage.jsx";
import ExportCsvPage from "./pages/ExportCsvPage.jsx";
import ShipmentCreatePage from "./pages/ShipmentCreatePage.jsx";
import EditShipmentPage from "./pages/EditShipmentPage.jsx";

const ROLE_ADMIN = ["admin"];
const ROLE_USER_OR_ADMIN = ["user", "admin"];

function Splash() {
  return (
    <div className="page">
      <div
        className="card"
        style={{
          maxWidth: 520,
          margin: "60px auto",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 900 }}>SwineSelected</div>
        <div className="small" style={{ marginTop: 8 }}>
          Loading...
        </div>
      </div>
    </div>
  );
}

function RequireRole({ roleAllow, children }) {
  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState(false);

  const allowSet = useMemo(() => {
    return new Set(roleAllow.map((r) => String(r).toLowerCase()));
  }, [roleAllow]);

  useEffect(() => {
    let alive = true;
    let running = false;

    async function run() {
      if (running) return;
      running = true;

      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        const session = data?.session;
        if (!session?.user?.id) {
          if (alive) {
            setOk(false);
            setLoading(false);
          }
          return;
        }

        const profile = await fetchMyProfile(session.user.id);

        if (!profile || profile.is_active === false) {
          if (alive) {
            setOk(false);
            setLoading(false);
          }
          return;
        }

        const role = String(profile.role || "user").toLowerCase();

        if (alive) {
          setOk(allowSet.has(role));
          setLoading(false);
        }
      } catch (err) {
        console.error("RequireRole error:", err);
        if (alive) {
          setOk(false);
          setLoading(false);
        }
      } finally {
        running = false;
      }
    }

    run();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      run();
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [allowSet]);

  if (loading) return <Splash />;
  if (!ok) return <Navigate to="/login" replace />;
  return children;
}

function RootRedirect() {
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState("/login");

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        const session = data?.session;

        if (!session?.user?.id) {
          if (alive) {
            setTo("/login");
            setLoading(false);
          }
          return;
        }

        const profile = await fetchMyProfile(session.user.id);

        if (!profile) {
          if (alive) {
            setTo("/no-profile");
            setLoading(false);
          }
          return;
        }

        if (profile.is_active === false) {
          if (alive) {
            setTo("/disabled");
            setLoading(false);
          }
          return;
        }

        const role = String(profile.role || "user").toLowerCase();

        if (alive) {
          setTo(role === "admin" ? "/admin" : "/user-home");
          setLoading(false);
        }
      } catch (err) {
        console.error("RootRedirect error:", err);
        if (alive) {
          setTo("/login");
          setLoading(false);
        }
      }
    }

    run();

    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Splash />;
  return <Navigate to={to} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />

        <Route path="/login" element={<LoginPage />} />
        <Route path="/disabled" element={<DisabledPage />} />
        <Route path="/no-profile" element={<NoProfilePage />} />

        <Route
          path="/admin"
          element={
            <RequireRole roleAllow={ROLE_ADMIN}>
              <AdminDashboardPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/import-swines"
          element={
            <RequireRole roleAllow={ROLE_ADMIN}>
              <AdminImportSwinesPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/import-master-farms"
          element={
            <RequireRole roleAllow={ROLE_ADMIN}>
              <AdminImportMasterFarmsPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireRole roleAllow={ROLE_ADMIN}>
              <AdminUsersPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/swine-heat-upload"
          element={
            <RequireRole roleAllow={ROLE_ADMIN}>
              <AdminUploadSwineHeatPage />
            </RequireRole>
          }
        />

        <Route
          path="/user-home"
          element={
            <RequireRole roleAllow={ROLE_USER_OR_ADMIN}>
              <UserHomePage />
            </RequireRole>
          }
        />

        <Route
          path="/user/home"
          element={
            <RequireRole roleAllow={ROLE_USER_OR_ADMIN}>
              <Navigate to="/user-home" replace />
            </RequireRole>
          }
        />

        <Route
          path="/user"
          element={
            <RequireRole roleAllow={ROLE_USER_OR_ADMIN}>
              <Navigate to="/user-home" replace />
            </RequireRole>
          }
        />

        <Route
          path="/user/dashboard"
          element={
            <RequireRole roleAllow={ROLE_USER_OR_ADMIN}>
              <UserDashboardPage />
            </RequireRole>
          }
        />

        <Route
          path="/shipment-create"
          element={
            <RequireRole roleAllow={ROLE_USER_OR_ADMIN}>
              <ShipmentCreatePage />
            </RequireRole>
          }
        />

        <Route
          path="/create-shipment"
          element={
            <RequireRole roleAllow={ROLE_USER_OR_ADMIN}>
              <Navigate to="/shipment-create" replace />
            </RequireRole>
          }
        />

        <Route
          path="/edit-shipment"
          element={
            <RequireRole roleAllow={ROLE_USER_OR_ADMIN}>
              <EditShipmentPage />
            </RequireRole>
          }
        />

        <Route
          path="/export-csv"
          element={
            <RequireRole roleAllow={ROLE_USER_OR_ADMIN}>
              <ExportCsvPage />
            </RequireRole>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}