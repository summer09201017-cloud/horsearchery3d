// verify-idle.mjs — idle 生動效果驗證(獨立 Playwright,絕不用共用 MCP 瀏覽器)
// 自起 `npx vite preview --port 5426 --strictPort`(專屬 port),驗完 taskkill。
// 驗:①騎射手 headGroup 會轉頭+smile 會放大 ②觀眾 14 人手臂舉放人浪 ③0 pageerror/0 console error
// 截圖:shots/idle-face.png(臉部特寫)、shots/idle-crowd.png(舉手人浪)、shots/idle-full.png(全景)
// 用法:node scripts/verify-idle.mjs
import { spawn } from "child_process";
import { mkdirSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire("C:/Users/HFP/");
const { chromium } = require("playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "scripts", "shots");
mkdirSync(SHOTS, { recursive: true });
const PORT = 5426;
const URL = `http://localhost:${PORT}/`;
const EXE = process.env.CHROME_EXE ||
  "C:/Users/HFP/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe";

// —— 自起 preview(strictPort:被占直接失敗,不飄埠) ——
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  cwd: ROOT, shell: true, stdio: "pipe",
});
const killServer = () => {
  try { spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { shell: true }); } catch {}
};
process.on("exit", killServer);

// 等埠開
await new Promise((resolve, reject) => {
  const t0 = Date.now();
  const probe = async () => {
    try {
      const res = await fetch(URL);
      if (res.ok) return resolve();
    } catch {}
    if (Date.now() - t0 > 20000) return reject(new Error("preview 沒起來"));
    setTimeout(probe, 300);
  };
  probe();
});

const errors = [];
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

await page.goto(URL, { waitUntil: "load", timeout: 25000 });
await page.bringToFront(); // 鐵則:分頁背景化 → RAF 1fps 像凍結
await page.waitForTimeout(1200);

const G = "__horsearchery3d";
const results = {};

// —— ⓪ 先開一場(出發線 gate 待命):首頁選單 DOM 會蓋住 canvas,截圖前要離開 menu 相位 ——
await page.evaluate(() => {
  document.querySelector('.mode-card[data-mode="standard"]').click();
  document.querySelector("#startMatchButton").click();
});
await page.waitForTimeout(600);

// —— ① 出發線採樣 7.5s:騎手轉頭/微笑 + 觀眾手臂/頭擺/踮起 都要真的在動 ——
results.sampling = await page.evaluate(async (g) => {
  const game = window[g];
  const s = {
    headYawMin: Infinity, headYawMax: -Infinity,
    smileMax: 0,
    armMin: Infinity, armMax: -Infinity,
    crowdHeadMin: Infinity, crowdHeadMax: -Infinity,
    hopMax: 0,
    timeStart: game.time, crowdCount: game.crowdFigures.length,
  };
  const t0 = performance.now();
  while (performance.now() - t0 < 7500) {
    const yaw = game.rider.headGroup.rotation.y;
    s.headYawMin = Math.min(s.headYawMin, yaw);
    s.headYawMax = Math.max(s.headYawMax, yaw);
    s.smileMax = Math.max(s.smileMax, game.rider.smile.scale.x);
    for (const c of game.crowdFigures) {
      const a = c.fig.leftArm.pivot.rotation.x;
      s.armMin = Math.min(s.armMin, a);
      s.armMax = Math.max(s.armMax, a);
      const hy = c.fig.headGroup.rotation.y;
      s.crowdHeadMin = Math.min(s.crowdHeadMin, hy);
      s.crowdHeadMax = Math.max(s.crowdHeadMax, hy);
      s.hopMax = Math.max(s.hopMax, c.fig.rig.position.y);
    }
    await new Promise((r) => setTimeout(r, 33));
  }
  s.timeEnd = game.time;
  return s;
}, G);

// —— ② 臉部特寫:等騎手正在「看一下」(yaw>0.3)時凍結,鏡頭擺到臉前 ——
results.faceShot = await page.evaluate(async (g) => {
  const game = window[g];
  const t0 = performance.now();
  while (game.rider.headGroup.rotation.y < 0.3 && performance.now() - t0 < 15000) {
    await new Promise((r) => setTimeout(r, 33));
  }
  const yaw = game.rider.headGroup.rotation.y;
  game.running = false; // 凍結 RAF(updateCamera 不再蓋鏡頭)
  await new Promise((r) => setTimeout(r, 120));
  const look = game.camLook;
  game.rider.head.getWorldPosition(look);
  const t = game.tangentAt(game.dist);
  game.camera.position.set(look.x + t.x * 1.9 + 0.5, look.y + 0.28, look.z + t.z * 1.9);
  game.camera.lookAt(look.x, look.y, look.z);
  game.render();
  return { frozenYaw: yaw, smileScale: game.rider.smile.scale.x };
}, G);
await page.screenshot({ path: path.join(SHOTS, "idle-face.png") });

// —— ③ 觀眾人浪:等至少 4 人手臂高舉(pivot.x < -2.0)時凍結,鏡頭看向看台 ——
results.crowdShot = await page.evaluate(async (g) => {
  const game = window[g];
  game.start(); // 先復跑(running 此刻=false;不可先設 true,start() 會早退不重啟 RAF)
  // 等「入鏡那兩位」(side=-1 的座號 1/2,x=-18/-9)同時手臂高舉,凍結才拍得到人浪
  const centerRaised = () => [1, 2].filter((i) => game.crowdFigures[i].fig.leftArm.pivot.rotation.x < -2.2).length;
  const t0 = performance.now();
  while (centerRaised() < 2 && performance.now() - t0 < 15000) {
    await new Promise((r) => setTimeout(r, 33));
  }
  const n = game.crowdFigures.filter((c) => c.fig.leftArm.pivot.rotation.x < -2.0).length;
  game.running = false;
  await new Promise((r) => setTimeout(r, 120));
  game.camera.position.set(-15, 2.8, -22); // 看台前退一步:座號 1/2 兩位都落在 HUD 左側
  game.camera.lookAt(-13.5, 1.9, -38.2);
  game.render();
  return { raisedCount: n, centerRaised: centerRaised(), crowdTotal: game.crowdFigures.length };
}, G);
await page.screenshot({ path: path.join(SHOTS, "idle-crowd.png") });

// —— ④ 全景:復跑 → 出發騎行中截圖(順便驗 riding 段 updateIdleLife 不炸) ——
await page.evaluate((g) => {
  const game = window[g];
  game.start(); // running 此刻=false → start() 會重啟 RAF
  setTimeout(() => game.beginDraw(), 300); // 出發(此刻仍在 gate)
}, G);
await page.waitForTimeout(5000);
results.riding = await page.evaluate((g) => {
  const game = window[g];
  return { phase: game.phase, dist: Math.round(game.dist), speed: Math.round(game.speed * 10) / 10 };
}, G);
await page.screenshot({ path: path.join(SHOTS, "idle-full.png") });

// —— 判定 ——
const s = results.sampling;
const checks = {
  "騎手轉頭(yaw 幅度>0.3)": s.headYawMax - s.headYawMin > 0.3,
  "騎手微笑(smile.scale>1.2)": s.smileMax > 1.2,
  "觀眾手臂擺動(幅度>1.5)": s.armMax - s.armMin > 1.5,
  "觀眾左右看(幅度>0.4)": s.crowdHeadMax - s.crowdHeadMin > 0.4,
  "觀眾踮起(>0.02)": s.hopMax > 0.02,
  "遊戲時間有走": s.timeEnd > s.timeStart + 5,
  "騎行中不炸(phase=riding)": results.riding.phase === "riding" && results.riding.dist > 10,
  "0 pageerror / 0 console error": errors.length === 0,
};
results.checks = checks;
results.errors = errors;
const pass = Object.values(checks).every(Boolean);
console.log(JSON.stringify(results, null, 2));
console.log(pass ? "VERDICT: PASS" : "VERDICT: FAIL");

await browser.close();
killServer();
process.exit(pass ? 0 : 1);
