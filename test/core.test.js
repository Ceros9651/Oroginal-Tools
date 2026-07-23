"use strict";

// spec のシナリオを core.js の純粋関数に対して検証する。
// 依存なしで実行: node test/core.test.js

const assert = require("node:assert/strict");
const C = require("../core.js");

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
  }
}

const WORK = C.INTERVAL_TYPES.WORK;
const BREAK = C.INTERVAL_TYPES.BREAK;
const MIN = C.MS_PER_MINUTE;

/** テスト用に区間を作る（生成が失敗したら即座に落とす） */
function iv(type, minutes) {
  const r = C.createInterval(type, minutes);
  assert.equal(r.ok, true, `区間の生成に失敗: ${type} ${minutes}`);
  return r.value;
}

// === spec: interval-schedule ===============================================

// Requirement: 区間の種類
test("[schedule] 作業区間を作成する", () => {
  const r = C.createInterval(WORK, 25);
  assert.equal(r.ok, true);
  assert.equal(r.value.type, "作業");
  assert.equal(r.value.minutes, 25);
});

test("[schedule] 休憩区間を作成する", () => {
  const r = C.createInterval(BREAK, 5);
  assert.equal(r.ok, true);
  assert.equal(r.value.type, "休憩");
});

test("[schedule] 作業・休憩以外の種類は生成できない", () => {
  for (const bad of ["昼寝", "work", "", null, undefined, 1]) {
    assert.equal(C.createInterval(bad, 10).ok, false, `拒否されるべき: ${String(bad)}`);
  }
});

// Requirement: 区間の時間指定
test("[schedule] 有効な分数を指定する", () => {
  const r = C.validateMinutes(25);
  assert.equal(r.ok, true);
  assert.equal(r.value, 25);
  assert.equal(C.validateMinutes("25").value, 25); // 文字列入力も受け付ける
  assert.equal(C.validateMinutes(1).ok, true); // 下限
});

test("[schedule] 0・負数・非整数の分数を拒否する", () => {
  for (const bad of [0, -1, -30, 1.5, 0.9, "abc", "", NaN, Infinity, null]) {
    assert.equal(C.validateMinutes(bad).ok, false, `拒否されるべき: ${String(bad)}`);
  }
});

// Requirement: 区間リストの自由な構成
test("[schedule] 好きな順番・回数で登録すると順番が保たれる", () => {
  let s = [];
  s = C.addInterval(s, iv(WORK, 50));
  s = C.addInterval(s, iv(BREAK, 10));
  s = C.addInterval(s, iv(WORK, 25));
  s = C.addInterval(s, iv(BREAK, 5));
  assert.deepEqual(
    s.map((x) => `${x.type}${x.minutes}`),
    ["作業50", "休憩10", "作業25", "休憩5"]
  );
});

test("[schedule] 連続した同種の区間を制約なく登録できる", () => {
  let s = [];
  s = C.addInterval(s, iv(WORK, 25));
  s = C.addInterval(s, iv(WORK, 25));
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => x.type), ["作業", "作業"]);
});

// Requirement: 区間の並べ替えと削除
test("[schedule] 区間を並べ替える", () => {
  const a = iv(WORK, 25);
  const b = iv(BREAK, 5);
  const c = iv(WORK, 50);
  const s = [a, b, c];

  const down = C.moveInterval(s, a.id, 1);
  assert.deepEqual(down.map((x) => x.id), [b.id, a.id, c.id]);

  const up = C.moveInterval(s, c.id, -1);
  assert.deepEqual(up.map((x) => x.id), [a.id, c.id, b.id]);

  // 端を超える移動は並びを変えない
  assert.deepEqual(C.moveInterval(s, a.id, -1).map((x) => x.id), [a.id, b.id, c.id]);
  assert.deepEqual(C.moveInterval(s, c.id, 1).map((x) => x.id), [a.id, b.id, c.id]);

  // 元の配列は変更されない
  assert.deepEqual(s.map((x) => x.id), [a.id, b.id, c.id]);
});

test("[schedule] 区間を削除しても残りの順番が維持される", () => {
  const a = iv(WORK, 25);
  const b = iv(BREAK, 5);
  const c = iv(WORK, 50);
  const s = C.removeInterval([a, b, c], b.id);
  assert.deepEqual(s.map((x) => x.id), [a.id, c.id]);
});

// Requirement: 空リストの実行防止
test("[schedule] 空リストではタイマーを開始できない", () => {
  const r = C.start([], 0);
  assert.equal(r.ok, false);
  assert.match(r.error, /区間を1つ以上/);
});

// === spec: countdown-timer =================================================

// Requirement: カウントダウン実行
test("[timer] 開始すると先頭区間からカウントダウンする", () => {
  const s = [iv(WORK, 25), iv(BREAK, 5)];
  const r = C.start(s, 1000);
  assert.equal(r.ok, true);
  assert.equal(r.state.status, C.STATUS.RUNNING);
  assert.equal(r.state.currentIndex, 0);
  assert.equal(r.state.endTime, 1000 + 25 * MIN);
  assert.equal(C.remainingMsOf(r.state, s, 1000), 25 * MIN);
  assert.equal(C.currentIntervalOf(r.state, s).type, "作業");
});

test("[timer] 残り時間が分：秒で表示される", () => {
  assert.equal(C.formatMmSs(25 * MIN), "25:00");
  assert.equal(C.formatMmSs(0), "00:00");
  assert.equal(C.formatMmSs(1), "00:01"); // 端数は切り上げ
  assert.equal(C.formatMmSs(59_000), "00:59");
  assert.equal(C.formatMmSs(60_000), "01:00");
  assert.equal(C.formatMmSs(-5000), "00:00"); // 負値は0扱い
});

// Requirement: 区間の自動遷移
test("[timer] 区間0で次の区間へ自動遷移し通知イベントを出す", () => {
  const s = [iv(WORK, 25), iv(BREAK, 5)];
  let state = C.start(s, 0).state;

  // まだ途中
  let r = C.tick(state, s, 10 * MIN);
  assert.equal(r.events.length, 0);
  assert.equal(r.state.currentIndex, 0);

  // 25分到達 -> 次へ
  r = C.tick(r.state, s, 25 * MIN);
  assert.equal(r.state.currentIndex, 1);
  assert.equal(r.state.status, C.STATUS.RUNNING);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].type, "interval-change");
  assert.equal(r.events[0].interval.type, "休憩");
  assert.equal(C.remainingMsOf(r.state, s, 25 * MIN), 5 * MIN);
});

// Requirement: 全区間の完了
test("[timer] 最後の区間が0になると完了する", () => {
  const s = [iv(WORK, 25), iv(BREAK, 5)];
  let state = C.start(s, 0).state;
  state = C.tick(state, s, 25 * MIN).state;
  const r = C.tick(state, s, 30 * MIN);
  assert.equal(r.state.status, C.STATUS.COMPLETED);
  assert.equal(C.remainingMsOf(r.state, s, 30 * MIN), 0);
  assert.deepEqual(r.events.map((e) => e.type), ["complete"]);
});

test("[timer] 完了後はtickしても状態が変わらない", () => {
  const s = [iv(WORK, 1)];
  let state = C.start(s, 0).state;
  state = C.tick(state, s, 1 * MIN).state;
  const r = C.tick(state, s, 99 * MIN);
  assert.equal(r.state.status, C.STATUS.COMPLETED);
  assert.equal(r.events.length, 0);
});

// Requirement: タイマーの操作
test("[timer] 一時停止で残り時間が保持される", () => {
  const s = [iv(WORK, 25)];
  const state = C.start(s, 0).state;
  const paused = C.pause(state, 10 * MIN);
  assert.equal(paused.status, C.STATUS.PAUSED);
  assert.equal(paused.remainingMs, 15 * MIN);
  assert.equal(paused.currentIndex, 0);
  // 一時停止中は時間が進んでも残りが減らない
  assert.equal(C.remainingMsOf(paused, s, 99 * MIN), 15 * MIN);
  // 一時停止中は tick しても進まない
  assert.equal(C.tick(paused, s, 99 * MIN).state.status, C.STATUS.PAUSED);
});

test("[timer] 再開すると保持した残り時間から続く", () => {
  const s = [iv(WORK, 25)];
  let state = C.start(s, 0).state;
  state = C.pause(state, 10 * MIN);
  const resumed = C.resume(state, 100 * MIN); // 90分放置してから再開
  assert.equal(resumed.status, C.STATUS.RUNNING);
  assert.equal(C.remainingMsOf(resumed, s, 100 * MIN), 15 * MIN);
  assert.equal(resumed.endTime, 115 * MIN);
});

test("[timer] リセットで先頭・初期値に戻る", () => {
  const s = [iv(WORK, 25), iv(BREAK, 5)];
  let state = C.start(s, 0).state;
  state = C.tick(state, s, 25 * MIN).state; // 2区間目まで進める
  assert.equal(state.currentIndex, 1);

  const reset = C.reset();
  assert.equal(reset.status, C.STATUS.IDLE);
  assert.equal(reset.currentIndex, 0);
  assert.equal(C.remainingMsOf(reset, s, 999 * MIN), 25 * MIN); // 先頭区間の初期値
});

test("[timer] 不正な遷移は無視される", () => {
  const idle = C.createRunState();
  assert.equal(C.pause(idle, 0).status, C.STATUS.IDLE); // idle は一時停止できない
  assert.equal(C.resume(idle, 0).status, C.STATUS.IDLE); // idle は再開できない
  const running = C.start([iv(WORK, 5)], 0).state;
  assert.equal(C.resume(running, 0).status, C.STATUS.RUNNING); // running は再開対象外
});

// Requirement: 計時の正確性（design の drift 対策）
test("[timer] 長時間スリープしても複数区間を正しく繰り越す", () => {
  const s = [iv(WORK, 25), iv(BREAK, 5), iv(WORK, 25), iv(BREAK, 5)];
  const state = C.start(s, 0).state;

  // 32分後に復帰: 1->2区間目(25分)->3区間目(30分)を越えて3区間目の途中
  const r = C.tick(state, s, 32 * MIN);
  assert.equal(r.state.currentIndex, 2);
  assert.equal(r.state.status, C.STATUS.RUNNING);
  assert.deepEqual(r.events.map((e) => e.toIndex), [1, 2]);
  // 3区間目は30分開始なので、32分時点の残りは23分
  assert.equal(C.remainingMsOf(r.state, s, 32 * MIN), 23 * MIN);
});

test("[timer] 全区間を越えて放置した場合は完了になる", () => {
  const s = [iv(WORK, 25), iv(BREAK, 5)];
  const state = C.start(s, 0).state;
  const r = C.tick(state, s, 500 * MIN);
  assert.equal(r.state.status, C.STATUS.COMPLETED);
  assert.equal(r.events.at(-1).type, "complete");
});

test("[timer] 終了時刻ベースなので刻み方に依らず残りが一致する", () => {
  const s = [iv(WORK, 10)];
  const state = C.start(s, 0).state;
  // 何度 tick しても、残りは実時間からのみ決まる
  let a = state;
  for (let t = 0; t <= 9 * MIN; t += 250) a = C.tick(a, s, t).state;
  assert.equal(C.remainingMsOf(a, s, 9 * MIN), 1 * MIN);
  const b = C.tick(state, s, 9 * MIN).state; // 一度も刻まずに飛ばした場合
  assert.equal(C.remainingMsOf(b, s, 9 * MIN), 1 * MIN);
});

// === 結果出力 ===============================================================

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ok" : "FAIL"}  ${r.name}${r.ok ? "" : `\n        ${r.error}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
