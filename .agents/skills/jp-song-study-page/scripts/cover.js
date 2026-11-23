#!/usr/bin/env node
/**
 * 自动给 song.json 配官方封面。
 *
 *   node scripts/cover.js <slug>/<slug>.song.json            # 已有封面则跳过
 *   node scripts/cover.js <song.json> --force                # 重新抓
 *   node scripts/cover.js <song.json> --query "群青 YOASOBI"  # 手动指定检索词
 *   node scripts/cover.js <song.json> --artwork <图片URL>     # 跳过检索，直接用这张图
 *   node scripts/cover.js <song.json> --size 1000 --dry-run  # 只看选哪张，不写盘
 *
 * 流程：iTunes Search API 检索 → 打分挑最像「原版单曲」的一张 →
 *       取 1000px 原图 → 方图直接缩；非方图用模糊底衬补成方形 → 写 covers/cover.jpg
 *       → 同时出 covers/thumb.jpg（320px，给合集页卡片用）
 *       → 把 meta.cover 指过去（build 时会 base64 内联，产物仍是单文件）。
 *
 * 依赖：Node 18+（内置 fetch）；macOS 的 sips，或 ffmpeg（非方图补边必须有其一）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const flag = name => args.includes('--' + name);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (!file) {
  console.error('用法：node scripts/cover.js <song.json> [--force] [--query "…"] [--size 800] [--dry-run]');
  process.exit(1);
}

const SIZE = Number(opt('size', 800));
const DRY = flag('dry-run');
const FORCE = flag('force');
const ARTWORK = opt('artwork', '');

/* ---------- 文本归一化与打分 ---------- */

function norm(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[!-/:-@[-`{-~、。・「」『』（）()【】\[\]…—–―~〜]/g, '');
}

const BAD = [
  'カラオケ', 'オルゴール', 'オルガン', 'cover', 'カバー', 'instrumental', 'inst版', 'instversion',
  'remix', 'live', 'ライブ', 'acoustic', 'アコースティック', '初音ミク', 'vocaloid', '歌っちゃ王',
  'piano', 'ピアノ', '吹奏楽', 'オルゴールサウンド',
];

function score(item, title, artist, { albumMode = false } = {}) {
  const name = norm(albumMode ? item.collectionName : item.trackName);
  const coll = norm(item.collectionName);
  const by = norm(item.artistName);
  const t = norm(title);
  const a = norm(artist);
  let s = 0;

  if (name === t) s += 10;
  else if (name.startsWith(t)) s += 4;
  else if (coll === t || coll.startsWith(t)) s += 3;
  else if (!coll.includes(t) && !name.includes(t)) s -= 12;

  if (by === a) s += 6;
  else if (by.includes(a) || a.includes(by)) s += 3;
  else s -= 6;

  if (/single|ep$/.test(coll)) s += 2;
  if (BAD.some(k => (item.trackName + ' ' + item.collectionName).toLowerCase().includes(k))) s -= 20;
  if (item.artworkUrl100) s += 1;

  const date = Date.parse(item.releaseDate || '');
  if (!Number.isNaN(date)) s += Math.max(0, 3 - (date - Date.UTC(1990, 0, 1)) / (1000 * 60 * 60 * 24 * 365 * 12));

  return s;
}

/* ---------- iTunes ---------- */

async function search(params) {
  const qs = new URLSearchParams(Object.assign({ country: 'jp', limit: '25', media: 'music' }, params));
  const res = await fetch('https://itunes.apple.com/search?' + qs, {
    headers: { 'User-Agent': 'jp-song-study-page/cover-script' },
  });
  if (!res.ok) throw new Error('iTunes 返回 HTTP ' + res.status);
  const data = await res.json();
  return (data.results || []).filter(r => r.artworkUrl100);
}

function pickBest(items, title, artist, albumMode) {
  return items
    .map(item => ({ item, s: score(item, title, artist, { albumMode }) }))
    .sort((x, y) => y.s - x.s)[0];
}

async function resolveTrack(title, artist, query) {
  const term = query || `${title} ${artist}`;
  const tries = [
    { label: '单曲检索', run: () => search({ term, entity: 'song' }), album: false },
    { label: '专辑检索', run: () => search({ term: artist, entity: 'album' }), album: true },
    { label: '歌名检索', run: () => search({ term: title, entity: 'song' }), album: false },
  ];

  for (const t of tries) {
    const items = await t.run();
    const best = pickBest(items, title, artist, t.album);
    if (best && best.s > 0) {
      return { item: best.item, score: best.s, via: t.label };
    }
  }
  return null;
}

/* ---------- 图片处理 ---------- */

function artworkUrl(url) {
  return url.replace(/\/\d+x\d+bb\.(jpg|png|jpeg)$/i, '/1000x1000bb.$1');
}

function has(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function imageSize(p) {
  try {
    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', p], { encoding: 'utf8' });
    const w = Number((out.match(/pixelWidth:\s*(\d+)/) || [])[1]);
    const h = Number((out.match(/pixelHeight:\s*(\d+)/) || [])[1]);
    if (w && h) return { w, h };
  } catch { /* fall through */ }
  if (has('ffprobe')) {
    const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', p], { encoding: 'utf8' });
    const [w, h] = out.trim().split(',').map(Number);
    if (w && h) return { w, h };
  }
  return null;
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('封面下载失败 HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) throw new Error('封面文件过小，可能不是图片');
  fs.writeFileSync(dest, buf);
  return buf.length;
}

function toSquareJpg(src, dest, size) {
  const dim = imageSize(src);
  if (!dim) throw new Error('读不出图片尺寸（缺 sips/ffprobe）');
  const ratio = dim.w / dim.h;

  if (Math.abs(ratio - 1) <= 0.02) {
    if (!has('sips')) throw new Error('需要 sips 缩放图片');
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82',
      '--resampleHeightWidth', String(size), String(size), src, '--out', dest], { stdio: 'ignore' });
    return { padded: false, from: dim };
  }

  if (!has('ffmpeg')) throw new Error('封面不是方图，需要 ffmpeg 做模糊底衬补边');
  const filter = [
    `[0]scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size},boxblur=22:2,eq=brightness=-0.06[bg]`,
    `[0]scale=${size}:${size}:force_original_aspect_ratio=decrease[fg]`,
    '[bg][fg]overlay=(W-w)/2:(H-h)/2',
  ].join(';');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-filter_complex', filter, '-q:v', '3', dest], { stdio: 'ignore' });
  return { padded: true, from: dim };
}

/* 标题：日文主标题 + 拉丁副标题时只用主标题，避免检索词被英文稀释 */
function pickTitle(meta) {
  const l1 = String(meta.titleLine1 || '').trim();
  const l2 = String(meta.titleLine2 || '').trim();
  const cjk = /[\u3040-\u30ff\u4e00-\u9fff]/;
  if (!l2) return l1;
  if (!l1) return l2;
  if (cjk.test(l1) && !cjk.test(l2)) return l1;
  return l1 + ' ' + l2;
}

function makeThumb(src, dest, size) {
  if (has('sips')) {
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '78',
      '--resampleHeightWidth', String(size), String(size), src, '--out', dest], { stdio: 'ignore' });
    return;
  }
  if (!has('ffmpeg')) throw new Error('需要 sips 或 ffmpeg 生成缩略图');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src,
    '-vf', `scale=${size}:${size}`, '-q:v', '4', dest], { stdio: 'ignore' });
}

/* ---------- 主流程 ---------- */

(async () => {
  const jsonPath = path.resolve(file);
  const song = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const meta = song.meta || {};
  const title = opt('title', pickTitle(meta));
  const artist = opt('artist', meta.artist || '');

  if (!title) throw new Error('song.json 缺 meta.titleLine1，无法检索；可用 --title 指定');

  const outDir = path.join(path.dirname(jsonPath), 'covers');
  const outFile = path.join(outDir, 'cover.jpg');
  const thumbFile = path.join(outDir, 'thumb.jpg');
  const rel = 'covers/cover.jpg';

  if (!FORCE && meta.cover === rel && fs.existsSync(outFile)) {
    console.log(`✓ 已有封面，跳过：${path.relative(process.cwd(), outFile)}（要重抓加 --force）`);
    return;
  }

  let coverSrc;
  if (ARTWORK) {
    /* 日区 iTunes 常缺动画盘，或只有翻唱版；这时用 --artwork 直接给官方图地址 */
    console.log(`指定封面：${ARTWORK}`);
    coverSrc = artworkUrl(ARTWORK);
  } else {
    console.log(`检索：${title} / ${artist}`);
    const found = await resolveTrack(title, artist, opt('query', ''));
    if (!found) {
      throw new Error('没找到匹配封面。用 --query "歌名 歌手" 手动指定检索词，或 --title/--artist 覆盖字段，或 --artwork <图片URL>');
    }

    const it = found.item;
    console.log(`选中：${it.trackName || it.collectionName} — ${it.artistName}｜${it.collectionName}｜${(it.releaseDate || '').slice(0, 10)}（${found.via}，得分 ${found.score.toFixed(1)}）`);
    coverSrc = artworkUrl(it.artworkUrl100);
  }

  if (DRY) {
    console.log('--dry-run：不下载、不写 song.json');
    console.log('封面地址：' + coverSrc);
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  const tmp = path.join(outDir, '.cover-src');
  const bytes = await download(coverSrc, tmp);
  const result = toSquareJpg(tmp, outFile, SIZE);
  fs.unlinkSync(tmp);

  song.meta = Object.assign({}, meta, { cover: rel });
  fs.writeFileSync(jsonPath, JSON.stringify(song, null, 2) + '\n');

  const kb = Math.round(fs.statSync(outFile).size / 1024);
  console.log(`✓ 写入 ${path.relative(process.cwd(), outFile)}（${result.padded ? '非方图，已加模糊底衬' : '方图直缩'}，原图 ${result.from.w}×${result.from.h} → ${SIZE}×${SIZE}，${kb} KB，下载 ${Math.round(bytes / 1024)} KB）`);

  makeThumb(outFile, thumbFile, 320);
  const tkb = Math.round(fs.statSync(thumbFile).size / 1024);
  console.log(`✓ 缩略图 ${path.relative(process.cwd(), thumbFile)}（320×320，${tkb} KB，合集页用）`);
  console.log(`✓ meta.cover 已设为 "${rel}"，重新 build 即可内联`);
})().catch(err => {
  console.error('✗ ' + err.message);
  process.exit(1);
});
