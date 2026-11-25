#!/usr/bin/env node
/**
 * 从各曲 song.json 生成根首页与 SONGS.md。
 *
 *   node scripts/build-site.js
 *   node scripts/build-site.js --check
 *
 * 首页保持单文件、可离线打开：生成时把合集数组直接写进 index.html。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'site', 'index.template.html');
const INDEX_OUT = path.join(ROOT, 'index.html');
const SONGS_OUT = path.join(ROOT, 'SONGS.md');
const CHECK_ONLY = process.argv.includes('--check');
const VALID_FLAGS = new Set(['--check']);

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--') && !VALID_FLAGS.has(arg)) {
    console.error(`未知参数: ${arg}`);
    process.exit(1);
  }
}

const errors = [];
const warnings = [];
const fail = () => {
  if (!errors.length) return;
  console.error('✗ 站点汇总校验未通过：');
  errors.forEach(error => console.error('  · ' + error));
  process.exit(1);
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${path.relative(ROOT, file)} 读取失败：${error.message}`);
    return null;
  }
}

function deepMerge(base, extra) {
  if (Array.isArray(base) || Array.isArray(extra)) return extra === undefined ? base : extra;
  if (typeof base !== 'object' || base === null || typeof extra !== 'object' || extra === null) {
    return extra === undefined ? base : extra;
  }
  const output = Object.assign({}, base);
  for (const key of Object.keys(extra)) output[key] = deepMerge(base[key], extra[key]);
  return output;
}

function loadSong(file, depth = 0) {
  if (depth > 5) throw new Error('extends 层级过深（可能有循环引用）');
  const raw = readJson(file);
  if (!raw) return null;
  if (raw.extends) {
    const baseFile = path.resolve(path.dirname(file), raw.extends);
    if (!fs.existsSync(baseFile)) {
      errors.push(`${path.relative(ROOT, file)} 的 extends 指向不存在：${raw.extends}`);
      return null;
    }
    const base = loadSong(baseFile, depth + 1);
    if (!base) return null;
    const merged = deepMerge(base, raw);
    delete merged.extends;
    return merged;
  }
  return raw;
}

function hasFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (_) {
    return false;
  }
}

function lyricLineCount(song) {
  if (song.modules?.lyrics === false) return 0;
  return (song.lyrics?.blocks || []).reduce((total, block) => total + (block.lines || []).length, 0);
}

function moduleCount(song) {
  const modules = Object.assign({ map: true, lyrics: true, lines: true, vocab: true, grammar: true }, song.modules || {});
  return ['map', 'lyrics', 'lines', 'vocab', 'grammar'].filter(key => modules[key] !== false).length;
}

function catalogEntry(dir, song) {
  const meta = song.meta || {};
  const catalog = meta.catalog;
  const label = path.join(dir, `${dir}.song.json`);

  if (!meta.slug) errors.push(`${label}: 缺少 meta.slug`);
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    errors.push(`${label}: 缺少 meta.catalog（站点卡片元数据）`);
    return null;
  }

  for (const key of ['work', 'source', 'tone', 'description']) {
    if (typeof catalog[key] !== 'string' || !catalog[key].trim()) {
      errors.push(`${label}: meta.catalog.${key} 不能为空`);
    }
  }
  if (catalog.tone && !['teal', 'rust'].includes(catalog.tone)) {
    errors.push(`${label}: meta.catalog.tone 只能是 teal 或 rust`);
  }
  if (catalog.order !== undefined && (!Number.isInteger(catalog.order) || catalog.order < 1)) {
    errors.push(`${label}: meta.catalog.order 必须是正整数`);
  }
  if (catalog.title !== undefined && (!Array.isArray(catalog.title) || !catalog.title.length || catalog.title.some(v => typeof v !== 'string' || !v))) {
    errors.push(`${label}: meta.catalog.title 必须是非空字符串数组`);
  }
  if (catalog.artists !== undefined && (!Array.isArray(catalog.artists) || !catalog.artists.length || catalog.artists.some(v => typeof v !== 'string' || !v))) {
    errors.push(`${label}: meta.catalog.artists 必须是非空字符串数组`);
  }
  if (!Array.isArray(song.lines) || !Array.isArray(song.vocab) || !Array.isArray(song.grammar)) {
    errors.push(`${label}: lines / vocab / grammar 必须是数组`);
    return null;
  }

  const coverFile = path.join(ROOT, dir, 'covers', 'thumb.jpg');
  const coverWebpFile = path.join(ROOT, dir, 'covers', 'thumb.webp');
  const indexFile = path.join(ROOT, dir, 'index.html');
  if (!hasFile(indexFile)) errors.push(`${label}: 缺少构建产物 ${dir}/index.html`);
  if (!hasFile(coverFile)) errors.push(`${label}: 缺少合集缩略图 ${dir}/covers/thumb.jpg`);
  if (!hasFile(coverWebpFile)) warnings.push(`${dir}: 缺少 covers/thumb.webp，卡片会退回 jpg（跑 npm run build 会自动补）`);

  const title = catalog.title || [meta.titleLine1, meta.titleLine2].filter(Boolean);
  if (!title.length) errors.push(`${label}: 无法确定卡片标题`);

  return {
    dir,
    song,
    meta,
    catalog,
    card: {
      slug: meta.slug,
      href: `./${dir}/index.html`,
      ...(hasFile(coverFile) ? { cover: `./${dir}/covers/thumb.jpg` } : {}),
      ...(hasFile(coverWebpFile) ? { coverWebp: `./${dir}/covers/thumb.webp` } : {}),
      kicker: catalog.kicker || meta.kicker || '',
      work: catalog.work,
      title,
      artist: meta.artist || '',
      ...(catalog.artists?.length ? { artists: catalog.artists } : {}),
      year: meta.discLabel || '',
      level: meta.level || meta.badges?.[0] || '',
      tone: catalog.tone,
      desc: catalog.description,
      scale: {
        lyr: lyricLineCount(song),
        lines: song.lines.length,
        vocab: song.vocab.length,
        grammar: song.grammar.length
      }
    },
    documentTitle: catalog.documentTitle || title.join(' '),
    source: catalog.source,
    moduleCount: moduleCount(song)
  };
}

function collectSongs() {
  const entries = [];
  for (const dirent of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.') || dirent.name === 'node_modules' || dirent.name === 'site' || dirent.name === 'scripts') continue;
    const dir = dirent.name;
    const expected = path.join(ROOT, dir, `${dir}.song.json`);
    if (!hasFile(expected)) continue;
    const song = loadSong(expected);
    if (!song) continue;
    const entry = catalogEntry(dir, song);
    if (entry) entries.push(entry);
  }

  const orderSeen = new Map();
  const slugSeen = new Map();
  for (const entry of entries) {
    if (entry.catalog.order !== undefined) {
      if (orderSeen.has(entry.catalog.order)) {
        errors.push(`meta.catalog.order=${entry.catalog.order} 重复：${orderSeen.get(entry.catalog.order)} / ${entry.dir}`);
      }
      orderSeen.set(entry.catalog.order, entry.dir);
    }
    if (slugSeen.has(entry.meta.slug)) {
      errors.push(`meta.slug 重复：${entry.meta.slug}（${slugSeen.get(entry.meta.slug)} / ${entry.dir}）`);
    }
    slugSeen.set(entry.meta.slug, entry.dir);
  }

  entries.sort((a, b) => {
    const aOrdered = a.catalog.order !== undefined;
    const bOrdered = b.catalog.order !== undefined;
    if (aOrdered !== bOrdered) return aOrdered ? -1 : 1;
    if (aOrdered && a.catalog.order !== b.catalog.order) return a.catalog.order - b.catalog.order;
    return a.meta.slug.localeCompare(b.meta.slug, 'ja');
  });

  entries.forEach(entry => {
    if (entry.catalog.order === undefined) {
      warnings.push(`${entry.dir}: 未设置 meta.catalog.order，已按 slug 排到现有曲目之后`);
    }
  });
  return entries;
}

function mdCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function renderMarkdown(entries) {
  const lines = [
    '# 曲目',
    '',
    '合集页 [`index.html`](./index.html) 与本文件均由各曲 `*.song.json` 自动汇总生成。',
    '新增歌曲时填写 `meta.catalog`，然后运行 `npm run build`；不要手改这里。',
    '',
    '| # | 曲目 | 出处 | 演唱 | 年份 | 难度 | 规模 | 板块 | 页面 |',
    '|---|---|---|---|---|---|---|---|---|'
  ];

  entries.forEach((entry, index) => {
    const card = entry.card;
    lines.push(`| ${index + 1} | ${mdCell(entry.documentTitle)} | ${mdCell(entry.source)} | ${mdCell(card.artist)} | ${mdCell(card.year)} | ${mdCell(card.level)} | ${card.scale.lines} 句 / ${card.scale.vocab} 词 / ${card.scale.grammar} 语法 / ${card.scale.lyr} 行歌词 | ${entry.moduleCount} 块 | [打开](${card.href}) |`);
  });

  const multiCredit = entries.filter(entry => entry.card.artists?.length);
  if (multiCredit.length) {
    lines.push('', '## 多署名曲', '', '多署名曲通过 `meta.catalog.artists` 拆分歌手统计。数组里只放真正演唱的人，作词作曲、制作人和角色名不进入歌手筛选。', '');
    for (const entry of multiCredit) {
      lines.push(`- ${entry.documentTitle}（${entry.card.artist} → ${entry.card.artists.join(' / ')}）`);
    }

    const artistCounts = new Map();
    for (const entry of entries) {
      for (const artist of entry.card.artists?.length ? entry.card.artists : [entry.card.artist]) {
        artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
      }
    }
    const repeated = [...artistCounts.entries()].filter(([artist, count]) => count > 1 && multiCredit.some(entry => entry.card.artists?.includes(artist)));
    if (repeated.length) {
      lines.push('', '按实际演唱者统计：' + repeated
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
        .map(([artist, count]) => `「${artist}」${count} 首`)
        .join('、') + '。');
    }
  }

  lines.push('', '<!-- Generated by scripts/build-site.js. Do not edit manually. -->', '');
  return lines.join('\n');
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) {
    errors.push(`site/index.template.html 缺少 ${label} 占位符`);
    return source;
  }
  if (source.indexOf(search, first + search.length) >= 0) {
    errors.push(`site/index.template.html 的 ${label} 占位符出现了多次`);
    return source;
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

/* 首屏缩略图在 head 里 preload：卡片是 JS 注入的，不预载的话图片请求要等
   HTML 下载 + 解析 + 执行完才发出，在慢网络上等于白白多一个 RTT。 */
const PRELOAD_COUNT = 4;

function renderPreload(cards) {
  return cards.slice(0, PRELOAD_COUNT)
    .filter(card => card.coverWebp)
    .map(card => `<link rel="preload" as="image" type="image/webp" href="${card.coverWebp}" fetchpriority="high">`)
    .join('\n');
}

function renderIndex(entries) {
  let template;
  try {
    template = fs.readFileSync(TEMPLATE, 'utf8');
  } catch (error) {
    throw new Error(`读取首页模板失败：${error.message}`);
  }

  const cards = entries.map(entry => entry.card);
  const songsJson = JSON.stringify(cards, null, 2).replace(/</g, '\\u003c');
  let html = replaceOnce(template, '{{SITE_SONG_COUNT}}', String(entries.length), '曲目数');
  html = replaceOnce(html, '/*__SITE_SONGS__*/[]', songsJson, '曲目数组');
  html = replaceOnce(html, '<!--__SITE_PRELOAD__-->', renderPreload(cards), '首屏预加载');
  if (/\{\{[A-Z0-9_]+\}\}/.test(html)) errors.push('首页模板还有未替换的占位符');
  return html;
}

const entries = collectSongs();
if (!entries.length) errors.push('没有找到任何 <slug>/<slug>.song.json');
fail();

const expectedFiles = {
  [INDEX_OUT]: renderIndex(entries),
  [SONGS_OUT]: renderMarkdown(entries)
};

if (CHECK_ONLY) {
  const stale = [];
  for (const [file, expected] of Object.entries(expectedFiles)) {
    let actual = '';
    try {
      actual = fs.readFileSync(file, 'utf8');
    } catch (_) {}
    if (actual !== expected) stale.push(path.relative(ROOT, file));
  }
  if (stale.length) {
    console.error('✗ 站点汇总文件未同步：' + stale.join(', '));
    console.error('  请运行 npm run build');
    process.exit(1);
  }
  console.log(`✓ 站点汇总已同步：${entries.length} 首`);
  process.exit(0);
}

const changed = [];
for (const [file, content] of Object.entries(expectedFiles)) {
  let previous = '';
  try {
    previous = fs.readFileSync(file, 'utf8');
  } catch (_) {}
  if (previous !== content) {
    fs.writeFileSync(file, content, 'utf8');
    changed.push(path.relative(ROOT, file));
  }
}

const totals = entries.reduce((sum, entry) => {
  for (const key of ['lyr', 'lines', 'vocab', 'grammar']) sum[key] += entry.card.scale[key];
  return sum;
}, { lyr: 0, lines: 0, vocab: 0, grammar: 0 });

console.log(`✓ 已汇总 ${entries.length} 首：${totals.lines} 句 / ${totals.vocab} 词 / ${totals.grammar} 语法`);
console.log(changed.length ? `✓ 已更新 ${changed.join(', ')}` : '✓ 站点汇总文件已是最新');
warnings.slice(0, 20).forEach(warning => console.warn('  提醒：' + warning));
