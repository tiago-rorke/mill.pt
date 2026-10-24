// Repo -> WordPress. Pushes content files changed between BEFORE_SHA and AFTER_SHA.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TYPES, wp, asString, readItem, writeItem } from './lib.js';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const { BEFORE_SHA, AFTER_SHA = 'HEAD', ALLOW_TRASH } = process.env;

let changes;
if (!BEFORE_SHA || /^0+$/.test(BEFORE_SHA)) {
  changes = git('ls-files', 'content').split('\n').filter(Boolean).map((f) => ['M', f]);
} else {
  changes = git('diff', '--name-status', '--no-renames', BEFORE_SHA, AFTER_SHA, '--', 'content')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));
}

const typeFor = (file) =>
  Object.values(TYPES).find((cfg) => file.startsWith(cfg.dir + '/') && file.endsWith('.html'));
const idFromName = (file) => Number(path.basename(file).match(/^(\d+)-/)?.[1]) || null;

// A renamed file shows up as delete + add; don't trash an item that is still being updated.
const upsertedIds = new Set(
  changes.filter(([s, f]) => s !== 'D' && typeFor(f) && fs.existsSync(f))
    .map(([, f]) => readItem(f).data.id)
    .filter(Boolean)
);

async function upsert(file, cfg) {
  const { data: fm, body } = readItem(file);
  const payload = { title: fm.title ?? '', excerpt: fm.excerpt ?? '', content: body };
  for (const f of cfg.fields) if (fm[f] !== undefined) payload[f] = asString(fm[f]);

  let result;
  if (fm.id) {
    const { data: live } = await wp(`${cfg.rest}/${fm.id}?context=edit&_fields=modified_gmt`);
    const known = asString(fm.modified_gmt);
    if (known && live.modified_gmt !== known) {
      throw new Error('changed on the site since the last pull; pull and merge first');
    }
    ({ data: result } = await wp(`${cfg.rest}/${fm.id}`, { method: 'POST', body: payload }));
  } else {
    payload.status ??= 'draft';
    ({ data: result } = await wp(cfg.rest, { method: 'POST', body: payload }));
  }

  // Record what WordPress assigned so the next push's conflict check passes.
  const out = { id: result.id, ...fm, slug: result.slug, modified_gmt: result.modified_gmt };
  const newFile = path.join(cfg.dir, `${result.id}-${result.slug}.html`);
  writeItem(newFile, out, body);
  if (newFile !== file) fs.rmSync(file);
  console.log(`${fm.id ? 'updated' : 'created'} ${result.id}: ${newFile}`);
}

async function trash(file, cfg) {
  const id = idFromName(file);
  if (!id || upsertedIds.has(id)) return;
  if (ALLOW_TRASH !== 'true') {
    console.log(`skipped deletion of ${file} (set ALLOW_TRASH=true to move it to trash)`);
    return;
  }
  await wp(`${cfg.rest}/${id}`, { method: 'DELETE' }); // no force=true, so it goes to trash
  console.log(`trashed ${id}`);
}

const failures = [];
for (const [status, file] of changes) {
  const cfg = typeFor(file);
  if (!cfg) continue;
  try {
    if (status === 'D') await trash(file, cfg);
    else await upsert(file, cfg);
  } catch (err) {
    failures.push(`${file}: ${err.message}`);
    console.error(`FAILED ${file}: ${err.message}`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} file(s) failed.`);
  process.exit(1);
}
