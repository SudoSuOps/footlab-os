import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
const { chromium } = await import(process.env.FLO_PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.FLO_BROWSER_PATH, args: JSON.parse(process.env.FLO_BROWSER_ARGS ?? '["--no-sandbox"]') });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(pathToFileURL(fileURLToPath(new URL("../docs/preview/flo-public-demo.html", import.meta.url))).href);
  await page.getByRole("button", { name: "Let’s check in →" }).click();
  for (const name of ["Right foot. Top view.", "Right foot. Sides view.", "Right foot. Bottom view.", "Left foot. Top view.", "Left foot. Sides view.", "Left foot. Bottom view."]) {
    await page.getByRole("heading", { name }).waitFor();
    assert.equal(await page.locator('input[type="file"]').count(), 0);
    await page.getByRole("button", { name: "Use sample image", exact: true }).click();
    await page.locator("#next").click();
  }
  for (const slot of ["extra-1", "extra-2", "extra-3", "extra-4"]) await page.locator("#file-" + slot).click();
  await page.locator("#review").click();
  await page.locator("#change").selectOption("no");
  await page.locator("#submit").click();
  await page.getByText("Simulated receipt", { exact: true }).waitFor();
  assert.ok((await page.locator(".receipt").textContent()).includes("10 photos"));
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  console.log("PASS: public demo runs 10 sample images, simulated receipt, no file inputs, no network requests or JS errors.");
} finally { await browser.close(); }
