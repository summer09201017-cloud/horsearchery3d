// horsearchery3d 端到端驗證:自動騎射手(拉滿+瞄心)→ 高環數完賽;全程不射 → 全靶錯過;速射挑戰
// 用法:node scripts/verify-horsearchery.mjs <url> <outDir>
import { chromium } from "playwright";

const [url, outDir] = process.argv.slice(2);
const EXE = process.env.CHROME_EXE ||
  "C:/Users/agape250/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe";
const errors = [];
const results = {};
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

await page.goto(url, { waitUntil: "load", timeout: 25000 });
await page.bringToFront();
await page.waitForTimeout(1200);

const G = "__horsearchery3d";

const runCourse = (mode, shooter) => page.evaluate(async ([g, m, shoot]) => {
  const game = window[g];
  document.querySelector(`.mode-card[data-mode="${m}"]`).click();
  document.querySelector("#startMatchButton").click();
  await new Promise((r) => setTimeout(r, 300));
  game.beginDraw(); // 出發
  const t0 = performance.now();
  let drawingFor = null;
  while (game.phase !== "ended" && performance.now() - t0 < 150000) {
    if (shoot && game.phase === "riding") {
      const target = game.activeTarget();
      if (target && !game.drawing && !game.arrowFlight) {
        game.beginDraw();
        drawingFor = target;
      }
      if (game.drawing && drawingFor) {
        game.aimLocal.set(0, 0); // 瞄準紅心(headless 無滑鼠)
        const dtf = drawingFor.dist - game.dist;
        if (game.power >= 1 && dtf < 6) game.releaseDraw(); // 拉滿+靶側身前放箭
      }
    }
    await new Promise((r) => setTimeout(r, 16));
  }
  return {
    phase: game.phase,
    totalScore: game.totalScore,
    gold: game.goldCount,
    elapsed: Math.round(game.elapsed * 10) / 10,
    targetCount: game.targets.length,
    rings: game.targets.map((t) => t.ring),
    overlay: { ...game.overlay },
  };
}, [G, mode, shooter]);

await page.waitForTimeout(800);
await page.screenshot({ path: outDir + "/ha-menu.png" });

// —— 標準賽:自動騎射手(kids 預設難度=normal?用選單當前值) ——
results.shootRun = await runCourse("standard", true);
await page.screenshot({ path: outDir + "/ha-finish-shoot.png" });

// —— 全程不射:全靶錯過,溫柔完賽 ——
await page.evaluate(() => document.querySelector("#overlayMenuButton").click());
await page.waitForTimeout(400);
results.missRun = await runCourse("standard", false);

// —— 速射挑戰 ——
await page.evaluate(() => document.querySelector("#overlayMenuButton").click());
await page.waitForTimeout(400);
results.challengeRun = await runCourse("challenge", true);

// —— 騎行+拉弓瞄準截圖 ——
await page.evaluate(() => document.querySelector("#overlayMenuButton").click());
await page.waitForTimeout(400);
await page.evaluate((g) => {
  const game = window[g];
  document.querySelector('.mode-card[data-mode="standard"]').click();
  document.querySelector("#startMatchButton").click();
  setTimeout(() => game.beginDraw(), 200);
}, G);
await page.waitForTimeout(3500);
await page.screenshot({ path: outDir + "/ha-riding.png" });
// 等靶進窗,拉弓中截圖(準星+靶+拉弓條)
await page.evaluate(async (g) => {
  const game = window[g];
  const t0 = performance.now();
  while (!game.activeTarget() && performance.now() - t0 < 30000) {
    await new Promise((r) => setTimeout(r, 16));
  }
  game.beginDraw();
  game.aimLocal.set(0, 0);
  await new Promise((r) => setTimeout(r, 350));
}, G);
await page.screenshot({ path: outDir + "/ha-drawing.png" });

console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
