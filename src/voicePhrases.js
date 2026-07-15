// 播報詞庫(固定句,全部預烤 mp3)+key 函式——scripts/gen-voice.mjs 與 runtime voice.js 共用。
// ★人聲鐵律:唸出來的一律固定句、預烤 mp3;⚠ edge-tts 短句斷流雷:句子保持完整、驚嘆/句號收尾。
export function voiceKey(text) {
  const s = String(text).replace(/\s+/g, "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export const PHRASES = [
  // 開賽/出發
  "歡迎來到騎射場!策馬、拉弓、放箭!",
  "出發!穩住節奏,靶就在道旁!",
  // 命中
  "十環!馬背上的神射手!",
  "九環!命中金心!",
  "好箭!穩穩上靶!",
  "上靶了,再往中心修正。",
  // 失手/錯過
  "可惜,這箭偏了。",
  "跑過頭了,下一靶早點拉弓!",
  "這箭射空了,等靶進射擊窗再放!",
  // 終場
  "完賽!馬背上的好身手!",
  "滿環在望!全場歡呼!",
  "速射挑戰完成!又快又準!",
];

// 騎射=運動皮,無經文
export const SCRIPTURES = [];
