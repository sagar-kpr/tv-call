import { chromium } from 'playwright-core';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
const mark = `<rect width="96" height="96" rx="26" fill="#daf1bf"/><g fill="none" stroke="#183d28" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 43 48 21 75 43M27 40V72Q27 77 32 77H64Q69 77 69 72V40"/><rect x="38" y="48" width="21" height="15" rx="4"/></g><circle cx="74" cy="22" r="7" fill="#183d28"/>`;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 96 96">${mark}</svg>`;
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><defs><linearGradient id="bg"><stop stop-color="#0a1812"/><stop offset="1" stop-color="#142b20"/></linearGradient></defs><rect width="640" height="360" fill="url(#bg)"/><g transform="translate(272 64)">${mark}</g><text x="320" y="226" text-anchor="middle" font-family="sans-serif" font-size="47" font-weight="600" fill="#f4f8f0">HomePing</text><text x="320" y="266" text-anchor="middle" font-family="sans-serif" font-size="16" letter-spacing="2" fill="#9fb7ab">A LITTLE CLOSER TO HOME</text></svg>`;
await writeFile('apps/tv/artwork/homeping-icon.svg', icon);
await writeFile('apps/tv/artwork/homeping-tv-banner.svg', banner);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [svg, folder, name, width, height] of [
    [icon, 'drawable-nodpi', 'homeping_icon', 512, 512],
    [banner, 'drawable-xhdpi', 'homeping_tv_banner', 320, 180],
    [banner, 'drawable-xxxhdpi', 'homeping_tv_banner', 640, 360],
  ]) {
    const target = `apps/tv/app/src/main/res/${folder}`;
    await mkdir(target, { recursive: true });
    await page.setViewportSize({ width, height });
    await page.setContent(`<style>body{margin:0}svg{width:${width}px;height:${height}px;display:block}</style>${svg}`);
    await page.locator('svg').screenshot({ path: `${target}/${name}.png` });
  }
} finally { await browser.close(); }

// Use the same artwork in both caller interfaces and launcher metadata.
await mkdir('apps/mobile/assets', { recursive: true });
await mkdir('apps/web/public', { recursive: true });
await copyFile('apps/tv/app/src/main/res/drawable-nodpi/homeping_icon.png', 'apps/mobile/assets/homeping-icon.png');
await copyFile('apps/tv/app/src/main/res/drawable-nodpi/homeping_icon.png', 'apps/web/public/homeping-icon.png');
await writeFile('apps/web/public/homeping-icon.svg', icon);
