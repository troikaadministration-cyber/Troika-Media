// Open a stored invoice (an HTML document) so it always renders as UTF-8 HTML,
// regardless of the Content-Type the storage layer serves the signed URL with.
//
// Some stored invoices were saved without an explicit charset, so opening the
// signed URL directly showed raw source and/or mojibake (₹ -> â‚¹, × -> Ã—).
// Fetching the bytes and re-wrapping them in a Blob with an explicit
// text/html;charset=utf-8 type forces the browser to render them correctly —
// and fixes files that were already stored, not just newly generated ones.
export async function openInvoiceHtml(signedUrl: string): Promise<void> {
  try {
    const res = await fetch(signedUrl);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    const blob = new Blob([buf], { type: 'text/html; charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, '_blank');
    if (!win) {
      // Popup blocked — fall back to the direct URL.
      URL.revokeObjectURL(blobUrl);
      window.open(signedUrl, '_blank');
      return;
    }
    // Give the new tab time to load before releasing the object URL.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch {
    // Network/CORS issue — fall back to opening the signed URL directly.
    window.open(signedUrl, '_blank');
  }
}
