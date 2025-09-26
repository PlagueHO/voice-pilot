const FORBIDDEN_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'link', 'meta']);
const ALLOWED_URI_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:', 'vscode:'];

function sanitizeElement(node) {
  if (!(node instanceof Element)) {
    return;
  }

  if (FORBIDDEN_TAGS.has(node.tagName.toLowerCase())) {
    node.remove();
    return;
  }

  const attributes = Array.from(node.attributes);
  for (const attr of attributes) {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on') || name === 'style' || name === 'srcset') {
      node.removeAttribute(attr.name);
      continue;
    }

    if ((name === 'href' || name === 'src') && attr.value) {
      try {
        const url = new URL(attr.value, window.location.href);
        if (!ALLOWED_URI_SCHEMES.includes(url.protocol)) {
          node.removeAttribute(attr.name);
        }
      } catch (_error) {
        node.removeAttribute(attr.name);
      }
    }
  }
}

export function sanitizeHtml(input) {
  if (!input) {
    return '';
  }

  const doc = document.implementation.createHTMLDocument('');
  const container = doc.createElement('div');
  container.innerHTML = input;

  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, null);
  const nodesToProcess = [];
  while (walker.nextNode()) {
    nodesToProcess.push(walker.currentNode);
  }

  for (const node of nodesToProcess) {
    sanitizeElement(node);
  }

  return container.innerHTML;
}
