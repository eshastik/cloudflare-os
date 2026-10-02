export async function copyToClipboard(text: string, html?: string): Promise<boolean> {
  if (!navigator.clipboard) return false

  if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([text], {type: "text/plain"}),
        "text/html": new Blob([html], {type: "text/html"}),
      })])
      return true
    } catch { /* При отсутствии поддержки HTML остаётся обычное копирование. */ }
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
