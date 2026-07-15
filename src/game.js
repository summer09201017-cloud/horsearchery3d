import * as THREE from "three";
import { InputManager } from "./input.js";
import { loadSettings, saveSettings, loadSavedGame, saveGameState } from "./storage.js";

// —— 3D 騎射(horsearchery3d)——騎乘引擎(equestrian3d)× 射箭引擎(archery3d)混搭首例(2026-07-15)。
// 馬沿閉環賽道自動尋路+控速節奏(騎乘核心);道旁環靶+拉弓/晃動/放箭(射箭核心)。
// 玩法:接近道旁靶時「按住=拉弓、移動=瞄準、放開=放箭」——馬跑越快,準星飄越大,但完賽越快分越高(挑戰賽)。
// ★判定=畫面(鐵則4):放箭當下算命中點(瞄準+晃動+速度漂移),再把箭演過去;錯過靶=0 環溫柔提示,永不淘汰。

// ---------- 可調量值 ----------
// windowM=射擊窗(靶側身前幾公尺開放);sway/drawDuration/aimAssist=archery 同款;speedSway=速度對晃動的加成
export const DIFFICULTY_PRESETS = {
  // 07-15 兩輪校正:靶大+拉近+準星歸中保留;馬速回拉(太簡單回報)——「好瞄但要快」
  kids: { baseSpeed: 5.0, boost: 2.2, targets: 6, windowM: 30, swayBase: 0.01, swayGrow: 0.1, drawDuration: 0.48, aimAssist: 0.78, speedSway: 0.18 },
  child: { baseSpeed: 6.2, boost: 2.6, targets: 7, windowM: 27, swayBase: 0.026, swayGrow: 0.22, drawDuration: 0.54, aimAssist: 0.58, speedSway: 0.3 },
  easy: { baseSpeed: 7.2, boost: 3.2, targets: 8, windowM: 24, swayBase: 0.055, swayGrow: 0.38, drawDuration: 0.6, aimAssist: 0.38, speedSway: 0.45 },
  normal: { baseSpeed: 8.2, boost: 3.8, targets: 8, windowM: 21, swayBase: 0.09, swayGrow: 0.62, drawDuration: 0.66, aimAssist: 0.22, speedSway: 0.6 },
  hard: { baseSpeed: 9.2, boost: 4.8, targets: 10, windowM: 17, swayBase: 0.15, swayGrow: 0.95, drawDuration: 0.72, aimAssist: 0, speedSway: 0.95 },
};

export const DIFFICULTY_LABELS = {
  kids: "幼兒(超簡單)",
  child: "兒童(簡單)",
  easy: "入門",
  normal: "標準",
  hard: "職業",
};

export const GAME_MODES = {
  standard: {
    label: "標準賽",
    description: "繞場一圈射完所有道旁靶,環數越高越好(每靶滿分 10 環)。",
    goal: "總環數越高越好",
  },
  challenge: {
    label: "速射挑戰",
    challenge: true,
    description: "環數+速度獎勵:跑得快加分——敢加速、又射得準,才是騎射高手!",
    goal: "環數+速度獎勵",
  },
  practice: {
    label: "練習場",
    endless: true,
    description: "無限圈數自由練——熟悉拉弓節奏與馬背上的晃動。",
    goal: "純練手感,不計勝負",
  },
};

export function getModeConfig(modeId) {
  return GAME_MODES[modeId] || GAME_MODES.standard;
}

// ---------- 場地/靶常數 ----------
const TARGET_R = 0.85; // 靶面半徑(07-15 太難回報:放大)
const TARGET_SIDE = 3.6; // 靶離路徑中線的側距(07-15:拉近)
const TARGET_H = 2.05; // 靶心高(隨長腿 v3 馬抬高)
const RING_COLORS = [0xf3f4f6, 0x25272b, 0x3f9be0, 0xe8443c, 0xf6d743]; // 白黑藍紅金(外→內)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const randomSigned = (s) => (Math.random() * 2 - 1) * s;

// ---------- 人物(照抄系列 makePerson:臉部鐵則+關節人物鐵則) ----------
function createLimb({ upperMaterial, lowerMaterial, endMaterial, upperLen, lowerLen, upperRadius, lowerRadius, end = "hand", thumbSide = 1 }) {
  const pivot = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(upperRadius, upperLen, 4, 8), upperMaterial);
  upper.position.y = -upperLen / 2;
  pivot.add(upper);
  const joint = new THREE.Group();
  joint.position.y = -upperLen;
  pivot.add(joint);
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(lowerRadius, lowerLen, 4, 8), lowerMaterial);
  lower.position.y = -lowerLen / 2;
  joint.add(lower);
  let endMesh;
  if (end === "foot") {
    endMesh = new THREE.Mesh(new THREE.BoxGeometry(lowerRadius * 2.1, lowerRadius, lowerRadius * 3.4), endMaterial);
    endMesh.position.set(0, -lowerLen - lowerRadius * 0.4, lowerRadius * 0.9);
  } else {
    const r = lowerRadius;
    endMesh = new THREE.Group();
    endMesh.position.y = -lowerLen - r * 0.2;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(r * 2.2, r * 1.7, r * 1.0), endMaterial);
    palm.position.y = -r * 0.85;
    endMesh.add(palm);
    for (let i = 0; i < 4; i += 1) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(r * 0.44, r * 1.25, r * 0.55), endMaterial);
      finger.position.set((i - 1.5) * r * 0.54, -r * 2.1, 0);
      finger.rotation.x = 0.14;
      endMesh.add(finger);
    }
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 1.0, r * 0.55), endMaterial);
    thumb.position.set(thumbSide * r * 1.3, -r * 0.95, r * 0.1);
    thumb.rotation.z = thumbSide * -0.55;
    endMesh.add(thumb);
  }
  joint.add(endMesh);
  return { pivot, upper, joint, lower, end: endMesh };
}

const HAIR_COLORS = [0x2b2119, 0x4a3120, 0x151515, 0x5e4630, 0x7a5636, 0x3a3a45];

function makePerson({ shirt = 0x2f6f4e, pants = 0x2a3550, skin = 0xf3cca6, hair = 0x2b2119, gender = "m", scale = 1 } = {}) {
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.72 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.78, emissive: 0x8a7355, emissiveIntensity: 0.5 });

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.76, 0.32), shirtMat);
  chest.position.y = 1.42;
  rig.add(chest);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.2, 12), skinMat);
  neck.position.y = 1.88;
  rig.add(neck);
  const waist = new THREE.Group();
  waist.position.y = 1.16;
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.27), shirtMat);
  belly.position.y = -0.05;
  waist.add(belly);
  const hip = new THREE.Mesh(
    gender === "f" ? new THREE.BoxGeometry(0.48, 0.22, 0.3) : new THREE.BoxGeometry(0.42, 0.2, 0.27),
    pantsMat,
  );
  hip.position.y = -0.26;
  waist.add(hip);
  const beltLine = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.06, 0.28), new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.6 }));
  beltLine.position.y = -0.15;
  waist.add(beltLine);
  rig.add(waist);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 18), skinMat);
  head.position.y = 2.12;
  rig.add(head);
  const earL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), skinMat);
  earL.scale.set(0.45, 1, 0.8);
  earL.position.set(-0.245, 2.11, 0);
  rig.add(earL);
  const earR = earL.clone();
  earR.position.x = 0.245;
  rig.add(earR);

  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.85 });
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.265, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.46), hairMat);
  hairCap.position.y = 2.13;
  hairCap.rotation.x = -0.22;
  rig.add(hairCap);
  const hairBack = new THREE.Mesh(
    new THREE.SphereGeometry(0.255, 16, 8, Math.PI, Math.PI, Math.PI * 0.35, Math.PI * (gender === "f" ? 0.38 : 0.22)),
    hairMat,
  );
  hairBack.position.y = 2.12;
  rig.add(hairBack);

  const faceDark = new THREE.MeshBasicMaterial({ color: 0x25201a });
  const faceWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), faceWhite);
  eyeL.position.set(-0.09, 2.18, 0.21);
  rig.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.09;
  rig.add(eyeR);
  const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), faceDark);
  pupilL.position.set(-0.09, 2.18, 0.25);
  rig.add(pupilL);
  const pupilR = pupilL.clone();
  pupilR.position.x = 0.09;
  rig.add(pupilR);
  const browL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), faceDark);
  browL.position.set(-0.09, 2.26, 0.22);
  browL.rotation.z = 0.16;
  rig.add(browL);
  const browR = browL.clone();
  browR.position.x = 0.09;
  browR.rotation.z = -0.16;
  rig.add(browR);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 14, Math.PI), faceDark);
  smile.position.set(0, 2.04, 0.21);
  smile.rotation.z = Math.PI;
  rig.add(smile);

  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.85 });
  const mkArm = (x) => {
    const arm = createLimb({
      upperMaterial: shirtMat, lowerMaterial: skinMat, endMaterial: skinMat,
      upperLen: 0.27, lowerLen: 0.26, upperRadius: 0.07, lowerRadius: 0.058,
      end: "hand", thumbSide: x < 0 ? 1 : -1,
    });
    arm.pivot.position.set(x, 1.72, 0);
    arm.joint.rotation.x = -0.18;
    rig.add(arm.pivot);
    return arm;
  };
  const leftArm = mkArm(-0.4);
  const rightArm = mkArm(0.4);
  const mkLeg = (x) => {
    const leg = createLimb({
      upperMaterial: pantsMat, lowerMaterial: pantsMat, endMaterial: shoeMat,
      upperLen: 0.40, lowerLen: 0.38, upperRadius: 0.09, lowerRadius: 0.072,
      end: "foot",
    });
    leg.pivot.position.set(x, 1.0, 0);
    leg.pivot.rotation.x = -0.05;
    leg.joint.rotation.x = 0.1;
    rig.add(leg.pivot);
    return leg;
  };
  const leftLeg = mkLeg(-0.15);
  const rightLeg = mkLeg(0.15);

  group.scale.setScalar(scale);
  return { group, rig, head, waist, leftArm, rightArm, leftLeg, rightLeg };
}

// ---------- 馬(equestrian3d 同款四足;coatMat/maneMat 共用材質可換色) ----------
export const HORSE_COATS = {
  brown: { label: "棗棕", coat: 0x8a5a33, mane: 0x3a2a1c },
  white: { label: "白馬", coat: 0xe8e4da, mane: 0xcfc8b8 },
  black: { label: "黑馬", coat: 0x2e2a28, mane: 0x14110f },
  chestnut: { label: "紅棕(栗色)", coat: 0xa04528, mane: 0x5a2415 },
  grey: { label: "銀灰", coat: 0x9aa0a8, mane: 0x5f6670 },
  palomino: { label: "金黃", coat: 0xd8a850, mane: 0xf0e6d0 },
  pinto: { label: "花斑(棕白)", coat: 0xb08050, mane: 0xefe9da },
};

function makeHorse({ coat = 0x8a5a33, mane = 0x3a2a1c } = {}) {
  const group = new THREE.Group();
  const coatMat = new THREE.MeshStandardMaterial({ color: coat, roughness: 0.7 });
  const maneMat = new THREE.MeshStandardMaterial({ color: mane, roughness: 0.85 });
  const sockMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.8 });
  const hoofMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.6 });

  const rig = new THREE.Group();
  group.add(rig);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 1.7), coatMat);
  body.position.set(0, 1.58, 0);
  rig.add(body);
  const chestCap = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.5, 0.4), coatMat);
  chestCap.position.set(0, 1.62, 0.95);
  rig.add(chestCap);
  const rump = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.5, 0.42), coatMat);
  rump.position.set(0, 1.6, -0.95);
  rig.add(rump);

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 1.82, 1.05);
  rig.add(neckPivot);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.72, 0.34), coatMat);
  neck.rotation.x = 0.7;
  neck.position.set(0, 0.26, 0.2);
  neckPivot.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.62, 0.5);
  neckPivot.add(head);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.52), coatMat);
  skull.rotation.x = 0.35;
  head.add(skull);
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.3), maneMat);
  muzzle.position.set(0, -0.12, 0.34);
  muzzle.rotation.x = 0.35;
  head.add(muzzle);
  const faceWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const faceDarkMat = new THREE.MeshBasicMaterial({ color: 0x1c1712 });
  for (const side of [-1, 1]) {
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), faceWhiteMat);
    eyeWhite.position.set(side * 0.14, 0.06, 0.14);
    head.add(eyeWhite);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), faceDarkMat);
    pupil.position.set(side * 0.165, 0.06, 0.15);
    head.add(pupil);
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), coatMat);
    ear.position.set(side * 0.09, 0.24, -0.05);
    ear.rotation.x = -0.2;
    head.add(ear);
  }
  // 鬃毛(07-15 使用者點名要明顯):頸背鬃冠+垂右側鬃髮+額前瀏海,三件套
  const maneCrest = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.88, 0.24), maneMat);
  maneCrest.rotation.x = 0.7;
  maneCrest.position.set(0, 0.36, -0.04); // 沿頸背露出來,不再埋進脖子
  neckPivot.add(maneCrest);
  const maneSide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.74, 0.34), maneMat);
  maneSide.rotation.x = 0.7;
  maneSide.position.set(0.17, 0.24, 0.08); // 垂在頸右側(真馬鬃髮倒一邊)
  neckPivot.add(maneSide);
  const forelock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.12), maneMat);
  forelock.position.set(0, 0.24, 0.08);
  head.add(forelock);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.66, 0.14), maneMat);
  tail.position.set(0, 1.45, -1.22);
  tail.rotation.x = 0.55;
  rig.add(tail);

  const mkLeg = (x, z, sock) => {
    const leg = createLimb({
      upperMaterial: coatMat,
      lowerMaterial: sock ? sockMat : coatMat,
      endMaterial: hoofMat,
      upperLen: 0.62, lowerLen: 0.6, upperRadius: 0.085, lowerRadius: 0.062, // 長腿 v3(07-15 再點名) // 長腿 v2(07-15 點名:馬腿再長)
      end: "foot",
    });
    leg.pivot.position.set(x, 1.35, z);
    rig.add(leg.pivot);
    return leg;
  };
  const legs = [
    mkLeg(-0.22, 0.72, true),
    mkLeg(0.22, 0.72, true),
    mkLeg(-0.22, -0.78, false),
    mkLeg(0.22, -0.78, false),
  ];

  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.62), new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.5 }));
  saddle.position.set(0, 1.95, 0.12);
  rig.add(saddle);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.06, 0.78), new THREE.MeshStandardMaterial({ color: 0x2f5f8a, roughness: 0.85 }));
  pad.position.set(0, 1.9, 0.12);
  rig.add(pad);

  return { group, rig, body, neckPivot, head, tail, legs, saddle, coatMat, maneMat };
}

// ---------- 弓+箭(archery3d 同款,縮小掛在騎手手上) ----------
function makeBow() {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.5, metalness: 0.1 });
  const limb = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.024, 8, 20, Math.PI * 1.1), woodMat);
  limb.rotation.z = Math.PI / 2 - 0.15;
  group.add(limb);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 10), woodMat);
  group.add(grip);
  const stringMat = new THREE.LineBasicMaterial({ color: 0xf4f0e4 });
  const stringGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.32, 0),
    new THREE.Vector3(0, 0, 0.02),
    new THREE.Vector3(0, -0.32, 0),
  ]);
  const string = new THREE.Line(stringGeo, stringMat);
  group.add(string);
  return { group, string, stringGeo };
}

function makeArrow(scale = 1) {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.85, 8),
    new THREE.MeshStandardMaterial({ color: 0xe8ddc4, roughness: 0.6 }),
  );
  shaft.rotation.x = Math.PI / 2;
  group.add(shaft);
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.02, 0.08, 8),
    new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.5, roughness: 0.4 }),
  );
  tip.rotation.x = Math.PI / 2;
  tip.position.z = 0.46;
  group.add(tip);
  const fletchMat = new THREE.MeshStandardMaterial({ color: 0xd8433c, roughness: 0.7, side: THREE.DoubleSide });
  for (let i = 0; i < 3; i += 1) {
    const holder = new THREE.Group();
    holder.rotation.z = (i / 3) * Math.PI * 2;
    const fletch = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.06), fletchMat);
    fletch.position.set(0, 0.045, -0.36);
    holder.add(fletch);
    group.add(holder);
  }
  group.scale.setScalar(scale);
  return group;
}

export class HorseArcheryGame {
  constructor({ canvas, touchRoot }) {
    this.canvas = canvas;
    this.touchRoot = touchRoot;

    const settings = loadSettings();
    this.difficulty = DIFFICULTY_PRESETS[settings.difficulty] ? settings.difficulty : "normal";
    this.modeId = GAME_MODES[settings.modeId] ? settings.modeId : "standard";
    this.mode = getModeConfig(this.modeId);
    this.coatId = HORSE_COATS[settings.horseCoat] ? settings.horseCoat : "brown";

    this.input = new InputManager();
    this.input.bindTouchButtons(this.touchRoot);

    this.onHudUpdate = null;
    this.onEvent = null;

    this.running = false; // ★只給主迴圈 RAF 用(athletics 撞名事故鐵則)
    this.time = 0;
    this.phase = "menu"; // menu | gate | riding | ended(拉弓是 riding 的子狀態 drawing 旗標)
    this.message = "在首頁選擇模式與難度後開始。";
    this.cameraView = 0; // 0 跟隨 1 側面轉播 2 高空 3 馬上視角
    this.autoSaveTimer = 0;

    // 賽況
    this.dist = 0;
    this.speed = 0;
    this.elapsed = 0;
    this.totalScore = 0;
    this.goldCount = 0; // 9 環以上
    this.targetIdx = 0;
    this.lastRing = null;
    this.gallopT = 0;
    this.finishDist = 0;
    this.lap = 1;

    // 射擊狀態(archery 移植)
    this.drawing = false;
    this.drawT = 0;
    this.holdAtFull = 0;
    this.power = 0;
    this.swayT = Math.random() * 10;
    this.pointerNDC = null;
    this.aimLocal = new THREE.Vector2(0, 0); // 瞄準點(靶面局部座標)
    this.arrowFlight = null; // {mesh, from, to, t, dur, target, ring}

    this.overlay = { visible: false, eyebrow: "", title: "", text: "", canResume: false };

    // ---- three ----
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fc4e8);
    this.scene.fog = new THREE.Fog(0x9fd0ee, 60, 160);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 240);
    this.camPos = new THREE.Vector3(0, 6, -14);
    this.camLook = new THREE.Vector3(0, 1.2, 0);
    this.camera.position.copy(this.camPos);

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();

    this.buildCourse();
    this.setupScene();
    this.setupInput();

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.pushHud();
  }

  emitEvent(type, payload = {}) {
    if (this.onEvent) this.onEvent({ type, ...payload });
  }

  // ---------- 賽道(閉環樣條,equestrian 同款) ----------
  buildCourse() {
    const pts = [];
    const RX = 30, RZ = 21;
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      const w = i % 2 === 0 ? 1.0 : 1.14;
      pts.push(new THREE.Vector3(Math.cos(a) * RX * w, 0, Math.sin(a) * RZ * w));
    }
    this.curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);
    this.courseLen = this.curve.getLength();
  }

  posAt(dist) {
    const u = (((dist % this.courseLen) + this.courseLen) % this.courseLen) / this.courseLen;
    return this.curve.getPointAt(u);
  }

  tangentAt(dist) {
    const u = (((dist % this.courseLen) + this.courseLen) % this.courseLen) / this.courseLen;
    return this.curve.getTangentAt(u);
  }

  // ---------- 道旁環靶 ----------
  rebuildTargets() {
    if (this.targetGroupAll) this.scene.remove(this.targetGroupAll);
    this.targetGroupAll = new THREE.Group();
    this.targets = [];
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const n = preset.targets;
    for (let i = 0; i < n; i += 1) {
      const d = this.courseLen * ((i + 1) / (n + 1));
      const p = this.posAt(d);
      const t = this.tangentAt(d);
      const side = i % 2 === 0 ? 1 : -1; // 左右交替(右射/左射都練)
      const normal = new THREE.Vector3(t.z * side, 0, -t.x * side); // 路徑法向(指離路)
      const pos = p.clone().addScaledVector(normal, TARGET_SIDE);
      const g = new THREE.Group();
      g.position.set(pos.x, TARGET_H, pos.z);
      // 靶面朝「射手經過前一段」的方向:面向路徑上游 8m 處
      const facing = this.posAt(d - 8);
      g.lookAt(facing.x, TARGET_H, facing.z);
      // 背板+五色環(archery 同款,判定=畫面)
      const backing = new THREE.Mesh(
        new THREE.BoxGeometry(TARGET_R * 2.3, TARGET_R * 2.3, 0.07),
        new THREE.MeshStandardMaterial({ color: 0xe9e2cf, roughness: 0.9 }),
      );
      backing.position.z = -0.05;
      g.add(backing);
      for (let r = 0; r < 5; r += 1) {
        const outer = TARGET_R * (1 - r * 0.2);
        const inner = TARGET_R * (1 - (r + 1) * 0.2);
        const geo = r === 4 ? new THREE.CircleGeometry(outer, 40) : new THREE.RingGeometry(Math.max(inner, 0.001), outer, 44);
        const ring = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({ color: RING_COLORS[r], roughness: 0.75, side: THREE.DoubleSide }),
        );
        ring.position.z = 0.001 + r * 0.001; // lookAt 後局部 +z 朝射手
        g.add(ring);
      }
      // 立柱
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, TARGET_H, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x6b4a2a }),
      );
      post.position.y = -TARGET_H / 2 - TARGET_R * 0.2;
      g.add(post);
      this.targetGroupAll.add(g);
      // 靶面平面(判定/瞄準用):法向=靶的世界 -z? lookAt 使局部 +z 朝 facing → 平面法向= g 的 +z 方向
      const planeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, g.position);
      this.targets.push({ dist: d, group: g, plane, center: g.position.clone(), quaternion: g.quaternion.clone(), shot: false, ring: null, planted: [] });
    }
    this.scene.add(this.targetGroupAll);
  }

  // ---------- 場景 ----------
  setupScene() {
    const sun = new THREE.HemisphereLight(0xffffff, 0x557040, 1.3);
    this.scene.add(sun);
    const key = new THREE.DirectionalLight(0xfff2d4, 1.9);
    key.position.set(30, 50, -20);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ccbff, 0.6);
    rim.position.set(-25, 30, 25);
    this.scene.add(rim);

    const grass = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), new THREE.MeshStandardMaterial({ color: 0x5c8a48, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.02;
    this.scene.add(grass);
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(96, 72), new THREE.MeshStandardMaterial({ color: 0xd2bd93, roughness: 1 }));
    sand.rotation.x = -Math.PI / 2;
    this.scene.add(sand);

    const railMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.7 });
    const mkRail = (w, x, z, rot = 0) => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.1), railMat);
      r.position.set(x, 1.0, z);
      r.rotation.y = rot;
      this.scene.add(r);
      const r2 = r.clone();
      r2.position.y = 0.55;
      this.scene.add(r2);
    };
    mkRail(96, 0, 36);
    mkRail(96, 0, -36);
    mkRail(72, 48, 0, Math.PI / 2);
    mkRail(72, -48, 0, Math.PI / 2);

    // 賽道白沙帶(YXZ 轉向鐵則:先 yaw 再倒平)
    const laneMat = new THREE.MeshBasicMaterial({ color: 0xe8dcbc });
    for (let i = 0; i < 120; i += 1) {
      const d = (i / 120) * this.courseLen;
      const p = this.posAt(d);
      const t = this.tangentAt(d);
      const dot = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), laneMat);
      dot.rotation.order = "YXZ";
      dot.rotation.y = Math.atan2(t.x, t.z);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(p.x, 0.012, p.z);
      this.scene.add(dot);
    }

    // 馬+騎手(草原獵裝:綠衣皮帽)
    const coat = HORSE_COATS[this.coatId] || HORSE_COATS.brown;
    this.horse = makeHorse({ coat: coat.coat, mane: coat.mane });
    this.scene.add(this.horse.group);
    this.rider = makePerson({ shirt: 0x3f7a4f, pants: 0x5a4630, hair: 0x2b2119, scale: 0.95 });
    this.rider.leftLeg.pivot.rotation.x = -1.25;
    this.rider.leftLeg.pivot.rotation.z = 0.5;
    this.rider.leftLeg.joint.rotation.x = 1.5;
    this.rider.rightLeg.pivot.rotation.x = -1.25;
    this.rider.rightLeg.pivot.rotation.z = -0.5;
    this.rider.rightLeg.joint.rotation.x = 1.5;
    // 弓手臂:左手持弓前伸(朝靶側動態轉),右手拉弦
    this.rider.leftArm.pivot.rotation.x = -1.2;
    this.rider.leftArm.joint.rotation.x = -0.1;
    this.rider.rightArm.pivot.rotation.x = -1.05;
    this.rider.rightArm.joint.rotation.x = -0.7;
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.6 });
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hatMat);
    hat.position.y = 2.16;
    this.rider.rig.add(hat);
    this.rider.group.position.set(0, 1.02, 0.12);
    this.rider.group.scale.setScalar(0.95);
    this.horse.rig.add(this.rider.group);

    // 弓掛在左手前方(隨騎手動)
    this.bow = makeBow();
    this.bow.group.position.set(-0.42, 1.55, 0.35);
    this.bow.group.rotation.y = Math.PI / 2; // 弓面朝側
    this.rider.rig.add(this.bow.group);
    this.nockedArrow = makeArrow(0.9);
    this.nockedArrow.visible = false;
    this.scene.add(this.nockedArrow);

    // 準星(archery 同款黃圈)
    const retMat = new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    this.reticle = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.065, 24), retMat);
    this.reticle.add(ring);
    for (let i = 0; i < 4; i += 1) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.05), retMat);
      tick.position.set(Math.cos((i * Math.PI) / 2) * 0.1, Math.sin((i * Math.PI) / 2) * 0.1, 0);
      tick.rotation.z = (i * Math.PI) / 2;
      this.reticle.add(tick);
    }
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    // 最新一箭標記
    this.latestMarker = new THREE.Mesh(
      new THREE.TorusGeometry(0.08, 0.013, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.95 }),
    );
    this.latestMarker.visible = false;
    this.scene.add(this.latestMarker);

    this.buildCrowd();
    this.rebuildTargets();

    const standMat = new THREE.MeshStandardMaterial({ color: 0x6b7687, roughness: 0.85 });
    for (const side of [-1, 1]) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(60, 3.2, 5), standMat);
      stand.position.set(0, 1.6, side * 41.5);
      this.scene.add(stand);
    }
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 1 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 });
    for (const [x, z] of [[-62, 20], [-58, -18], [60, 24], [64, -10], [-30, 55], [25, 58], [0, -60], [40, -55]]) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 3, 8), trunkMat);
      trunk.position.set(x, 1.5, z);
      this.scene.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 10), treeMat);
      crown.position.set(x, 4.6, z);
      this.scene.add(crown);
    }

    this.placeHorse();
  }

  buildCrowd() {
    this.crowd = new THREE.Group();
    const shirts = [0xd98a3d, 0x3d78d9, 0xc94f8f, 0x4fae6a, 0xb0552f, 0x8a5ac0];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i += 1) {
        const p = makePerson({
          shirt: shirts[(i + (side > 0 ? 3 : 0)) % shirts.length],
          pants: 0x2c3340,
          hair: HAIR_COLORS[(i * 2 + (side > 0 ? 1 : 0)) % HAIR_COLORS.length],
          gender: (i + (side > 0 ? 1 : 0)) % 2 === 0 ? "m" : "f",
          scale: 0.92,
        });
        p.group.position.set(-27 + i * 9, 0, side * 38.2);
        p.group.rotation.y = side > 0 ? Math.PI : 0;
        this.crowd.add(p.group);
      }
    }
    this.scene.add(this.crowd);
  }

  placeHorse() {
    const p = this.posAt(this.dist);
    const t = this.tangentAt(this.dist);
    this.horse.group.position.set(p.x, 0, p.z);
    this.horse.group.rotation.y = Math.atan2(t.x, t.z);
  }

  setHorseCoat(coatId) {
    if (!HORSE_COATS[coatId]) return;
    this.coatId = coatId;
    if (this.horse) {
      this.horse.coatMat.color.setHex(HORSE_COATS[coatId].coat);
      this.horse.maneMat.color.setHex(HORSE_COATS[coatId].mane);
    }
  }

  // ---------- 輸入(按住=拉弓、移動=瞄準、放開=放箭) ----------
  setupInput() {
    const setNDC = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointerNDC = {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
      };
    };
    this.canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      setNDC(event);
      this.beginDraw();
    });
    this.canvas.addEventListener("pointermove", (event) => setNDC(event));
    this.canvas.addEventListener("pointerup", (event) => {
      setNDC(event);
      this.releaseDraw();
    });
    this.canvas.addEventListener("pointerleave", () => {
      if (this.drawing) this.releaseDraw();
    });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  // ---------- 局面控制 ----------
  applyPresentation({ difficulty, modeId, horseCoat }) {
    if (difficulty && DIFFICULTY_PRESETS[difficulty]) this.difficulty = difficulty;
    if (modeId && GAME_MODES[modeId]) {
      this.modeId = modeId;
      this.mode = getModeConfig(modeId);
    }
    if (horseCoat && HORSE_COATS[horseCoat]) this.setHorseCoat(horseCoat);
    saveSettings({ difficulty: this.difficulty, modeId: this.modeId, horseCoat: this.coatId });
    this.message = `${this.mode.label} · ${DIFFICULTY_LABELS[this.difficulty]} · ${HORSE_COATS[this.coatId].label} 已設定。`;
    this.pushHud();
  }

  openHomeMenu() {
    this.phase = "menu";
    this.drawing = false;
    this.message = "在首頁選擇模式與難度後開始。";
    this.overlay.visible = false;
    this.pushHud();
  }

  startSelectedMatch() {
    this.dist = 0;
    this.speed = 0;
    this.elapsed = 0;
    this.totalScore = 0;
    this.goldCount = 0;
    this.targetIdx = 0;
    this.lastRing = null;
    this.arrowFlight = null;
    this.drawing = false;
    this.lap = 1;
    this.rebuildTargets();
    this.finishDist = this.targets.length ? this.targets[this.targets.length - 1].dist + 22 : this.courseLen;
    this.placeHorse();
    const t0 = this.tangentAt(0);
    const p0 = this.posAt(0);
    this.camPos.set(p0.x - t0.x * 9, 4.6, p0.z - t0.z * 9);
    this.camLook.set(p0.x, 1.4, p0.z);
    this.phase = "gate";
    this.message = "點畫面出發!靶在道旁——按住拉弓、移動瞄準、放開放箭!";
    this.emitEvent("match-start", { mode: this.mode.label });
    this.pushHud();
  }

  _watchActiveTarget() {
    const t = this.activeTarget();
    if (t !== this._lastActive) {
      this._lastActive = t;
      if (t) this.aimLocal.set(0, 0); // 新靶=準星歸中:不動滑鼠也瞄在紅心附近,滑鼠只做微調
    }
  }

  activeTarget() {
    const t = this.targets && this.targets[this.targetIdx];
    if (!t || t.shot) return null;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const dtf = t.dist - this.dist;
    if (dtf <= preset.windowM && dtf >= -2.5) return t;
    return null;
  }

  beginDraw() {
    if (this.overlay.visible) return;
    if (this.phase === "gate") {
      this.phase = "riding";
      this.speed = DIFFICULTY_PRESETS[this.difficulty].baseSpeed * 0.6;
      this.message = "出發!按住 W/↑ 加速——靶快到時按住畫面拉弓!";
      this.emitEvent("gate", {});
      this.pushHud();
      return;
    }
    if (this.phase !== "riding" || this.drawing) return;
    this.drawing = true;
    this.drawT = 0;
    this.holdAtFull = 0;
    this.power = 0;
    this.emitEvent("draw-start");
    if (!this.activeTarget()) this.message = "拉弓中……等靶進射擊窗再放箭!";
    this.pushHud();
  }

  releaseDraw() {
    if (!this.drawing) return;
    this.drawing = false;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    this.power = clamp(this.drawT / preset.drawDuration, 0, 1);
    const target = this.activeTarget();
    if (!target) {
      // 沒靶就放箭=射空(溫柔:不扣分不消耗,提醒節奏)
      this.message = "這箭射空了——等靶進射擊窗(時機條亮起)再放!";
      this.emitEvent("shoot-empty");
      this.pushHud();
      return;
    }
    if (this.power < 0.22) {
      this.message = "拉力不足——按住久一點再放。";
      this.pushHud();
      return;
    }
    this.fireAt(target);
  }

  // ★判定=畫面:先算命中點(瞄準+晃動+速度漂移),再演箭
  fireAt(target) {
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const powerFactor = 0.6 + this.power * 0.9;
    const sway = this.currentSway();
    // 速度漂移:跑越快箭越往行進方向拖(可預瞄補償)
    const drift = (this.speed / 10) * preset.speedSway * TARGET_R * 0.5;
    let ix = this.aimLocal.x + sway.x + drift / powerFactor;
    let iy = this.aimLocal.y + sway.y;
    if (this.power < 0.6) iy -= (0.6 - this.power) * TARGET_R * 0.5; // 拉不滿下墜
    if (preset.aimAssist > 0) {
      ix += (0 - ix) * preset.aimAssist * 0.35;
      iy += (0 - iy) * preset.aimAssist * 0.35;
    }
    const r = Math.hypot(ix, iy);
    let ring = 0;
    if (r <= TARGET_R) ring = Math.max(1, 10 - Math.floor(r / (TARGET_R / 10)));
    // 命中點世界座標(靶面局部 → 世界)
    const impact = new THREE.Vector3(ix, iy, 0.02).applyQuaternion(target.quaternion).add(target.center);
    const from = this.horse.group.position.clone().add(new THREE.Vector3(0, 2.5, 0));
    const arrow = makeArrow(0.9);
    arrow.position.copy(from);
    this.scene.add(arrow);
    this.arrowFlight = {
      mesh: arrow,
      from,
      to: impact,
      t: 0,
      dur: Math.max(0.12, from.distanceTo(impact) / 40),
      target,
      ring,
    };
    target.shot = true; // 一靶一箭(放箭當下鎖定)
    this.emitEvent("release", { power: this.power });
    this.pushHud();
  }

  currentSway() {
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const speedAmp = 1 + (this.speed / (preset.baseSpeed + preset.boost)) * preset.speedSway;
    const amp = TARGET_R * preset.swayBase * (1 + this.holdAtFull * preset.swayGrow) * speedAmp;
    return new THREE.Vector2(
      Math.sin(this.swayT * 2.3) * amp,
      Math.sin(this.swayT * 3.4 + 1.3) * amp * 0.82,
    );
  }

  resolveArrow() {
    const f = this.arrowFlight;
    this.arrowFlight = null;
    const { target, ring } = f;
    target.ring = ring;
    // 插箭(留在靶上)
    if (ring > 0) {
      f.mesh.position.copy(f.to);
      target.planted.push(f.mesh);
      this.latestMarker.position.copy(f.to);
      this.latestMarker.visible = true;
    } else {
      this.scene.remove(f.mesh);
      this.latestMarker.visible = false;
    }
    this.lastRing = ring;
    this.totalScore += ring;
    if (ring >= 9) this.goldCount += 1;
    this.emitEvent("impact", { ring, isBull: ring >= 10, isGold: ring >= 9, miss: ring === 0, totalScore: this.totalScore, idx: this.targetIdx + 1 });
    this.advanceTarget();
  }

  advanceTarget() {
    this.targetIdx += 1;
    // 練習場:一圈射完重置再來
    if (this.mode.endless && this.targetIdx >= this.targets.length) {
      this.targetIdx = 0;
      this.lap += 1;
      for (const t of this.targets) {
        t.shot = false;
        t.ring = null;
        for (const a of t.planted) this.scene.remove(a);
        t.planted = [];
        t.dist += this.courseLen;
      }
      this.finishDist += this.courseLen;
    }
    this.pushHud();
  }

  finishCourse() {
    this.phase = "ended";
    this.drawing = false;
    const n = this.targets.length;
    const possible = n * 10;
    const timeText = `${this.elapsed.toFixed(1)} 秒`;
    let scoreText;
    let finalScore = this.totalScore;
    if (this.mode.challenge) {
      const speedBonus = Math.max(0, Math.round((this.courseLen / Math.max(this.elapsed, 1) - 6) * 6));
      finalScore = this.totalScore + speedBonus;
      scoreText = `環數 ${this.totalScore} + 速度獎勵 ${speedBonus} = ${finalScore} 分`;
    } else {
      scoreText = `總環數 ${this.totalScore} / ${possible}`;
    }
    const pct = this.totalScore / possible;
    const grade = pct >= 0.9 ? "A+" : pct >= 0.75 ? "A" : pct >= 0.58 ? "B" : pct >= 0.4 ? "C" : "D";
    this.overlay = {
      visible: true,
      eyebrow: "完賽",
      title: `評等 ${grade}`,
      text: `${scoreText},用時 ${timeText},金心 ${this.goldCount} 靶。${pct >= 0.9 ? "神射手!" : "再來一場,朝滿環前進!"}`,
      canResume: false,
    };
    this.emitEvent("finish", { total: finalScore, rings: this.totalScore, grade, gold: this.goldCount, elapsed: this.elapsed });
    this.message = `完賽——${scoreText}。`;
    this.saveGame(true);
    this.pushHud();
  }

  togglePause() {
    if (this.phase === "menu" || this.phase === "ended") return;
    if (this.overlay.visible) {
      this.resume();
    } else {
      this.overlay = { visible: true, eyebrow: "暫停中", title: "喘口氣", text: "拉弓的手也要休息,準備好再繼續。", canResume: true };
      this.pushHud();
    }
  }

  resume() {
    if (!this.overlay.canResume) return;
    this.overlay.visible = false;
    this.pushHud();
  }

  cycleCameraView() {
    this.cameraView = (this.cameraView + 1) % 4;
    const names = ["跟隨視角", "側面轉播", "高空俯瞰", "馬上視角"];
    this.message = `視角:${names[this.cameraView]}。`;
    this.pushHud();
  }

  // ---------- 主迴圈 ----------
  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const tick = () => {
      if (!this.running) return;
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.update(delta);
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height || 1.6;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  update(delta) {
    this.time += delta;
    this.swayT += delta;
    const paused = this.overlay.visible;

    if (!paused && this.phase === "riding") {
      this.elapsed += delta;
      const preset = DIFFICULTY_PRESETS[this.difficulty];
      const boosting = this.input.isDown("up") || this.input.isDown("sprint");
      const slowing = this.input.isDown("down");
      // 拉弓時馬自然收步(真實騎射:放箭窗口收韁)
      const drawSlow = this.drawing ? 2.4 : 0; // 拉弓收步更多(07-15 放軟)
      const target = preset.baseSpeed + (boosting ? preset.boost : 0) - (slowing ? 2.0 : 0) - drawSlow;
      this.speed += (Math.max(3, target) - this.speed) * Math.min(1, delta * 1.8);
      this.dist += this.speed * delta;
      this.gallopT += delta * (this.speed / 8);

      if (this.drawing) {
        this.drawT += delta;
        this.power = clamp(this.drawT / preset.drawDuration, 0, 1);
        if (this.power >= 1) this.holdAtFull += delta;
      }

      // 錯過靶(沒射就跑過)=0 環,溫柔提示
      const t = this.targets[this.targetIdx];
      if (t && !t.shot && t.dist - this.dist < -2.5) {
        t.shot = true;
        t.ring = 0;
        this.lastRing = 0;
        this.emitEvent("target-missed", { idx: this.targetIdx + 1 });
        this.message = "跑過頭了,這靶沒射到——下一靶早點拉弓!";
        this.advanceTarget();
      }

      if (!this.mode.endless && this.dist >= this.finishDist && this.phase !== "ended") {
        this.finishCourse();
      }
    }

    // 箭飛行
    if (this.arrowFlight) {
      const f = this.arrowFlight;
      f.t += delta / f.dur;
      const k = clamp(f.t, 0, 1);
      const pos = new THREE.Vector3().lerpVectors(f.from, f.to, k);
      pos.y += Math.sin(Math.PI * k) * 0.4;
      f.mesh.position.copy(pos);
      const ahead = new THREE.Vector3().lerpVectors(f.from, f.to, Math.min(1, k + 0.03));
      f.mesh.lookAt(ahead);
      if (f.t >= 1) this.resolveArrow();
    }

    // 最新一箭標記脈動
    if (this.latestMarker.visible) {
      this.latestMarker.scale.setScalar(1 + Math.sin(this.time * 5) * 0.18);
    }

    this.handleKeys();
    this._watchActiveTarget();
    this.updateAim();
    this.updateHorsePose();
    this.placeHorse();
    this.updateReticle();
    this.updateCamera(delta);

    this.autoSaveTimer += delta;
    if (this.autoSaveTimer > 5) {
      this.autoSaveTimer = 0;
      this.saveGame(true);
    }

    this.input.endFrame();
    this.pushHud();
  }

  handleKeys() {
    if (this.input.consumePress("camera")) this.cycleCameraView();
    if (this.input.consumePress("pause")) this.togglePause();
    if (this.overlay.visible) return;
    if (this.input.consumePress("shoot")) this.beginDraw();
    if (this.input.consumeRelease("shoot")) this.releaseDraw();
  }

  // 滑鼠/觸控射線 → 靶面平面 → 靶面局部座標(clamp 1.7R)
  updateAim() {
    const target = this.activeTarget();
    if (!target || !this.pointerNDC || this.phase !== "riding") return;
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(target.plane, hit)) {
      const local = hit.sub(target.center).applyQuaternion(target.quaternion.clone().invert());
      this.aimLocal.set(
        clamp(local.x, -TARGET_R * 1.7, TARGET_R * 1.7),
        clamp(local.y, -TARGET_R * 1.7, TARGET_R * 1.7),
      );
    }
  }

  updateReticle() {
    const target = this.activeTarget();
    const show = !!target && this.phase === "riding";
    this.reticle.visible = show;
    if (!show) return;
    const sway = this.currentSway();
    const world = new THREE.Vector3(this.aimLocal.x + sway.x, this.aimLocal.y + sway.y, 0.06)
      .applyQuaternion(target.quaternion)
      .add(target.center);
    this.reticle.position.copy(world);
    this.reticle.quaternion.copy(target.quaternion);
    const d = this.horse.group.position.distanceTo(target.center);
    this.reticle.scale.setScalar(Math.max(1, d / 7));
  }

  updateHorsePose() {
    const h = this.horse;
    if (!h) return;
    const sp = this.phase === "riding" ? this.speed : 0;
    const amp = clamp(sp / 14, 0, 0.62);
    const t = this.gallopT * Math.PI * 2;
    const phases = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
    h.legs.forEach((leg, i) => {
      leg.pivot.rotation.x = Math.sin(t + phases[i]) * amp;
      leg.joint.rotation.x = Math.max(0, Math.sin(t + phases[i] + 0.8)) * amp * 1.3;
    });
    h.rig.rotation.x = 0;
    h.rig.position.y = Math.abs(Math.sin(t)) * amp * 0.14;
    h.neckPivot.rotation.x = Math.sin(t) * amp * 0.12;
    h.tail.rotation.x = 0.55 + Math.sin(t * 0.9) * 0.15;

    // 騎手:拉弓時上身轉向靶側、左臂指靶、右臂後拉(判定不看姿勢,姿勢跟著判定演)
    const target = this.activeTarget();
    if (this.rider) {
      if (target && this.phase === "riding") {
        // 靶在馬的哪一側?用局部座標 x 判斷
        const local = target.center.clone().sub(this.horse.group.position);
        const yaw = this.horse.group.rotation.y;
        const lx = local.x * Math.cos(-yaw) - local.z * Math.sin(-yaw);
        const side = lx >= 0 ? 1 : -1;
        this.rider.rig.rotation.y = side * (this.drawing ? 1.15 : 0.6); // 轉腰朝靶
        this.rider.leftArm.pivot.rotation.x = -1.5;
        this.rider.leftArm.joint.rotation.x = -0.05;
        this.rider.rightArm.pivot.rotation.x = -1.35;
        this.rider.rightArm.joint.rotation.x = -0.6 - this.power * 1.6; // 拉滿=手拉回臉頰
        this.rider.rig.rotation.x = 0.05;
      } else {
        this.rider.rig.rotation.y += (0 - this.rider.rig.rotation.y) * 0.15;
        this.rider.rig.rotation.x = amp * 0.18;
        this.rider.leftArm.pivot.rotation.x = -1.2;
        this.rider.rightArm.pivot.rotation.x = -1.05;
        this.rider.rightArm.joint.rotation.x = -0.7;
      }
    }
    // 弓弦隨拉弓後移
    const pts = this.bow.stringGeo.attributes.position;
    pts.setXYZ(1, 0, 0, 0.02 + this.power * 0.22);
    pts.needsUpdate = true;
  }

  updateCamera(delta) {
    const p = this.posAt(this.dist);
    const t = this.tangentAt(this.dist);
    let desiredPos;
    let desiredLook;
    const target = this.activeTarget();
    if (this.phase === "menu") {
      const a = this.time * 0.08;
      desiredPos = new THREE.Vector3(Math.cos(a) * 40, 12, Math.sin(a) * 40);
      desiredLook = new THREE.Vector3(0, 1, 0);
    } else if (this.cameraView === 0) {
      desiredPos = new THREE.Vector3(p.x - t.x * 8.6, 4.4, p.z - t.z * 8.6);
      if (target && this.phase === "riding") {
        // 射擊窗:看點往靶方向帶(瞄得到又看得到馬)
        desiredLook = new THREE.Vector3().addVectors(
          new THREE.Vector3(p.x + t.x * 4, 1.4, p.z + t.z * 4).multiplyScalar(0.35),
          target.center.clone().multiplyScalar(0.65),
        );
      } else {
        desiredLook = new THREE.Vector3(p.x + t.x * 7, 1.3, p.z + t.z * 7);
      }
    } else if (this.cameraView === 1) {
      const side = new THREE.Vector3(t.z, 0, -t.x);
      desiredPos = new THREE.Vector3(p.x + side.x * 13, 3.6, p.z + side.z * 13);
      desiredLook = new THREE.Vector3(p.x, 1.2, p.z);
    } else if (this.cameraView === 2) {
      desiredPos = new THREE.Vector3(p.x + 3, 26, p.z + 3);
      desiredLook = new THREE.Vector3(p.x + t.x * 6, 0.5, p.z + t.z * 6);
    } else {
      desiredPos = new THREE.Vector3(p.x - t.x * 0.6, 2.6, p.z - t.z * 0.6);
      desiredLook = target && this.phase === "riding"
        ? target.center.clone()
        : new THREE.Vector3(p.x + t.x * 12, 1.2, p.z + t.z * 12);
    }
    const k = 1 - Math.exp(-delta * 3.2);
    this.camPos.lerp(desiredPos, k);
    this.camLook.lerp(desiredLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  // ---------- HUD ----------
  pushHud() {
    if (!this.onHudUpdate) return;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const t = this.targets && this.targets[this.targetIdx];
    const dtf = t ? t.dist - this.dist : null;
    const active = this.activeTarget();
    // 射擊窗條:靶進 windowM 內開始充,到靶側身(0m)=滿
    let window01 = 0;
    if (this.phase === "riding" && t && dtf !== null && dtf <= preset.windowM && dtf > -2.5) {
      window01 = clamp(1 - dtf / preset.windowM, 0, 1);
    }
    const phaseLabels = { menu: "主選單", gate: "出發線", riding: this.drawing ? "拉弓" : "騎行", ended: "完賽" };
    const mins = Math.floor(this.elapsed / 60);
    const secs = (this.elapsed % 60).toFixed(1).padStart(4, "0");
    this.onHudUpdate({
      totalScore: this.totalScore,
      goldCount: this.goldCount,
      targetIdx: this.targets && this.targets.length ? Math.min(this.targetIdx + 1, this.targets.length) : 1,
      targetCount: this.targets ? this.targets.length : 0,
      lap: this.lap,
      endless: !!this.mode.endless,
      timeText: `${mins}:${secs}`,
      modeLabel: this.mode.label,
      difficultyLabel: DIFFICULTY_LABELS[this.difficulty],
      phaseLabel: phaseLabels[this.phase] || "",
      message: this.message,
      speed01: clamp(this.speed / (preset.baseSpeed + preset.boost), 0, 1),
      speedText: `${(this.speed * 3.6).toFixed(0)} km/h`,
      drawPower: this.power,
      drawing: this.drawing,
      window01,
      windowActive: !!active,
      nextTargetText: dtf === null ? "—" : dtf > 90 ? "衝線!" : `${Math.max(0, dtf).toFixed(0)} m`,
      lastRing: this.lastRing,
      overlay: { ...this.overlay },
    });
  }

  // ---------- 存讀檔(最佳成績) ----------
  saveGame(silent = false) {
    const prev = loadSavedGame() || {};
    const snapshot = { difficulty: this.difficulty, modeId: this.modeId, horseCoat: this.coatId, bestScore: prev.bestScore, bestTime: prev.bestTime };
    if (this.phase === "ended" && !this.mode.endless) {
      const better = prev.bestScore === undefined || this.totalScore > prev.bestScore ||
        (this.totalScore === prev.bestScore && this.elapsed < (prev.bestTime ?? Infinity));
      if (better) {
        snapshot.bestScore = this.totalScore;
        snapshot.bestTime = this.elapsed;
      }
    }
    saveGameState(snapshot);
    if (!silent) {
      this.message = "已存檔。";
      this.pushHud();
    }
  }

  loadGame() {
    const snap = loadSavedGame();
    if (!snap) return false;
    if (DIFFICULTY_PRESETS[snap.difficulty]) this.difficulty = snap.difficulty;
    if (GAME_MODES[snap.modeId]) {
      this.modeId = snap.modeId;
      this.mode = getModeConfig(snap.modeId);
    }
    if (HORSE_COATS[snap.horseCoat]) this.setHorseCoat(snap.horseCoat);
    this.openHomeMenu();
    this.message = snap.bestScore !== undefined
      ? `最佳成績:${snap.bestScore} 環、${(snap.bestTime || 0).toFixed(1)} 秒——挑戰它!`
      : "尚無最佳成績,先跑一場吧!";
    this.pushHud();
    return true;
  }
}
