# CLAUDE.md — horsearchery3d(3D 騎射=騎乘×射箭雙引擎混搭首例)

> 2026-07-15。GitHub 唯一真相;帳號 summer09201017-cloud。base=equestrian3d fork+archery 射擊模組。

## 混搭要點(之後的引擎混搭照這裡)

- 騎乘核心原封不動:buildCourse/posAt/tangentAt、makeHorse(長腿 v2+鬃毛三件套)、控速、HORSE_COATS。
- 射擊模組移植:currentSway(速度加成 speedSway)、beginDraw/releaseDraw、fireAt(判定=畫面:
  瞄準+晃動+速度漂移 → 靶面局部座標算環)、reticle(active target 的平面上 raycast)。
- activeTarget():下一個未射且 dist 差在 [-2.5, windowM] 的靶;跑過=0 環自動結案。
- 相機:射擊窗時 camLook 混 65% 靶心(看得到馬也瞄得到靶)。
- 拉弓時馬自動收步(drawSlow=1.6),放開恢復——真騎射的收韁感。

## 地雷

- `this.running` 只給 RAF;vite preview 不接管線;地面貼片 rotation.order="YXZ"。
- headless 驗證:pointerNDC 為 null 時 aimLocal 不會被覆蓋,直接 set(0,0) 瞄紅心。

## 部署

Netlify 手動站 hfpc-horsearchery3d;奧運頁=示範賽區卡片;portfolio/gamefleet 同步。
