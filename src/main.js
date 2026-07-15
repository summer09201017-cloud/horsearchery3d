import "./styles.css";
import { HorseArcheryGame, GAME_MODES } from "./game.js";
import { AudioManager } from "./audio.js";
import { speakLine, setVoiceEnabled } from "./voice.js";
import { hasSavedGame, loadSettings, saveSettings } from "./storage.js";

const ui = {
  canvas: document.querySelector("#gameCanvas"),
  cameraButton: document.querySelector("#cameraButton"),
  totalScore: document.querySelector("#totalScore"),
  goldLabel: document.querySelector("#goldLabel"),
  modeCode: document.querySelector("#modeCode"),
  targetLabel: document.querySelector("#targetLabel"),
  timeLabel: document.querySelector("#timeLabel"),
  timeSideLabel: document.querySelector("#timeSideLabel"),
  lastRingLabel: document.querySelector("#lastRingLabel"),
  phaseLabel: document.querySelector("#phaseLabel"),
  statusMessage: document.querySelector("#statusMessage"),
  modeLabel: document.querySelector("#modeLabel"),
  difficultyLabel: document.querySelector("#difficultyLabel"),
  nextTargetLabel: document.querySelector("#nextTargetLabel"),
  speedLabel: document.querySelector("#speedLabel"),
  audioStatus: document.querySelector("#audioStatus"),
  saveStatus: document.querySelector("#saveStatus"),
  installButton: document.querySelector("#installButton"),
  installHint: document.querySelector("#installHint"),
  loadButton: document.querySelector("#loadButton"),
  menuButton: document.querySelector("#menuButton"),
  audioButton: document.querySelector("#audioButton"),
  pauseButton: document.querySelector("#pauseButton"),
  touchControls: document.querySelector("#touchControls"),
  drawMeterFill: document.querySelector("#drawMeterFill"),
  drawMeterText: document.querySelector("#drawMeterText"),
  windowFill: document.querySelector("#windowFill"),
  windowValue: document.querySelector("#windowValue"),
  matchOverlay: document.querySelector("#matchOverlay"),
  overlayEyebrow: document.querySelector("#overlayEyebrow"),
  overlayTitle: document.querySelector("#overlayTitle"),
  overlayText: document.querySelector("#overlayText"),
  resumeButton: document.querySelector("#resumeButton"),
  overlayMenuButton: document.querySelector("#overlayMenuButton"),
  homeScreen: document.querySelector("#homeScreen"),
  modeCardGrid: document.querySelector("#modeCardGrid"),
  modeDescription: document.querySelector("#modeDescription"),
  menuDifficultySelect: document.querySelector("#menuDifficultySelect"),
  horseCoatSelect: document.querySelector("#horseCoatSelect"),
  audioSelect: document.querySelector("#audioSelect"),
  modeMetaTitle: document.querySelector("#modeMetaTitle"),
  modeMetaGoal: document.querySelector("#modeMetaGoal"),
  startMatchButton: document.querySelector("#startMatchButton"),
  commentaryBar: document.querySelector("#commentaryBar"),
  continueSavedButton: document.querySelector("#continueSavedButton"),
};

const settings = loadSettings();
const audio = new AudioManager();
audio.setEnabled(settings.audioEnabled !== false);

const game = new HorseArcheryGame({
  canvas: ui.canvas,
  touchRoot: ui.touchControls,
});
window.__horsearchery3d = game; // dev hook:Playwright 驗證用
window.__game = game; // /smoke3d 通用鉤子

let selectedModeId = game.modeId;
let selectedDifficulty = game.difficulty;
let selectedCoat = game.coatId;
let audioEnabled = settings.audioEnabled !== false;

function persistSettings() {
  saveSettings({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
    horseCoat: selectedCoat,
    audioEnabled,
  });
}

function setMeterFill(element, value) {
  element.style.transform = `scaleX(${Math.max(0, Math.min(1, value))})`;
}

function setAudioState(enabled) {
  audioEnabled = enabled;
  audio.setEnabled(enabled);
  setVoiceEnabled(enabled);
  ui.audioStatus.textContent = enabled ? "開啟" : "靜音";
  ui.audioButton.textContent = enabled ? "音效開啟" : "音效靜音";
  ui.audioSelect.value = enabled ? "on" : "off";
  persistSettings();
}

function syncMenuCards() {
  for (const button of ui.modeCardGrid.querySelectorAll(".mode-card")) {
    button.classList.toggle("selected", button.dataset.mode === selectedModeId);
  }
  const mode = GAME_MODES[selectedModeId];
  ui.modeDescription.textContent = mode.description;
  ui.modeMetaTitle.textContent = mode.label;
  ui.modeMetaGoal.textContent = mode.goal;
}

function syncMenuControls() {
  ui.menuDifficultySelect.value = selectedDifficulty;
  ui.horseCoatSelect.value = selectedCoat;
  syncMenuCards();
}

function syncGameConfigurationToMenu() {
  selectedModeId = game.modeId;
  selectedDifficulty = game.difficulty;
  selectedCoat = game.coatId;
  syncMenuControls();
}

function syncOverlay(overlay) {
  ui.matchOverlay.classList.toggle("visible", overlay.visible);
  ui.overlayEyebrow.textContent = overlay.eyebrow;
  ui.overlayTitle.textContent = overlay.title;
  ui.overlayText.textContent = overlay.text;
  ui.resumeButton.hidden = !overlay.canResume;
}

function openHomeScreen() {
  game.openHomeMenu();
  audio.stopCrowd();
  syncGameConfigurationToMenu();
  ui.homeScreen.classList.add("visible");
}

function closeHomeScreen() {
  ui.homeScreen.classList.remove("visible");
}

function unlockAudio() {
  audio.unlock();
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function pushCommentary(text, tone = "info", spoken = text) {
  const bar = ui.commentaryBar;
  if (!bar || !text) return;
  bar.hidden = false;
  bar.dataset.tone = tone;
  bar.textContent = text;
  bar.style.animation = "none";
  void bar.offsetWidth;
  bar.style.animation = "";
  speakLine(spoken);
}

function handleGameEvent(event) {
  switch (event.type) {
    case "match-start": {
      audio.whistle();
      audio.startCrowd();
      audio.vibrate(18);
      pushCommentary("歡迎來到騎射場!策馬、拉弓、放箭!");
      break;
    }
    case "gate": {
      audio.buzzer();
      audio.vibrate(14);
      pushCommentary("出發!穩住節奏,靶就在道旁!");
      break;
    }
    case "release":
      audio.swish();
      audio.vibrate(14);
      break;
    case "impact": {
      if (event.miss) {
        audio.thud(0.5);
        pushCommentary(`第 ${event.idx} 靶——偏出靶外。`, "cool", "可惜,這箭偏了。");
      } else if (event.isBull) {
        audio.scoreSting();
        audio.crowdCheer(1);
        audio.vibrate([35, 25, 55]);
        pushCommentary(`第 ${event.idx} 靶——十環!正中紅心!`, "hot", "十環!馬背上的神射手!");
      } else if (event.isGold) {
        audio.scoreSting();
        audio.crowdCheer(0.7);
        audio.vibrate([30, 20, 40]);
        pushCommentary(`第 ${event.idx} 靶——${event.ring} 環,金心區!`, "hot", "九環!命中金心!");
      } else if (event.ring >= 7) {
        audio.rebound();
        audio.crowdCheer(0.3);
        pushCommentary(`第 ${event.idx} 靶——${event.ring} 環,穩穩命中!`, "info", "好箭!穩穩上靶!");
      } else {
        audio.rebound();
        pushCommentary(`第 ${event.idx} 靶——${event.ring} 環。`, "info", "上靶了,再往中心修正。");
      }
      break;
    }
    case "target-missed": {
      audio.thud(0.5);
      pushCommentary(`第 ${event.idx} 靶跑過頭了——0 環。`, "cool", "跑過頭了,下一靶早點拉弓!");
      break;
    }
    case "shoot-empty": {
      audio.rebound();
      pushCommentary("這箭射空了——等靶進射擊窗再放!", "cool", "這箭射空了,等靶進射擊窗再放!");
      break;
    }
    case "finish": {
      audio.horn();
      audio.crowdCheer(event.rings >= event.total * 0.9 ? 1 : 0.6);
      audio.vibrate([110, 50, 120]);
      const perfectish = event.grade === "A+" || event.grade === "A";
      pushCommentary(
        `完賽!${event.rings} 環,評等 ${event.grade}!`,
        perfectish ? "hot" : "info",
        perfectish ? "滿環在望!全場歡呼!" : "完賽!馬背上的好身手!",
      );
      ui.saveStatus.textContent = hasSavedGame() ? "已記錄" : "尚無";
      break;
    }
    default:
      break;
  }
}

game.onEvent = handleGameEvent;

game.onHudUpdate = (state) => {
  ui.totalScore.textContent = String(state.totalScore);
  ui.goldLabel.textContent = String(state.goldCount);
  ui.modeCode.textContent = ({ 標準賽: "標準", 速射挑戰: "速射", 練習場: "練習" })[state.modeLabel] || state.modeLabel;
  ui.targetLabel.textContent = state.endless ? `${state.targetIdx}/${state.targetCount}·圈${state.lap}` : `${state.targetIdx}/${state.targetCount}`;
  ui.timeLabel.textContent = state.timeText;
  ui.timeSideLabel.textContent = state.timeText;
  ui.lastRingLabel.textContent = state.lastRing === null ? "—" : state.lastRing === 0 ? "脫靶" : `${state.lastRing} 環`;
  ui.phaseLabel.textContent = state.phaseLabel;
  ui.statusMessage.textContent = state.message;
  ui.modeLabel.textContent = state.modeLabel;
  ui.difficultyLabel.textContent = state.difficultyLabel;
  ui.nextTargetLabel.textContent = state.nextTargetText;
  ui.speedLabel.textContent = state.speedText;
  ui.drawMeterText.textContent = state.drawing
    ? state.drawPower >= 1 ? "拉滿!放箭!" : `${Math.round(state.drawPower * 100)}%`
    : "按住拉弓";
  setMeterFill(ui.drawMeterFill, state.drawPower);
  ui.windowValue.textContent = state.window01 > 0 ? (state.windowActive ? "射擊窗!" : "接近中…") : "—";
  setMeterFill(ui.windowFill, state.window01);
  { // 中下方大拉弓條(07-14 拍板規格):拉弓時顯示
    const bp = document.getElementById("bigPower"), bf = document.getElementById("bigPowerFill");
    if (bp) {
      bp.hidden = !state.drawing;
      bf.style.transform = `scaleX(${Math.min(1, state.drawPower)})`;
      bf.classList.toggle("full", state.drawPower >= 1);
    }
  }
  syncOverlay(state.overlay);
};

syncGameConfigurationToMenu();
setAudioState(audioEnabled);
ui.saveStatus.textContent = hasSavedGame() ? "已記錄" : "尚無";

ui.modeCardGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".mode-card");
  if (!button) return;
  unlockAudio();
  audio.uiTap();
  selectedModeId = button.dataset.mode;
  syncMenuCards();
  persistSettings();
});

ui.menuDifficultySelect.addEventListener("change", (event) => {
  selectedDifficulty = event.target.value;
  persistSettings();
});

ui.horseCoatSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  selectedCoat = event.target.value;
  game.setHorseCoat(selectedCoat);
  persistSettings();
});

ui.audioSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  setAudioState(event.target.value === "on");
});

ui.startMatchButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.applyPresentation({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
    horseCoat: selectedCoat,
  });
  game.startSelectedMatch();
  closeHomeScreen();
});

function loadIntoUi() {
  const loaded = game.loadGame();
  syncGameConfigurationToMenu();
  ui.saveStatus.textContent = loaded && hasSavedGame() ? "已記錄" : "尚無";
}

ui.continueSavedButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  loadIntoUi();
});

ui.loadButton.addEventListener("click", loadIntoUi);

ui.menuButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  openHomeScreen();
});

ui.overlayMenuButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  openHomeScreen();
});

ui.cameraButton.addEventListener("click", () => {
  game.cycleCameraView();
});

ui.audioButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  setAudioState(!audioEnabled);
});

ui.pauseButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.togglePause();
});

ui.resumeButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.resume();
});

window.addEventListener("pointerdown", unlockAudio, { passive: true });
window.addEventListener("keydown", unlockAudio, { passive: true });

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  ui.installButton.hidden = false;
  ui.installHint.textContent = "已偵測到可安裝版本，點一下就能加入主畫面。";
});

ui.installButton.addEventListener("click", async () => {
  unlockAudio();
  audio.uiTap();
  if (!deferredInstallPrompt) {
    ui.installHint.textContent = "如果是 iPhone，請用分享選單的「加入主畫面」。";
    return;
  }
  deferredInstallPrompt.prompt();
  const outcome = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  ui.installButton.hidden = true;
  ui.installHint.textContent =
    outcome.outcome === "accepted" ? "安裝要求已送出。" : "你可以之後再安裝。";
});

window.addEventListener("appinstalled", () => {
  ui.installButton.hidden = true;
  ui.installHint.textContent = "已安裝到裝置。";
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    game.saveGame(true);
  }
});

// dev(localhost)不註冊 SW(07-11 踩雷)
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      ui.installHint.textContent = "Service Worker 註冊失敗，但仍可直接遊玩。";
    });
  });
}

game.start();
