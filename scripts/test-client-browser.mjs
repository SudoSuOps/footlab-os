import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCaptureDemo } from "./demo-capture-server.mjs";
const { chromium } = await import(
  process.env.FLO_PLAYWRIGHT_MODULE ?? "playwright"
);
const vaultDir = mkdtempSync(join(tmpdir(), "flo-browser-"));
const demo = createCaptureDemo({ vaultDir });
demo.server.listen(0, "127.0.0.1");
await once(demo.server, "listening");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.FLO_BROWSER_PATH,
  args: process.env.FLO_BROWSER_ARGS
    ? JSON.parse(process.env.FLO_BROWSER_ARGS)
    : ["--no-sandbox"],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on("pageerror", (e) => errors.push(e.message));
const url = `http://127.0.0.1:${demo.server.address().port}/c/${demo.issueDemoLink()}`;
mkdirSync("docs/preview", { recursive: true });
try {
  await page.goto(url);
  await page.getByRole("button", { name: "Let’s check in →" }).waitFor();
  await page.screenshot({
    path: "docs/preview/flo-welcome.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Let’s check in →" }).click();
  await page.getByRole("heading", { name: "Right foot. Top view." }).waitFor();
  await page.screenshot({
    path: "docs/preview/flo-mobile-camera.png",
    fullPage: true,
  });
  // Synthetic fixture created in the test browser, never client media.
  const png = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 320;
      const g = c.getContext("2d");
      g.fillStyle = "#e8f0ff";
      g.fillRect(0, 0, 320, 320);
      g.fillStyle = "#2867df";
      g.fillRect(70, 45, 180, 230);
      g.fillStyle = "#fff";
      g.font = "bold 20px sans-serif";
      g.fillText("FLO TEST", 108, 165);
      return c.toDataURL().split(",")[1];
    }),
    "base64",
  );
  const file = { name: "synthetic.png", mimeType: "image/png", buffer: png };
  const headings = [
    "Right foot. Top view.",
    "Right foot. Sides view.",
    "Right foot. Bottom view.",
    "Left foot. Top view.",
    "Left foot. Sides view.",
    "Left foot. Bottom view.",
  ];
  for (let i = 0; i < 6; i++) {
    await page.getByRole("heading", { name: headings[i] }).waitFor();
    if (i === 1) {
      await page.route("**/photos/right-sides", (route) => route.abort(), {
        times: 1,
      });
    }
    await page.locator("#camera").setInputFiles(file);
    if (i === 1) {
      await page.getByRole("button", { name: "Retry upload" }).waitFor();
      assert.equal(await page.locator("#next").isEnabled(), false);
      await page.getByRole("button", { name: "Retry upload" }).click();
    }
    await page.getByText("✓ Photo received", { exact: true }).waitFor();
    await page.locator("#next").click();
  }
  await page
    .getByRole("heading", { name: "Anything else to show us?" })
    .waitFor();
  assert.equal(await page.locator(".extra input").count(), 4);
  for (let i = 1; i <= 4; i++) {
    await page.locator("#file-extra-" + i).setInputFiles(file);
    await page
      .locator("#upload-extra-" + i)
      .filter({ hasText: "Photo received" })
      .waitFor();
  }
  await page.locator('.remove[data-slot="extra-4"]').click();
  await page
    .locator('.remove[data-slot="extra-4"]')
    .waitFor({ state: "detached" });
  await page.waitForFunction(
    () => !document.querySelector("#file-extra-4").disabled,
  );
  await page.locator("#file-extra-4").setInputFiles(file);
  await page
    .locator("#upload-extra-4")
    .filter({ hasText: "Photo received" })
    .waitFor();
  await page.locator("#review").click();
  await page.locator("#change").selectOption("unsure");
  await page.locator("#note").fill("Synthetic browser test");
  assert.equal(await page.locator(".review-tile").count(), 10);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "docs/preview/flo-mobile-review.png",
    fullPage: true,
  });
  await page.route("**/complete", (route) => route.abort(), { times: 1 });
  await page.locator("#submit").click();
  await page.locator("#error").filter({ hasText: "retry" }).waitFor();
  assert.equal(
    await page.locator("#note").inputValue(),
    "Synthetic browser test",
  );
  assert.equal(await page.locator(".review-tile").count(), 10);
  await page.locator("#submit").click();
  await page
    .getByRole("heading", { name: "You showed up. That matters." })
    .waitFor();
  await page.getByText("10 photos ·", { exact: false }).waitFor();
  await page.reload();
  await page
    .getByRole("heading", { name: "You showed up. That matters." })
    .waitFor();
  assert.equal(
    demo.events.filter((e) => e.type === "capture_completed").length,
    1,
  );
  assert.deepEqual(errors, []);
  await page.goto(
    pathToFileURL(join(process.cwd(), "docs/preview/flo-time.html")).href,
  );
  await page.getByRole("button", { name: "Let’s check in →" }).waitFor();
  await page.getByRole("button", { name: "Camera step", exact: true }).click();
  await page.getByRole("heading", { name: "Right foot. Top view." }).waitFor();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page
    .getByRole("heading", { name: "Your check-in. Ready to send." })
    .waitFor();
  assert.equal(await page.locator(".review-tile").count(), 6);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: mobile ordered flow, upload retry, 4 extras, removal, review, completion retry, durable receipt, no horizontal overflow or JS errors.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => demo.server.close(resolve));
  rmSync(vaultDir, { recursive: true, force: true });
}
