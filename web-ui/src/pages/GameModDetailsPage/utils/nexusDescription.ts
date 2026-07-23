export const renderNexusDescription = (raw: string): string => {
  let html = raw;

  html = replaceRepeatedly(html, /\[b\](.*?)\[\/b\]/gis, '<strong>$1</strong>');
  html = replaceRepeatedly(html, /\[i\](.*?)\[\/i\]/gis, '<em>$1</em>');
  html = replaceRepeatedly(html, /\[u\](.*?)\[\/u\]/gis, '<u>$1</u>');
  html = replaceRepeatedly(
    html,
    /\[center\](.*?)\[\/center\]/gis,
    '<div class="bb-center">$1</div>',
  );

  html = replaceRepeatedly(html, /\[font=(.*?)\](.*?)\[\/font\]/gis, (_m, font, text) => {
    const safeFont = sanitizeFontFamily(font);
    return safeFont ? `<span style="font-family:${safeFont}">${text}</span>` : String(text);
  });

  html = replaceRepeatedly(html, /\[color=(.*?)\](.*?)\[\/color\]/gis, (_m, color, text) => {
    const safeColor = sanitizeColor(color);
    return safeColor ? `<span style="color:${safeColor}">${text}</span>` : String(text);
  });

  html = replaceRepeatedly(html, /\[url=(.*?)\](.*?)\[\/url\]/gis, (_m, href, text) => {
    const safeHref = sanitizeExternalUrl(href);
    return safeHref
      ? `<a href="${safeHref}" target="_blank" rel="noreferrer">${text}</a>`
      : String(text);
  });
  html = replaceRepeatedly(html, /\[url\](.*?)\[\/url\]/gis, (_m, href) => {
    const safeHref = sanitizeExternalUrl(href);
    return safeHref
      ? `<a href="${safeHref}" target="_blank" rel="noreferrer">${safeHref}</a>`
      : String(href);
  });

  html = replaceRepeatedly(html, /\[youtube\]([A-Za-z0-9_-]{11})\[\/youtube\]/gi, (_m, videoId) => {
    return `<div class="bb-youtube"><iframe src="https://www.youtube-nocookie.com/embed/${videoId}" title="YouTube video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation"></iframe></div>`;
  });
  html = html.replace(/\[\/?youtube\b[^\]]*\]/gi, '');

  html = replaceRepeatedly(html, /\[img\](.*?)\[\/img\]/gis, (_m, src) => {
    const safeSrc = sanitizeExternalImageUrl(src);
    return safeSrc
      ? `<img class="bb-inline-image" src="${safeSrc}" alt="mod description image" loading="lazy" />`
      : '';
  });

  html = replaceRepeatedly(html, /\[size=(\d+)\](.*?)\[\/size\]/gis, (_m, size, text) => {
    const n = Number(size);
    const clamped = Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 3;
    const em = 0.8 + clamped * 0.1;
    return `<span style="font-size:${em.toFixed(2)}em">${text}</span>`;
  });

  html = html.replace(/\[size=\d+\]/gi, '');
  html = html.replace(/\[\/size\]/gi, '');
  html = html.replace(/\[font=.*?\]/gi, '');
  html = html.replace(/\[\/font\]/gi, '');

  html = html.replace(/\[list=1\]/gi, '<ul>');
  html = html.replace(/\[list\]/gi, '<ul>');
  html = html.replace(/\[\/list\]/gi, '</ul>');
  html = html.replace(/\[\*\]/g, '<li>');
  html = html.replace(/<li>([\s\S]*?)(?=<li>|<\/ul>)/g, '<li>$1</li>');

  html = html.replace(/<br\s*\/\/>/gi, '<br />');
  html = html.replace(/<br\s*\/\s*>/gi, '<br />');
  html = normalizeDescriptionLineBreaks(html);

  return html;
};

const normalizeDescriptionLineBreaks = (value: string): string => {
  let normalized = value.replace(/\r\n|\r/g, '\n');

  normalized = normalized.replace(/[ \t]*\n[ \t]*/g, '\n');
  normalized = normalized.replace(/\n{3,}/g, '\n\n');
  normalized = normalized.replace(/\n\n/g, '__BB_PARAGRAPH_BREAK__');
  normalized = normalized.replace(/\n/g, ' ');
  normalized = normalized.replace(/__BB_PARAGRAPH_BREAK__/g, '<br /><br />');

  normalized = normalized.replace(/(?:<br \/>\s*){3,}/gi, '<br /><br />');
  normalized = normalized.replace(/<br \/>\s*(<(?:div|ul|ol|li|img)\b)/gi, '$1');
  normalized = normalized.replace(/(<\/(?:div|ul|ol|li)>)(?:\s*<br \/>)+/gi, '$1');

  return normalized;
};

const replaceRepeatedly = (
  value: string,
  pattern: RegExp,
  replacement: string | ((substring: string, ...args: string[]) => string),
): string => {
  let current = value;

  for (let i = 0; i < 10; i += 1) {
    const next = current.replace(pattern, replacement as never);
    if (next === current) {
      break;
    }
    current = next;
  }

  return current;
};

const sanitizeExternalUrl = (value: string): string | null => {
  const href = String(value).trim();
  if (/^https?:\/\//i.test(href)) return href;
  return null;
};

const sanitizeExternalImageUrl = (value: string): string | null => {
  return sanitizeExternalUrl(value);
};

const sanitizeColor = (value: string): string | null => {
  const color = String(value).trim().toLowerCase();

  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
    return color;
  }

  const allowed = new Set([
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'pink',
    'white',
    'black',
    'gray',
    'grey',
    'cyan',
    'magenta',
  ]);

  if (allowed.has(color)) {
    return color;
  }

  return null;
};

const sanitizeFontFamily = (value: string): string | null => {
  const family = String(value).trim();
  if (!family) return null;

  if (!/^[a-z0-9 ,'-]+$/i.test(family)) {
    return null;
  }

  const normalized = family.toLowerCase();
  const blocked = ['expression', 'javascript', 'url(', '@import', ';', ':', '/*', '*/'];
  if (blocked.some((token) => normalized.includes(token))) {
    return null;
  }

  return family;
};
