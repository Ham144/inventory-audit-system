import { Link } from "react-router";
import { DocSection, DocsShell } from "~/components/DocsShell";
import todoMd from "../../../todo.md?raw";

export default function Docs() {
  return (
    <DocsShell subtitle="Panduan Kerja">
      <div className="mb-10">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          Panduan Stok Opname
        </h1>
        <p className="mt-2 text-sm text-slate-600 max-w-2xl">
          Alur kerja dari buka/tutup periode, input fisik, compare, delegasi, dan
          hitungan ulang (step).
        </p>
      </div>

      <DocSection id="ringkasan" title="1. Ringkasan">
        <p>
          Aplikasi ini dipakai untuk mencocokkan stok fisik lapangan dengan qty
          sistem (NAV). Operator menginput hasil hitung fisik. Admin mengelola
          periode, mengunci patokan NAV, membandingkan hasil, dan mendelegasikan
          SKU yang berselisih untuk dihitung ulang.
        </p>
        <ul className="mt-3 list-disc pl-5 text-sm text-slate-600 space-y-1">
          <li>
            Qty NAV diambil lewat SOAP{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">
              GetInventoryOnlyByLocation
            </code>{" "}
            (1 SKU per call).
          </li>
          <li>
            Periode per gudang: mode <strong>FREE</strong> /{" "}
            <strong>OPNAME</strong> (<code className="text-xs bg-slate-100 px-1 rounded">openedAt</code> /{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">closedAt</code>).
          </li>
          <li>
            SKU yang sudah <strong>SESUAI</strong> dengan NAV terkunci dari
            input ulang — kecuali di luar window periode aktif, atau melalui
            alur delegasi (step 2).
          </li>
        </ul>
      </DocSection>

      <DocSection id="role" title="2. Role">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>Operator</strong> — input stok di{" "}
            <Link to="/input" className="link link-primary">
              /input
            </Link>
            , lihat tugas di{" "}
            <Link to="/selisih" className="link link-primary">
              cek selisih
            </Link>
            , riwayat di{" "}
            <Link to="/my-logs" className="link link-primary">
              my logs
            </Link>
          </li>
          <li>
            <strong>Admin</strong> — buka/tutup periode, compare, tetapkan qty,
            final correction, delegasi SKU, export CSV (tanpa halaman input)
          </li>
          <li>
            <strong>Owner</strong> — mirip admin, bisa pilih wilayah/lokasi di
            semua halaman
          </li>
        </ul>
      </DocSection>

      <DocSection id="alur" title="3. Alur Kerja — Periode Baru">
        <p className="mb-4 text-slate-600">
          Periode baru memisahkan input selanjutnya dengan pekerjaan yang lalu.
          Ikuti urutan di bawah.
        </p>

        <ol className="space-y-5">
          <li className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              1 · Admin
            </p>
            <p className="font-bold text-slate-900">Tutup periode</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Tekan <strong>Tutup periode</strong> di{" "}
              <Link to="/selisih" className="link link-primary">
                cek selisih
              </Link>
              . Ini mengakhiri sesi kerja: mengosongkan tampilan myLogs /
              selisih / row admin untuk gudang itu, dan melepaskan penguncian
              yang sudah berlalu. Setelah tutup, operator boleh mulai input
              periode baru (mode FREE — patokan NAV belum dikunci).
            </p>
          </li>

          <li className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              2 · Operator
            </p>
            <p className="font-bold text-slate-900">Input stok fisik</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Pergi ke{" "}
              <Link to="/input" className="link link-primary">
                /input
              </Link>{" "}
              atau klik &quot;input&quot; di cek selisih. Jika daftar kosong di
              cek selisih, admin belum mendelegasikan — anda tetap bisa langsung
              ke input. Qty boleh 0 atau negatif (koreksi mandiri). Input ulang
              sku+rak+office yang sama di periode aktif memunculkan peringatan
              rescan (dicek di server), lalu qty di-<strong>sum</strong> ke step
              yang sama.
            </p>
          </li>

          <li className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              3 · Admin
            </p>
            <p className="font-bold text-slate-900">Buka periode</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Tombol <strong>Buka periode</strong> di cek selisih mengambil qty
              NAV (SOAP) dan mengunci patokan <em>systemQty</em> untuk gudang
              itu (mode OPNAME / <code className="text-xs bg-slate-100 px-1 rounded">openedAt</code>).
              Bisa diklik saat NAV sudah siap. Jika NAV kosong / gagal, sistem
              menolak mengunci. Buka periode boleh dicoba ulang jika sebelumnya
              gagal.
            </p>
          </li>

          <li className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              4 · Admin
            </p>
            <p className="font-bold text-slate-900">Compare di halaman admin</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Di{" "}
              <Link to="/admin" className="link link-primary">
                /admin
              </Link>
              : tetapkan qty operator per rak, bandingkan fisik vs NAV, final
              correction bila perlu. Filter tanggal default 1 hari terakhir.
              Export CSV memuat kolom <strong>Nama Rak</strong>. SKU yang sudah
              SESUAI tidak perlu di-compare lagi. Jika auto-compare gagal, klik
              &quot;cek selisih&quot; di ujung row.
            </p>
          </li>

          <li className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              5 · Admin
            </p>
            <p className="font-bold text-slate-900">Delegasi SKU selisih</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Barang berselisih / diragukan muncul di cek selisih (status
              &quot;selisih&quot;). Admin mendelegasikan ke operator gudang yang
              sama. Badge{" "}
              <span className="text-[10px] font-bold text-sky-800 bg-sky-50 border border-sky-200 px-1 py-0.5 rounded">
                Delegasi → nama
              </span>{" "}
              muncul di admin.
            </p>
          </li>

          <li className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              6 · Operator
            </p>
            <p className="font-bold text-slate-900">Hitung ulang (step 2)</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Di cek selisih: kerjakan SKU status &quot;belum&quot; dan yang
              didelegasikan ke anda. Tombol &quot;input&quot; di kanan
              mempercepat ke form. Input setelah delegasi masuk{" "}
              <strong>step 2</strong> (tidak digabung ke step 1) — lihat section
              berikut.
            </p>
          </li>

          <li className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              7 · Admin
            </p>
            <p className="font-bold text-slate-900">Tutup periode (akhir siklus)</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Setelah selesai, <strong>Tutup periode</strong> lagi untuk
              mengakhiri siklus dan menyiapkan katalog tugas periode berikutnya
              untuk gudang tersebut saja.
            </p>
          </li>
        </ol>
      </DocSection>

      <DocSection id="step" title="4. Step Scan & Delegasi">
        <p className="mb-4 text-slate-600">
          Setiap hasil input fisik punya <strong>step</strong>. Ini memisahkan
          hitungan awal dengan hitungan ulang setelah delegasi.
        </p>

        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="font-bold text-slate-900">Step 1 — hitungan awal</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Default. Input ulang sku + rak + office + operator di periode
              aktif → peringatan rescan, lalu qty di-<strong>sum</strong> ke
              baris step 1 yang sama. Pengecekan rescan dilakukan di backend
              (bukan hanya di browser).
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="font-bold text-slate-900">
              Step 2 — hitungan ulang (setelah delegasi)
            </p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Setelah admin mendelegasikan SKU ke operator, input berikutnya
              dari operator itu otomatis <strong>step 2</strong> — tidak digabung
              ke step 1. Di admin: badge{" "}
              <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-1 py-0.5 rounded">
                S2
              </span>{" "}
              / &quot;Step 2 (ulang)&quot;. Approval rak lama dibersihkan agar
              admin menetapkan ulang. Untuk compare, step tertinggi per
              operator+rak yang dipakai.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="font-bold text-slate-900">Cara kerja singkat</p>
            <ol className="mt-2 list-decimal pl-5 text-sm text-slate-600 space-y-1.5 leading-relaxed">
              <li>
                Admin lihat selisih di{" "}
                <Link to="/admin" className="link link-primary">
                  /admin
                </Link>{" "}
                /{" "}
                <Link to="/selisih" className="link link-primary">
                  /selisih
                </Link>
                , delegasikan ke operator gudang yang sama.
              </li>
              <li>
                Operator input ulang lewat{" "}
                <Link to="/input" className="link link-primary">
                  /input
                </Link>
                .
              </li>
              <li>
                Sistem tulis step 2. Peringatan rescan hanya jika sudah pernah
                input di step 2 yang sama.
              </li>
              <li>
                Admin tetapkan ulang / compare memakai hasil step 2.
              </li>
            </ol>
          </div>
        </div>
      </DocSection>

      <DocSection id="menu" title="5. Menu">
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            to="/input"
            className="bg-white border border-slate-200 rounded-2xl p-4 hover:border-slate-300 transition-colors"
          >
            <p className="font-bold text-slate-900">Input</p>
            <p className="mt-1 text-xs text-slate-500">
              Scan fisik (operator / owner). Rescan dicek server + step.
            </p>
          </Link>
          <Link
            to="/selisih"
            className="bg-white border border-slate-200 rounded-2xl p-4 hover:border-slate-300 transition-colors"
          >
            <p className="font-bold text-slate-900">Cek Selisih</p>
            <p className="mt-1 text-xs text-slate-500">
              Buka/tutup periode, tugas SKU, delegasi
            </p>
          </Link>
          <Link
            to="/admin"
            className="bg-white border border-slate-200 rounded-2xl p-4 hover:border-slate-300 transition-colors"
          >
            <p className="font-bold text-slate-900">Admin</p>
            <p className="mt-1 text-xs text-slate-500">
              Compare, tetapkan, final correction, export CSV + nama rak
            </p>
          </Link>
          <Link
            to="/my-logs"
            className="bg-white border border-slate-200 rounded-2xl p-4 hover:border-slate-300 transition-colors"
          >
            <p className="font-bold text-slate-900">My Logs</p>
            <p className="mt-1 text-xs text-slate-500">
              Riwayat scan; filter tanggal mengikuti periode gudang
            </p>
          </Link>
        </div>
      </DocSection>

      <DocSection id="riwayat" title="6. Riwayat Perubahan">
        <pre className="bg-white border border-slate-200 rounded-2xl p-4 text-xs text-slate-700 font-mono whitespace-pre-wrap overflow-x-auto leading-relaxed">
          {todoMd.trim()}
        </pre>
      </DocSection>

      <footer className="pt-8 border-t border-slate-200 text-xs text-slate-400">
        Catur Sukses Internasional — Stok Opname CSI
      </footer>
    </DocsShell>
  );
}
