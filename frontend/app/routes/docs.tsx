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
            — state compare NAV per SKU (termasuk field opsional{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">note</code>{" "}
            untuk catatan admin)
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
          untuk admin & owner. Setiap baris tabel berasal dari model{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">CompareItem</code>{" "}
          (per SKU + sesi opname aktif).
        </p>

        <p className="font-semibold text-slate-800 mt-4">
          Dua tahap perbandingan
        </p>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            <strong>Compare scan (per rak)</strong> — qty antar operator di rak
            yang sama; jika beda, admin <strong>Tetapkan</strong> via{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              POST /api/compare/scan/approve
            </code>
            . Baris dengan rak pending tidak boleh compare NAV.
          </li>
          <li>
            <strong>Compare NAV (per SKU + lokasi)</strong> — tombol manual per
            baris memanggil{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              POST /api/compare/nav/:compareItemId/check
            </code>
            . Hanya aktif jika semua rak sudah resolved (
            <code className="text-xs bg-slate-100 px-1 rounded">
              pendingRakCount === 0
            </code>
            ). Membandingkan total fisik vs stok ERP (NAV).
          </li>
        </ol>

        <p className="font-semibold text-slate-800 mt-4">Filter tanggal scan</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Input <strong>Dari</strong> / <strong>Sampai</strong> memfilter
            tabel dan scope bulk compare
          </li>
          <li>
            Hanya SKU yang punya minimal 1{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">ScanLog</code>{" "}
            dengan{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">createdAt</code>{" "}
            dalam rentang tanggal
          </li>
          <li>
            Query API:{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              GET /api/compare/nav?dateFrom=YYYY-MM-DD&amp;dateTo=YYYY-MM-DD
            </code>{" "}
            (keduanya wajib jika salah satu diisi)
          </li>
          <li>Default UI: 7 hari terakhir s/d hari ini</li>
        </ul>

        <p className="font-semibold text-slate-800 mt-4">
          Bulk Compare + Export CSV
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Tombol <strong>Bulk Compare + CSV</strong> memproses semua SKU dalam
            rentang tanggal + filter aktif (wilayah, rak, search)
          </li>
          <li>
            SKU eligible (
            <code className="text-xs bg-slate-100 px-1 rounded">
              pendingRakCount === 0
            </code>
            ) di-compare satu per satu (sequential, hindari membanjiri ERP)
          </li>
          <li>
            SKU dengan rak pending <em>tidak</em> di-compare, tetapi tetap masuk
            CSV dengan status{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              dilewati_pending_rak
            </code>
          </li>
          <li>
            Setelah selesai, file CSV otomatis terunduh (
            <code className="text-xs bg-slate-100 px-1 rounded">
              compare-nav-YYYY-MM-DD_YYYY-MM-DD.csv
            </code>
            )
          </li>
        </ul>

        <p className="font-semibold text-slate-800 mt-4">Catatan per barang</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            Setiap baris{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              CompareItem
            </code>{" "}
            punya field opsional{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">note</code>{" "}
            (satu teks per SKU, bukan array)
          </li>
          <li>
            Tombol <strong>Note</strong> di kolom Catatan → modal textarea →
            simpan via{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              PATCH /api/compare/nav/:compareItemId/note
            </code>
          </li>
          <li>
            Catatan ikut diekspor ke kolom <strong>Catatan</strong> di CSV
          </li>
        </ul>

        <p className="font-semibold text-slate-800 mt-4">
          Filter &amp; lainnya
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
            Filter tambahan: wilayah, rak, search SKU/nama, status NAV (pending
            / selisih / sesuai), sort
          </li>
          <li>Tombol Perbarui — refresh data compare scan</li>
          <li>Auto-expand baris yang masih pending approval</li>
        </ul>

        <p>Status compare NAV:</p>
        <div className="flex flex-wrap gap-2">
          <span className="badge badge-ghost">BELUM_COMPARE</span>
          <span className="badge badge-success">SESUAI</span>
          <span className="badge badge-warning">SELISIH</span>
        </div>

        <p className="font-semibold text-slate-800 mt-4">
          Kolom CSV bulk export
        </p>
        <CodeBlock>{`SKU, Nama Barang, Lokasi, Fisik, ERP, Selisih, Status NAV,
Rak Selesai, Rak Pending, Hasil, Keterangan, Catatan

Hasil: dibandingkan | dilewati_pending_rak | gagal`}</CodeBlock>
      </DocSection>

      <DocSection id="menu" title="6. Menu Aplikasi">
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Link
                to="/input"
                className="font-mono font-bold text-slate-700 hover:underline"
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
                className="font-mono font-bold text-slate-700 hover:underline"
              >
                /admin
              </Link>
              <StatusBadge status="implemented" />
            </div>
            <p className="font-semibold text-slate-800">
              Dashboard Rekonsiliasi
            </p>
            <ul className="mt-2 list-disc pl-5 text-xs space-y-1">
              <li>Stats cards (SKU, pending rak, selisih, sesuai)</li>
              <li>
                Tabel NAV per SKU + lokasi (sumber:{" "}
                <code className="bg-slate-100 px-1 rounded">CompareItem</code>)
              </li>
              <li>Tetapkan qty operator per rak (compare scan)</li>
              <li>
                Compare NAV manual per baris (jika semua rak sudah resolved)
              </li>
              <li>
                Filter tanggal scan (Dari/Sampai) — memfilter tabel &amp; scope
                bulk
              </li>
              <li>
                Bulk Compare + CSV — loop compare NAV + unduh laporan otomatis
              </li>
              <li>
                Catatan per barang (field{" "}
                <code className="bg-slate-100 px-1 rounded">note</code> di
                CompareItem)
              </li>
              <li>Filter wilayah, rak, search, status NAV, sort</li>
              <li>Akses: admin + owner (operator di-redirect ke /input)</li>
            </ul>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Link
                to="/settings"
                className="font-mono font-bold text-slate-700 hover:underline"
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
                className="font-mono font-bold text-slate-700 hover:underline"
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
                <td className="font-sans">
                  Baris compare NAV vs fisik. Query: office, rak, search,
                  dateFrom, dateTo
                </td>
              </tr>
              <tr>
                <td>POST</td>
                <td>/api/compare/nav/:id/check</td>
                <td className="font-sans">
                  Compare NAV manual per SKU (fetch stok ERP)
                </td>
              </tr>
              <tr>
                <td>PATCH</td>
                <td>/api/compare/nav/:id/note</td>
                <td className="font-sans">
                  Simpan catatan per CompareItem (admin/owner)
                </td>
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
