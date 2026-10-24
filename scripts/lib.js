import fs from 'node:fs';
import matter from 'gray-matter';

const { WP_URL, WP_USER, WP_APP_PASSWORD } = process.env;
for (const [name, value] of Object.entries({ WP_URL, WP_USER, WP_APP_PASSWORD })) {
  if (!value) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}

const AUTH = 'Basic ' + Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');
const API = `${WP_URL.replace(/\/+$/, '')}/wp-json/wp/v2`;

// One entry per content type. `rest` is the REST base (for custom post types,
// use their rest_base). `fields` are extra scalar fields kept in front matter
// and sent back on push. Title, excerpt and content are always handled.
export const TYPES = {
  posts: {
    rest: 'posts',
    dir: 'content/posts',
    fields: ['slug', 'status', 'date_gmt', 'categories', 'tags', 'sticky'],
  },
  pages: {
    rest: 'pages',
    dir: 'content/pages',
    fields: ['slug', 'status', 'date_gmt', 'parent', 'menu_order'],
  },
};

export async function wp(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: {
      Authorization: AUTH,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return { data: await res.json(), headers: res.headers };
}

// Published items only, so drafts and private posts never reach a public repo.
export async function fetchAll(rest) {
  const items = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const { data, headers } = await wp(
      `${rest}?context=edit&status=publish&per_page=100&page=${page}`
    );
    pages = Number(headers.get('x-wp-totalpages') || 1);
    items.push(...data);
  }
  return items;
}

// YAML parses bare timestamps into Date objects; keep them as WordPress strings.
export const asString = (v) => (v instanceof Date ? v.toISOString().slice(0, 19) : v);

export function toFrontMatter(cfg, item) {
  const fm = { id: item.id, title: item.title.raw, excerpt: item.excerpt?.raw ?? '' };
  for (const f of cfg.fields) if (item[f] !== undefined) fm[f] = item[f];
  fm.modified_gmt = item.modified_gmt;
  return fm;
}

export function writeItem(file, data, body) {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  fs.writeFileSync(file, matter.stringify(body, clean));
}

export function readItem(file) {
  const { data, content } = matter(fs.readFileSync(file, 'utf8'));
  return { data, body: content.replace(/\n$/, '') };
}
