const SETTINGS_KEY = "horsearchery3d-settings-v1";
const SAVE_KEY = "horsearchery3d-save-v1";

const defaultSettings = {
  difficulty: "child", // 07-15:預設降為兒童(太難回報)
  modeId: "standard",
  horseCoat: "brown",
  audioEnabled: true,
};

function parseValue(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function loadSettings() {
  return {
    ...defaultSettings,
    ...parseValue(localStorage.getItem(SETTINGS_KEY), {}),
  };
}

export function saveSettings(settings) {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      ...defaultSettings,
      ...settings,
    }),
  );
}

export function loadSavedGame() {
  return parseValue(localStorage.getItem(SAVE_KEY), null);
}

export function saveGameState(snapshot) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
}

export function hasSavedGame() {
  return localStorage.getItem(SAVE_KEY) !== null;
}
