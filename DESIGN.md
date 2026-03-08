# InSpark - Design Document

3D花火シミュレーションの中を仮想ドローンで飛ぶWeb体験。

---

## Architecture Overview

```
[User Input]         [Auto Camera]        [Audio Engine]
  mouse/touch   -->   Spline Path    <--   Beat Detection
  gyroscope          + User Offset         Web Audio API
       |                  |                     |
       v                  v                     v
+----------------------------------------------------------+
|                    Scene Manager                          |
|  - Firework Choreographer (launch timing & sequencing)    |
|  - Camera Controller (path + offset + shake + FOV)        |
+----------------------------------------------------------+
       |                  |                     |
       v                  v                     v
+----------------------------------------------------------+
|                   Particle System                         |
|  GPU-based (WebGPU compute / WebGL2 transform feedback)   |
|  - Shell particles (ascending)                            |
|  - Star particles (burst & trail)                         |
|  - Secondary sparks (glitter, crackle)                    |
|  - Smoke volumes (optional, later phase)                  |
+----------------------------------------------------------+
       |
       v
+----------------------------------------------------------+
|                    Render Pipeline                         |
|  Three.js WebGPURenderer (fallback: WebGL2)               |
|  1. Particle draw (Points + ShaderMaterial, additive)     |
|  2. Bloom post-process (selective UnrealBloomPass)        |
|  3. Motion blur (optional)                                |
|  4. Vignette (dynamic, for comfort)                       |
|  5. Tone mapping (ACES Filmic)                            |
+----------------------------------------------------------+
```

---

## 1. Firework Domain Model

### 1.1 Shell Sizes & Parameters

| Shell | Height (m) | Burst Radius (m) | Stars | Fuse (s) | Star Burn (s) |
|-------|-----------|-------------------|-------|----------|----------------|
| 3"    | 120       | 20                | ~100  | 3.0-3.5  | 1-2 (peony)    |
| 4"    | 150       | 27                | ~125  | 3.5      | 1-2            |
| 5"    | 180       | 34                | ~145  | 4.0      | 2-3            |
| 6"    | 210       | 41                | ~150  | 5.0      | 2-4            |
| 8"    | 270       | 55                | ~155  | 6.0      | 3-5            |
| 10"   | 320       | 69                | ~250  | 6.5      | 3-6            |
| 12"   | 350       | 82                | ~400  | 7.0      | 4-8            |

### 1.2 Burst Patterns (実装優先度順)

**Phase 1 (MVP):**
- **Peony** — 均一な放射状散布、トレイルなし
- **Chrysanthemum** — Peony + 輝くトレイル付き
- **Willow** — 超長燃焼 (5-10s)、重力で垂れ下がる弧
- **Crossette** — 2段階: 星が飛んだ後4方向に分裂 (事前計算で実現可能)
- **Multi-break** — 複数段の連続破裂 (事前計算で実現可能)

**Phase 2:**
- **Palm** — 上昇中のコメットテイル + 垂れ下がる枝
- **Kamuro** — 密集した金/銀グリッターの幕
- **Brocade** — 星は暗く、トレイルが主役
- **Ring** — 星を1平面(赤道面)に限定して放出
- **Strobe** — 4-10Hzで明滅

#### Crossette / Multi-break の事前計算方式

ドラッグ近似で各星の軌道が確定するため、分裂・連続破裂も打ち上げ時に
全パーティクルの初期条件を一括計算できる。動的生成は不要。

```
Crossette:
  1. 破裂時に親星を生成 (birthTime = T_burst)
  2. 親星の t=1.5s 時点の位置を事前計算:
     splitPos = start + (vel/k)*(1 - exp(-k*1.5)) + 0.5*g*1.5²
  3. splitPos を起点に子パーティクル4つを生成 (birthTime = T_burst + 1.5)
  → GPU には全て初期条件として渡し、birthTime で出現制御

Multi-break:
  1. 第N段の破裂位置 = シェル軌道の t=fuse_N 時点の位置
  2. 各段の星を事前生成 (birthTime = T_launch + fuse_N)
  → 全段のパーティクルを打ち上げ前に確定
```

シェーダー側: `if (time < birthTime) discard;` で未出現パーティクルを非表示。

### 1.3 Physics Simulation

各パーティクルの更新ループ:

```
// Per frame, per particle:
F_drag = 0.5 * rho * Cd * A * |v|^2  (opposite to velocity)
a = gravity + F_drag / mass
v += a * dt
pos += v * dt
burnTime -= dt
```

Key constants:
- gravity = (0, -9.81, 0) m/s^2
- rho (air density) = 1.225 kg/m^3
- Cd (drag coefficient) = 0.47-0.6
- Star ejection velocity = 28-50 m/s
- Launch muzzle velocity = 40-50 m/s (academic) / ~112 m/s (industry rule)

**Analytical shortcut (GPU-friendly, with drag approximation):**
初期条件(position, velocity, dragCoeff, birthTime)をGPUに渡し、
シェーダー内で指数減衰ドラッグ近似で計算:

```glsl
float k = dragCoeff;  // 0=no drag (peony), 0.5-1.0 (chrysanthemum), 2.0-3.0 (willow)
vec3 pos = startPos
         + (vel / k) * (1.0 - exp(-k * t))   // drag-decayed velocity
         + 0.5 * gravity * t * t;              // gravity (unaffected by drag)
// k=0 の場合は pos = startPos + vel * t + 0.5 * gravity * t * t にフォールバック
```

CPUは初期条件 + time uniform のみ → CPU負荷ほぼゼロ。
Crossette分裂やMulti-breakも事前計算した初期条件で対応可能。

### 1.4 Color Model

| Color    | RGB (HDR peak)     | Metal Salt     |
|----------|--------------------|----------------|
| Red      | (5.0, 0.3, 0.1)   | Strontium      |
| Green    | (0.3, 5.0, 0.3)   | Barium         |
| Blue     | (0.2, 0.4, 5.0)   | Copper (dim)   |
| Yellow   | (5.0, 4.5, 0.5)   | Sodium         |
| Orange   | (5.0, 2.0, 0.2)   | Calcium        |
| White    | (6.0, 5.5, 5.0)   | Mg/Al          |
| Gold     | (4.0, 2.5, 0.5)   | Iron/Charcoal  |
| Purple   | (3.0, 0.3, 4.0)   | Sr + Cu        |

星の色変化シーケンス:
1. 点火フラッシュ: 白 (broadband, ~50ms)
2. 主燃焼: 指定色 (1-8s)
3. フェード: 色 → オレンジ → 暗い赤 → 消滅

HDR値 > 1.0 でbloomが自然にかかる。

---

## 2. Technical Architecture

### 2.1 Renderer: Three.js + WebGPURenderer

- **WebGPURenderer** をデフォルト、WebGL2にフォールバック
- Three.js TSL (Three Shading Language) でシェーダーを書く → WGSL/GLSLに自動コンパイル
- WebGPU compute shaderでパーティクル物理をGPU上で完結

### 2.2 Particle System Design

**レンダリング方式:**
- `THREE.Points` + カスタム `ShaderMaterial` (大量の小さな火花)
- `InstancedBufferGeometry` (速度方向にストレッチするトレイル用、Phase 2)

**パフォーマンス目標:**

| Platform       | Max Particles | Target FPS |
|---------------|---------------|------------|
| Desktop       | 200,000-500,000 | 60        |
| Mobile (modern)| 30,000-50,000  | 30-60     |
| Mobile (old)  | 10,000-20,000   | 30        |

**メモリ戦略:**
- 起動時にmax particle数分のBufferを事前確保 (Float32Array)
- Object pooling: free listでインデックス管理、`new` を禁止
- `attribute.updateRange` で変更部分のみGPUにアップロード
- delta time clamp (max 33ms) でバックグラウンドタブ復帰時の暴走防止

**GPU Particle (Phase 1: Analytical):**
- 各パーティクルの初期条件をvertex attributeとして格納
- vertex shader内で `pos = start + vel * t + 0.5 * accel * t * t`
- CPUは time uniform のみ更新 → CPU負荷ほぼゼロ

**GPU Particle (Phase 2: Compute Shader):**
- WebGPU compute shaderでドラッグ付き物理シミュレーション
- Ping-pong buffer (2つのstorage bufferを交互に使用)
- Workgroup size = 256

### 2.3 Rendering Pipeline

1. **Particle draw**: additive blending (`THREE.AdditiveBlending`)
   - 順序非依存 → ソート不要
   - `depthWrite: false`, `depthTest: true`
2. **Selective Bloom**: `UnrealBloomPass` を花火パーティクルのみに適用
   - Layer system で花火と背景を分離
   - threshold, strength, radius をシェルサイズと距離で動的調整
3. **Tone Mapping**: `THREE.ACESFilmicToneMapping`
4. **Dynamic Vignette**: 速度に応じて周辺を暗くする (酔い防止)
5. **Output**: `SRGBColorSpace`

### 2.4 Known Pitfalls & Mitigations

| Problem | Impact | Mitigation |
|---------|--------|------------|
| `gl_PointSize` ハードウェア上限 | 一部GPUで最大1px | `gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)` を確認、上限超えたらinstanced quadにフォールバック |
| Points frustum culling | 画面端でパーティクルが突然消える | `frustumCulled = false` または boundingBox を手動拡張 |
| Overdraw (fill rate) | 密集花火でFPS激減、特にモバイル | 低解像度オフスクリーンバッファに描画→合成 (GPU Gems手法) |
| WebGL context loss | GPU リソース全消失 | `webglcontextlost` / `webglcontextrestored` イベントハンドリング |
| Background tab spike | dt巨大化でパーティクルがワープ | `Math.min(dt, 33)` でクランプ |
| モバイル fill rate | デスクトップの1/5-1/10 | `mediump`精度、varying 3個以下、分岐→`mix()`/`step()` |
| iOS gyroscope権限 | iOS 13+で明示的許可必要 | ボタンタップ後に `DeviceOrientationEvent.requestPermission()` |
| GC pause | 大量のオブジェクト生成でフレーム落ち | typed array事前確保、ループ内 `new` 禁止 |

---

## 3. Camera System

### 3.1 Auto Camera (デフォルト)

**Dual Spline System:**
- Position spline: `CatmullRomCurve3` でカメラ位置を定義
- LookAt spline: 別の `CatmullRomCurve3` でカメラ注視点を定義
- `getPointAt(t)` で t=0→1 の間をアニメーション

**Speed Ramping:**
- 花火破裂前: スローダウン (接近感)
- 花火通過中: 加速 (爽快感)
- bezier easing で滑らかな速度変化

**Cinematic Effects:**
- FOV変化: 高速時にワイド (没入感↑)、接近時にナロー (圧縮感)
- Camera shake: Perlin noise、花火爆発時に強度UP
- Dolly zoom: 花火爆発時にカメラ後退+FOV拡大で衝撃波感

### 3.2 User Input (オフセットレイヤー)

自動カメラの上にユーザー入力を加算:

```
finalRotation = autoRotation + userOffset
userOffset = lerp(currentOffset, targetOffset, 0.05)  // smooth
targetOffset = clamp(mouseInput * maxAngle, -45deg, +45deg)
```

**Input Sources (優先度順):**
1. マウス移動 → pitch/yaw offset
2. タッチドラッグ → 同上
3. ジャイロスコープ → デバイス傾き (モバイル、許可時)

### 3.3 Motion Sickness Mitigation

- **Dynamic vignette**: カメラ速度 > 20deg/s で周辺暗くする
- **Stable background**: 遠景の星空/地上の灯りをゆっくり動かす (安定参照フレーム)
- **Speed limit**: 急激な加速・回転を避ける
- **Frame rate**: 60FPS維持を最優先、パーティクル数を動的に削減
- **Comfort mode**: 穏やかなカメラ動きオプション

---

## 4. Sound Design

### 4.1 Sound-Light Delay

```
delay = distance_to_burst / 343  // seconds
```

カメラが花火の中を飛ぶ場合、距離が非常に近い (0-50m) ため遅延はほぼゼロ。
遠くの花火は 0.3-2秒の遅延をつけるとリアル。

### 4.2 Sound Types

| Sound      | Trigger                  | Character              |
|------------|--------------------------|------------------------|
| Boom       | Burst charge explosion   | Low-freq impulse       |
| Crackle    | Glitter/crackle stars    | Stochastic mid-freq    |
| Whistle    | Ascending shell          | Tonal ~2.5kHz          |
| Hiss       | Burning stars nearby     | Broadband white noise  |

### 4.3 Audio-Reactive Option (Phase 3)

- Web Audio API `AnalyserNode` で周波数分析
- 低音 → 打ち上げトリガー
- ビート → カメラシェイク強度
- 全体エネルギー → bloom強度、FOV

---

## 5. Implementation Phases

### Phase 1: MVP
- [ ] プロジェクトセットアップ (Vite + Three.js + TypeScript)
- [ ] 基本パーティクルシステム (Points + ShaderMaterial, analytical physics + drag approximation)
- [ ] Peony, Chrysanthemum, Willow, Crossette, Multi-break の5パターン
- [ ] Crossette / Multi-break の事前計算パイプライン
- [ ] Additive blending + Bloom post-process
- [ ] 固定カメラ + マウス操作 (OrbitControls)
- [ ] 基本色モデル (6色)
- [ ] デスクトップ60FPS

### Phase 2: Fly-Through Experience
- [ ] Auto camera (CatmullRomCurve3 spline path)
- [ ] User offset (mouse/touch on top of auto)
- [ ] Camera shake + FOV effects
- [ ] Dynamic vignette
- [ ] Firework choreographer (タイミング制御)
- [ ] Trail rendering (velocity-stretched particles)
- [ ] Mobile optimization (低解像度レンダリング、パーティクル動的削減)
- [ ] Touch/gyroscope input

### Phase 3: Polish & Expansion
- [ ] Compute shader physics (WebGPU)
- [ ] Additional burst patterns (Palm, Kamuro, Brocade, Ring, Strobe)
- [ ] Sound system (Web Audio API)
- [ ] Audio-reactive mode
- [ ] Smoke volumes (optional)
- [ ] Color-change stars
- [ ] Comfort settings UI

---

## 6. Tech Stack

サーバーサイド処理なし。完全クライアントサイドの静的サイト。

| Layer          | Choice                                    |
|----------------|-------------------------------------------|
| Build          | Vite                                      |
| Language       | TypeScript                                |
| 3D Engine      | Three.js                                  |
| Shaders        | GLSL (ShaderMaterial / RawShaderMaterial)  |
| Post-process   | pmndrs/postprocessing                     |
| Audio          | Web Audio API                             |
| Hosting        | GitHub Pages (or any static host)         |
