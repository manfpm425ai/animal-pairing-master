/* 動物配對師 — UI, input, levels, scoring */
(function () {
  "use strict";

  var E = window.MatchEngine;
  var ART = window.AnimalArt.ANIMALS;
  var COLS = E.COLS;
  var ROWS = E.ROWS;
  var HINTS_PER_LEVEL = 3;
  var START_LIVES = 8;
  var STORAGE_MUTE = "animal-match-mute";
  var STORAGE_BEST = "animal-match-best";

  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var audio = new window.AudioBus();
  try {
    audio.setMuted(localStorage.getItem(STORAGE_MUTE) === "1");
  } catch (err) {}

  var els = {};
  var state = null;
  var tileEls = {}; // key "c,r" -> element, plus id map
  var tileId = 0;
  var animating = false;
  var rafTimer = null;
  var lastTs = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function keyOf(c, r) {
    return c + "," + r;
  }

  function loadBest() {
    try {
      return parseInt(localStorage.getItem(STORAGE_BEST) || "0", 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  function saveBest(score) {
    var best = Math.max(loadBest(), score);
    try {
      localStorage.setItem(STORAGE_BEST, String(best));
    } catch (e) {}
    return best;
  }

  function persistMute() {
    try {
      localStorage.setItem(STORAGE_MUTE, audio.muted ? "1" : "0");
    } catch (e) {}
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function newGameState(startLevel) {
    return {
      phase: "playing",
      level: startLevel || 1,
      lives: START_LIVES,
      score: 0,
      combo: 0,
      hintsLeft: HINTS_PER_LEVEL,
      board: null,
      selected: null,
      timeLeft: 0,
      timeLimit: 0,
      paused: false,
      matchIndex: 0,
      running: true,
      retryLevel: startLevel || 1
    };
  }

  function currentLevel() {
    return E.LEVELS[state.level - 1];
  }

  function layoutBoard() {
    var play = els.playfield;
    var hud = els.hud;
    if (!play || play.classList.contains("hidden")) return;
    var padX = 16;
    var padY = 16;
    var tile = 56;
    // HUD width depends on --tile and may wrap; iterate so board leaves room.
    for (var i = 0; i < 4; i++) {
      var hudH = hud.offsetHeight || 48;
      var availW = play.clientWidth - padX;
      var availH = play.clientHeight - hudH - padY - 8;
      if (availW < 80 || availH < 80) break;
      var next = Math.floor(Math.min(availW / COLS, availH / ROWS));
      next = Math.max(22, next);
      document.documentElement.style.setProperty("--tile", next + "px");
      if (next === tile) break;
      tile = next;
    }
    if (els.pathLayer) sizePathLayer();
  }

  function showScreen(id) {
    ["start-screen", "playfield"].forEach(function (s) {
      var n = $(s);
      if (!n) return;
      n.classList.toggle("hidden", s !== id);
    });
    hideBanner();
    hideConfirm();
    if (id === "playfield") {
      requestAnimationFrame(function () {
        layoutBoard();
        if (state && state.board) positionTiles(false);
      });
    }
  }

  function hideBanner() {
    els.banner.classList.add("hidden");
    els.banner.innerHTML = "";
  }

  function showBanner(html) {
    els.banner.innerHTML = html;
    els.banner.classList.remove("hidden");
  }

  function hideConfirm() {
    els.confirm.classList.add("hidden");
    els.confirm.innerHTML = "";
  }

  function wait(ms) {
    if (reducedMotion) ms = Math.min(ms, 40);
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function updateHud() {
    if (!state) return;
    els.hudLevel.textContent = "第" + state.level + "關";
    els.livesText.textContent = state.lives + "點生命";
    var frac = state.timeLimit > 0 ? Math.max(0, state.timeLeft / state.timeLimit) : 0;
    els.timerFill.style.transform = "scaleX(" + frac + ")";
    els.timerSec.textContent = formatTime(state.timeLeft);
    els.score.textContent = String(state.score);
    els.hintBtn.textContent = "新手提示";
    els.hintBtn.disabled = state.hintsLeft <= 0 || state.phase !== "playing" || state.paused;
    els.hintBtn.title = "剩餘 " + state.hintsLeft + " 次（快捷鍵 H）";
    els.muteBtn.textContent = audio.muted ? "取消靜音" : "靜音";
    els.muteBtn.setAttribute("aria-pressed", audio.muted ? "true" : "false");
    els.pauseBtn.textContent = state.paused ? "繼續" : "暫停";
  }

  function clearBoardDom() {
    els.board.innerHTML = "";
    tileEls = {};
  }

  function makeTileEl(type, c, r) {
    var art = ART[type];
    var el = document.createElement("button");
    el.type = "button";
    el.className = "tile entering";
    el.setAttribute("aria-label", art ? art.name : "動物");
    el.dataset.c = String(c);
    el.dataset.r = String(r);
    el.dataset.type = String(type);
    el.dataset.tid = String(++tileId);
    var face = document.createElement("div");
    face.className = "face";
    face.style.setProperty("--tile-bg", art ? art.bg : "#f6f2ea");
    face.style.background = art ? art.bg : "#f6f2ea";
    face.innerHTML = art ? art.svg : "";
    el.appendChild(face);
    el.addEventListener("click", onTileClick);
    el.addEventListener("animationend", function (ev) {
      if (ev.animationName === "popIn") el.classList.remove("entering");
      if (ev.animationName === "shake") el.classList.remove("shake");
    });
    return el;
  }

  function tileSize() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tile")) || 56;
  }

  function sizePathLayer() {
    var tile = tileSize();
    var w = tile * (COLS + 2);
    var h = tile * (ROWS + 2);
    els.pathLayer.setAttribute("viewBox", -tile + " " + -tile + " " + w + " " + h);
    els.pathLayer.style.left = -tile + "px";
    els.pathLayer.style.top = -tile + "px";
    els.pathLayer.style.width = w + "px";
    els.pathLayer.style.height = h + "px";
  }

  function inputLocked() {
    if (!state || state.phase !== "playing" || state.paused || animating) return true;
    if (els.banner && !els.banner.classList.contains("hidden")) return true;
    if (els.confirm && !els.confirm.classList.contains("hidden")) return true;
    return false;
  }

  function positionTiles(animate) {
    var tile = tileSize();
    var dur = animate && !reducedMotion ? "0.28s" : "0s";
    Object.keys(tileEls).forEach(function (k) {
      var el = tileEls[k];
      if (!el) return;
      el.style.transitionDuration = dur;
      var c = parseInt(el.dataset.c, 10);
      var r = parseInt(el.dataset.r, 10);
      el.style.transform = "translate(" + c * tile + "px," + r * tile + "px)";
    });
  }

  function renderBoard(board, withEnter) {
    clearBoardDom();
    var r, c, t, el;
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        t = board[r][c];
        if (t === null) continue;
        el = makeTileEl(t, c, r);
        if (!withEnter || reducedMotion) el.classList.remove("entering");
        els.board.appendChild(el);
        tileEls[keyOf(c, r)] = el;
      }
    }
    positionTiles(false);
    sizePathLayer();
  }

  function toast(text) {
    var n = document.createElement("div");
    n.className = "toast";
    n.textContent = text;
    els.boardShell.appendChild(n);
    setTimeout(function () {
      n.remove();
    }, reducedMotion ? 400 : 1500);
  }

  function comboPop(text, x, y) {
    var n = document.createElement("div");
    n.className = "combo-pop";
    n.textContent = text;
    if (typeof x === "number") {
      n.style.left = x + "px";
      n.style.top = y + "px";
      n.style.transform = "translate(-50%, -50%)";
    }
    els.boardShell.appendChild(n);
    setTimeout(function () {
      n.remove();
    }, reducedMotion ? 300 : 950);
  }

  function sparks(cx, cy, color) {
    if (reducedMotion) return;
    var i, s, ang, dist;
    for (i = 0; i < 8; i++) {
      s = document.createElement("div");
      s.className = "spark";
      ang = (Math.PI * 2 * i) / 8 + Math.random() * 0.3;
      dist = 18 + Math.random() * 22;
      s.style.left = cx - 3 + "px";
      s.style.top = cy - 3 + "px";
      s.style.background = color || "#ffe26a";
      s.style.setProperty("--dx", Math.cos(ang) * dist + "px");
      s.style.setProperty("--dy", Math.sin(ang) * dist + "px");
      els.particles.appendChild(s);
      (function (node) {
        setTimeout(function () {
          node.remove();
        }, 520);
      })(s);
    }
  }

  function tileCenter(el) {
    var tile = tileSize();
    var c = parseInt(el.dataset.c, 10);
    var r = parseInt(el.dataset.r, 10);
    return { x: (c + 0.5) * tile, y: (r + 0.5) * tile };
  }

  function drawPath(path) {
    var tile = tileSize();
    var pts = path
      .map(function (p) {
        return (p.c + 0.5) * tile + "," + (p.r + 0.5) * tile;
      })
      .join(" ");
    els.pathLine.setAttribute("points", pts);
    els.pathLayer.style.opacity = "1";
  }

  function clearPath() {
    els.pathLine.setAttribute("points", "");
    els.pathLayer.style.opacity = "0";
  }

  function deselect() {
    if (state.selected) {
      var el = tileEls[keyOf(state.selected.c, state.selected.r)];
      if (el) el.classList.remove("selected");
    }
    state.selected = null;
  }

  function shakeTile(el) {
    if (!el) return;
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
  }

  function clearHintMarks() {
    Object.keys(tileEls).forEach(function (k) {
      if (tileEls[k]) tileEls[k].classList.remove("hinted");
    });
  }

  function onTileClick(ev) {
    ev.preventDefault();
    if (inputLocked()) return;
    audio.unlock();
    var el = ev.currentTarget;
    var c = parseInt(el.dataset.c, 10);
    var r = parseInt(el.dataset.r, 10);
    if (state.board[r][c] === null) return;
    clearHintMarks();

    if (!state.selected) {
      state.selected = { c: c, r: r };
      el.classList.add("selected");
      audio.select();
      return;
    }

    if (state.selected.c === c && state.selected.r === r) {
      deselect();
      return;
    }

    var a = state.selected;
    var t1 = state.board[a.r][a.c];
    var t2 = state.board[r][c];
    var elA = tileEls[keyOf(a.c, a.r)];
    var elB = el;

    if (t1 !== t2) {
      audio.mismatch();
      shakeTile(elA);
      shakeTile(elB);
      deselect();
      elB.classList.remove("selected");
      return;
    }

    var path = E.findPath(state.board, a.c, a.r, c, r);
    if (!path) {
      audio.fail();
      shakeTile(elA);
      shakeTile(elB);
      deselect();
      loseLife("unconnectable");
      return;
    }

    resolveMatch(a, { c: c, r: r }, path, elA, elB);
  }

  function loseLife(reason) {
    state.lives -= 1;
    state.combo = 0;
    updateHud();
    if (reason === "timeout") audio.lifeLost();
    if (state.lives <= 0) {
      endGame(false);
      return true;
    }
    return false;
  }

  function resolveMatch(a, b, path, elA, elB) {
    animating = true;
    state.selected = null;
    if (elA) elA.classList.remove("selected");
    if (elB) elB.classList.remove("selected");

    drawPath(path);

    state.combo += 1;
    var base = 100;
    var speedFrac = state.timeLimit > 0 ? state.timeLeft / state.timeLimit : 0;
    var speedBonus = Math.round(40 * speedFrac);
    var comboMult = 1 + Math.min(state.combo - 1, 8) * 0.2;
    var gained = Math.round((base + speedBonus) * comboMult);
    state.score += gained;
    state.timeLeft = Math.min(state.timeLimit, state.timeLeft + 1.2 + Math.min(state.combo, 5) * 0.15);

    if (state.combo >= 2) {
      var mid = {
        x: (tileCenter(elA).x + tileCenter(elB).x) / 2,
        y: (tileCenter(elA).y + tileCenter(elB).y) / 2
      };
      comboPop("連擊 ×" + state.combo, mid.x, mid.y);
      audio.combo(state.combo);
    } else {
      audio.match();
    }

    var ca = tileCenter(elA);
    var cb = tileCenter(elB);
    var color = (ART[state.board[a.r][a.c]] || {}).bg || "#ffe26a";
    sparks(ca.x, ca.y, color);
    sparks(cb.x, cb.y, color);

    if (elA) elA.classList.add("popping");
    if (elB) elB.classList.add("popping");

    var popMs = reducedMotion ? 40 : 280;
    var pathMs = reducedMotion ? 40 : 180;

    wait(pathMs)
      .then(function () {
        clearPath();
        return wait(popMs - pathMs);
      })
      .then(function () {
        E.applyMatch(state.board, a.c, a.r, b.c, b.r);
        if (elA) elA.remove();
        if (elB) elB.remove();
        delete tileEls[keyOf(a.c, a.r)];
        delete tileEls[keyOf(b.c, b.r)];

        if (E.countTiles(state.board) === 0) {
          updateHud();
          animating = false;
          levelCleared();
          return;
        }

        var gName = E.resolveGravity(state.level, state.matchIndex);
        state.matchIndex += 1;
        applyGravityAnimated(gName);
      });
  }

  function applyGravityAnimated(gName) {
    var before = {};
    Object.keys(tileEls).forEach(function (k) {
      var el = tileEls[k];
      before[el.dataset.tid] = { c: parseInt(el.dataset.c, 10), r: parseInt(el.dataset.r, 10), el: el };
    });

    if (gName && gName !== "none") {
      E.applyGravityNamed(state.board, gName);
    }

    var afterMap = {};
    var r, c, t, el, k;
    var used = {};
    // Reassign tile elements to new cells of the same type, preferring same tid staying if type matches that cell... 
    // After gravity, types move as whole tiles. We should track identity through gravity.
    // Engine only stores type ids, not tile identity. Reconstruct by scanning and matching unused els of that type nearest to destination? 
    // Better: run gravity on a parallel identity board.

    // Since we already mutated state.board, we need a different approach if we didn't keep identity.
    // We'll map remaining elements by walking the new board and assigning leftover tiles of the same type
    // using a stable scan, after computing movement from a cloned pre-gravity board.
    // Actually we already applied gravity to state.board. Let's rebuild positions by type greedy nearest.

    var leftover = [];
    Object.keys(tileEls).forEach(function (key) {
      leftover.push(tileEls[key]);
    });

    var newEls = {};
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        t = state.board[r][c];
        if (t === null) continue;
        // find leftover tile of this type closest to (c,r) (from old pos)
        var best = -1;
        var bestD = Infinity;
        for (var i = 0; i < leftover.length; i++) {
          el = leftover[i];
          if (!el || parseInt(el.dataset.type, 10) !== t) continue;
          var oc = parseInt(el.dataset.c, 10);
          var or_ = parseInt(el.dataset.r, 10);
          var d = Math.abs(oc - c) + Math.abs(or_ - r);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        if (best < 0) continue;
        el = leftover[best];
        leftover[best] = null;
        el.dataset.c = String(c);
        el.dataset.r = String(r);
        el.setAttribute("aria-label", (ART[t] || {}).name || "動物");
        newEls[keyOf(c, r)] = el;
      }
    }
    tileEls = newEls;
    positionTiles(true);

    var slideMs = reducedMotion || !gName || gName === "none" ? 40 : 300;
    wait(slideMs).then(function () {
      maybeShuffleThenUnlock();
    });
  }

  function maybeShuffleThenUnlock() {
    if (!E.hasValidMove(state.board) && E.countTiles(state.board) > 0) {
      var rng = E.mulberry32((Date.now() ^ (state.score * 997)) >>> 0);
      var result = E.shuffleInPlace(state.board, rng, 100);
      if (result.failed) {
        // Extremely rare: still no move. Shuffle types randomly one last visual refresh.
        toast("洗牌");
      } else {
        toast("洗牌");
      }
      audio.shuffle();
      // Update existing tile faces in place (cells occupied stay, types redistributed)
      var r, c, t, el, art;
      for (r = 0; r < ROWS; r++) {
        for (c = 0; c < COLS; c++) {
          el = tileEls[keyOf(c, r)];
          t = state.board[r][c];
          if (!el || t === null) continue;
          art = ART[t];
          el.dataset.type = String(t);
          el.setAttribute("aria-label", art ? art.name : "動物");
          el.querySelector(".face").style.background = art ? art.bg : "#f6f2ea";
          el.querySelector(".face").innerHTML = art ? art.svg : "";
        }
      }
    }
    updateHud();
    animating = false;
  }

  function useHint() {
    if (inputLocked()) return;
    if (state.hintsLeft <= 0) return;
    var moves = E.findAllMoves(state.board);
    if (!moves.length) {
      toast("沒有可連的配對");
      return;
    }
    // Prefer a move that is not just adjacent if possible, else first.
    var move = moves[0];
    var i, m, segs;
    for (i = 0; i < moves.length; i++) {
      segs = moves[i].path.length - 1;
      if (segs >= 1) {
        move = moves[i];
        break;
      }
    }
    state.hintsLeft -= 1;
    state.timeLeft = Math.max(0, state.timeLeft - 3);
    var elA = tileEls[keyOf(move.a.c, move.a.r)];
    var elB = tileEls[keyOf(move.b.c, move.b.r)];
    if (elA) elA.classList.add("hinted");
    if (elB) elB.classList.add("hinted");
    audio.hint();
    updateHud();
    setTimeout(clearHintMarks, reducedMotion ? 600 : 2200);
  }

  function onFrame(ts) {
    rafTimer = requestAnimationFrame(onFrame);
    if (!state || !state.running) return;
    if (!lastTs) lastTs = ts;
    var dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (state.phase !== "playing" || state.paused || animating) return;
    if (els.banner && !els.banner.classList.contains("hidden")) return;
    if (els.confirm && !els.confirm.classList.contains("hidden")) return;

    state.timeLeft -= dt;
    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      updateHud();
      var dead = loseLife("timeout");
      if (!dead) {
        var refill = currentLevel().refill;
        state.timeLeft = Math.max(18, state.timeLimit * refill);
        toast("時間到，失去 1 點生命");
        updateHud();
      }
      return;
    }
    // Update timer every frame for smooth bar; text at ~4 Hz is fine but cheap enough.
    var frac = state.timeLimit > 0 ? Math.max(0, state.timeLeft / state.timeLimit) : 0;
    els.timerFill.style.transform = "scaleX(" + frac + ")";
    var shown = formatTime(state.timeLeft);
    if (els.timerSec.textContent !== shown) els.timerSec.textContent = shown;
  }

  function startTimerLoop() {
    if (rafTimer) cancelAnimationFrame(rafTimer);
    lastTs = 0;
    rafTimer = requestAnimationFrame(onFrame);
  }

  function beginLevel(level, keepScoreLives) {
    var lv = E.LEVELS[level - 1];
    if (!keepScoreLives) {
      /* score/lives already set */
    }
    state.level = level;
    state.phase = "playing";
    state.paused = false;
    state.hintsLeft = HINTS_PER_LEVEL;
    state.combo = 0;
    state.matchIndex = 0;
    state.selected = null;
    state.timeLimit = lv.time;
    state.timeLeft = lv.time;
    state.running = true;
    animating = false;
    clearPath();
    clearHintMarks();

    var rng = E.mulberry32((Date.now() ^ (level * 7919) ^ (state.score * 13)) >>> 0);
    var gen = E.generateBoard(lv.types, rng, 4);
    state.board = gen.board;

    showScreen("playfield");
    renderBoard(state.board, true);
    updateHud();
    layoutBoard();
    positionTiles(false);

    showBanner(
      "<h2>第" +
        level +
        "關　" +
        lv.name +
        "</h2><p>點兩隻相同動物，用最多三筆直線連起來就可消除</p>"
    );
    audio.levelStart();
    var intro = reducedMotion ? 400 : 1200;
    wait(intro).then(function () {
      if (!state || state.level !== level) return;
      hideBanner();
    });
  }

  function levelCleared() {
    state.phase = "clear";
    var leftover = Math.ceil(Math.max(0, state.timeLeft));
    var bonus = leftover * 10;
    state.score += bonus;
    updateHud();
    var isLast = state.level >= E.LEVELS.length;
    audio.levelClear();
    showBanner(
      "<h2>過關！</h2><p>剩餘時間獎勵　+" +
        bonus +
        "</p><p>目前分數　" +
        state.score +
        "</p>"
    );
    wait(reducedMotion ? 500 : 1800).then(function () {
      if (!state) return;
      hideBanner();
      if (isLast) {
        endGame(true);
      } else {
        beginLevel(state.level + 1, true);
      }
    });
  }

  function endGame(won) {
    state.phase = won ? "won" : "over";
    state.running = true; // keep loop but phase blocks timer
    state.paused = true;
    var best = saveBest(state.score);
    if (won) audio.win();
    else audio.gameOver();
    var title = won ? "全部通關！" : "遊戲結束";
    showBanner(
      '<div class="confirm-box">' +
        "<h2>" +
        title +
        "</h2>" +
        '<p class="result-sub">今局分數</p>' +
        '<div class="result-score">' +
        state.score +
        "</div>" +
        "<p>最佳成績　" +
        best +
        "</p>" +
        '<div class="btn-row">' +
        (won
          ? '<button type="button" class="btn" data-act="again">再玩一次</button>'
          : '<button type="button" class="btn" data-act="retry">從本關重試</button>' +
            '<button type="button" class="btn secondary" data-act="again">從第 1 關開始</button>') +
        '<button type="button" class="btn secondary" data-act="home">返回標題</button>' +
        "</div></div>"
    );
    els.banner.onclick = function (ev) {
      var btn = ev.target.closest("button[data-act]");
      if (!btn) return;
      var act = btn.getAttribute("data-act");
      els.banner.onclick = null;
      hideBanner();
      if (act === "home") {
        goHome();
      } else if (act === "retry") {
        startRun(state.level);
      } else {
        startRun(1);
      }
    };
  }

  function goHome() {
    state = null;
    animating = false;
    clearBoardDom();
    showScreen("start-screen");
    refreshStartBest();
  }

  function refreshStartBest() {
    var best = loadBest();
    var n = $("best-score");
    if (n) n.textContent = best > 0 ? "最佳成績　" + best : "";
  }

  function startRun(level) {
    audio.unlock();
    state = newGameState(level);
    showScreen("playfield");
    beginLevel(level, false);
  }

  function requestRestart() {
    if (!state) return;
    if (state.phase === "over" || state.phase === "won") {
      startRun(state.level === 0 ? 1 : state.phase === "won" ? 1 : state.level);
      return;
    }
    showConfirm(
      "要重新開始本關嗎？",
      "會用同一關規則重新洗牌，本關分數進度不會保留。",
      "重新開始",
      function () {
        var lv = state.level;
        var score = state.score; // keep total from previous cleared levels? 
        // Spec: restart the current level (same level rule, new shuffle).
        // Lives reset for the level restart feels fairer if we also reset score gained this level — we don't track that separately.
        // Keep lives and cumulative score, just rebuild the board and refill time.
        var lives = state.lives;
        var keptScore = state.score;
        beginLevel(lv, true);
        state.lives = lives;
        state.score = keptScore;
        updateHud();
      }
    );
  }

  function showConfirm(title, msg, okLabel, onOk) {
    els.confirm.classList.remove("hidden");
    els.confirm.innerHTML =
      '<div class="confirm-box"><h2>' +
      title +
      "</h2><p>" +
      msg +
      '</p><div class="btn-row">' +
      '<button type="button" class="btn" data-act="ok">' +
      okLabel +
      "</button>" +
      '<button type="button" class="btn secondary" data-act="cancel">取消</button>' +
      "</div></div>";
    els.confirm.onclick = function (ev) {
      var btn = ev.target.closest("button[data-act]");
      if (!btn) return;
      var act = btn.getAttribute("data-act");
      els.confirm.onclick = null;
      hideConfirm();
      if (act === "ok") onOk();
    };
  }

  function togglePause() {
    if (!state || (state.phase !== "playing" && state.phase !== "clear")) return;
    if (state.phase !== "playing") return;
    if (!els.confirm.classList.contains("hidden")) return;
    state.paused = !state.paused;
    updateHud();
    if (state.paused) {
      showBanner(
        '<div class="confirm-box"><h2>暫停</h2><p>第' +
          state.level +
          "關　" +
          currentLevel().name +
          '</p><div class="btn-row">' +
          '<button type="button" class="btn" data-act="resume">繼續遊戲</button>' +
          '<button type="button" class="btn secondary" data-act="home">返回標題</button>' +
          "</div></div>"
      );
      els.banner.onclick = function (ev) {
        var btn = ev.target.closest("button[data-act]");
        if (!btn) return;
        var act = btn.getAttribute("data-act");
        els.banner.onclick = null;
        hideBanner();
        if (act === "home") {
          goHome();
        } else {
          state.paused = false;
          updateHud();
        }
      };
    } else {
      hideBanner();
    }
  }

  function toggleMute() {
    audio.setMuted(!audio.muted);
    persistMute();
    updateHud();
    // also update start screen button if visible
    if (els.startMute) els.startMute.textContent = audio.muted ? "取消靜音" : "靜音";
  }

  function populateStartDeco() {
    var row = $("deco-row");
    if (!row) return;
    row.innerHTML = "";
    var picks = [0, 11, 8, 6, 14, 19, 17, 27];
    picks.forEach(function (i) {
      var a = ART[i];
      var d = document.createElement("div");
      d.className = "mini-tile";
      d.style.background = a.bg;
      d.innerHTML = a.svg;
      row.appendChild(d);
    });
  }

  function bind() {
    els.playfield = $("playfield");
    els.hud = $("hud");
    els.hudLevel = $("hud-level");
    els.livesText = $("lives-text");
    els.timerFill = $("timer-fill");
    els.timerSec = $("timer-sec");
    els.score = $("score");
    els.hintBtn = $("hint-btn");
    els.f5Btn = $("f5-btn");
    els.pauseBtn = $("pause-btn");
    els.muteBtn = $("mute-btn");
    els.boardShell = $("board-shell");
    els.board = $("board");
    els.pathLayer = $("path-layer");
    els.pathLine = $("path-line");
    els.particles = $("particles");
    els.banner = $("banner");
    els.confirm = $("confirm");
    els.startMute = $("start-mute");

    $("start-btn").addEventListener("click", function () {
      startRun(1);
    });
    els.hintBtn.addEventListener("click", function () {
      audio.unlock();
      useHint();
    });
    els.f5Btn.addEventListener("click", function () {
      audio.unlock();
      requestRestart();
    });
    els.pauseBtn.addEventListener("click", function () {
      audio.unlock();
      togglePause();
    });
    els.muteBtn.addEventListener("click", toggleMute);
    if (els.startMute) {
      els.startMute.textContent = audio.muted ? "取消靜音" : "靜音";
      els.startMute.addEventListener("click", toggleMute);
    }

    window.addEventListener(
      "keydown",
      function (e) {
        if (e.key === "F5" || ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && !e.altKey)) {
          var tag = (e.target && e.target.tagName) || "";
          if (tag === "INPUT" || tag === "TEXTAREA") return;
          e.preventDefault();
          if (state && !document.getElementById("playfield").classList.contains("hidden")) {
            requestRestart();
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          if (!els.confirm.classList.contains("hidden")) {
            hideConfirm();
            return;
          }
          togglePause();
          return;
        }
        if ((e.key === "h" || e.key === "H") && !e.ctrlKey && !e.metaKey) {
          var tag2 = (e.target && e.target.tagName) || "";
          if (tag2 === "INPUT" || tag2 === "TEXTAREA") return;
          useHint();
        }
      },
      true
    );

    window.addEventListener("resize", function () {
      layoutBoard();
      positionTiles(false);
    });
    window.addEventListener("orientationchange", function () {
      setTimeout(function () {
        layoutBoard();
        positionTiles(false);
      }, 80);
    });

    document.addEventListener(
      "visibilitychange",
      function () {
        if (document.hidden && state && state.phase === "playing" && !state.paused) {
          togglePause();
        }
      },
      false
    );
  }

  function init() {
    bind();
    populateStartDeco();
    refreshStartBest();
    showScreen("start-screen");
    startTimerLoop();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
