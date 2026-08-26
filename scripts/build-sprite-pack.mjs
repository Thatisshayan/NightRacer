#!/usr/bin/env node
/**
 * Generates the runtime sprite pack from the authored high-resolution art.
 *
 * The authored vehicle art ships at 1373x2048 (~4-5MB each). The renderer draws
 * those vehicles at 48x80 - 80x128 CSS px, i.e. a ~1:26 minification. GPUs
 * sample that with a bilinear filter over a tiny fraction of the source texels,
 * so authored panel/rust/edge detail aliases into noise: the art looks *worse*
 * the larger the source is. See audits/2026-08-14_Viktor_UIUXVisual_Audit.md S3.
 *
 * This script pre-resamples each source with a proper Lanczos filter down to
 * ~2x the largest on-screen size (retina headroom, plus room for the planned
 * perspective camera to scale near-camera sprites up), which both removes the
 * aliasing and cuts the shipped payload by ~98%.
 *
 * Source of truth stays untouched at assets-src/sprites-premium/ (outside public/, not shipped). Output is written
 * to public/sprites/ and is what the game loads at runtime.
 *
 * Usage: node scripts/build-sprite-pack.mjs [--check]
 *   --check  exit non-zero if the generated pack is missing or stale
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'artifacts/warboss-highway/assets-src/sprites-premium');
const OUT = path.join(ROOT, 'artifacts/warboss-highway/public/sprites');

/**
 * Target width per asset class, in texture pixels.
 * Height is derived from the source aspect ratio so nothing is distorted.
 * Rationale: largest on-screen vehicle is the TANK at 80x128 CSS px; at a
 * devicePixelRatio of 3 that is 240x384, so 256 wide is the smallest power-of-
 * two-friendly size that never upsamples on a real device.
 */
const TARGET_WIDTH = {
  vehicle: 256,   // all cars, trucks, buses, player cars
  boss: 512,      // boss renders roughly double a regular vehicle
  prop: 256,      // guardrail segment, lamp post
  debris: 256,
  road: 512,      // asphalt tile is already 512 and tiles seamlessly
};

/** Files small enough that resampling would only lose information. */
const PASSTHROUGH_MAX_WIDTH = 512;
/** Backdrop layers are drawn full-bleed; leave them at authored size. */
const PASSTHROUGH_NAMES = new Set(['skyline_layer1.png', 'skyline_layer2.png']);

function classify(name, width) {
  if (PASSTHROUGH_NAMES.has(name)) return null;
  if (name === 'boss.png') return TARGET_WIDTH.boss;
  if (name === 'asphalt_tile.png') return TARGET_WIDTH.road;
  if (name === 'debris.png') return TARGET_WIDTH.debris;
  if (name === 'guardrail_segment.png' || name === 'lamp_post.png') return TARGET_WIDTH.prop;
  if (width <= PASSTHROUGH_MAX_WIDTH) return null;
  return TARGET_WIDTH.vehicle;
}

async function main() {
  const check = process.argv.includes('--check');
  if (!existsSync(SRC)) throw new Error(`source pack not found: ${SRC}`);

  const files = (await readdir(SRC)).filter((f) => f.endsWith('.png')).sort();
  if (check && !existsSync(OUT)) {
    console.error('sprite pack missing - run: node scripts/build-sprite-pack.mjs');
    process.exit(1);
  }

  if (!check) {
    await mkdir(OUT, { recursive: true });
  }

  let srcBytes = 0;
  let outBytes = 0;
  const manifest = {};

  for (const file of files) {
    const srcPath = path.join(SRC, file);
    srcBytes += (await stat(srcPath)).size;

    const image = sharp(srcPath);
    const meta = await image.metadata();
    const targetWidth = classify(file, meta.width);

    let info;
    if (targetWidth === null || targetWidth >= meta.width) {
      if (!check) {
        info = await image.png({ compressionLevel: 9, palette: false }).toFile(path.join(OUT, file));
      }
    } else {
      const targetHeight = Math.round((meta.height * targetWidth) / meta.width);
      if (!check) {
        info = await image
          .resize(targetWidth, targetHeight, { kernel: 'lanczos3', fit: 'fill' })
          .png({ compressionLevel: 9, palette: false })
          .toFile(path.join(OUT, file));
      }
    }

    let width = meta.width;
    let height = meta.height;
    let bytes = 0;
    if (info) {
      width = info.width;
      height = info.height;
      bytes = info.size;
    } else if (check) {
      const existingPath = path.join(OUT, file);
      if (!existsSync(existingPath)) {
        console.error(`stale pack: ${file} missing from OUT`);
        process.exit(1);
      }
      const existing = await sharp(existingPath).metadata();
      width = existing.width;
      height = existing.height;
      bytes = (await stat(existingPath)).size;
    }

    outBytes += bytes;
    manifest[file] = { width, height, bytes };
  }

  if (check) {
    const manifestPath = path.join(OUT, 'manifest.json');
    if (!existsSync(manifestPath)) {
      console.error('stale pack: manifest.json missing from OUT');
      process.exit(1);
    }
    const existingManifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
    if (JSON.stringify(existingManifest) !== JSON.stringify({ generatedFrom: 'assets-src/sprites-premium', sprites: manifest })) {
      console.error('stale pack: manifest.json does not match source');
      process.exit(1);
    }
    return;
  }

  await writeFile(
    path.join(OUT, 'manifest.json'),
    `${JSON.stringify({ generatedFrom: 'assets-src/sprites-premium', sprites: manifest }, null, 2)}\n`
  );

  const mb = (b) => (b / 1024 / 1024).toFixed(1);
  console.log(`sprite pack: ${files.length} files`);
  console.log(`  source ${mb(srcBytes)} MB -> runtime ${mb(outBytes)} MB`);
  console.log(`  reduction ${(100 - (outBytes / srcBytes) * 100).toFixed(1)}%`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
