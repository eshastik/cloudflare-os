const tags = new Set('p div span br hr h1 h2 h3 h4 h5 h6 strong b em i u s strike sub sup ul ol li blockquote pre code table thead tbody tfoot tr th td caption colgroup col'.split(' '))
const styles = new Set('color background-color font-weight font-style font-size font-family text-align text-decoration white-space border border-color border-width border-style padding margin line-height vertical-align width height'.split(' '))

/** Разметка просмотра сохраняет только пассивные элементы и оформление. */
export function reviewMarkup(html: string): string {
  const template = document.createElement('template'); template.innerHTML = html
  const clean = document.createElement('template')
  function copy(node: Node, parent: Node) {
    if (node.nodeType === 3) { parent.appendChild(document.createTextNode(node.textContent || '')); return }
    const view = document.defaultView
    if (!view || !(node instanceof view.HTMLElement)) return
    const tag = node.localName
    if (['script', 'style', 'iframe', 'object', 'embed', 'template', 'link', 'meta', 'base', 'input', 'form'].includes(tag)) return
    const out = document.createElement(tags.has(tag) ? tag : 'span')
    for (const name of styles) {
      const value = node.style.getPropertyValue(name)
      if (value && /^[\w\s#.,%()"'-]+$/.test(value) && !/url|var|expression|attr/i.test(value)) out.style.setProperty(name, value)
    }
    for (const name of ['colspan', 'rowspan']) {
      const value = node.getAttribute(name)
      if ((tag === 'td' || tag === 'th') && value && /^[1-9][0-9]{0,2}$/.test(value)) out.setAttribute(name, value)
    }
    for (const name of tag === 'ol' ? ['start'] : tag === 'li' ? ['value'] : []) {
      const value = node.getAttribute(name)
      if (value && /^-?\d{1,10}$/.test(value) && Number(value) >= -2147483648 && Number(value) <= 2147483647) out.setAttribute(name, value)
    }
    for (const child of node.childNodes) copy(child, out)
    parent.appendChild(out)
  }
  for (const child of template.content.childNodes) copy(child, clean.content)
  return clean.innerHTML
}

/** Изолированный просмотр без сети и активного содержимого. */
export function documentPreviewSource(html: string): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:16px sans-serif;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:4px}</style>${reviewMarkup(html)}`
}

