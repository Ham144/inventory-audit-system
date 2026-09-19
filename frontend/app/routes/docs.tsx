import { Link } from "react-router";
import { DocSection, DocsShell } from "~/components/DocsShell";

export default function Docs() {
  return (
    <DocsShell subtitle="Panduan Kerja">
      <div className="mb-10">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          Panduan Stok Opname
        </h1>
        <p className="mt-2 text-sm text-slate-600 max-w-2xl">
          Alur kerja dari buka/tutup periode, input fisik, sampai delegasi SKU
          yang berselisih.
        </p>
      </div>

      <DocSection id="ringkasan" title="1. Ringkasan">
        <p>
          Aplikasi ini dipakai untuk mencocokkan stok fisik lapangan dengan qty
          sistem (NAV). Operator menginput hasil hitung fisik. Admin mengelola
          periode, mengunci patokan NAV, membandingkan hasil, dan mendelegasikan
          SKU yang berselisih.
        </p>
      </DocSection>

      <DocSection id="role" title="2. Role">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>Operator</strong> — input stok fisik di{" "}
            <Link to="/input" className="link link-primary">
              /input
            </Link>
            , kerjakan tugas di{" "}
            <Link to="/selisih" className="link link-primary">
              cek selisih
            </Link>
          </li>
          <li>
            <strong>Admin</strong> — buka/tutup periode, kunci qty NAV, compare,
            delegasi SKU selisih ke operator
          </li>
          <li>
            <strong>Owner</strong> — mirip admin, bisa pilih wilayah/lokasi
          </li>
        </ul>
      </DocSection>

      <DocSection id="alur" title="3. Alur Kerja — Periode Baru">
        <p className="mb-4 text-slate-600">
          Periode baru dimulai untuk memisahkan input selanjutnya dengan
          pekerjaan yang lalu. Ikuti urutan di bawah.
        </p>

        <ol className="space-y-5">
          <li className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Step 1 · Admin
            </p>
            <p className="font-bold text-slate-900">Tutup periode</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Periode baru dimulai untuk memisahkan input selanjutnya dengan
              pekerjaan yang lalu. Tekan tombol tutup periode di halaman{" "}
              <Link to="/selisih" className="link link-primary">
                cek selisih
              </Link>
              .
            </p>
          </li>

          <li className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Step 2 · Operator
            </p>
            <p className="font-bold text-slate-900">Input stok fisik</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Pergi ke{" "}
              <Link to="/input" className="link link-primary">
                /input
              </Link>{" "}
              dan melakukan input stock fisik, atau klik &quot;input&quot; di
              halaman cek selisih jika bingung. Jika tidak ada di cek selisih
              berarti admin belum melakukan delegasi — anda bisa langsung pergi
              saja ke input.
            </p>
          </li>

          <li className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Step 3 · Admin
            </p>
            <p className="font-bold text-slate-900">Buka periode</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Tombol di halaman{" "}
              <Link to="/selisih" className="link link-primary">
                selisih
              </Link>{" "}
              ini berguna untuk mengambil dan mengunci quantity system / qty
              patokan dari NAV yang akan dijadikan patokan utama periode yang
              dibuka ini. Anda bisa klik kapan saja jika NAV sudah bisa dijadikan
              patokan. Tapi jika belum, anda juga bisa klik kapan saja. Tombol
              ini hanya bisa ditekan satu kali. Jika NAV tidak ada isinya, tombol
              ini akan mengeluarkan info gagal agar tidak terkunci.
            </p>
          </li>

          <li className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Step 4 · Admin
            </p>
            <p className="font-bold text-slate-900">Compare di halaman admin</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Biasanya hasil opname otomatis dicompare di halaman{" "}
              <Link to="/admin" className="link link-primary">
                admin
              </Link>
              . Tapi jika aplikasi gagal, anda bisa klik &quot;cek selisih&quot;
              di ujung tiap row.
            </p>
          </li>

          <li className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Step 5 · Admin
            </p>
            <p className="font-bold text-slate-900">Delegasi SKU selisih</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Hasilnya: barang yang berselisih dan opname yang diragukan akan
              muncul di cek selisih dengan status &quot;selisih&quot;. Sebagai
              admin anda bisa mendelegasikan nya kepada operator yang anda
              tugaskan.
            </p>
          </li>

          <li className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Step 6 · Operator
            </p>
            <p className="font-bold text-slate-900">Kerjakan di cek selisih</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Di halaman{" "}
              <Link to="/selisih" className="link link-primary">
                cek selisih
              </Link>
              : sambil mengerjakan SKU yang belum dikerjakan (status:
              &quot;belum&quot;), anda bisa melihat SKU yang di-delegasikan
              kepada anda. Bisa langsung tekan tombol &quot;input&quot; di pojok
              kanan agar lebih cepat.
            </p>
          </li>

          <li className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Step 7 · Admin
            </p>
            <p className="font-bold text-slate-900">Tutup periode</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Tombol tutup periode di cek selisih akan mengakhiri sesi kerja /
              periode kerja yang akan mengosongkan halaman myLogs, status selisih
              di halaman selisih, row input di halaman admin, dan aturan-aturan
              penguncian yang telah berlalu.
            </p>
          </li>
        </ol>
      </DocSection>

      <DocSection id="menu" title="4. Menu">
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            to="/input"
            className="bg-white border border-slate-200 rounded-2xl p-4 hover:border-slate-300 transition-colors"
          >
            <p className="font-bold text-slate-900">Input</p>
            <p className="mt-1 text-xs text-slate-500">
              Input stock fisik lapangan (operator)
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
              Compare hasil opname vs NAV
            </p>
          </Link>
          <Link
            to="/my-logs"
            className="bg-white border border-slate-200 rounded-2xl p-4 hover:border-slate-300 transition-colors"
          >
            <p className="font-bold text-slate-900">My Logs</p>
            <p className="mt-1 text-xs text-slate-500">
              Riwayat scan milik anda
            </p>
          </Link>
        </div>
      </DocSection>

      <footer className="pt-8 border-t border-slate-200 text-xs text-slate-400">
        Catur Sukses Internasional — Stok Opname CSI
      </footer>
    </DocsShell>
  );
}
