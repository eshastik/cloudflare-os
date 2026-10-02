import { renderAsync } from 'docx-preview'
import DOMPurify from 'dompurify'

/** Оригинал остаётся в браузере. Полученный HTML читается в изолированном фрейме без скриптов и сети. */
export async function renderOriginalDocx(bytes: Blob): Promise<string> {
  const body = document.createElement('div'), styles = document.createElement('div')
  await renderAsync(await bytes.arrayBuffer(), body, styles, { renderAltChunks: false, useBase64URL: true, breakPages: true, renderHeaders: true, renderFooters: true })
  const html = DOMPurify.sanitize(body.innerHTML, { FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'], FORBID_ATTR: ['srcset', 'href'] })
  const css = Array.from(styles.querySelectorAll('style')).map(style => style.textContent ?? '').join('\n').replace(/<\/style/gi, '')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; font-src data: blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>${css} body{margin:0;background:#eae8ec;} .docx-wrapper{padding:24px!important;background:#efedf1!important;} section.docx{margin:0 auto 24px!important;box-shadow:0 1px 6px #0002!important;} /* reader-scale */ @media(max-width:700px){.docx-wrapper{padding:8px!important;}} </style></head><body>${html}</body></html>`
}
