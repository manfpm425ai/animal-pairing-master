/**
 * 動物配對師 — game engine (DOM-free, Node + browser).
 * Classic Onet / 連連看: at most 3 axis-aligned segments (0–2 corners),
 * paths may travel through empty cells and a 1-cell virtual border.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MatchEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var COLS = 16;
  var ROWS = 9;
  var TOTAL = COLS * ROWS; // 144

  var LEVELS = [
    { id: 1, name: "靜止", gravity: "none", time: 200, types: 24, refill: 0.5 },
    { id: 2, name: "下落", gravity: "down", time: 180, types: 24, refill: 0.48 },
    { id: 3, name: "上升", gravity: "up", time: 170, types: 24, refill: 0.46 },
    { id: 4, name: "左移", gravity: "left", time: 160, types: 24, refill: 0.44 },
    { id: 5, name: "右移", gravity: "right", time: 150, types: 24, refill: 0.42 },
    { id: 6, name: "分向兩側", gravity: "splitH", time: 140, types: 36, refill: 0.4 },
    { id: 7, name: "向中靠攏", gravity: "centerH", time: 130, types: 36, refill: 0.38 },
    { id: 8, name: "上下分離", gravity: "splitV", time: 120, types: 36, refill: 0.36 },
    { id: 9, name: "四面聚集", gravity: "centerBoth", time: 100, types: 36, refill: 0.34 },
    { id: 10, name: "終極挑戰", gravity: "cycle", time: 85, types: 36, refill: 0.3 }
  ];

  var CYCLE_GRAVITY = ["down", "left", "up", "right", "splitH", "centerH", "splitV", "centerBoth"];

  function createBoard(fill) {
    var board = [];
    for (var r = 0; r < ROWS; r++) {
      board[r] = [];
      for (var c = 0; c < COLS; c++) board[r][c] = fill === undefined ? null : fill;
    }
    return board;
  }

  function cloneBoard(board) {
    return board.map(function (row) {
      return row.slice();
    });
  }

  function inGrid(c, r) {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS;
  }

  function isEmpty(board, c, r) {
    if (c < -1 || c > COLS || r < -1 || r > ROWS) return false;
    if (c === -1 || c === COLS || r === -1 || r === ROWS) return true;
    return board[r][c] === null;
  }

  /**
   * Cells strictly between two axis-aligned points must be empty.
   * Endpoints are not checked (they may be the occupied tiles).
   */
  function lineClear(board, c1, r1, c2, r2) {
    if (c1 !== c2 && r1 !== r2) return false;
    if (c1 === c2 && r1 === r2) return true;
    if (c1 === c2) {
      var minR = Math.min(r1, r2);
      var maxR = Math.max(r1, r2);
      for (var r = minR + 1; r < maxR; r++) {
        if (!isEmpty(board, c1, r)) return false;
      }
      return true;
    }
    var minC = Math.min(c1, c2);
    var maxC = Math.max(c1, c2);
    for (var c = minC + 1; c < maxC; c++) {
      if (!isEmpty(board, c, r1)) return false;
    }
    return true;
  }

  function pt(c, r) {
    return { c: c, r: r };
  }

  /**
   * Returns an array of points (including both tiles) or null.
   * The two tiles must already be known to exist; this only checks geometry.
   * The start/end cells are allowed to be occupied.
   */
  function findPath(board, c1, r1, c2, r2) {
    if (c1 === c2 && r1 === r2) return null;
    if (!inGrid(c1, r1) || !inGrid(c2, r2)) return null;

    // 0 turns
    if (lineClear(board, c1, r1, c2, r2)) {
      return [pt(c1, r1), pt(c2, r2)];
    }

    // 1 turn
    var corners = [pt(c1, r2), pt(c2, r1)];
    for (var i = 0; i < corners.length; i++) {
      var k = corners[i];
      if ((k.c === c1 && k.r === r1) || (k.c === c2 && k.r === r2)) continue;
      if (isEmpty(board, k.c, k.r) && lineClear(board, c1, r1, k.c, k.r) && lineClear(board, k.c, k.r, c2, r2)) {
        return [pt(c1, r1), k, pt(c2, r2)];
      }
    }

    // 2 turns: horizontal first from A, then vertical, then horizontal to B
    var c, r, mid;
    for (c = -1; c <= COLS; c++) {
      if (c === c1) continue;
      if (!isEmpty(board, c, r1) || !lineClear(board, c1, r1, c, r1)) continue;
      mid = pt(c, r2);
      if (isEmpty(board, mid.c, mid.r) && lineClear(board, c, r1, mid.c, mid.r) && lineClear(board, mid.c, mid.r, c2, r2)) {
        return [pt(c1, r1), pt(c, r1), mid, pt(c2, r2)];
      }
    }
    // vertical first from A, then horizontal, then vertical to B
    for (r = -1; r <= ROWS; r++) {
      if (r === r1) continue;
      if (!isEmpty(board, c1, r) || !lineClear(board, c1, r1, c1, r)) continue;
      mid = pt(c2, r);
      if (isEmpty(board, mid.c, mid.r) && lineClear(board, c1, r, mid.c, mid.r) && lineClear(board, mid.c, mid.r, c2, r2)) {
        return [pt(c1, r1), pt(c1, r), mid, pt(c2, r2)];
      }
    }

    return null;
  }

  function canClear(board, c1, r1, c2, r2) {
    if (!inGrid(c1, r1) || !inGrid(c2, r2)) return null;
    var a = board[r1][c1];
    var b = board[r2][c2];
    if (a === null || b === null || a !== b) return null;
    return findPath(board, c1, r1, c2, r2);
  }

  function findAllMoves(board) {
    var positions = {};
    var r, c, type, list, i, j, path, moves;
    moves = [];
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        type = board[r][c];
        if (type === null) continue;
        if (!positions[type]) positions[type] = [];
        positions[type].push({ c: c, r: r });
      }
    }
    var types = Object.keys(positions);
    for (var t = 0; t < types.length; t++) {
      list = positions[types[t]];
      for (i = 0; i < list.length; i++) {
        for (j = i + 1; j < list.length; j++) {
          path = findPath(board, list[i].c, list[i].r, list[j].c, list[j].r);
          if (path) {
            moves.push({ a: list[i], b: list[j], path: path, type: Number(types[t]) });
          }
        }
      }
    }
    return moves;
  }

  function hasValidMove(board) {
    return findAllMoves(board).length > 0;
  }

  function countTiles(board) {
    var n = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) if (board[r][c] !== null) n++;
    }
    return n;
  }

  function remainingTypesEven(board) {
    var counts = {};
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var t = board[r][c];
        if (t === null) continue;
        counts[t] = (counts[t] || 0) + 1;
      }
    }
    var keys = Object.keys(counts);
    for (var i = 0; i < keys.length; i++) {
      if (counts[keys[i]] % 2 !== 0) return false;
    }
    return true;
  }

  function applyGravityNamed(board, name) {
    switch (name) {
      case "down":
        return gravityDown(board);
      case "up":
        return gravityUp(board);
      case "left":
        return gravityLeft(board);
      case "right":
        return gravityRight(board);
      case "splitH":
        return gravitySplitH(board);
      case "centerH":
        return gravityCenterH(board);
      case "splitV":
        return gravitySplitV(board);
      case "centerBoth":
        return gravityCenterBoth(board);
      case "none":
      default:
        return board;
    }
  }

  function resolveGravity(level, matchIndex) {
    var g = LEVELS[level - 1].gravity;
    if (g === "cycle") return CYCLE_GRAVITY[matchIndex % CYCLE_GRAVITY.length];
    return g;
  }

  function gravityDown(board) {
    for (var c = 0; c < COLS; c++) {
      var write = ROWS - 1;
      for (var r = ROWS - 1; r >= 0; r--) {
        if (board[r][c] !== null) {
          var t = board[r][c];
          board[r][c] = null;
          board[write][c] = t;
          write--;
        }
      }
    }
    return board;
  }

  function gravityUp(board) {
    for (var c = 0; c < COLS; c++) {
      var write = 0;
      for (var r = 0; r < ROWS; r++) {
        if (board[r][c] !== null) {
          var t = board[r][c];
          board[r][c] = null;
          board[write][c] = t;
          write++;
        }
      }
    }
    return board;
  }

  function gravityLeft(board) {
    for (var r = 0; r < ROWS; r++) {
      var write = 0;
      for (var c = 0; c < COLS; c++) {
        if (board[r][c] !== null) {
          var t = board[r][c];
          board[r][c] = null;
          board[r][write] = t;
          write++;
        }
      }
    }
    return board;
  }

  function gravityRight(board) {
    for (var r = 0; r < ROWS; r++) {
      var write = COLS - 1;
      for (var c = COLS - 1; c >= 0; c--) {
        if (board[r][c] !== null) {
          var t = board[r][c];
          board[r][c] = null;
          board[r][write] = t;
          write--;
        }
      }
    }
    return board;
  }

  function gravitySplitH(board) {
    var mid = COLS / 2;
    for (var r = 0; r < ROWS; r++) {
      var write = 0;
      var c, t;
      for (c = 0; c < mid; c++) {
        if (board[r][c] !== null) {
          t = board[r][c];
          board[r][c] = null;
          board[r][write] = t;
          write++;
        }
      }
      write = COLS - 1;
      for (c = COLS - 1; c >= mid; c--) {
        if (board[r][c] !== null) {
          t = board[r][c];
          board[r][c] = null;
          board[r][write] = t;
          write--;
        }
      }
    }
    return board;
  }

  function gravityCenterH(board) {
    var mid = COLS / 2;
    for (var r = 0; r < ROWS; r++) {
      var write = mid - 1;
      var c, t;
      for (c = mid - 1; c >= 0; c--) {
        if (board[r][c] !== null) {
          t = board[r][c];
          board[r][c] = null;
          board[r][write] = t;
          write--;
        }
      }
      write = mid;
      for (c = mid; c < COLS; c++) {
        if (board[r][c] !== null) {
          t = board[r][c];
          board[r][c] = null;
          board[r][write] = t;
          write++;
        }
      }
    }
    return board;
  }

  function gravitySplitV(board) {
    var mid = Math.floor(ROWS / 2);
    for (var c = 0; c < COLS; c++) {
      var write = 0;
      var r, t;
      for (r = 0; r < mid; r++) {
        if (board[r][c] !== null) {
          t = board[r][c];
          board[r][c] = null;
          board[write][c] = t;
          write++;
        }
      }
      write = ROWS - 1;
      for (r = ROWS - 1; r >= mid; r--) {
        if (board[r][c] !== null) {
          t = board[r][c];
          board[r][c] = null;
          board[write][c] = t;
          write--;
        }
      }
    }
    return board;
  }

  function packAround(count, span, center) {
    var start = Math.round(center - (count - 1) / 2);
    if (start < 0) start = 0;
    if (start + count > span) start = Math.max(0, span - count);
    return start;
  }

  function gravityCenterBoth(board) {
    var midR = (ROWS - 1) / 2;
    var midC = (COLS - 1) / 2;
    var c, r, tiles, i, start, t;
    for (c = 0; c < COLS; c++) {
      tiles = [];
      for (r = 0; r < ROWS; r++) {
        if (board[r][c] !== null) tiles.push(board[r][c]);
      }
      for (r = 0; r < ROWS; r++) board[r][c] = null;
      start = packAround(tiles.length, ROWS, midR);
      for (i = 0; i < tiles.length; i++) board[start + i][c] = tiles[i];
    }
    for (r = 0; r < ROWS; r++) {
      tiles = [];
      for (c = 0; c < COLS; c++) {
        if (board[r][c] !== null) tiles.push(board[r][c]);
      }
      for (c = 0; c < COLS; c++) board[r][c] = null;
      start = packAround(tiles.length, COLS, midC);
      for (i = 0; i < tiles.length; i++) board[r][start + i] = tiles[i];
    }
    return board;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffleArray(arr, rng) {
    var i, j, tmp;
    for (i = arr.length - 1; i > 0; i--) {
      j = Math.floor(rng() * (i + 1));
      tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * Redistribute types among currently occupied cells until a move exists.
   * Returns { board, shuffled: boolean, attempts }.
   */
  function shuffleInPlace(board, rng, maxAttempts) {
    maxAttempts = maxAttempts || 80;
    if (countTiles(board) < 2) return { board: board, shuffled: false, attempts: 0 };
    if (hasValidMove(board)) return { board: board, shuffled: false, attempts: 0 };

    var cells = [];
    var types = [];
    var r, c, k;
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        if (board[r][c] !== null) {
          cells.push({ c: c, r: r });
          types.push(board[r][c]);
        }
      }
    }

    for (k = 0; k < maxAttempts; k++) {
      shuffleArray(types, rng);
      for (var i = 0; i < cells.length; i++) {
        board[cells[i].r][cells[i].c] = types[i];
      }
      if (hasValidMove(board)) return { board: board, shuffled: true, attempts: k + 1 };
    }
    return { board: board, shuffled: true, attempts: maxAttempts, failed: !hasValidMove(board) };
  }

  function buildTypeList(typeCount) {
    if (typeCount < 1) typeCount = 1;
    if (TOTAL % 2 !== 0) throw new Error("Board must have even tile count");
    var pairs = TOTAL / 2; // 72
    var list = [];
    // Spread types as evenly as possible, always even counts.
    var base = Math.floor(pairs / typeCount) * 2; // tiles per type, even
    if (base < 2) {
      typeCount = pairs; // one pair each
      base = 2;
    }
    var used = 0;
    var t, n;
    for (t = 0; t < typeCount; t++) {
      n = base;
      for (var i = 0; i < n; i++) list.push(t);
      used += n;
    }
    // leftover tiles (even) go as extra pairs on early types
    var leftover = TOTAL - used;
    t = 0;
    while (leftover >= 2) {
      list.push(t);
      list.push(t);
      leftover -= 2;
      t = (t + 1) % typeCount;
    }
    return list;
  }

  function generateBoard(typeCount, rng, minMoves) {
    minMoves = minMoves === undefined ? 4 : minMoves;
    var types, board, r, c, i, moves, attempt;
    var maxAttempts = 60;
    for (attempt = 0; attempt < maxAttempts; attempt++) {
      types = buildTypeList(typeCount);
      shuffleArray(types, rng);
      board = createBoard(null);
      i = 0;
      for (r = 0; r < ROWS; r++) {
        for (c = 0; c < COLS; c++) {
          board[r][c] = types[i++];
        }
      }
      moves = findAllMoves(board);
      if (moves.length >= minMoves && remainingTypesEven(board)) {
        return { board: board, moves: moves.length, attempts: attempt + 1 };
      }
    }
    // Fallback: accept whatever we have if it has at least 1 move (or shuffle).
    var repaired = shuffleInPlace(board, rng, 80);
    return { board: repaired.board, moves: findAllMoves(repaired.board).length, attempts: maxAttempts, fallback: true };
  }

  function applyMatch(board, c1, r1, c2, r2) {
    board[r1][c1] = null;
    board[r2][c2] = null;
    return board;
  }

  return {
    COLS: COLS,
    ROWS: ROWS,
    TOTAL: TOTAL,
    LEVELS: LEVELS,
    CYCLE_GRAVITY: CYCLE_GRAVITY,
    createBoard: createBoard,
    cloneBoard: cloneBoard,
    inGrid: inGrid,
    isEmpty: isEmpty,
    lineClear: lineClear,
    findPath: findPath,
    canClear: canClear,
    findAllMoves: findAllMoves,
    hasValidMove: hasValidMove,
    countTiles: countTiles,
    remainingTypesEven: remainingTypesEven,
    applyGravityNamed: applyGravityNamed,
    resolveGravity: resolveGravity,
    gravityDown: gravityDown,
    gravityUp: gravityUp,
    gravityLeft: gravityLeft,
    gravityRight: gravityRight,
    gravitySplitH: gravitySplitH,
    gravityCenterH: gravityCenterH,
    gravitySplitV: gravitySplitV,
    gravityCenterBoth: gravityCenterBoth,
    mulberry32: mulberry32,
    shuffleArray: shuffleArray,
    shuffleInPlace: shuffleInPlace,
    buildTypeList: buildTypeList,
    generateBoard: generateBoard,
    applyMatch: applyMatch
  };
});
