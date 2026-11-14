import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.FANTALAB_PLAYWRIGHT ?? 'playwright');
const url = process.argv[2] ?? new URL('../../FantaLab-Pro.html', import.meta.url).href;
const target = new URL(url, pathToFileURL(process.cwd() + '/'));
const browser = await chromium.launch({
  executablePath: process.env.FANTALAB_BROWSER,
  headless: true
});

try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      target.hash = 'panoramica';
      await page.goto(target.href, { waitUntil: 'domcontentloaded' });
      const navigation = page.getByRole('navigation', { name: 'Navigazione principale' });
      const sections = await navigation.getByRole('link').evaluateAll(links =>
        links.map(link => ({ href: link.getAttribute('href'), label: link.textContent.trim() })));
      assert.ok(sections.length >= 8);
      for (const mode of ['Dati reali', 'Demo']) {
        const button = page.getByRole('button', { name: mode, exact: true });
        await button.click();
        await page.locator('#view[aria-busy=false]').waitFor();
        assert.equal(await button.getAttribute('aria-pressed'), 'true');
        for (const { href, label } of sections) {
          const link = navigation.getByRole('link', { name: label, exact: true });
          await link.click();
          await page.locator(`#main-nav a[href="${href}"][aria-current=page]`).waitFor();
          await page.locator('#view h1').waitFor();
          assert.equal(await page.locator('#page-label').textContent(), label);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
            `${label} supera la larghezza a ${viewport.width}px.`);
        }
      }
      await navigation.getByRole('link', { name: 'La mia rosa' }).click();
      await page.getByRole('button', { name: 'Carica rosa demo', exact: true }).click();
      await page.getByText('11 titolari validi', { exact: true }).waitFor();
      await navigation.getByRole('link', { name: 'Simulazione', exact: true }).click();
      await page.getByRole('button', { name: 'Avvia simulazione', exact: true }).click();
      await page.getByRole('heading', { name: 'Distribuzione dei fantapunti', exact: true }).waitFor();
      await page.getByText(/copertura titolari 100\s*%/i).waitFor();
      assert.deepEqual(errors, []);
      console.log(`Smoke test superato a ${viewport.width}×${viewport.height}.`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
