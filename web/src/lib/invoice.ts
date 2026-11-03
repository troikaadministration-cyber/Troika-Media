// Open a stored invoice (an HTML document) so it always renders as UTF-8 HTML,
// regardless of the Content-Type the storage layer serves the signed URL with.
//
// Some stored invoices were saved without an explicit charset, so opening the
// signed URL directly showed raw source and/or mojibake (₹ -> â‚¹, × -> Ã—).
// Fetching the bytes and re-wrapping them in a Blob with an explicit
// text/html;charset=utf-8 type forces the browser to render them correctly —
// and fixes files that were already stored, not just newly generated ones.
//
// Security: a blob: URL runs with the app's origin, so any script inside an
// invoice could read the signed-in session. Older invoices contain unescaped
// student names/labels, so we inject a policy that blocks all scripts before
// rendering.

const NO_SCRIPT_POLICY =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`;

function lockDown(html: string): string {
  const head = html.match(/<head[^>]*>/i);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + NO_SCRIPT_POLICY + html.slice(at);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${NO_SCRIPT_POLICY}</head><body>${html}</body></html>`;
}

export async function openInvoiceHtml(signedUrl: string): Promise<void> {
  // Open the tab synchronously (inside the click) so popup blockers allow it,
  // then point it at the content once it's ready.
  const win = window.open('', '_blank');
  try {
    const res = await fetch(signedUrl);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const html = new TextDecoder('utf-8').decode(await res.arrayBuffer());
    const blob = new Blob([lockDown(html)], { type: 'text/html; charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    if (win) {
      win.location.href = blobUrl;
    } else if (!window.open(blobUrl, '_blank')) {
      URL.revokeObjectURL(blobUrl);
      throw new Error('Please allow pop-ups to view the invoice.');
    }
    // Give the new tab time to load before releasing the object URL.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (err) {
    // Network issue — fall back to the signed URL itself (served from the
    // storage domain, not the app's origin, so it can't touch the session).
    if (win) win.location.href = signedUrl;
    else window.open(signedUrl, '_blank', 'noopener');
    if (err instanceof Error && /pop-ups/.test(err.message)) throw err;
  }
}
