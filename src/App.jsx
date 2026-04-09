import React, { useEffect, useMemo, useRef, useState } from "react";
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
import SummaryPage from "./pages/SummaryPage.jsx";

const ROLE_ADMIN = ["admin"];
const ROLE_USER_OR_ADMIN = ["user", "admin"];

const AUTH_RETRY_ATTEMPTS = 2;
const AUTH_RETRY_DELAY_MS = 800;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getStableSession({
  attempts = AUTH_RETRY_ATTEMPTS,
  delayMs = AUTH_RETRY_DELAY_MS,
} = {}) {
  let lastError = null;

  for (let i = 0; i < attempts; i += 1) {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      lastError = error;
    }

    const session = data?.session || null;
    if (session?.user?.id) {
      return { session, error: null };
    }

    if (i < attempts - 1) {
      await sleep(delayMs);
    }
  }

  return { session: null, error: lastError };
}

async function resolveRequireRoleState(allowSet) {
  const { session, error } = await getStableSession();

  if (error) {
    console.warn("resolveRequireRoleState session warning:", error);
  }

  if (!session?.user?.id) {
    return { status: "login", redirectTo: "/login" };
  }

  const profile = await fetchMyProfile(session.user.id);

  if (!profile) {
    return { status: "no-profile", redirectTo: "/no-profile" };
  }

  if (profile.is_active === false || String(profile.role || "").toLowerCase() === "disabled") {
    return { status: "disabled", redirectTo: "/disabled" };
  }

  const role = String(profile.role || "user").toLowerCase();

  if (allowSet.has(role)) {
    return { status: "allowed", redirectTo: "" };
  }

  return {
    status: "forbidden",
    redirectTo: role === "admin" ? "/admin" : "/user-home",
  };
}

async function resolveRootTarget() {
  const { session, error } = await getStableSession();

  if (error) {
    console.warn("resolveRootTarget session warning:", error);
  }

  if (!session?.user?.id) {
    return "/login";
  }

  const profile = await fetchMyProfile(session.user.id);

  if (!profile) {
    return "/no-profile";
  }

  if (profile.is_active === false || String(profile.role || "").toLowerCase() === "disabled") {
    return "/disabled";
  }

  const role = String(profile.role || "user").toLowerCase();
  return role === "admin" ? "/admin" : "/user-home";
}

function RequireRole({ roleAllow, children }) {
  const [guardState, setGuardState] = useState({
    status: "checking",
    redirectTo: "/login",
  });

  const allowSet = useMemo(() => {
    return new Set(roleAllow.map((r) => String(r).toLowerCase()));
  }, [roleAllow]);

  const seqRef = useRef(0);

  useEffect(() => {
    let alive = true;

    async function evaluate() {
      const seq = ++seqRef.current;

      if (alive) {
        setGuardState((prev) => ({
          status: "checking",
          redirectTo: prev?.redirectTo || "/login",
        }));
      }

      try {
        const result = await resolveRequireRoleState(allowSet);

        if (!alive || seq !== seqRef.current) return;

        setGuardState(result);
      } catch (err) {
        console.error("RequireRole evaluate error:", err);

        if (!alive || seq !== seqRef.current) return;

        setGuardState({
          status: "checking",
          redirectTo: "/login",
        });

        try {
          const retryResult = await resolveRequireRoleState(allowSet);

          if (!alive || seq !== seqRef.current) return;

          setGuardState(retryResult);
        } catch (retryErr) {
          console.error("RequireRole retry error:", retryErr);

          if (!alive || seq !== seqRef.current) return;

          setGuardState({
            status: "login",
            redirectTo: "/login",
          });
        }
      }
    }

    void evaluate();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (!alive) return;

      if (event === "SIGNED_OUT") {
        seqRef.current += 1;
        setGuardState({
          status: "login",
          redirectTo: "/login",
        });
        return;
      }

      void evaluate();
    });

    return () => {
      alive = false;
      subscription?.unsubscribe?.();
    };
  }, [allowSet]);

  if (guardState.status === "checking") return <Splash />;
  if (guardState.status === "allowed") return children;
  if (guardState.status === "disabled") return <Navigate to="/disabled" replace />;
  if (guardState.status === "no-profile") return <Navigate to="/no-profile" replace />;
  if (guardState.status === "forbidden") {
    return <Navigate to={guardState.redirectTo || "/"} replace />;
  }

  return <Navigate to="/login" replace />;
}

function RootRedirect() {
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState("/login");

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        const target = await resolveRootTarget();

        if (!alive) return;

        setTo(target);
        setLoading(false);
      } catch (err) {
        console.error("RootRedirect error:", err);

        if (!alive) return;

        setTo("/login");
        setLoading(false);
      }
    }

    void run();

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
          path="/shipment"
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
          path="/shipment-edit"
          element={
            <RequireRole roleAllow={ROLE_USER_OR_ADMIN}>
              <Navigate to="/edit-shipment" replace />
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

        <Route
          path="/summary"
          element={
            <RequireRole roleAllow={ROLE_USER_OR_ADMIN}>
              <SummaryPage />
            </RequireRole>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}