export function compositionExportUrl(exportId: string, download = false) {
  return `/api/public/composition-exports/${exportId}${download ? "?download=1" : ""}`;
}
