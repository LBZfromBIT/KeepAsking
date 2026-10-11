// Render resources/icon.svg into PNG / ICO / ICNS icons for electron-builder.
// Requires a Chrome/Chromium (set CHROME=/path/to/chrome, default /usr/bin/google-chrome).
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const svg = readFileSync('resources/icon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage();

async function render(size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const png = {};
for (const s of sizes) png[s] = await render(s);
await browser.close();

mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png[1024]);
writeFileSync('resources/icon.png', png[512]);

// ICO with embedded PNGs (Vista+)
const icoSizes = [16, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = 6 + 16 * icoSizes.length;
const dir = [];
for (const s of icoSizes) {
  const e = Buffer.alloc(16);
  e.writeUInt8(s >= 256 ? 0 : s, 0);
  e.writeUInt8(s >= 256 ? 0 : s, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(png[s].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png[s].length;
  dir.push(e);
}
writeFileSync('build/icon.ico', Buffer.concat([header, ...dir, ...icoSizes.map((s) => png[s])]));

// ICNS with PNG payloads
const types = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024 };
const chunks = Object.entries(types).map(([t, s]) => {
  const h = Buffer.alloc(8);
  h.write(t, 0, 'ascii');
  h.writeUInt32BE(png[s].length + 8, 4);
  return Buffer.concat([h, png[s]]);
});
const body = Buffer.concat(chunks);
const ih = Buffer.alloc(8);
ih.write('icns', 0, 'ascii');
ih.writeUInt32BE(body.length + 8, 4);
writeFileSync('build/icon.icns', Buffer.concat([ih, body]));
console.log('icons written: build/icon.png, build/icon.ico, build/icon.icns, resources/icon.png');
