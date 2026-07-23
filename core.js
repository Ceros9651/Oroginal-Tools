"use strict";

// Original Timer - コアロジック
// DOM に触れない純粋関数のみを置く。ブラウザと Node の双方から利用できる。

/** 区間の種類は「作業」「休憩」の2種類のみ */
const INTERVAL_TYPES = Object.freeze({
  WORK: "作業",
  BREAK: "休憩",
});

const ALL_TYPES = Object.freeze([INTERVAL_TYPES.WORK, INTERVAL_TYPES.BREAK]);

const MS_PER_MINUTE = 60 * 1000;

/** 実行状態 */
const STATUS = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
});

// --- バリデーション ---------------------------------------------------------

/**
 * 分数を検証する。1以上の整数のみ許可し、0・負数・非整数・数値でない値は拒否する。
 * @returns {{ok: true, value: number} | {ok: false, error: string}}
 */
function validateMinutes(input) {
  const value = typeof input === "string" ? input.trim() : input;
  if (value === "" || value === null || value === undefined) {
    return { ok: false, error: "分数を入力してください。" };
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return { ok: false, error: "分数は数値で入力してください。" };
  }
  if (!Number.isInteger(num)) {
    return { ok: false, error: "分数は整数で入力してください。" };
  }
  if (num < 1) {
    return { ok: false, error: "分数は1以上で入力してください。" };
  }
  return { ok: true, value: num };
}

/** 種類が「作業」「休憩」のいずれかかを検証する */
function validateType(type) {
  if (!ALL_TYPES.includes(type)) {
    return { ok: false, error: "種類は「作業」または「休憩」のみ指定できます。" };
  }
  return { ok: true, value: type };
}

// --- 区間スケジュール -------------------------------------------------------

let idCounter = 0;
/** 衝突しない区間 ID を生成する */
function nextId() {
  idCounter += 1;
  return `iv-${Date.now().toString(36)}-${idCounter}`;
}

/**
 * 区間を生成する。種類・分数のいずれかが不正なら生成しない。
 * @returns {{ok: true, value: Interval} | {ok: false, error: string}}
 */
function createInterval(type, minutes) {
  const t = validateType(type);
  if (!t.ok) return t;
  const m = validateMinutes(minutes);
  if (!m.ok) return m;
  return { ok: true, value: { id: nextId(), type: t.value, minutes: m.value } };
}

/** 区間をリスト末尾に追加した新しいリストを返す（元のリストは変更しない） */
function addInterval(schedule, interval) {
  return schedule.concat([interval]);
}

/** 指定 id の区間を取り除いた新しいリストを返す */
function removeInterval(schedule, id) {
  return schedule.filter((iv) => iv.id !== id);
}

/**
 * 区間を上下に移動した新しいリストを返す。
 * 端を超える移動は何もしない（元と同じ並びを返す）。
 * @param {number} delta -1 で上へ、+1 で下へ
 */
function moveInterval(schedule, id, delta) {
  const index = schedule.findIndex((iv) => iv.id === id);
  if (index === -1) return schedule.slice();
  const target = index + delta;
  if (target < 0 || target >= schedule.length) return schedule.slice();
  const next = schedule.slice();
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** 区間の長さをミリ秒で返す */
function durationMs(interval) {
  return interval.minutes * MS_PER_MINUTE;
}

/** スケジュール全体の合計ミリ秒 */
function totalDurationMs(schedule) {
  return schedule.reduce((sum, iv) => sum + durationMs(iv), 0);
}

// --- 実行状態の FSM ---------------------------------------------------------

/**
 * 実行状態:
 *   { status, currentIndex, endTime, remainingMs }
 *   - running のとき endTime（絶対時刻）を持つ。remainingMs は null。
 *   - paused のとき remainingMs（確定した残り）を持つ。endTime は null。
 */
function createRunState() {
  return { status: STATUS.IDLE, currentIndex: 0, endTime: null, remainingMs: null };
}

/**
 * タイマーを開始する。空リストでは開始できない。
 * @returns {{ok: true, state: RunState} | {ok: false, error: string}}
 */
function start(schedule, now) {
  if (!schedule || schedule.length === 0) {
    return { ok: false, error: "区間を1つ以上登録してください。" };
  }
  return {
    ok: true,
    state: {
      status: STATUS.RUNNING,
      currentIndex: 0,
      endTime: now + durationMs(schedule[0]),
      remainingMs: null,
    },
  };
}

/** 一時停止する。残りミリ秒を確定して保持する。running 以外では何もしない。 */
function pause(state, now) {
  if (state.status !== STATUS.RUNNING) return state;
  return {
    status: STATUS.PAUSED,
    currentIndex: state.currentIndex,
    endTime: null,
    remainingMs: Math.max(0, state.endTime - now),
  };
}

/** 再開する。保持した残りミリ秒から endTime を再計算する。paused 以外では何もしない。 */
function resume(state, now) {
  if (state.status !== STATUS.PAUSED) return state;
  return {
    status: STATUS.RUNNING,
    currentIndex: state.currentIndex,
    endTime: now + state.remainingMs,
    remainingMs: null,
  };
}

/** 先頭・初期値に戻す */
function reset() {
  return createRunState();
}

/**
 * 現在時刻に基づいて状態を進める。
 * 残りが0以下になった区間は次へ送り、後続が無ければ完了する。
 * 長時間のスリープ等で複数区間をまたいだ場合も endTime を積み上げて正しく繰り越す。
 * @returns {{state: RunState, events: Array<{type: string, ...}>}}
 */
function tick(state, schedule, now) {
  if (state.status !== STATUS.RUNNING) return { state, events: [] };

  const events = [];
  let currentIndex = state.currentIndex;
  let endTime = state.endTime;

  while (now >= endTime) {
    if (currentIndex + 1 < schedule.length) {
      const from = currentIndex;
      currentIndex += 1;
      endTime += durationMs(schedule[currentIndex]);
      events.push({
        type: "interval-change",
        fromIndex: from,
        toIndex: currentIndex,
        interval: schedule[currentIndex],
      });
    } else {
      events.push({ type: "complete" });
      return {
        state: {
          status: STATUS.COMPLETED,
          currentIndex,
          endTime: null,
          remainingMs: 0,
        },
        events,
      };
    }
  }

  return {
    state: { status: STATUS.RUNNING, currentIndex, endTime, remainingMs: null },
    events,
  };
}

/** 現在の残りミリ秒を求める（表示用） */
function remainingMsOf(state, schedule, now) {
  switch (state.status) {
    case STATUS.RUNNING:
      return Math.max(0, state.endTime - now);
    case STATUS.PAUSED:
      return state.remainingMs;
    case STATUS.COMPLETED:
      return 0;
    case STATUS.IDLE:
    default:
      return schedule && schedule.length > 0 ? durationMs(schedule[0]) : 0;
  }
}

/** 現在区間を返す（無ければ null） */
function currentIntervalOf(state, schedule) {
  if (!schedule || schedule.length === 0) return null;
  return schedule[state.currentIndex] || null;
}

// --- 表示整形 ---------------------------------------------------------------

/** ミリ秒を「MM:SS」に整形する。端数の秒は切り上げる。 */
function formatMmSs(ms) {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const TimerCore = {
  INTERVAL_TYPES,
  ALL_TYPES,
  STATUS,
  MS_PER_MINUTE,
  validateMinutes,
  validateType,
  createInterval,
  addInterval,
  removeInterval,
  moveInterval,
  durationMs,
  totalDurationMs,
  createRunState,
  start,
  pause,
  resume,
  reset,
  tick,
  remainingMsOf,
  currentIntervalOf,
  formatMmSs,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = TimerCore;
}
if (typeof window !== "undefined") {
  window.TimerCore = TimerCore;
}
