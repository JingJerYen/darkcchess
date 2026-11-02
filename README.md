# 暗棋擺子（Banqi Drop）

自創的暗棋變體網頁遊戲：棋盤開局是空的，每回合可以從自己的棋堆抽棋放到任何空格（放明或放暗）、翻開任何一顆暗棋，或走自己的明棋。支援**雙人同機**與**對電腦**（搜尋式 bot，在 Web Worker 執行）。

TypeScript + Vite，不使用 UI 框架。手機優先，桌面也能玩。

```bash
npm install
npm run dev      # 開發伺服器
npm test         # vitest 單元測試
npm run build    # 型別檢查 + 打包到 dist/
npm run arena -- --games 200 --red mcts:normal --black greedy   # 無頭對戰評測
```

---

## 規則

### 1. 棋盤與棋子

- 棋盤 4 列 × 8 行，開局全空。座標 `(row 0..3, col 0..7)`；介面上列標 A–D（由上而下）、行標 1–8。
- 紅黑各 16 顆（數字越大越強）：

| 大小 | 紅 | 黑 | 數量 |
|---|---|---|---|
| 7 | 帥 | 將 | 1 |
| 6 | 仕 | 士 | 2 |
| 5 | 相 | 象 | 2 |
| 4 | 俥 | 車 | 2 |
| 3 | 傌 | 馬 | 2 |
| 2 | 炮 | 包 | 2 |
| 1 | 兵 | 卒 | 5 |

- 每方有自己的**棋堆**：開局把自己 16 顆洗牌（seeded RNG）。只能抽自己顏色的棋。
- 紅方先手。

### 2. 每回合三選一

1. **抽棋**：自己棋堆有棋、且盤面至少一個空格時，從棋堆抽一顆（只有抽的人看得到），看過後決定放**明**或放**暗**，放到**任何空格**。抽了就必須放，不能取消。
2. **翻棋**：翻開盤面上**任何一顆暗棋，包括對方放的**。翻開後仍屬於原本那一方。
3. **移動**：移動自己的明棋。

棋堆抽完之後，只能翻棋或移動。

### 3. 明棋的移動與吃子

大小規則 `canCapture(attacker, target)`：

- 炮（2）：永遠 false（炮不能用一般步行吃子）。
- 兵（1）：只能吃兵或帥。
- 帥（7）：不能吃兵，其他都可以（含帥）。
- 其他：`attacker.rank >= target.rank`。

只能吃**對方的明棋**；吃子後攻擊者停在被吃棋的位置，被吃的棋移出遊戲。

- **所有明棋**：上下左右一格走到空格。
- **一般吃子（非炮）**：上下左右一格吃相鄰的敵方明棋，須通過 `canCapture`。
- **炮／包**：沿同一列或行，中間**剛好隔一顆棋**（明暗敵我都可當炮架），吃炮架之後的第一顆棋；那顆必須是敵方明棋，**可吃任何大小**。炮架後第一顆是己方棋或暗棋則不能吃；不能緊貼直接吃。
- **俥／車直衝**：沿直線衝過去，中間格必須全空（暗棋也會擋），可吃路徑上第一顆敵方明棋並停在該格。
  - `CHARIOT_CHARGE_CAPTURES_ANY = false`（預設，`src/engine/rules.ts`）：直衝仍受大小規則限制，所以俥只能直衝吃俥、傌、炮、兵。
  - 設為 `true`：距離 ≥ 2 的直衝可吃任何敵方明棋。
  - 不吃子時俥仍只能走一格。

### 4. 暗棋

- 背面朝上，以背面顏色顯示是誰放的，看不到大小。
- 不能移動、不能吃子、**不能被吃**；可以當炮架，也會擋住俥的直衝。
- 被翻開後變成普通明棋。

### 5. 勝負與和局

- 輪到某方時若**沒有任何合法動作**（不能抽棋、盤上沒有暗棋可翻、沒有明棋能動或吃），該方輸。
- 同一局面（每格的棋與明暗、雙方棋堆剩餘數、輪到誰）**第 3 次**出現，立即和局。
- 沒有其他和局條件。

---

## 專案結構

```
src/
  engine/            純函式規則引擎，不碰 DOM
    types.ts         Side / Rank / Action / GameState …
    rng.ts           可設定種子的 RNG（mulberry32）與洗牌
    rules.ts         常數、canCapture、射線表、isAttacked、CHARIOT_CHARGE_CAPTURES_ANY
    game.ts          newGame、legalActions、applyAction、positionKey、drawRank …
    observation.ts   observationFor（隱藏資訊防火牆）
  bot/
    types.ts         Bot 介面、MctsParams
    evalWeights.ts   ★ 所有評估／rollout／搜尋常數
    determinize.ts   隱藏資訊取樣、sampleRank（chance node 用）
    policy.ts        rollout policy、展開排序、評估函數
    mcts.ts          PIMC-MCTS
    bots.ts          RandomBot、GreedyBot、MctsBot
    presets.ts       難度預設
    worker.ts        Web Worker 入口
    client.ts        瀏覽器端 BotRunner（Worker + 同步 fallback）
  sim/playGame.ts    無頭對局（arena 與測試共用）、dump 格式
  ui/                畫面（app.ts、describe.ts、rulesHtml.ts、style.css）
scripts/arena.ts     評測工具（worker_threads 平行）
tests/               vitest 測試
```

### 引擎 API

- `newGame(seed, rules?)`：新局。`rules.chariotChargeCapturesAny` 預設取 `CHARIOT_CHARGE_CAPTURES_ANY`。
- `legalActions(state)`、`applyAction(state, action)`（回傳新 state，不就地修改；非法動作會丟例外）。
- `observationFor(state, side)`：該方能看到的資訊。
- `positionKey(state)`：重複局面判斷用的字串。
- Action：`{type:'draw'}`、`{type:'place', to, faceUp}`、`{type:'flip', at}`、`{type:'move', from, to}`。格子 `Square = row * 8 + col`。
- `draw` 之後 `state.pending` 有值，`legalActions` 只會回傳 `place`。
- 重複局面只需比對「上一次不可逆動作（抽放、翻棋、吃子）之後」的局面，因為那些動作之前的局面不可能再出現；state 以不可變鏈結串列 `rep` 保存。

---

## 電腦對手（bot）

不使用神經網路，採 **Determinization（隱藏資訊取樣）+ MCTS**，即 PIMC-MCTS。

### 資訊防火牆

```ts
interface Bot { name: string; chooseAction(obs: Observation, rng: RNG): Promise<Action> }
```

Bot 只會拿到 `observationFor(state, side)`：所有明棋、雙方陣亡棋、自己暗棋的大小、自己棋堆的**組成**（排序過，不含順序）、對方暗棋的位置與數量、雙方棋堆剩餘數、`pending` 時自己抽到的棋、輪到誰、重複局面歷史（只含位置鍵，不含暗棋大小）。選了 `draw` 後，同一回合會再呼叫一次 `chooseAction` 決定 `place`。

### 隱藏資訊取樣

未知集合 U = 對方 16 顆 − 對方盤上明棋 − 對方陣亡棋，並 assert `|U| = 對方盤上暗棋數 + 對方棋堆數`。U 均勻洗牌後依序分配給對方的每顆暗棋，其餘當對方棋堆。暗棋歸屬由背面顏色可知，不需推測。

### 搜尋

- 每個難度做 `D` 次 determinization，每次 `I` 次 MCTS iteration（UCT，`uctC` 預設 1.0），把根節點各動作的訪問次數加總，選最多的（同票比平均值）。
- `draw` 是 **chance node**：每次經過都從剩餘棋堆的**組成**重新隨機抽一個大小（`sampleRank` 只看多重集合，與排列順序無關），雙方都一樣，所以 bot 不會偷知道下一張。
- 對方暗棋大小在同一次 determinization 內固定，翻開後揭曉。
- 每步受 `timeBudgetMs` 限制（`performance.now()`），時間會平均分給各次 determinization；時間到就用當下統計出手。
- **Progressive widening**：一個節點被訪問 n 次時最多展開 `ceil(pwC · (n+1)^pwAlpha)` 個子節點；未展開動作依啟發式排序（吃子、可威脅對方的安全明放、逃離被攻擊……）加上隨機擾動。

### Rollout 與評估

- Rollout policy 是加權隨機：吃子權重高（加上被吃棋價值）；放明到下一步就會被吃的格子權重很低；翻對方暗棋權重低；走進被攻擊格權重低、把被攻擊的棋移到安全處權重高；其他均等。為了速度，非吃子動作用拒絕取樣，放棋不展開全部 64 個動作。
- Rollout 最多 `maxRolloutPlies`（預設 30）步，未終局就用評估函數轉成勝率：`1 / (1 + exp(-LOGISTIC_SCALE · diff))`。終局：勝 1、負 0、和 0.5。
- 評估：棋子價值 兵 1、傌 3、炮 4、相 4、俥 5、仕 5、帥 7；己方減對方；棋堆裡（含抽到未放）的棋 × 0.8；暗棋 × 0.9；可選的機動性項（合法動作數差 × `MOBILITY_WEIGHT`，預設 0 關閉）。

### 難度

| 難度 | D | I | 時間上限 |
|---|---|---|---|
| 簡單 `easy` | 4 | 150 | 0.3 s |
| 普通 `normal` | 8 | 400 | 1 s |
| 困難 `hard` | 16 | 1000 | 3 s |

先到哪個上限就停。網頁版 bot 在 Web Worker 裡執行；Worker 失敗時改用主執行緒同步跑簡單難度。Bot 的 RNG 與遊戲 RNG 分開。

另有 `RandomBot`（合法動作均勻隨機）與 `GreedyBot`（能吃就吃、優先吃大的，否則隨機）供測試。

### 調整 `src/bot/evalWeights.ts`

所有可調常數都在這個檔案：

- `PIECE_VALUE`、`POOL_FACTOR`、`HIDDEN_FACTOR`、`MOBILITY_WEIGHT`、`LOGISTIC_SCALE`：評估函數。
- `ROLLOUT`：rollout 權重。
- `EXPANSION`：展開順序的額外加分與擾動。
- `SEARCH`：`uctC`、`maxRolloutPlies`、`pwC`、`pwAlpha` 的預設值（難度預設由 `presets.ts` 套用）。

建議流程：改一個常數 → 用 arena 讓新版對舊版（或對固定對手）跑幾百局 → 看分數與信賴區間再決定。arena 也可以直接覆寫搜尋參數做 A/B，例如：

```bash
npm run arena -- --games 400 --red mcts:normal,c=0.7 --black mcts:normal
```

---

## 評測工具（arena）

```bash
npm run arena -- --games 1000 --red mcts:normal --black random --seed 1 --out result.json [--chariot-any] [--dump data.jsonl] [--workers 4] [--max-plies 1000]
```

- Bot 規格：`random`、`greedy`、`mcts:easy|normal|hard`，可接覆寫：`mcts:normal,t=500,d=4,i=200,c=0.7,r=30,pw=2`（t=時間 ms、d=D、i=I、c=UCT 常數、r=rollout 步數上限、pw=pwC）。
- `--red` 的 bot 稱為 A、`--black` 的稱為 B；**自動交換顏色**：偶數局 A 執紅、奇數局 A 執黑，相鄰兩局使用同一副牌序以降低變異。
- 以 `worker_threads` 平行（預設 CPU 核心數）。
- `--chariot-any` 讓該次對戰使用 `chariotChargeCapturesAny = true`，方便 A/B 實驗。
- `--max-plies`（預設 1000）是評測用的安全上限，超過記為「其他」和局（遊戲規則本身沒有這條）。
- 輸出（終端表格；`--out` 另存 JSON，含每局紀錄）：
  - A 的勝／和／負與得分（和局 0.5 分），A 執紅、A 執黑各自的成績，以及**紅方（先手）**整體勝率。
  - 平均手數、平均每局耗時、雙方平均每步思考時間、和局原因（重複局面 vs 其他）。
  - **各棋種統計**：平均每局吃子數、平均每局被吃數、平均被吃時的手數、吃法分類（一般／炮／直衝），以及「被誰吃掉」矩陣（列＝攻擊者，欄＝被吃者）。
- `--dump data.jsonl`：每個決策點一行 JSON，schema 版本 `v: 1`：

```json
{"v":1,"game":0,"ply":12,"side":"red","bot":"mcts:normal","x":{...},"action":"p5h","result":1}
```

`x` 是以決策方為視角的特徵：`board`（32 格，0＝空、+r＝己方明棋、8+r＝己方暗棋、−r＝對方明棋、−8＝對方暗棋）、`myPool`（各大小數量，兵→帥）、`oppPoolCount`、`myCaptured`、`oppCaptured`、`pending`、`ply`、`repLen`、`rules`。`action` 是 `actionKey`（`d`、`p{sq}u|h`、`f{sq}`、`m{from}-{to}`），`result` 是該局最終結果（決策方視角，1／0.5／0）。

---

## 測試

```bash
npm test
```

- `tests/engine.test.ts`：大小規則、炮（各種炮架、隔兩子、緊貼、炮架後是暗棋、吃帥、不吃己方）、俥直衝（路徑擋住、旗標開關、落點）、暗棋、抽棋（棋堆空、盤面滿、pending）、翻棋、勝負、三次重複、`observationFor` 隱藏資訊、種子重現。
- `tests/bot.test.ts`：Observation 防火牆（只差對方暗棋大小／棋堆順序的兩個 state 產生相同 obs 與相同 bot 動作）、determinization 的 `|U|` 約束與觀察一致性、chance node 與棋堆順序無關、200 個隨機局面上三種 bot 都回傳合法動作。
