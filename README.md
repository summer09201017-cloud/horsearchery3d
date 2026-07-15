# 3D 騎射(horsearchery3d)

> HFPC 3D 系列第一個「雙引擎混搭」:騎乘引擎(equestrian3d)× 射箭引擎(archery3d)。
> 策馬沿賽道自動尋路+控速節奏;道旁環靶+拉弓/晃動/放箭(2026-07-15)。

## 玩法

- **標準賽**:繞場一圈射完所有道旁靶(標準 8 靶,每靶滿分 10 環)。
- **速射挑戰**:環數+速度獎勵——跑越快加越多,敢快又射得準才會贏。
- **練習場**:無限圈數自由練。

靶進「射擊窗」(側欄時機條亮起)→ **按住=拉弓、移動滑鼠=瞄準、放開=放箭**。
馬跑越快準星飄越大(speedSway),拉弓時馬自動收步;錯過靶=0 環溫柔提示,永不淘汰。
判定=畫面:放箭當下算命中點(瞄準+晃動+速度漂移),再演箭。七色馬沿用騎乘引擎。

## 開發

```bash
npm install && npm run dev
npm run build && node scripts/gen-voice.mjs
node scripts/verify-horsearchery.mjs <url> <outDir>  # 自動騎射手/全錯過/速射三線驗證
```

## 部署

`npx netlify deploy --prod --dir dist --no-build --site hfpc-horsearchery3d`
