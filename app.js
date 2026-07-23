"use strict";

// Original Timer - UI 層
// 状態の保持と DOM 更新のみを担当し、判断ロジックは core.js の純粋関数に委ねる。

(() => {
  const C = window.TimerCore;
  const STORAGE_KEY = "original-timer.schedule.v1";
  const TICK_MS = 250;

  /** @type {Interval[]} */
  let schedule = [];
  let runState = C.createRunState();
  let intervalHandle = null;

  const el = {};

  // --- 永続化 (localStorage) ------------------------------------------------

  function loadSchedule() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // 保存値が壊れていても落ちないよう、妥当な区間だけを復元する
      return parsed
        .filter(
          (iv) =>
            iv &&
            C.validateType(iv.type).ok &&
            C.validateMinutes(iv.minutes).ok
        )
        .map((iv) => ({
          id: typeof iv.id === "string" ? iv.id : C.createInterval(iv.type, iv.minutes).value.id,
          type: iv.type,
          minutes: Number(iv.minutes),
        }));
    } catch (err) {
      // localStorage が使えない環境ではメモリ上の動作にフォールバックする
      return [];
    }
  }

  function saveSchedule() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(schedule));
    } catch (err) {
      // 保存失敗は機能低下のみ。実行は継続する。
    }
  }

  // --- 通知 (Web Audio 合成音) ----------------------------------------------

  let audioCtx = null;

  function playTone(frequency, durationSec) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === "suspended") audioCtx.resume();

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;

      const now = audioCtx.currentTime;
      // クリック音を避けるため、短いフェードイン/アウトを掛ける
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + durationSec + 0.02);
    } catch (err) {
      // 音が鳴らせなくても画面通知で用は足りるため無視する
    }
  }

  /** 区間切り替わり: 次が作業なら高め、休憩なら低めの音 */
  function playIntervalChangeSound(interval) {
    const isWork = interval && interval.type === C.INTERVAL_TYPES.WORK;
    playTone(isWork ? 880 : 587.33, 0.25);
  }

  /** 全完了: 上昇する2音 */
  function playCompleteSound() {
    playTone(659.25, 0.2);
    window.setTimeout(() => playTone(987.77, 0.35), 220);
  }

  // --- メッセージ表示 --------------------------------------------------------

  function showFormError(message) {
    el.formError.textContent = message;
    el.formError.hidden = false;
  }

  function clearFormError() {
    el.formError.textContent = "";
    el.formError.hidden = true;
  }

  function showRunnerMessage(message, kind) {
    el.runnerMessage.textContent = message;
    el.runnerMessage.className = `runner-message${kind ? ` is-${kind}` : ""}`;
    el.runnerMessage.hidden = false;
  }

  function clearRunnerMessage() {
    el.runnerMessage.textContent = "";
    el.runnerMessage.hidden = true;
  }

  // --- 描画 ------------------------------------------------------------------

  function renderList() {
    el.list.innerHTML = "";

    schedule.forEach((iv, index) => {
      const li = document.createElement("li");
      li.className = "interval-item";
      li.dataset.id = iv.id;
      if (runState.status !== C.STATUS.IDLE && index === runState.currentIndex) {
        li.classList.add("is-current");
      }

      const badge = document.createElement("span");
      badge.className = `type-badge ${iv.type === C.INTERVAL_TYPES.WORK ? "is-work" : "is-break"}`;
      badge.textContent = iv.type;

      const minutes = document.createElement("span");
      minutes.className = "interval-minutes";
      minutes.textContent = `${iv.minutes}分`;

      const actions = document.createElement("div");
      actions.className = "item-actions";
      actions.append(
        makeIconButton("↑", "上へ移動", () => handleMove(iv.id, -1), index === 0),
        makeIconButton("↓", "下へ移動", () => handleMove(iv.id, 1), index === schedule.length - 1),
        makeIconButton("×", "削除", () => handleRemove(iv.id), false)
      );

      li.append(badge, minutes, actions);
      el.list.append(li);
    });

    el.emptyHint.hidden = schedule.length > 0;

    if (schedule.length > 0) {
      const totalMinutes = C.totalDurationMs(schedule) / C.MS_PER_MINUTE;
      el.summary.textContent = `全${schedule.length}区間 / 合計${totalMinutes}分`;
    } else {
      el.summary.textContent = "";
    }
  }

  function makeIconButton(label, title, onClick, disabled) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-btn";
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.disabled = Boolean(disabled);
    btn.addEventListener("click", onClick);
    return btn;
  }

  function renderRunner(now) {
    const remaining = C.remainingMsOf(runState, schedule, now);
    el.remaining.textContent = C.formatMmSs(remaining);

    const current = C.currentIntervalOf(runState, schedule);

    if (runState.status === C.STATUS.COMPLETED) {
      el.currentType.textContent = "完了";
      el.currentType.className = "current-type is-done";
      el.progressLabel.textContent = "";
    } else if (runState.status === C.STATUS.IDLE) {
      el.currentType.textContent = schedule.length > 0 ? "待機中" : "区間未登録";
      el.currentType.className = "current-type";
      el.progressLabel.textContent =
        schedule.length > 0 ? `次: ${schedule[0].type} ${schedule[0].minutes}分` : "";
    } else if (current) {
      el.currentType.textContent =
        current.type + (runState.status === C.STATUS.PAUSED ? "（一時停止中）" : "");
      el.currentType.className = `current-type ${
        current.type === C.INTERVAL_TYPES.WORK ? "is-work" : "is-break"
      }`;
      el.progressLabel.textContent = `区間 ${runState.currentIndex + 1} / ${schedule.length}`;
    }

    el.btnStart.textContent = runState.status === C.STATUS.PAUSED ? "再開" : "開始";
    el.btnStart.disabled = runState.status === C.STATUS.RUNNING;
    el.btnPause.disabled = runState.status !== C.STATUS.RUNNING;
    el.btnReset.disabled = runState.status === C.STATUS.IDLE;

    // 実行中は編集を禁止して、リストと実行位置の食い違いを防ぐ
    const editingLocked =
      runState.status === C.STATUS.RUNNING || runState.status === C.STATUS.PAUSED;
    el.form.querySelectorAll("select, input, button").forEach((node) => {
      node.disabled = editingLocked;
    });
    el.list.querySelectorAll(".icon-btn").forEach((node) => {
      if (editingLocked) node.disabled = true;
    });
  }

  function renderAll(now) {
    renderList();
    renderRunner(now === undefined ? Date.now() : now);
  }

  // --- 計時ループ ------------------------------------------------------------

  function startLoop() {
    if (intervalHandle !== null) return;
    intervalHandle = window.setInterval(onTick, TICK_MS);
  }

  function stopLoop() {
    if (intervalHandle === null) return;
    window.clearInterval(intervalHandle);
    intervalHandle = null;
  }

  function onTick() {
    const now = Date.now();
    const result = C.tick(runState, schedule, now);
    const changed = result.state !== runState;
    runState = result.state;

    result.events.forEach((event) => {
      if (event.type === "interval-change") {
        showRunnerMessage(`${event.interval.type} ${event.interval.minutes}分 を開始しました`, "info");
        playIntervalChangeSound(event.interval);
      } else if (event.type === "complete") {
        showRunnerMessage("すべての区間が完了しました！お疲れさまでした。", "done");
        playCompleteSound();
      }
    });

    if (runState.status !== C.STATUS.RUNNING) stopLoop();

    // 区間が変わった時だけリスト全体を組み直し、通常は残り時間のみ更新する
    if (changed && result.events.length > 0) {
      renderAll(now);
    } else {
      renderRunner(now);
    }
  }

  // --- 操作ハンドラ ----------------------------------------------------------

  function handleAdd(event) {
    event.preventDefault();
    clearFormError();

    const result = C.createInterval(el.typeSelect.value, el.minutesInput.value);
    if (!result.ok) {
      showFormError(result.error);
      return;
    }

    schedule = C.addInterval(schedule, result.value);
    saveSchedule();
    renderAll();
  }

  function handleMove(id, delta) {
    schedule = C.moveInterval(schedule, id, delta);
    saveSchedule();
    renderAll();
  }

  function handleRemove(id) {
    schedule = C.removeInterval(schedule, id);
    saveSchedule();
    renderAll();
  }

  function handleStart() {
    clearRunnerMessage();

    if (runState.status === C.STATUS.PAUSED) {
      runState = C.resume(runState, Date.now());
      startLoop();
      renderAll();
      return;
    }

    const result = C.start(schedule, Date.now());
    if (!result.ok) {
      showRunnerMessage(result.error, "error");
      return;
    }

    runState = result.state;
    const first = C.currentIntervalOf(runState, schedule);
    showRunnerMessage(`${first.type} ${first.minutes}分 を開始しました`, "info");
    playIntervalChangeSound(first);
    startLoop();
    renderAll();
  }

  function handlePause() {
    runState = C.pause(runState, Date.now());
    stopLoop();
    showRunnerMessage("一時停止中です。", "info");
    renderAll();
  }

  function handleReset() {
    runState = C.reset();
    stopLoop();
    clearRunnerMessage();
    renderAll();
  }

  /** タブ復帰時は実時間から即座に再計算して表示のずれをなくす */
  function handleVisibilityChange() {
    if (!document.hidden && runState.status === C.STATUS.RUNNING) {
      onTick();
    }
  }

  // --- 初期化 ----------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", () => {
    el.form = document.getElementById("add-form");
    el.typeSelect = document.getElementById("type-select");
    el.minutesInput = document.getElementById("minutes-input");
    el.formError = document.getElementById("form-error");
    el.list = document.getElementById("interval-list");
    el.emptyHint = document.getElementById("empty-hint");
    el.summary = document.getElementById("schedule-summary");
    el.currentType = document.getElementById("current-type");
    el.remaining = document.getElementById("remaining");
    el.progressLabel = document.getElementById("progress-label");
    el.runnerMessage = document.getElementById("runner-message");
    el.btnStart = document.getElementById("btn-start");
    el.btnPause = document.getElementById("btn-pause");
    el.btnReset = document.getElementById("btn-reset");

    el.form.addEventListener("submit", handleAdd);
    el.btnStart.addEventListener("click", handleStart);
    el.btnPause.addEventListener("click", handlePause);
    el.btnReset.addEventListener("click", handleReset);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    schedule = loadSchedule();
    renderAll();
  });
})();
