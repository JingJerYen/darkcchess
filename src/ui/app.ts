import {
  PIECE_NAMES,
  SIDE_NAMES,
  SQUARES,
  applyAction,
  countOnBoard,
  createRng,
  legalActions,
  newGame,
  observationFor,
  other,
} from '../engine';
import type { Action, GameState, Side, SeededRng } from '../engine';
import { BotRunner } from '../bot/client';
import { DIFFICULTY_NAMES } from '../bot/presets';
import type { Difficulty } from '../bot/presets';
import { describeAction, describeResult, pieceName, squareName } from './describe';
import { RULES_HTML } from './rulesHtml';

type Mode = 'hotseat' | 'ai';
interface Settings {
  mode: Mode;
  humanSide: Side;
  difficulty: Difficulty;
}

const SETTINGS_KEY = 'banqi-drop-settings-v1';

function loadSettings(): Settings {
  const def: Settings = { mode: 'ai', humanSide: 'red', difficulty: 'normal' };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return def;
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      mode: s.mode === 'hotseat' ? 'hotseat' : 'ai',
      humanSide: s.humanSide === 'black' ? 'black' : 'red',
      difficulty: s.difficulty === 'easy' || s.difficulty === 'hard' ? s.difficulty : 'normal',
    };
  } catch {
    return def;
  }
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TEMPLATE = `
<div class="app">
  <header class="top">
    <h1>暗棋擺子</h1>
    <div class="top-actions">
      <button class="btn" id="btn-setup" aria-expanded="false">新局設定</button>
      <button class="btn" id="btn-restart">重新開局</button>
    </div>
  </header>

  <div class="panel confirm" id="confirm" hidden role="alertdialog" aria-labelledby="confirm-text">
    <span id="confirm-text">確定要放棄目前這局，重新開局嗎？</span>
    <button class="btn primary" id="confirm-yes">確定重新開局</button>
    <button class="btn" id="confirm-no">取消</button>
  </div>

  <section class="panel setup" id="setup" hidden>
    <h2>新局設定</h2>
    <div class="row" role="group" aria-label="模式">
      <span class="label">模式</span>
      <button class="btn toggle" data-mode="hotseat">雙人同機</button>
      <button class="btn toggle" data-mode="ai">對電腦</button>
    </div>
    <div class="row ai-only" role="group" aria-label="執子">
      <span class="label">我執</span>
      <button class="btn toggle" data-side="red">紅（先手）</button>
      <button class="btn toggle" data-side="black">黑（後手）</button>
    </div>
    <div class="row ai-only" role="group" aria-label="難度">
      <span class="label">難度</span>
      <button class="btn toggle" data-diff="easy">簡單</button>
      <button class="btn toggle" data-diff="normal">普通</button>
      <button class="btn toggle" data-diff="hard">困難</button>
    </div>
    <div class="row">
      <button class="btn primary" id="btn-start">開始新局</button>
    </div>
  </section>

  <div class="bar black" id="bar-black"></div>
  <div class="status" id="status" aria-live="polite"></div>
  <div class="board-wrap"><div class="board" id="board"></div></div>
  <div class="bar red" id="bar-red"></div>
  <div class="last-text" id="last-text" aria-live="polite"></div>

  <section class="panel gameover" id="gameover" hidden>
    <p id="result-text"></p>
    <button class="btn primary" id="btn-again">再來一局</button>
  </section>

  <div class="controls" id="controls">
    <div class="row" id="turn-controls">
      <button class="btn primary" id="btn-draw">抽棋</button>
      <button class="btn hold" id="btn-peek-hidden">按住窺看我方暗棋</button>
    </div>
    <div class="row" id="pending-controls" hidden>
      <div class="drawn">
        <span>抽到：</span>
        <span class="slot" id="drawn-slot"></span>
        <button class="btn hold" id="btn-peek-drawn">按住查看這顆棋</button>
      </div>
    </div>
    <div class="row" id="place-controls" hidden role="group" aria-label="放明或放暗">
      <button class="btn toggle" id="btn-faceup" aria-pressed="false">放明</button>
      <button class="btn toggle" id="btn-facedown" aria-pressed="false">放暗</button>
    </div>
    <div class="hint" id="hint"></div>
  </div>

  <details class="rules">
    <summary>規則說明</summary>
    ${RULES_HTML}
  </details>
  <div class="foot" id="foot"></div>
</div>
`;

/** Pointer + keyboard "press and hold" behaviour. */
function bindHold(el: HTMLElement, onChange: (held: boolean) => void): void {
  let held = false;
  const set = (v: boolean) => {
    if (held === v) return;
    held = v;
    el.classList.toggle('active', v);
    onChange(v);
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    set(true);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) el.addEventListener(ev, () => set(false));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) set(true);
    }
  });
  el.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      set(false);
    }
  });
  el.addEventListener('blur', () => set(false));
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = TEMPLATE;
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T;

  const boardEl = $('#board');
  const cells: HTMLButtonElement[] = [];
  // Build the board grid once: row labels on the left, column labels at the bottom.
  for (let r = 0; r < 4; r++) {
    const lab = document.createElement('div');
    lab.className = 'coord';
    lab.textContent = 'ABCD'[r];
    boardEl.appendChild(lab);
    for (let c = 0; c < 8; c++) {
      const b = document.createElement('button');
      b.className = 'cell';
      const s = r * 8 + c;
      b.addEventListener('click', () => onCell(s));
      boardEl.appendChild(b);
      cells.push(b);
    }
  }
  boardEl.appendChild(document.createElement('div'));
  for (let c = 0; c < 8; c++) {
    const lab = document.createElement('div');
    lab.className = 'coord';
    lab.textContent = String(c + 1);
    boardEl.appendChild(lab);
  }

  // ---- state ---------------------------------------------------------------
  let settings = loadSettings();
  let draftSettings: Settings = { ...settings };
  let game!: GameState;
  let gameSeed = 0;
  let gameId = 0;
  let sel: { kind: 'piece' | 'flip'; sq: number } | null = null;
  let placeFaceUp: boolean | null = null;
  let peekDrawn = false;
  let peekHidden = false;
  let thinking = false;
  let animSq: number | null = null;
  let lastText = '';
  let hintOverride = '';
  let botRng: SeededRng = createRng(Date.now());
  let runner: BotRunner | null = null;

  const isAi = () => settings.mode === 'ai';
  const botSide = () => other(settings.humanSide);
  const humanCanAct = () =>
    game.result === null && !thinking && (!isAi() || game.toMove === settings.humanSide);
  /** Whose face-down pieces the peek button reveals. */
  const peekSide = (): Side => (isAi() ? settings.humanSide : game.toMove);

  function startGame(): void {
    gameId++;
    gameSeed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    game = newGame(gameSeed);
    botRng = createRng(gameSeed ^ 0x2545f491);
    sel = null;
    placeFaceUp = null;
    peekDrawn = false;
    thinking = false;
    animSq = null;
    lastText = '';
    hintOverride = '';
    if (isAi() && runner === null) runner = new BotRunner();
    render();
    void maybeBotTurn();
  }

  function act(a: Action): void {
    game = applyAction(game, a);
    sel = null;
    if (a.type !== 'draw') {
      placeFaceUp = null;
      peekDrawn = false;
    }
    animSq = a.type === 'place' ? a.to : a.type === 'move' ? a.to : a.type === 'flip' ? a.at : null;
    lastText = describeAction(game.lastAction!);
    hintOverride = '';
    render();
    void maybeBotTurn();
  }

  async function maybeBotTurn(): Promise<void> {
    if (!isAi() || game.result !== null || game.toMove !== botSide() || thinking) return;
    const id = gameId;
    const side = botSide();
    thinking = true;
    render();
    try {
      const t0 = performance.now();
      let a = await runner!.choose(observationFor(game, side), settings.difficulty, botRng.nextSeed());
      await sleep(Math.max(0, 300 - (performance.now() - t0)));
      if (id !== gameId) return;
      if (a.type === 'draw') {
        game = applyAction(game, a);
        lastText = describeAction(game.lastAction!);
        render();
        const t1 = performance.now();
        a = await runner!.choose(observationFor(game, side), settings.difficulty, botRng.nextSeed());
        await sleep(Math.max(0, 500 - (performance.now() - t1)));
        if (id !== gameId) return;
      }
      game = applyAction(game, a);
      animSq = a.type === 'place' ? a.to : a.type === 'move' ? a.to : a.type === 'flip' ? a.at : null;
      lastText = describeAction(game.lastAction!);
    } catch (err) {
      console.error(err);
      lastText = '電腦發生錯誤，請重新開局';
    } finally {
      if (id === gameId) {
        thinking = false;
        render();
      }
    }
  }

  function targetsFrom(from: number): Action[] {
    return legalActions(game).filter((a) => a.type === 'move' && a.from === from);
  }

  function onCell(s: number): void {
    if (!humanCanAct()) return;
    const c = game.board[s];
    if (game.pending !== null) {
      if (c !== null) return;
      if (placeFaceUp === null) {
        hintOverride = '請先選擇「放明」或「放暗」';
        render();
        return;
      }
      act({ type: 'place', to: s, faceUp: placeFaceUp });
      return;
    }
    if (sel?.kind === 'flip' && sel.sq === s) {
      act({ type: 'flip', at: s });
      return;
    }
    if (sel?.kind === 'piece') {
      const t = targetsFrom(sel.sq).find((a) => a.type === 'move' && a.to === s);
      if (t) {
        act(t);
        return;
      }
    }
    if (c !== null && !c.faceUp) sel = { kind: 'flip', sq: s };
    else if (c !== null && c.side === game.toMove && !(sel?.kind === 'piece' && sel.sq === s)) sel = { kind: 'piece', sq: s };
    else sel = null;
    hintOverride = '';
    render();
  }

  // ---- rendering -------------------------------------------------------------
  function pieceHtml(side: Side, rank: number, faceUp: boolean, peek: boolean, drop: boolean): string {
    const name = PIECE_NAMES[side][rank as 1];
    const cls = `piece ${faceUp ? 'up' : 'down'} ${side}${peek ? ' peek' : ''}${drop ? ' drop' : ''}`;
    return `<span class="${cls}" aria-hidden="true">${faceUp || peek ? name : ''}</span>`;
  }

  function renderBoard(): void {
    const canAct = humanCanAct();
    boardEl.classList.toggle('locked', !canAct);
    const moveMarks = new Map<number, 'dot' | 'ring'>();
    if (canAct && sel?.kind === 'piece') {
      for (const a of targetsFrom(sel.sq)) {
        if (a.type === 'move') moveMarks.set(a.to, game.board[a.to] === null ? 'dot' : 'ring');
      }
    }
    const la = game.lastAction;
    const lastSquares = new Set<number>();
    if (la) {
      const a = la.action;
      if (a.type === 'place') lastSquares.add(a.to);
      else if (a.type === 'flip') lastSquares.add(a.at);
      else if (a.type === 'move') {
        lastSquares.add(a.from);
        lastSquares.add(a.to);
      }
    }
    const placing = canAct && game.pending !== null && placeFaceUp !== null;
    const pSide = peekSide();
    for (let s = 0; s < SQUARES; s++) {
      const c = game.board[s];
      const el = cells[s];
      let html = '';
      let label = squareName(s) + '：';
      if (c === null) label += '空格';
      else if (c.faceUp) label += `${SIDE_NAMES[c.side]}明棋「${PIECE_NAMES[c.side][c.rank]}」`;
      else label += `${SIDE_NAMES[c.side]}暗棋`;
      if (c !== null) {
        const peek = !c.faceUp && peekHidden && c.side === pSide && game.result === null;
        html = pieceHtml(c.side, c.rank, c.faceUp, peek, animSq === s);
      }
      const mark = moveMarks.get(s);
      if (mark === 'dot') {
        html += '<span class="mark-dot"></span>';
        label += '（可走）';
      } else if (mark === 'ring') {
        html += '<span class="mark-ring"></span>';
        label += '（可吃）';
      }
      el.innerHTML = html;
      el.setAttribute('aria-label', label);
      el.classList.toggle('last', lastSquares.has(s));
      el.classList.toggle('selected', sel?.kind === 'piece' && sel.sq === s);
      el.classList.toggle('flip-armed', sel?.kind === 'flip' && sel.sq === s);
      el.classList.toggle('placeable', placing && c === null);
    }
    animSq = null;
  }

  function renderBar(side: Side): void {
    const el = $(`#bar-${side}`);
    el.classList.toggle('turn', game.result === null && game.toMove === side);
    let tag = '';
    if (isAi()) tag = side === settings.humanSide ? '<span class="tag">你</span>' : `<span class="tag">電腦・${DIFFICULTY_NAMES[settings.difficulty]}</span>`;
    const lost = game.captured[side].map((r) => PIECE_NAMES[side][r]).join('');
    el.innerHTML = `
      <span class="name"><span class="dot"></span>${SIDE_NAMES[side]}${tag}</span>
      <span class="stats">
        <span>棋堆 <b>${game.pools[side].length}</b></span>
        <span>盤上 <b>${countOnBoard(game, side)}</b></span>
        <span>陣亡 <b>${game.captured[side].length}</b></span>
      </span>
      <span class="lost ${side === 'red' ? 'r' : ''}" aria-label="陣亡棋子">${lost}</span>`;
  }

  function renderControls(): void {
    const canAct = humanCanAct();
    const pending = game.pending !== null;
    $('#turn-controls').hidden = game.result !== null;
    const drawBtn = $<HTMLButtonElement>('#btn-draw');
    const canDraw = canAct && !pending && legalActions(game).some((a) => a.type === 'draw');
    drawBtn.hidden = pending;
    drawBtn.disabled = !canDraw;
    drawBtn.textContent = `抽棋（剩 ${game.pools[isAi() ? settings.humanSide : game.toMove].length}）`;
    $('#btn-peek-hidden').hidden = game.result !== null;

    const showPending = pending && canAct;
    $('#pending-controls').hidden = !showPending;
    $('#place-controls').hidden = !showPending;
    if (showPending) {
      const p = game.pending!;
      const visible = isAi() || peekDrawn;
      $('#drawn-slot').innerHTML = pieceHtml(p.side, p.rank, visible, false, false);
      $('#drawn-slot').setAttribute('aria-label', visible ? `抽到「${pieceName(p)}」` : '抽到的棋（隱藏）');
      $('#btn-peek-drawn').hidden = isAi();
      $('#btn-faceup').setAttribute('aria-pressed', String(placeFaceUp === true));
      $('#btn-facedown').setAttribute('aria-pressed', String(placeFaceUp === false));
    }

    let hint = '';
    if (game.result === null) {
      if (thinking) hint = '';
      else if (!canAct) hint = '';
      else if (pending) hint = placeFaceUp === null ? '先選「放明」或「放暗」，再點一個空格放置。' : '點任何一個空格放置。';
      else hint = '點自己的明棋走棋；點暗棋選取，再點一次才翻開。';
    }
    $('#hint').textContent = hintOverride || hint;
  }

  function renderStatus(): void {
    const st = $('#status');
    st.classList.toggle('thinking', thinking);
    if (game.result !== null) {
      st.textContent = '對局結束';
    } else if (thinking) {
      st.textContent = '電腦思考中…';
    } else {
      const who = SIDE_NAMES[game.toMove];
      const you = isAi() ? (game.toMove === settings.humanSide ? '（你）' : '（電腦）') : '';
      st.textContent = game.pending !== null ? `${who}${you}放置抽到的棋` : `輪到${who}${you}`;
    }
  }

  function renderGameOver(): void {
    const over = game.result !== null;
    $('#gameover').hidden = !over;
    if (over) {
      let text = describeResult(game.result!);
      if (isAi() && game.result!.winner !== null) text += game.result!.winner === settings.humanSide ? '　你贏了！' : '　電腦獲勝。';
      $('#result-text').textContent = text;
    }
  }

  function renderSetup(): void {
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === draftSettings.mode));
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-side]')) b.setAttribute('aria-pressed', String(b.dataset.side === draftSettings.humanSide));
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-diff]')) b.setAttribute('aria-pressed', String(b.dataset.diff === draftSettings.difficulty));
    for (const el of root.querySelectorAll<HTMLElement>('.ai-only')) el.hidden = draftSettings.mode !== 'ai';
  }

  function render(): void {
    renderBar('black');
    renderBar('red');
    renderStatus();
    renderBoard();
    renderControls();
    renderGameOver();
    $('#last-text').textContent = lastText;
    const mode = isAi() ? `對電腦（${DIFFICULTY_NAMES[settings.difficulty]}）` : '雙人同機';
    $('#foot').textContent = `${mode}・牌局編號 ${gameSeed}${runner?.fallback ? '・背景執行緒無法使用，電腦以簡單難度運算' : ''}`;
  }

  // ---- wiring --------------------------------------------------------------
  $('#btn-draw').addEventListener('click', () => {
    if (!humanCanAct() || game.pending !== null) return;
    if (!legalActions(game).some((a) => a.type === 'draw')) return;
    act({ type: 'draw' });
  });
  $('#btn-faceup').addEventListener('click', () => {
    placeFaceUp = true;
    hintOverride = '';
    render();
  });
  $('#btn-facedown').addEventListener('click', () => {
    placeFaceUp = false;
    hintOverride = '';
    render();
  });
  bindHold($('#btn-peek-drawn'), (h) => {
    peekDrawn = h;
    renderControls();
  });
  bindHold($('#btn-peek-hidden'), (h) => {
    peekHidden = h;
    renderBoard();
  });

  const confirmEl = $('#confirm');
  let confirmAction: (() => void) | null = null;
  const requestRestart = (then: () => void) => {
    if (game.result !== null || game.ply === 0) {
      then();
      return;
    }
    confirmAction = then;
    confirmEl.hidden = false;
    $('#confirm-yes').focus();
  };
  $('#confirm-yes').addEventListener('click', () => {
    confirmEl.hidden = true;
    const f = confirmAction;
    confirmAction = null;
    f?.();
  });
  $('#confirm-no').addEventListener('click', () => {
    confirmEl.hidden = true;
    confirmAction = null;
  });
  $('#btn-restart').addEventListener('click', () => requestRestart(startGame));
  $('#btn-again').addEventListener('click', startGame);

  const setupEl = $('#setup');
  const setupBtn = $('#btn-setup');
  const toggleSetup = (open: boolean) => {
    setupEl.hidden = !open;
    setupBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      draftSettings = { ...settings };
      renderSetup();
    }
  };
  setupBtn.addEventListener('click', () => toggleSetup(setupEl.hidden));
  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      draftSettings.mode = b.dataset.mode as Mode;
      renderSetup();
    }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-side]').forEach((b) =>
    b.addEventListener('click', () => {
      draftSettings.humanSide = b.dataset.side as Side;
      renderSetup();
    }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((b) =>
    b.addEventListener('click', () => {
      draftSettings.difficulty = b.dataset.diff as Difficulty;
      renderSetup();
    }),
  );
  $('#btn-start').addEventListener('click', () =>
    requestRestart(() => {
      settings = { ...draftSettings };
      saveSettings(settings);
      toggleSetup(false);
      startGame();
    }),
  );

  // Clicking outside the board cancels a selection.
  document.addEventListener('click', (e) => {
    if (sel === null) return;
    if (!(e.target instanceof Node) || boardEl.contains(e.target)) return;
    sel = null;
    renderBoard();
  });

  startGame();
  toggleSetup(true);
}
