const ALLOWED_TAGS = new Set([
  'P',
  'DIV',
  'BR',
  'SPAN',
  'STRONG',
  'B',
  'EM',
  'I',
  'U',
  'S',
  'STRIKE',
  'SUB',
  'SUP',
  'UL',
  'OL',
  'LI',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'FONT',
]);

const STRIP_COMPLETELY_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'SVG',
  'MATH',
  'LINK',
  'META',
  'FORM',
  'INPUT',
  'BUTTON',
  'TEXTAREA',
  'SELECT',
  'OPTION',
  'NOSCRIPT',
  'TEMPLATE',
  'BASE',
  'APPLET',
  'AUDIO',
  'VIDEO',
  'SOURCE',
  'TRACK',
]);

const ALLOWED_CSS_PROPS = new Set([
  'text-align',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-decoration',
  'line-height',
  'color',
  'background-color',
  'margin',
  'margin-left',
  'margin-right',
  'margin-top',
  'margin-bottom',
  'padding',
  'padding-left',
  'padding-right',
  'padding-top',
  'padding-bottom',
  'width',
  'min-width',
  'max-width',
  'height',
  'table-layout',
  'border',
  'border-collapse',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'vertical-align',
  'word-wrap',
  'overflow-wrap',
  'text-indent',
  'white-space',
  'display',
  'letter-spacing',
  'outline',
  'outline-offset',
  'border-radius',
]);

const DANGEROUS_CSS_VALUE_RE = /(?:expression|url\s*\(|javascript:|vbscript:|data:|@import|-moz-binding|\\)/i;

function sanitizeStyleAttribute(rawStyle: string): string {
  const safeParts: string[] = [];
  for (const decl of rawStyle.split(';')) {
    const colonIdx = decl.indexOf(':');
    if (colonIdx <= 0) continue;
    const prop = decl.slice(0, colonIdx).trim().toLowerCase();
    const val = decl.slice(colonIdx + 1).trim();
    if (!prop || !val) continue;
    if (!ALLOWED_CSS_PROPS.has(prop)) continue;
    if (DANGEROUS_CSS_VALUE_RE.test(val)) continue;
    if (/[<>]/.test(val)) continue;
    safeParts.push(`${prop}:${val}`);
  }
  return safeParts.join(';');
}

function sanitizeDomNode(node: Node, doc: Document): void {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.COMMENT_NODE) {
      node.removeChild(child);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }

    const el = child as Element;
    const tag = el.tagName.toUpperCase();

    if (STRIP_COMPLETELY_TAGS.has(tag)) {
      node.removeChild(el);
      continue;
    }

    // Recursively sanitize descendants first
    sanitizeDomNode(el, doc);

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap disallowed non-executable container tags (keep safe text/children)
      const frag = doc.createDocumentFragment();
      while (el.firstChild) {
        frag.appendChild(el.firstChild);
      }
      node.replaceChild(frag, el);
      continue;
    }

    // Whitelist attributes
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const val = attr.value;

      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }

      if (name === 'style') {
        const cleanStyle = sanitizeStyleAttribute(val);
        if (cleanStyle) {
          el.setAttribute('style', cleanStyle);
        } else {
          el.removeAttribute('style');
        }
        continue;
      }

      if (
        name === 'data-alt-group' ||
        name === 'data-alt-item' ||
        name === 'data-alt-part2' ||
        name === 'data-alt-month' ||
        name === 'data-alt-sem-alt'
      ) {
        if (val.length > 200 || /[<>]/.test(val)) {
          el.removeAttribute(attr.name);
        }
        continue;
      }

      if ((tag === 'TD' || tag === 'TH') && (name === 'colspan' || name === 'rowspan')) {
        const num = parseInt(val, 10);
        if (!Number.isFinite(num) || num < 1 || num > 50) {
          el.removeAttribute(attr.name);
        } else {
          el.setAttribute(name, String(num));
        }
        continue;
      }

      if (name === 'align') {
        if (!/^(left|center|right|justify)$/i.test(val.trim())) {
          el.removeAttribute(attr.name);
        }
        continue;
      }

      if (tag === 'FONT' && (name === 'face' || name === 'size' || name === 'color')) {
        if (/[<>;"()]/.test(val) || val.length > 80) {
          el.removeAttribute(attr.name);
        }
        continue;
      }

      // Drop all other attributes (href, src, id, class, srcdoc, etc.)
      el.removeAttribute(attr.name);
    }
  }
}

export function sanitizeAlteracaoHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== 'string') return '<p><br></p>';

  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
    sanitizeDomNode(doc.body, doc);
    const cleaned = doc.body.innerHTML.trim();
    return cleaned || '<p><br></p>';
  }

  // Fallback for non-DOM test environments
  return rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(?:iframe|object|embed|svg|math|form|link|meta)[^>]*>[\s\S]*?<\/(?:iframe|object|embed|svg|math|form)>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');
}

export function sanitizeCssFontSizePt(rawPt: string, fallback = '12pt'): string {
  const clean = String(rawPt || '').trim();
  return /^(?:[6-9]|[1-6]\d|72)(?:\.\d{1,2})?pt$/.test(clean) ? clean : fallback;
}

export function sanitizeCssFontFamily(rawFamily: string, fallback = 'Times New Roman'): string {
  const clean = String(rawFamily || '').trim();
  const allowed = new Set(['Times New Roman', 'Georgia', 'Arial', 'Open Sans']);
  return allowed.has(clean) ? clean : fallback;
}

export function sanitizeCssLineHeight(rawLineHeight: string, fallback = '1.22'): string {
  const clean = String(rawLineHeight || '').trim();
  return /^(?:1(?:\.\d{1,2})?|2(?:\.0{1,2})?)$/.test(clean) ? clean : fallback;
}

export function isSafeImageObjectOrDataUrl(url: string): boolean {
  const clean = String(url || '').trim();
  if (clean.startsWith('blob:')) return true;
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/i.test(clean)) {
    return true;
  }
  return false;
}
