#!/usr/bin/env node
/**
 * 为每首歌生成 WebP 版本，jpg 原图保留作兜底。
 *
 *   node scripts/optimize-covers.js           # 补齐 / 更新过期的 webp
 *   node scripts/optimize-covers.js --force   # 全部重新编码
 *   node scripts/optimize-covers.js --check   # 只报告缺失，不写文件
 *
 * 产物：
 *   covers/thumb.webp  320×320  q78  合集页卡片（显示 128px，2.5x 富余）
 *   covers/cover.webp  720×720  q80  详情页内联（显示最大 368px，约 2x）
 *
 * 首页十张缩略图原本 27KB×10，换成 webp 后约 9KB×10；详情页内联封面
 * 从 122KB 降到 30KB 上下，base64 之后省得更多。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FORCE = process.argv.includes('--force');
const CHECK_ONLY = process.argv.includes('--check');

const VARIANTS = [
  { out: 'thumb.webp', size: 320, quality: 78, from: ['thumb.jpg', 'cover.jpg'] },
  { out: 'cover.webp', size: 720, quality: 80, from: ['cover.jpg', 'thumb.jpg'] }
];

function hasCommand(name) {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

const HAS_CWEBP = hasCommand('cwebp');
const HAS_FFMPEG = hasCommand('ffmpeg');
if (!HAS_CWEBP && !HAS_FFMPEG) {
  console.error('✗ 需要 cwebp（brew install webp）或 ffmpeg 才能生成 webp');
  process.exit(1);
}

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch (_) {
    return 0;
  }
}

function encodeWebp(src, dest, size, quality) {
  if (HAS_CWEBP) {
    execFileSync('cwebp', [
      '-quiet', '-q', String(quality),
      '-resize', String(size), String(size),
      '-metadata', 'none',
      src, '-o', dest
    ], { stdio: 'ignore' });
    return;
  }
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', src,
    '-vf', `scale=${size}:${size}:flags=lanczos`,
    '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '5',
    dest
  ], { stdio: 'ignore' });
}

function songDirs() {
  return fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
    .map(dirent => dirent.name)
    .filter(dir => fs.existsSync(path.join(ROOT, dir, 'covers')))
    .sort();
}

const missing = [];
const written = [];
const skipped = [];
let beforeBytes = 0;
let afterBytes = 0;

for (const dir of songDirs()) {
  const coversDir = path.join(ROOT, dir, 'covers');
  for (const variant of VARIANTS) {
    const dest = path.join(coversDir, variant.out);
    const src = variant.from
      .map(name => path.join(coversDir, name))
      .find(file => fs.existsSync(file));

    if (!src) {
      missing.push(`${dir}: 没有任何原始封面，无法生成 ${variant.out}`);
      continue;
    }

    const srcTime = mtime(src);
    const destTime = mtime(dest);
    const jpgSibling = path.join(coversDir, variant.out.replace(/\.webp$/, '.jpg'));

    if (destTime && !FORCE && destTime >= srcTime) {
      skipped.push(`${dir}/${variant.out}`);
      if (destTime < mtime(jpgSibling)) {
        missing.push(`${dir}/${variant.out}: 比同名 jpg 旧，建议加 --force 重编码`);
      }
      beforeBytes += fs.statSync(dest).size;
      afterBytes += fs.statSync(dest).size;
      continue;
    }

    if (CHECK_ONLY) {
      missing.push(`${dir}/${variant.out}: 缺失或过期`);
      continue;
    }

    encodeWebp(src, dest, variant.size, variant.quality);
    written.push(`${dir}/${variant.out}`);
    beforeBytes += fs.statSync(src).size;
    afterBytes += fs.statSync(dest).size;
  }
}

if (CHECK_ONLY) {
  if (missing.length) {
    console.error('✗ webp 封面未就绪：');
    missing.slice(0, 20).forEach(item => console.error('  · ' + item));
    if (missing.length > 20) console.error(`  · 其余 ${missing.length - 20} 项略`);
    process.exit(1);
  }
  console.log(`✓ webp 封面齐全：${skipped.length} 个文件`);
  process.exit(0);
}

const kb = bytes => Math.round(bytes / 1024);
if (written.length) {
  console.log(`✓ 生成 ${written.length} 个 webp（${kb(beforeBytes)}KB → ${kb(afterBytes)}KB）`);
} else {
  console.log('✓ webp 封面已是最新');
}
if (skipped.length) console.log(`  跳过 ${skipped.length} 个未变化的文件`);
missing.slice(0, 20).forEach(item => console.warn('  提醒：' + item));
