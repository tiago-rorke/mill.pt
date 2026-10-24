// WordPress -> repo. Mirrors published content into content/<type>/<id>-<slug>.html
import fs from 'node:fs';
import path from 'node:path';
import { TYPES, fetchAll, toFrontMatter, writeItem } from './lib.js';

for (const [type, cfg] of Object.entries(TYPES)) {
  fs.mkdirSync(cfg.dir, { recursive: true });
  const items = await fetchAll(cfg.rest);
  const keep = new Set();

  for (const item of items) {
    const name = `${item.id}-${item.slug}.html`;
    keep.add(name);
    writeItem(path.join(cfg.dir, name), toFrontMatter(cfg, item), item.content.raw);
  }

  // Remove files for items that were renamed, unpublished or deleted on the site.
  // Files without a numeric id prefix (new, not yet pushed) are left alone.
  for (const f of fs.readdirSync(cfg.dir)) {
    if (/^\d+-/.test(f) && !keep.has(f)) fs.rmSync(path.join(cfg.dir, f));
  }

  console.log(`${type}: ${items.length} item(s) written`);
}
