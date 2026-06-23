import { Link } from "react-router";
import { DocSection, DocsShell, StatusBadge } from "~/components/DocsShell";

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-slate-900 text-slate-100 text-xs p-4 rounded-xl overflow-x-auto font-mono">
      {children}
    </pre>
  );
}

export default function Docs() {
  return (
    <DocsShell>
      <div className="mb-10">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          Dokumentasi Teknis Stok Opname
        </h1>
        <p className="mt-2 text-sm text-slate-600 max-w-2xl">
          Referensi internal untuk developer dan operator sistem. Mencakup
          arsitektur, role, logika bisnis scan/compare, dan menu aplikasi.
        </p>
      </div>

      <DocSection id="ringkasan" title="1. Ringkasan Sistem">
        <p>
          <strong>Stok Opname CSI</strong> adalah aplikasi rekonsiliasi stok
          fisik lapangan dengan data sistem ERP (NAV). Monorepo terdiri dari:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Frontend</strong> — React Router 7, TanStack Query, Zustand,
            Tailwind + DaisyUI
          </li>
          <li className="text-xs bg-slate-100 px-1 rounded">
            <strong>Backend</strong> — Express, Prisma/PostgreSQL, proxy ke ERP
          </li>
          <li>
            <strong>ERP (SO)</strong> — autentikasi LDAP, produk, stok NAV via{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              DATABASE_CENTER
            </code>
          </li>
        </ul>
        <p>Model data lokal utama:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <code className="text-xs bg-slate-100 px-1 rounded">
              OpnameSession
            </code>{" "}
            — sesi opname per office
          </li>
          <li>
            <code className="text-xs bg-slate-100 px-1 rounded">ScanLog</code> —
            hasil scan per operator, SKU, rak, office
          </li>
          <li>
            <code className="text-xs bg-slate-100 px-1 rounded">
              ScanQtyApproval
            </code>{" "}
            — qty ditetapkan admin saat konflik operator
          </li>
          <li>
            <code className="text-xs bg-slate-100 px-1 rounded">
              CompareItem
            </code>{" "}
            — state compare NAV per SKU
          </li>
          <li>
            <code className="text-xs bg-slate-100 px-1 rounded">User</code> —
            role & office lokal
          </li>
        </ul>
      </DocSection>

      <DocSection id="role" title="2. Role & Akses">
        <p>
          Role disimpan di tabel <strong>User</strong> lokal, bukan dari ERP.
          Field <strong>office</strong> disinkron dari{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">getUserInfo</code>
          .
        </p>
        <div className="overflow-x-auto">
          <table className="table table-sm table-zebra w-full text-xs">
            <thead>
              <tr className="bg-slate-100">
                <th>Role</th>
                <th>Scan /input</th>
                <th>Admin /admin</th>
                <th>Wilayah / Office</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-bold">operator</td>
                <td>Ya, wajib punya office</td>
                <td>Tidak</td>
                <td>Fixed dari user.office</td>
              </tr>
              <tr>
                <td className="font-bold">admin</td>
                <td>Ya jika punya office</td>
                <td>Ya</td>
                <td>Filter &quot;Semua Wilayah&quot;</td>
              </tr>
              <tr>
                <td className="font-bold">owner</td>
                <td>Ya</td>
                <td>Ya</td>
                <td>Dropdown pilih gudang</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          Login pertama: user dengan{" "}
          <code className="bg-slate-100 px-1 rounded">
            office === &quot;IT&quot;
          </code>{" "}
          otomatis mendapat role <strong>owner</strong> (hanya saat INSERT ke
          tabel User; perubahan manual di DB tidak ditimpa saat sync).
        </p>
      </DocSection>

      <DocSection id="auth" title="3. Alur Autentikasi">
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            User login via{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">/login</code>{" "}
            (LDAP atau app account) → proxy{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              /so/api/auth/login/*
            </code>
          </li>
          <li>
            Proxy menyimpan token cookie, sync profile ke tabel User (office
            dari response ERP)
          </li>
          <li>
            Frontend memanggil{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              POST /api/opname/me/sync
            </code>{" "}
            dengan office dari getUserInfo
          </li>
          <li>
            Role dibaca dari{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              GET /api/opname/me
            </code>{" "}
            (tabel User lokal)
          </li>
        </ol>
        <CodeBlock>{`ERP getUserInfo  →  username, office
User table       →  role (operator | admin | owner)
Backend JWT      →  autentikasi request API opname/compare`}</CodeBlock>
      </DocSection>

      <DocSection id="scan" title="4. Logika Scan (per Operator)">
        <p>
          Endpoint:{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">
            POST /api/opname/scan
          </code>
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Upsert</strong> — kombinasi{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              operator + sku + office + rak
            </code>{" "}
            sama → qty <em>ditambah</em>, bukan baris baru
          </li>
          <li>
            <strong>Rescan</strong> — jika operator sudah scan SKU/rak yang
            sama, dialog konfirmasi sebelum submit
          </li>
          <li>
            <strong>Rak disarankan</strong> — dari localStorage + max rak di DB
            untuk SKU+office
          </li>
          <li>
            <strong>Owner</strong> — kirim{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">office</code> di
            body request; operator/admin pakai office dari tabel User
          </li>
          <li>
            Backend menolak scan (403) jika user tidak punya office, kecuali
            owner dengan lokasi terpilih
          </li>
        </ul>
      </DocSection>

      <DocSection id="compare" title="5. Rekonsiliasi & Compare (Admin)">
        <p>
          Halaman{" "}
          <Link to="/admin" className="link link-primary">
            /admin
          </Link>{" "}
          untuk admin & owner.
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Kolom Fisik (NAV)</strong> ={" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              SUM(approvedQty)
            </code>{" "}
            semua rak resolved per SKU + office
          </li>
          <li>
            <strong>Compare scan</strong> — agregasi per operator per rak; jika
            qty operator berbeda di rak sama → admin <strong>Tetapkan</strong>{" "}
            via{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              POST /api/compare/scan/approve
            </code>
          </li>
          <li>
            Filter: wilayah, rak, search SKU/nama, status NAV (pending / selisih
            / sesuai), sort
          </li>
          <li>Sync ERP — refresh kuantitas sistem (NAV systemQty)</li>
          <li>Auto-expand baris yang masih pending approval</li>
        </ul>
        <p>Status compare:</p>
        <div className="flex flex-wrap gap-2">
          <span className="badge badge-ghost">BELUM_COMPARE</span>
          <span className="badge badge-success">SESUAI</span>
          <span className="badge badge-warning">SELISIH</span>
        </div>
      </DocSection>

      <DocSection id="menu" title="6. Menu Aplikasi">
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Link
                to="/input"
                className="font-mono font-bold text-indigo-700 hover:underline"
              >
                /input
              </Link>
              <StatusBadge status="implemented" />
            </div>
            <p className="font-semibold text-slate-800">
              Formulir Input Barang
            </p>
            <ul className="mt-2 list-disc pl-5 text-xs space-y-1">
              <li>Cari SKU / nama barang (ERP product API)</li>
              <li>Input nomor rak + qty fisik lapangan</li>
              <li>Wilayah: fixed (operator/admin) atau dropdown (owner)</li>
              <li>Link ke admin hanya untuk role admin & owner</li>
            </ul>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Link
                to="/admin"
                className="font-mono font-bold text-indigo-700 hover:underline"
              >
                /admin
              </Link>
              <StatusBadge status="implemented" />
            </div>
            <p className="font-semibold text-slate-800">
              Dashboard Rekonsiliasi
            </p>
            <ul className="mt-2 list-disc pl-5 text-xs space-y-1">
              <li>Stats cards global (SKU, pending rak, selisih)</li>
              <li>Tabel perbandingan NAV vs scan fisik per operator</li>
              <li>Approve / tetapkan qty operator per rak</li>
              <li>Filter, expand/collapse, reset filter</li>
              <li>Akses: admin + owner (operator di-redirect ke /input)</li>
            </ul>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Link
                to="/settings"
                className="font-mono font-bold text-indigo-700 hover:underline"
              >
                /settings
              </Link>
              <StatusBadge status="implemented" />
            </div>
            <p className="font-semibold text-slate-800">Pengaturan</p>
            <ul className="mt-2 list-disc pl-5 text-xs space-y-1">
              <li>Profil user (office read-only dari ERP)</li>
              <li>Preferensi UI (tema, default office admin)</li>
              <li>Manajemen role user (owner)</li>
            </ul>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Link
                to="/my-logs"
                className="font-mono font-bold text-indigo-700 hover:underline"
              >
                /my-logs
              </Link>
              <StatusBadge status="implemented" />
            </div>
            <p className="font-semibold text-slate-800">Riwayat Scan Saya</p>
            <ul className="mt-2 list-disc pl-5 text-xs space-y-1">
              <li>Daftar scan milik user yang sedang login</li>
              <li>Filter: tanggal, SKU, office, rak</li>
              <li>
                Sumber data: GET /api/opname/scans (filter client-side by
                operator)
              </li>
            </ul>
          </div>
        </div>
      </DocSection>

      <DocSection id="api" title="7. API Reference Ringkas">
        <div className="overflow-x-auto">
          <table className="table table-sm w-full text-xs">
            <thead>
              <tr className="bg-slate-100">
                <th>Method</th>
                <th>Endpoint</th>
                <th>Keterangan</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              <tr>
                <td>POST</td>
                <td>/api/opname/scan</td>
                <td className="font-sans">Simpan / upsert scan</td>
              </tr>
              <tr>
                <td>GET</td>
                <td>/api/opname/scans</td>
                <td className="font-sans">Daftar scan (filter office, rak)</td>
              </tr>
              <tr>
                <td>GET</td>
                <td>/api/compare/scan</td>
                <td className="font-sans">Baris compare scan per operator</td>
              </tr>
              <tr>
                <td>GET</td>
                <td>/api/compare/nav</td>
                <td className="font-sans">Baris compare NAV vs fisik</td>
              </tr>
              <tr>
                <td>POST</td>
                <td>/api/compare/scan/approve</td>
                <td className="font-sans">
                  Tetapkan qty operator (admin/owner)
                </td>
              </tr>
              <tr>
                <td>GET</td>
                <td>/api/opname/me</td>
                <td className="font-sans">Profile user lokal (role, office)</td>
              </tr>
              <tr>
                <td>POST</td>
                <td>/api/opname/me/sync</td>
                <td className="font-sans">
                  Sync office dari ERP ke User table
                </td>
              </tr>
              <tr>
                <td>*</td>
                <td>/so/api/*</td>
                <td className="font-sans">
                  Proxy ke ERP (auth, produk, lokasi)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </DocSection>

      <footer className="pt-8 border-t border-slate-200 text-xs text-slate-400">
        Catur Sukses Internasional — Stok Opname CSI Technical Docs
      </footer>
    </DocsShell>
  );
}
