/** Copy text. Clipboard API needs a secure context; Tailscale HTTP uses execCommand. */
export async function writeClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined" || !text) return false;
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  return writeClipboardFallback(text);
}

function writeClipboardFallback(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.style.position = "fixed";
  ta.style.left = "8px";
  ta.style.top = "8px";
  ta.style.width = "12rem";
  ta.style.height = "4rem";
  ta.style.opacity = "0.01";
  ta.style.pointerEvents = "none";
  ta.style.zIndex = "-1";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}
