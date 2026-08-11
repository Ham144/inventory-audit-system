export type BulkCompareResultRow = {
  sku: string;
  name: string;
  office: string;
  physicalQty: number;
  systemQty: number;
  status: string;
  resolvedRakCount: number;
  pendingRakCount: number;
  note: string;
  hasil: "dibandingkan" | "dilewati_pending_rak" | "gagal" | "laporan";
  keterangan: string;
};

function csvEscape(value: string | number): string {
  const str = String(value);
  if (str.includes(",") || str.includes("\n") || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildBulkCompareCsv(
  rows: BulkCompareResultRow[],
  dateFrom: string,
  dateTo: string,
): string {
  const header = [
    "SKU",
    "Nama Barang",
    "Lokasi",
    "Fisik",
    "ERP",
    "Selisih",
    "Status NAV",
    "Rak Selesai",
    "Rak Pending",
    "Hasil",
    "Keterangan",
    "Catatan",
  ].join(",");

  const dataRows = rows.map((r) => {
    const isCompared = r.hasil === "dibandingkan" || (r.hasil === "laporan" && r.status !== "belum_compare");
    const selisih = isCompared ? r.physicalQty - r.systemQty : "";
    
    return [
      csvEscape(r.sku),
      csvEscape(r.name),
      csvEscape(r.office),
      csvEscape(r.physicalQty),
      isCompared ? csvEscape(r.systemQty) : "—",
      selisih !== "" ? csvEscape(selisih) : "—",
      csvEscape(r.status),
      csvEscape(r.resolvedRakCount),
      csvEscape(r.pendingRakCount),
      csvEscape(r.hasil),
      csvEscape(r.keterangan),
      csvEscape(r.note),
    ].join(",");
  });

  return [header, ...dataRows].join("\n");
}

export function downloadCsv(filename: string, content: string): void {
  const bom = "\uFEFF";
  const blob = new Blob([bom + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
