import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  KeyRound,
  User,
  Layers,
  Sparkles,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Building,
} from "lucide-react";
import { loginLdap, loginApp } from "../api/authApi";
import { syncAppUser, getAppUser } from "../api/opnameUserApi";
import { parseAuthProfile, resolveUserRole } from "../libs/auth-profile";
import { useUserInfo } from "../store";

export default function Login() {
  const navigate = useNavigate();
  const { userInfo, setUserInfo } = useUserInfo();
  const [loginType, setLoginType] = useState<"ldap" | "app">("ldap");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (userInfo?.username) {
      navigate("/input", { replace: true });
    }
  }, [userInfo, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMsg("Username dan Password tidak boleh kosong");
      return;
    }

    setIsLoading(true);
    setErrorMsg("");

    try {
      let res;
      if (loginType === "ldap") {
        res = await loginLdap({ username, password });
      } else {
        res = await loginApp({ username, password });
      }

      // Check response status
      if (
        res &&
        (res.status === 200 || res.status === 201 || res.data?.success)
      ) {
        const profile = parseAuthProfile(res.data);
        if (!profile) {
          setErrorMsg(
            "Profil user tidak dapat dibaca dari server. Hubungi admin IT.",
          );
          return;
        }

        try {
          const synced = await syncAppUser({
            office: profile.office,
            description: profile.description,
          });
          setUserInfo({
            username: profile.username,
            office: synced.office ?? profile.office,
            description: profile.description ?? undefined,
            role: resolveUserRole(profile, synced.role),
          });
        } catch {
          const dataRole =
            typeof res.data?.data === "object" && res.data.data !== null
              ? (res.data.data as { role?: string }).role
              : undefined;
          try {
            const appUser = await getAppUser();
            setUserInfo({
              username: profile.username,
              office: appUser.office ?? profile.office,
              description: profile.description ?? undefined,
              role: resolveUserRole(profile, appUser.role ?? dataRole),
            });
          } catch {
            setUserInfo({
              username: profile.username,
              office: profile.office,
              description: profile.description ?? undefined,
              role: resolveUserRole(profile, dataRole),
            });
          }
        }
        navigate("/input");
      } else {
        setErrorMsg(
          res?.data?.message || "Login gagal, silakan periksa kredensial Anda.",
        );
      }
    } catch (err: any) {
      console.error("Login error:", err);
      setErrorMsg(
        err.response?.data?.message ||
          "Gagal terhubung ke server auth. Periksa koneksi jaringan Anda.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-center items-center font-sans relative px-4 overflow-hidden selection:bg-slate-100">
      {/* Background elegant pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-size-[4rem_4rem] mask-[radial-gradient(ellipse_60%_50%_at_50%_40%,#000_70%,transparent_100%)] pointer-events-none opacity-30 z-0" />

      {/* Decorative colored glow spheres */}
      <div className="absolute top-1/4 left-1/4 h-72 w-72 bg-slate-200 rounded-full blur-3xl opacity-30 pointer-events-none z-0" />
      <div className="absolute bottom-1/4 right-1/4 h-72 w-72 bg-violet-200 rounded-full blur-3xl opacity-30 pointer-events-none z-0" />

      {/* Card container */}
      <div className="relative w-96 bg-white border border-slate-200  p-8 shadow-xl shadow-slate-100/50 backdrop-blur-md">
        {/* Brand logo header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="p-3.5 bg-linear-to-tr  rounded-2xl shadow-lg shadow-slate-500/10 ring-1 ring-white/20 mb-3.5">
            <img width={60} height={60} src="/logo.png" />
          </div>
          <h1 className="text-xl font-black tracking-tight text-slate-900">
            Stok Opname CSI
          </h1>
          <p className="text-[11px] text-slate-500 font-semibold mt-1 uppercase tracking-wider">
            Admin Reconciliation Control Room
          </p>
        </div>

        {/* Form Error alert block */}
        {errorMsg && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-2.5 text-xs text-rose-800 font-medium">
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
            <p>{errorMsg}</p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          {/* Tab selector LDAP vs Local App */}
          <div className="bg-slate-100 p-1.5 rounded-2xl border border-slate-200 flex gap-1">
            <button
              type="button"
              onClick={() => setLoginType("ldap")}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-1.5 ${
                loginType === "ldap"
                  ? "bg-white text-slate-650 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Building className="h-3.5 w-3.5" />
              LDAP Login
            </button>
            <button
              type="button"
              onClick={() => setLoginType("app")}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-1.5 ${
                loginType === "app"
                  ? "bg-white text-slate-650 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              App Account
            </button>
          </div>

          {/* Username Input */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              {loginType === "ldap"
                ? "Username LDAP / Email"
                : "Username App / Local Account"}
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder={
                  loginType === "ldap"
                    ? "Masukkan username atau email..."
                    : "Masukkan username..."
                }
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                className="w-full bg-slate-50 border border-slate-200 hover:border-slate-350 focus:border-slate-500 focus:ring-1 focus:ring-slate-500/20 text-xs font-semibold text-slate-800 rounded-2xl pl-11 pr-4 py-3.5 outline-none transition-all duration-150"
              />
            </div>
          </div>

          {/* Password Input */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              Password
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-400 pointer-events-none" />
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="w-full bg-slate-50 border border-slate-200 hover:border-slate-350 focus:border-slate-500 focus:ring-1 focus:ring-slate-500/20 text-xs font-semibold text-slate-800 rounded-2xl pl-11 pr-4 py-3.5 outline-none transition-all duration-150"
              />
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-3.5 bg-linear-to-r bg-black text-white text-xs font-bold rounded-2xl shadow-lg shadow-slate-500/10 transition-all duration-150 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 cursor-pointer"
          >
            {isLoading ? (
              <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                Masuk Sistem
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </form>
      </div>

      {/* Footer copyright */}
      <footer className="relative z-10 mt-8 flex items-center gap-1 text-[10px] text-slate-400 font-medium">
        <Sparkles className="h-3 w-3 text-slate-400 animate-pulse" />
        <span>Catur Sukses Internasional. Security Verified.</span>
      </footer>
    </div>
  );
}
