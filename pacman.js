/* =========================================================
   肥美将军 · 吃豆人（FZR_PAC）—— Persona5 风格，全部程序化绘制，不引用任何外部资源。
   对外接口：window.FZR_GAME = { init, start, pause, destroy }
   画布内部固定 760x860：19x21 格（每格 40px = 760x840）+ 底部 20px 状态条
   ========================================================= */
window.FZR_GAME = (function () {
  'use strict';

  /* ---------- 1. 常量 / 配色 ---------- */
  var COLS = 19, ROWS = 21, TS = 40;
  var PW = COLS * TS, PH = ROWS * TS;          // 760 x 840 游戏区
  var CW = 760, CH = 860;                      // 画布内部尺寸（不修改 canvas 尺寸）
  var HUD_Y = 806;                             // 游戏区内的 HUD 覆盖带（压在底部墙排上）
  var FLOOR = '#07070a', RED = '#e01228', RED_HI = '#ff2b45', PAPER = '#f6f3ee';
  var OUTLINE = '#0b0b0f';
  var GCOL = ['#e01228', '#f2a20c', '#22c2d6', '#f0629b'];
  var FACE = '#e8c49a', CAP_CROWN = '#46502f', CAP_BAND = '#5d5a3c', CAP_VISOR = '#2f3524';
  var FRIGHT_COL = '#2b3fa8';
  var SPD_PLAYER = 6.4, SPD_GHOST = 5.6, SPD_FRIGHT = 3.6, SPD_EYES = 11.0, SPD_HOUSE = 4.2;
  var FRIGHT_TIME = 7, BLINK_TIME = 2;
  var READY_TIME = 1.6, DEATH_TIME = 1.2, CLEAR_TIME = 2.0, MOUTH_STEP = 0.09;
  var SPEED_STEP = 1.06, START_LIVES = 3;
  var HIT_R = 24;                              // 碰撞半径（像素 ≈ 0.6 格）

  /* =========================================================
     2. 迷宫（19 列 x 21 行）
        # 墙  . 豆子  o 能量豆  ' ' 空地  - 鬼屋门  P 出生点  G 幽灵出生点
     ========================================================= */
  var MAZE = [
    '###################',
    '#........#........#',
    '#o##.###.#.###.##o#',
    '#.................#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '####.### # ###.####',
    '   #.#   G   #.#   ',
    '####.# ##-## #.####',
    '    .  #GGG#  .    ',
    '####.# ##### #.####',
    '   #.#       #.#   ',
    '####.# ##### #.####',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o.#.....P.....#.o#',
    '##.#.#.#####.#.#.##',
    '#....#...#...#....#',
    '#.######.#.######.#',
    '#.................#',
    '###################'
  ];

  /* 方向常量（单例，便于用 === 比较） */
  var D_U = { x: 0, y: -1 }, D_D = { x: 0, y: 1 }, D_L = { x: -1, y: 0 }, D_R = { x: 1, y: 0 };
  var DIR_ORDER = [D_U, D_L, D_D, D_R];

  /* ---------- 3. 运行状态 ---------- */
  var cv = null, ctx = null, raf = 0, lastTs = 0, clock = 0, running = false;
  var walls = [], doors = [], pellets = [];
  var pelletTotal = 0, pelletsLeft = 0;
  var spawn = { x: 9, y: 15 }, ghostSpawns = [];
  var homeField = null, exitField = null;
  var player = null, ghosts = [], floaters = [];
  var mode = 'title', modeT = 0, holdReturn = 'play';
  var score = 0, hi = 0, lives = START_LIVES, level = 1, speedMul = 1;
  var frightT = 0, combo = 0, scatterMode = true, scatterT = 0;
  var sprites = [], small = [], wallLayer = null, scanPat = null;

  /* ---------- 4. 小工具 ---------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function pad(n, w) {
    var s = '' + Math.max(0, Math.floor(n));
    while (s.length < w) s = '0' + s;
    return s;
  }
  function makeCanvas(w, h) {
    try {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    } catch (e) { return null; }
  }
  function ctx2d(c) {
    if (!c || !c.getContext) return null;
    try { return c.getContext('2d'); } catch (e) { return null; }
  }
  /* 圆角矩形路径 */
  function rr(g, x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }
  /* 带粗黑描边的粗体文字 */
  function text(str, x, y, size, color, align, outline) {
    if (!ctx) return;
    try {
      ctx.font = 'bold ' + size + 'px "Arial Black","Noto Sans SC","PingFang SC",sans-serif';
      ctx.textAlign = align || 'center';
      ctx.textBaseline = 'middle';
      if (outline > 0) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = outline;
        ctx.strokeStyle = OUTLINE;
        ctx.strokeText(str, x, y);
      }
      ctx.fillStyle = color;
      ctx.fillText(str, x, y);
    } catch (e) { /* 绘制失败不影响逻辑 */ }
  }
  function rafAdd(fn) {
    if (window.requestAnimationFrame) return window.requestAnimationFrame(fn);
    if (window.setTimeout) return window.setTimeout(function () { fn(+new Date()); }, 16);
    return 0;
  }
  function rafDel(id) {
    if (!id) return;
    try {
      if (window.cancelAnimationFrame) window.cancelAnimationFrame(id);
      else if (window.clearTimeout) window.clearTimeout(id);
    } catch (e) { }
  }

  /* ---------- 5. 关卡解析 + BFS 距离场（用于幽灵出屋 / 归巢） ---------- */
  function buildLevel() {
    var x, y, ch, row;
    walls = []; doors = []; pellets = [];
    ghostSpawns = []; pelletTotal = 0;
    for (y = 0; y < ROWS; y++) {
      walls[y] = []; doors[y] = []; pellets[y] = [];
      row = MAZE[y] || '';
      while (row.length < COLS) row += ' ';
      for (x = 0; x < COLS; x++) {
        ch = row.charAt(x);
        walls[y][x] = (ch === '#');
        doors[y][x] = (ch === '-');
        pellets[y][x] = ch === '.' ? 1 : (ch === 'o' ? 2 : 0);
        if (pellets[y][x]) pelletTotal++;
        if (ch === 'P') spawn = { x: x, y: y };
        if (ch === 'G') ghostSpawns.push({ x: x, y: y });
      }
    }
    while (ghostSpawns.length < 4) ghostSpawns.push({ x: 9, y: 9 });
    pelletsLeft = pelletTotal;
    homeField = bfs(9, 9);   // 鬼屋中心：眼睛归巢
    exitField = bfs(9, 7);   // 门上方：幽灵出屋
  }

  function bfs(tx, ty) {
    var f = new Array(COLS * ROWS), i, n, d, nx, ny, ni;
    for (i = 0; i < f.length; i++) f[i] = -1;
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return f;
    var q = [ty * COLS + tx], head = 0;
    f[ty * COLS + tx] = 0;
    while (head < q.length) {
      var c = q[head++], cx = c % COLS, cy = (c - cx) / COLS;
      for (n = 0; n < 4; n++) {
        d = DIR_ORDER[n];
        nx = cx + d.x; ny = cy + d.y;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        if (walls[ny][nx]) continue;             // 门算可通行
        ni = ny * COLS + nx;
        if (f[ni] !== -1) continue;
        f[ni] = f[c] + 1; q.push(ni);
      }
    }
    return f;
  }

  function refillPellets() {
    var x, y, row, ch;
    pelletsLeft = 0;
    for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) {
      row = MAZE[y] || '';
      ch = x < row.length ? row.charAt(x) : ' ';
      pellets[y][x] = ch === '.' ? 1 : (ch === 'o' ? 2 : 0);
      if (pellets[y][x]) pelletsLeft++;
    }
  }

  /* ---------- 6. 离屏精灵：肥美将军头像（面向右，72x72；另出 28x28 小图） ---------- */
  function paintSoldier(g, m) {
    var CX = 34, CY = 36, R = 23;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    /* 脸 */
    g.beginPath(); g.arc(CX, CY, R, 0, Math.PI * 2);
    g.fillStyle = FACE; g.fill();
    g.lineWidth = 3; g.strokeStyle = OUTLINE; g.stroke();
    /* 腮红 */
    g.globalAlpha = 0.5; g.fillStyle = '#e08a86';
    g.beginPath(); g.arc(CX - 13, CY + 12, 6, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(CX + 8, CY + 13, 5, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    /* 嘴：右下切出的黑色楔形，张口角 0° / ~29° / ~55° */
    var open = m === 0 ? 0 : (m === 1 ? 0.5 : 0.96);
    if (open > 0.01) {
      var px = CX + 2, py = CY + 12, a0 = -0.16;
      g.beginPath();
      g.moveTo(px, py);
      g.arc(px, py, 30, a0, a0 + open);
      g.closePath();
      g.fillStyle = FLOOR;
      g.fill();
    }
    /* 黑框眼镜（两片矩形镜片 + 鼻梁，中间留出肤色间隙） */
    g.fillStyle = '#14141a'; g.strokeStyle = OUTLINE; g.lineWidth = 3;
    rr(g, 11, 33, 16, 14, 3); g.fill(); g.stroke();
    rr(g, 35, 33, 16, 14, 3); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(27, 38); g.lineTo(35, 38); g.stroke();
    g.globalAlpha = 0.42; g.fillStyle = PAPER;
    g.fillRect(15, 36, 7, 2.5); g.fillRect(39, 36, 7, 2.5);
    g.globalAlpha = 1;
    /* 眉毛 */
    g.strokeStyle = '#14141a'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(14, 30); g.lineTo(28, 28); g.stroke();
    g.beginPath(); g.moveTo(35, 28); g.lineTo(49, 30); g.stroke();
    /* 鼻子 */
    g.beginPath(); g.moveTo(25, 47); g.lineTo(34, 52); g.lineTo(25, 55); g.closePath();
    g.fillStyle = '#d9a878'; g.fill();
    g.lineWidth = 2; g.strokeStyle = OUTLINE; g.stroke();
    /* 帽冠 */
    g.beginPath();
    g.moveTo(8, 22);
    g.quadraticCurveTo(7, 2, 35, 2);
    g.quadraticCurveTo(62, 2, 61, 22);
    g.closePath();
    g.fillStyle = CAP_CROWN; g.fill();
    g.lineWidth = 3; g.strokeStyle = OUTLINE; g.stroke();
    /* 帽墙带 */
    g.beginPath(); g.rect(8, 17, 53, 8);
    g.fillStyle = CAP_BAND; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = OUTLINE; g.stroke();
    /* 帽檐（朝右突出） */
    g.beginPath();
    g.moveTo(30, 19);
    g.lineTo(66, 21);
    g.quadraticCurveTo(71, 25, 64, 29);
    g.lineTo(30, 29);
    g.closePath();
    g.fillStyle = CAP_VISOR; g.fill();
    g.lineWidth = 3; g.strokeStyle = OUTLINE; g.stroke();
    /* 帽徽（红底黄星点） */
    g.beginPath(); g.arc(52, 10, 5.5, 0, Math.PI * 2);
    g.fillStyle = RED; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = OUTLINE; g.stroke();
    g.beginPath(); g.arc(52, 10, 2.2, 0, Math.PI * 2);
    g.fillStyle = '#f2c40c'; g.fill();
  }

  function buildSprites() {
    sprites = []; small = [];
    for (var i = 0; i < 3; i++) {
      var c = makeCanvas(72, 72), g = ctx2d(c);
      if (g) paintSoldier(g, i);
      sprites.push(c);
      var s = makeCanvas(28, 28), sg = ctx2d(s);
      if (sg && c) { try { sg.drawImage(c, 0, 0, 28, 28); } catch (e) { } }
      small.push(s);
    }
  }

  /* 小头像（28x28）—— HUD 命数图标 / 覆盖层装饰 */
  function drawSmallHead(idx, x, y, size) {
    var s = small[idx] || small[0];
    if (!s || !ctx) return;
    try { ctx.drawImage(s, x, y, size, size); } catch (e) { }
  }

  /* ---------- 7. 墙体离屏层（红霓虹描边 + 暗红内填充） ---------- */
  function isWallCell(x, y) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return false;
    return !!walls[y][x];
  }

  function buildWallLayer() {
    var c = makeCanvas(PW, PH), g = ctx2d(c);
    if (!g) return c;
    var x, y, px, py;
    g.clearRect(0, 0, PW, PH);
    g.fillStyle = '#5c0a15';
    for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) {
      if (walls[y][x]) g.fillRect(x * TS, y * TS, TS, TS);
    }
    g.strokeStyle = RED;
    g.lineWidth = 3.5;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.shadowColor = RED;
    g.shadowBlur = 9;
    g.beginPath();
    for (y = 0; y < ROWS; y++) {
      for (x = 0; x < COLS; x++) {
        if (!walls[y][x]) continue;
        px = x * TS; py = y * TS;
        if (!isWallCell(x, y - 1)) { g.moveTo(px + 1.6, py + 1.6); g.lineTo(px + TS - 1.6, py + 1.6); }
        if (!isWallCell(x, y + 1)) { g.moveTo(px + 1.6, py + TS - 1.6); g.lineTo(px + TS - 1.6, py + TS - 1.6); }
        if (!isWallCell(x - 1, y)) { g.moveTo(px + 1.6, py + 1.6); g.lineTo(px + 1.6, py + TS - 1.6); }
        if (!isWallCell(x + 1, y)) { g.moveTo(px + TS - 1.6, py + 1.6); g.lineTo(px + TS - 1.6, py + TS - 1.6); }
      }
    }
    g.stroke();
    g.shadowBlur = 0;
    /* 鬼屋门 */
    for (y = 0; y < ROWS; y++) {
      for (x = 0; x < COLS; x++) {
        if (!doors[y][x]) continue;
        g.fillStyle = '#8c8a6a';
        g.fillRect(x * TS + 5, y * TS + TS / 2 - 3, TS - 10, 6);
        g.strokeStyle = OUTLINE;
        g.lineWidth = 2;
        g.strokeRect(x * TS + 5, y * TS + TS / 2 - 3, TS - 10, 6);
      }
    }
    return c;
  }

  function buildScanlinePattern() {
    if (!ctx) return null;
    var c = makeCanvas(2, 3), g = ctx2d(c);
    if (!g || !ctx.createPattern) return null;
    g.fillStyle = 'rgba(0,0,0,0.13)';
    g.fillRect(0, 0, 2, 1);
    try { return ctx.createPattern(c, 'repeat'); } catch (e) { return null; }
  }

  /* ---------- 8. 通行判定 + 平滑移动 ---------- */
  function tunnelRow(ty) { return ty === 9; }   // 第 9 行左右两侧为隧道

  function canEnter(tx, ty, e) {
    if (tx < 0 || tx >= COLS) return tunnelRow(ty);          // 隧道可穿越
    if (ty < 0 || ty >= ROWS) return false;
    if (walls[ty][tx]) return false;
    if (doors[ty][tx]) return !!(e && e.kind === 'ghost' && (e.state === 'eaten' || e.state === 'house'));
    return true;
  }

  /* 子步进移动：撞墙时贴住当前格中心；返回实际位移 */
  function stepEntity(e, dist) {
    if (!e.dir || !(dist > 0)) return 0;
    var moved = 0, guard = 0, s, nx, ny, ntx, nty, mx, my, ctx0, cty0;
    while (dist > 0.0001 && guard++ < 80) {
      s = dist > 4 ? 4 : dist;
      dist -= s;
      if (e.x < 0) e.x += PW; else if (e.x >= PW) e.x -= PW;
      nx = e.x + e.dir.x * s;
      ny = e.y + e.dir.y * s;
      ntx = Math.floor((nx + e.dir.x * TS * 0.45) / TS);
      nty = Math.floor((ny + e.dir.y * TS * 0.45) / TS);
      if (!canEnter(ntx, nty, e)) {
        ctx0 = Math.floor(e.x / TS);
        cty0 = Math.floor(e.y / TS);
        mx = ctx0 * TS + TS / 2;
        my = cty0 * TS + TS / 2;
        if (e.dir.x) nx = e.dir.x > 0 ? Math.min(nx, mx) : Math.max(nx, mx);
        else ny = e.dir.y > 0 ? Math.min(ny, my) : Math.max(ny, my);
        moved += Math.abs(nx - e.x) + Math.abs(ny - e.y);
        e.x = nx; e.y = ny;
        e.hitWall = true;
        break;
      }
      moved += Math.abs(nx - e.x) + Math.abs(ny - e.y);
      e.x = nx; e.y = ny;
      e.hitWall = false;
      if (e.onCenter) e.onCenter(e);
    }
    if (e.x < 0) e.x += PW; else if (e.x >= PW) e.x -= PW;
    return moved;
  }

  function angleOf(d) {
    if (!d) return 0;
    if (d === D_D) return Math.PI / 2;
    if (d === D_L) return Math.PI;
    if (d === D_U) return -Math.PI / 2;
    return 0;
  }

  /* ---------- 9. 幽灵 AI ---------- */
  function fieldMin(opts, tx, ty, f) {
    var best = null, bd = 1e9, i, nx, ny, v;
    for (i = 0; i < opts.length; i++) {
      nx = tx + opts[i].x; ny = ty + opts[i].y;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      v = f[ny * COLS + nx];
      if (v >= 0 && v < bd) { bd = v; best = opts[i]; }
    }
    return best;
  }

  function randomNearPlayer() {
    var pt = tileOf(player);
    for (var i = 0; i < 16; i++) {
      var x = clamp(pt.x + Math.round((Math.random() * 8) - 4), 0, COLS - 1);
      var y = clamp(pt.y + Math.round((Math.random() * 8) - 4), 0, ROWS - 1);
      if (!walls[y][x] && !doors[y][x] && !(x === 9 && y === 7)) return { x: x, y: y };
    }
    return { x: pt.x, y: pt.y };
  }

  function pickTarget(g) {
    var pt = tileOf(player), pd = player.dir || D_R;
    if (g.wanderT > 0 && g.wanderTile) return g.wanderTile;
    if (scatterMode) return g.corner;
    if (g.role === 'chase') return { x: pt.x, y: pt.y };
    if (g.role === 'ambush') return { x: pt.x + pd.x * 4, y: pt.y + pd.y * 4 };
    if (g.role === 'patrol') return g.corner;
    /* 游荡型：离得远就随机乱走，离得近就包抄 */
    var far = Math.abs(g.tx - pt.x) + Math.abs(g.ty - pt.y);
    if (far > 8) {
      g.wanderTile = randomNearPlayer();
      g.wanderT = 1.2;
      return g.wanderTile;
    }
    return { x: pt.x + pd.x * 2, y: pt.y + pd.y * 2 };
  }

  function decideGhostDir(g, tx, ty) {
    var fwd = [], all = [], i, d, nx, ny;
    for (i = 0; i < 4; i++) {
      d = DIR_ORDER[i];
      nx = tx + d.x; ny = ty + d.y;
      if (!canEnter(nx, ny, g)) continue;
      all.push(d);
      if (g.dir && d.x === -g.dir.x && d.y === -g.dir.y) continue;
      fwd.push(d);
    }
    if (!all.length) { if (g.dir) g.dir = { x: -g.dir.x, y: -g.dir.y }; return; }
    if (!fwd.length) fwd = all;
    var pick;
    if (g.state === 'eaten' && homeField) pick = fieldMin(all, tx, ty, homeField);
    else if (g.state === 'house' && exitField) pick = fieldMin(all, tx, ty, exitField);
    else if (g.state === 'frightened') pick = fwd[(Math.random() * fwd.length) | 0];
    else {
      var t = pickTarget(g), bd = 1e9;
      pick = fwd[0];
      for (i = 0; i < fwd.length; i++) {
        nx = tx + fwd[i].x; ny = ty + fwd[i].y;
        var dd = (nx - t.x) * (nx - t.x) + (ny - t.y) * (ny - t.y);
        if (dd < bd) { bd = dd; pick = fwd[i]; }
      }
    }
    g.dir = pick || g.dir;
  }

  function ghostCenter(g) {
    var tx = Math.floor(g.x / TS), ty = Math.floor(g.y / TS);
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return;   // 隧道边缘不决策
    var key = tx * 1000 + ty;
    if (g.lastTile === key) return;
    var cx = tx * TS + TS / 2, cy = ty * TS + TS / 2;
    if (Math.abs(g.x - cx) > 3 || Math.abs(g.y - cy) > 3) return;
    g.x = cx; g.y = cy;
    g.lastTile = key;
    g.tx = tx; g.ty = ty;
    decideGhostDir(g, tx, ty);
  }

  /* ---------- 10. 实体创建 / 重置 ---------- */
  function tileOf(e) { return { x: Math.floor(e.x / TS), y: Math.floor(e.y / TS) }; }

  function centerX(tx) { return tx * TS + TS / 2; }

  function makePlayer() {
    return {
      kind: 'player', x: centerX(spawn.x), y: centerX(spawn.y), dir: null, want: null,
      mouth: 0, mouthT: 0, moving: false, hitWall: false
    };
  }

  function makeGhost(i) {
    var sp = ghostSpawns[i] || { x: 9, y: 9 };
    var roles = ['chase', 'ambush', 'patrol', 'wander'];
    var corners = [{ x: 17, y: 1 }, { x: 1, y: 1 }, { x: 17, y: 19 }, { x: 1, y: 19 }];
    var inside = (sp.y >= 8);
    return {
      kind: 'ghost', idx: i, x: centerX(sp.x), y: centerX(sp.y), homeX: centerX(sp.x), homeY: centerX(sp.y),
      dir: i % 2 ? D_L : D_R, tx: sp.x, ty: sp.y, lastTile: -1, onCenter: ghostCenter,
      state: inside ? 'house' : 'hunt', role: roles[i], corner: corners[i],
      releaseT: inside ? 1.0 + i * 1.6 : 0, bob: Math.random() * 6, wanderT: 0, wanderTile: null, hitWall: false
    };
  }

  function resetRound() {
    player = makePlayer();
    ghosts = [];
    for (var i = 0; i < 4; i++) ghosts.push(makeGhost(i));
    floaters = [];
    frightT = 0; combo = 0;
    scatterMode = true;
    scatterT = scatterTime();
  }

  function scatterTime() { return Math.max(3.2, 7 - (level - 1) * 0.55); }

  function setMode(m) { mode = m; modeT = 0; }

  /* ---------- 11. 更新逻辑 ---------- */
  function updatePlayer(dt) {
    var p = player;
    if (!p) return;
    p.moving = false;
    /* 转向：只在格子中心 ±35% 死区内允许（含掉头） */
    if (p.want && p.want !== p.dir) {
      var tx = Math.floor(p.x / TS), ty = Math.floor(p.y / TS);
      var cx = tx * TS + TS / 2, cy = ty * TS + TS / 2;
      if (Math.abs(p.x - cx) <= TS * 0.35 && Math.abs(p.y - cy) <= TS * 0.35) {
        if (p.want.x && canEnter(tx + p.want.x, ty, p)) { p.dir = p.want; p.y = cy; }
        else if (p.want.y && canEnter(tx, ty + p.want.y, p)) { p.dir = p.want; p.x = cx; }
      }
    }
    if (p.dir) {
      var d = stepEntity(p, SPD_PLAYER * speedMul * TS * dt);
      if (d > 0.01) {
        p.moving = true;
        p.mouthT += dt;
        if (p.mouthT >= MOUTH_STEP) {
          p.mouthT -= MOUTH_STEP;
          p.mouth = (p.mouth + 1) % 3;
        }
      }
    }
    eatAt(Math.floor(p.x / TS), Math.floor(p.y / TS));
  }

  function updateGhosts(dt) {
    for (var i = 0; i < ghosts.length; i++) {
      var g = ghosts[i];
      if (g.state === 'house') {
        if (g.releaseT > 0) {
          g.releaseT -= dt;
          g.bob += dt;
          g.y = g.homeY + Math.sin(g.bob * 4) * 6;
          if (g.releaseT <= 0) { g.y = g.homeY; g.x = g.homeX; g.lastTile = -1; }
          continue;
        }
        stepEntity(g, SPD_HOUSE * TS * dt);
        if (Math.floor(g.y / TS) <= 7) {
          g.state = frightT > 0 ? 'frightened' : 'hunt';
          g.lastTile = -1;
        }
        continue;
      }
      if (g.state === 'eaten') {
        stepEntity(g, SPD_EYES * TS * dt);
        if (Math.abs(g.x - centerX(9)) < 4 && Math.abs(g.y - centerX(9)) < 4) {
          g.x = centerX(9); g.y = centerX(9);
          g.state = 'house';
          g.releaseT = 0.7;
          g.homeX = centerX(9); g.homeY = centerX(9);
          g.lastTile = -1;
        }
        continue;
      }
      var sp = (g.state === 'frightened' ? SPD_FRIGHT : SPD_GHOST * (scatterMode ? 0.9 : 1.05));
      stepEntity(g, sp * speedMul * TS * dt);
      if (g.wanderT > 0) g.wanderT -= dt;
    }
  }

  function eatGhost(g) {
    combo++;
    var pts = 200 * Math.pow(2, Math.min(combo - 1, 3));
    addScore(pts);
    floaters.push({ x: g.x, y: g.y, t: 0, s: '' + pts });
    g.state = 'eaten';
    g.lastTile = -1;
  }

  function addScore(n) {
    score += n;
    if (score > hi) hi = score;
  }

  function startFright() {
    frightT = FRIGHT_TIME;
    combo = 0;
    for (var i = 0; i < ghosts.length; i++) {
      var g = ghosts[i];
      if (g.state === 'hunt') {
        g.state = 'frightened';
        if (g.dir) g.dir = { x: -g.dir.x, y: -g.dir.y };
        g.lastTile = -1;
      }
    }
  }

  function eatAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return;
    var v = pellets[ty][tx];
    if (!v) return;
    pellets[ty][tx] = 0;
    pelletsLeft--;
    if (v === 1) addScore(10);
    else { addScore(50); startFright(); }
    if (pelletsLeft <= 0) setMode('clear');
  }

  function checkHit() {
    var p = player;
    if (!p) return;
    for (var i = 0; i < ghosts.length; i++) {
      var g = ghosts[i];
      if (g.state === 'eaten' || g.state === 'house') continue;
      var dx = g.x - p.x, dy = g.y - p.y;
      if (dx * dx + dy * dy > HIT_R * HIT_R) continue;
      if (g.state === 'frightened') eatGhost(g);
      else { loseLife(); return; }
    }
  }

  function loseLife() {
    lives--;
    if (lives < 0) lives = 0;
    setMode('dying');
  }

  function afterDeath() {
    if (lives <= 0) {
      if (score > hi) hi = score;
      setMode('over');
      return;
    }
    resetRound();
    setMode('ready');
  }

  function nextLevel() {
    level++;
    speedMul = Math.pow(SPEED_STEP, level - 1);
    refillPellets();
    resetRound();
    setMode('ready');
  }

  function newRound() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    speedMul = 1;
    buildLevel();
    resetRound();
    setMode('ready');
  }

  function update(dt) {
    var i;
    clock += dt;
    modeT += dt;
    for (i = floaters.length - 1; i >= 0; i--) {
      floaters[i].t += dt;
      if (floaters[i].t > 0.9) floaters.splice(i, 1);
    }
    if (mode === 'title' || mode === 'over' || mode === 'hold') return;
    if (mode === 'ready') { if (modeT >= READY_TIME) setMode('play'); return; }
    if (mode === 'dying') { if (modeT >= DEATH_TIME) afterDeath(); return; }
    if (mode === 'clear') { if (modeT >= CLEAR_TIME) nextLevel(); return; }
    if (mode !== 'play') return;

    updatePlayer(dt);
    updateGhosts(dt);
    checkHit();
    if (mode !== 'play') return;             // 本帧可能已死亡 / 过关

    if (frightT > 0) {
      frightT -= dt;
      if (frightT <= 0) {
        frightT = 0; combo = 0;
        for (i = 0; i < ghosts.length; i++) if (ghosts[i].state === 'frightened') ghosts[i].state = 'hunt';
      }
    }
    scatterT -= dt;
    if (scatterT <= 0) {
      scatterMode = !scatterMode;
      scatterT = scatterMode ? scatterTime() : 20;
    }
  }

  /* ---------- 12. 绘制 ---------- */
  function drawBoard(alpha) {
    if (!ctx) return;
    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;
    if (wallLayer) { try { ctx.drawImage(wallLayer, 0, 0); } catch (e) { } }
    var x, y, v, pulse = 0.5 + 0.5 * Math.sin(clock * 5);
    ctx.fillStyle = PAPER;
    for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) {
      if (pellets[y][x] === 1) ctx.fillRect(centerX(x) - 2, centerX(y) - 2, 4, 4);
    }
    for (y = 0; y < ROWS; y++) for (x = 0; x < COLS; x++) {
      v = pellets[y][x];
      if (v !== 2) continue;
      var r = 3.6 + pulse * 1.3;
      ctx.save();
      ctx.translate(centerX(x), centerX(y));
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = pulse > 0.5 ? RED_HI : RED;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = PAPER;
      ctx.strokeRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawGhost(g) {
    var blinking = g.state === 'frightened' && frightT <= BLINK_TIME && (Math.floor(frightT * 6) % 2 === 0);
    var col = g.state === 'frightened' ? (blinking ? PAPER : FRIGHT_COL) : GCOL[g.idx % 4];
    var dir = g.dir || D_R;
    ctx.save();
    ctx.translate(g.x, g.y);
    if (g.state !== 'eaten') {
      var r = 17, y0 = 8, amp = 5, n = 4, w = (r * 2) / n, i;
      ctx.beginPath();
      ctx.arc(0, -1, r, Math.PI, 0);
      ctx.lineTo(r, y0);
      for (i = 0; i < n; i++) {
        ctx.quadraticCurveTo(r - w * i - w * 0.5, y0 + amp, r - w * (i + 1), y0);
      }
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      if (g.state === 'frightened') {
        /* 受惊表情：小方眼 + 波浪嘴 */
        ctx.fillStyle = blinking ? RED : PAPER;
        ctx.fillRect(-8, -6, 5, 5);
        ctx.fillRect(3, -6, 5, 5);
        ctx.strokeStyle = blinking ? RED : PAPER;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-9, 5);
        for (i = 0; i < 6; i++) ctx.lineTo(-9 + i * 3 + 1.5, i % 2 ? 5 : 1);
        ctx.stroke();
      }
    }
    if (g.state !== 'frightened') {
      var ox = dir.x * 2.2, oy = dir.y * 2.2;
      ctx.fillStyle = PAPER;
      ctx.beginPath(); ctx.arc(-6, -3, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(6, -3, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1b1b2a';
      ctx.beginPath(); ctx.arc(-6 + ox, -3 + oy, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(6 + ox, -3 + oy, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawPlayerEnt() {
    var p = player;
    if (!p || !sprites.length || !sprites[0]) return;
    var idx = 0;
    if (mode === 'dying') idx = 2;
    else if (mode === 'play' && p.moving) idx = p.mouth % 3;
    var sp = sprites[idx] || sprites[0];
    ctx.save();
    ctx.translate(p.x, p.y);
    if (mode === 'dying') {
      var prog = clamp(modeT / DEATH_TIME, 0, 1);
      ctx.rotate(prog * 9.5);
      var sc = 1 - prog * prog;
      ctx.scale(sc, sc);
      ctx.globalAlpha = 1 - prog * 0.6;
    } else {
      ctx.rotate(angleOf(p.dir));
    }
    try { ctx.drawImage(sp, -21, -21, 42, 42); } catch (e) { }
    ctx.restore();
  }

  function drawEntities() {
    var i;
    for (i = 0; i < ghosts.length; i++) drawGhost(ghosts[i]);
    drawPlayerEnt();
  }

  function drawFloaters() {
    for (var i = 0; i < floaters.length; i++) {
      var f = floaters[i];
      text(f.s, f.x, f.y - f.t * 26, 22, '#7ef7ff', 'center', 5);
    }
  }

  /* HUD：游戏区内底部覆盖带（分数 / 最高分 / 命数 / 关卡）+ 20px 状态条 */
  function drawHud() {
    if (!ctx) return;
    ctx.fillStyle = 'rgba(7,7,10,0.88)';
    ctx.fillRect(0, HUD_Y, PW, PH - HUD_Y);
    ctx.fillStyle = RED;
    ctx.fillRect(0, HUD_Y, PW, 3);
    text('SCORE ' + pad(score, 6), 16, HUD_Y + 20, 20, PAPER, 'left', 4);
    text('HI ' + pad(hi, 6), 268, HUD_Y + 20, 20, 'rgba(246,243,238,0.62)', 'left', 4);
    for (var i = 0; i < lives && i < 6; i++) drawSmallHead(0, 486 + i * 32, HUD_Y + 3, 28);
    ctx.save();
    ctx.translate(702, HUD_Y + 17);
    ctx.rotate(-0.06);
    ctx.fillStyle = RED; ctx.fillRect(-54, -14, 108, 28);
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3;
    ctx.strokeRect(-54, -14, 108, 28);
    ctx.restore();
    text('LV ' + level, 702, HUD_Y + 17, 19, PAPER, 'center', 0);
    /* 20px 状态条 */
    ctx.fillStyle = '#040406';
    ctx.fillRect(0, PH, PW, CH - PH);
    ctx.fillStyle = 'rgba(224,18,40,0.85)';
    ctx.fillRect(0, PH, PW, 2);
    text('← → ↑ ↓ / WASD 移动 · 滑动屏幕 · P 暂停 · R 重开', CW / 2, PH + 11, 11,
      'rgba(246,243,238,0.45)', 'center', 0);
  }

  function overlayWash(a) {
    ctx.fillStyle = 'rgba(7,7,10,' + a + ')';
    ctx.fillRect(0, 0, CW, CH);
  }

  /* 大红色斜切装饰条（P5 风） */
  function redSlash(cy, ang, w, h, alpha) {
    ctx.save();
    ctx.translate(CW / 2, cy);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(224,18,40,' + alpha + ')';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }

  function drawTitle() {
    overlayWash(0.8);
    redSlash(236, -0.09, 780, 116, 0.92);
    redSlash(310, -0.09, 620, 20, 0.5);
    text('肥美将军', CW / 2, 226, 64, PAPER, 'center', 10);
    text('· 吃 豆 人 ·', CW / 2, 300, 28, '#ffd7dd', 'center', 6);
    var bl = 0.55 + 0.45 * Math.sin(clock * 4);
    ctx.save();
    ctx.globalAlpha = bl;
    text('按空格 / 点击开始', CW / 2, 420, 30, PAPER, 'center', 7);
    ctx.restore();
    drawSmallHead(2, 118, 470, 56);
    drawSmallHead(2, 586, 470, 56);
    text('← → ↑ ↓ / WASD 移动', CW / 2, 498, 21, 'rgba(246,243,238,0.9)', 'center', 5);
    text('手机：在画面上滑动', CW / 2, 534, 21, 'rgba(246,243,238,0.9)', 'center', 5);
    text('P 暂停 · R 重开', CW / 2, 570, 21, 'rgba(246,243,238,0.9)', 'center', 5);
    text('吃掉全部豆子进入下一关 · 能量豆可反杀幽灵', CW / 2, 626, 17, 'rgba(246,243,238,0.55)', 'center', 4);
    text('HI ' + pad(hi, 6), CW / 2, 690, 22, RED_HI, 'center', 5);
  }

  function drawReady() {
    drawSmallHead(1, 250, 452, 56);
    text('READY!', 412, 480, 46, RED_HI, 'center', 8);
  }

  function drawPaused() {
    overlayWash(0.66);
    redSlash(392, -0.07, 700, 92, 0.85);
    text('PAUSED', CW / 2, 392, 58, PAPER, 'center', 9);
    drawSmallHead(0, 250, 470, 56);
    text('按 P 或空格继续', 420, 498, 24, PAPER, 'center', 6);
    text('按 R 重开', CW / 2, 560, 22, 'rgba(246,243,238,0.8)', 'center', 5);
  }

  function drawClear() {
    overlayWash(0.58);
    redSlash(390, -0.07, 760, 100, 0.9);
    text('LEVEL CLEAR', CW / 2, 390, 54, PAPER, 'center', 9);
    text('第 ' + level + ' 关通过 · 下一关速度 +6%', CW / 2, 470, 24, RED_HI, 'center', 6);
    text('SCORE ' + pad(score, 6), CW / 2, 540, 24, PAPER, 'center', 5);
  }

  function drawOver() {
    overlayWash(0.68);
    redSlash(330, -0.08, 800, 130, 0.92);
    text('GAME OVER', CW / 2, 330, 66, PAPER, 'center', 10);
    drawSmallHead(2, 300, 400, 56);
    text('得分 ' + pad(score, 6), CW / 2, 428, 26, PAPER, 'center', 6);
    text('最高 ' + pad(hi, 6), CW / 2, 470, 22, 'rgba(246,243,238,0.75)', 'center', 5);
    var bl = 0.55 + 0.45 * Math.sin(clock * 4);
    ctx.save();
    ctx.globalAlpha = bl;
    text('按 R 重来 / 点击重来', CW / 2, 556, 28, RED_HI, 'center', 7);
    ctx.restore();
    text('第 ' + level + ' 关 · 共 ' + pelletTotal + ' 颗豆子', CW / 2, 626, 18, 'rgba(246,243,238,0.5)', 'center', 4);
  }

  function drawScanlines() {
    if (!ctx) return;
    try {
      if (scanPat) {
        ctx.fillStyle = scanPat;
        ctx.fillRect(0, 0, CW, CH);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        for (var y = 0; y < CH; y += 3) ctx.fillRect(0, y, CW, 1);
      }
    } catch (e) { }
  }

  function render() {
    if (!ctx) return;
    ctx.save();
    ctx.fillStyle = FLOOR;
    ctx.fillRect(0, 0, CW, CH);
    if (mode === 'title') {
      drawBoard(0.34);
      drawTitle();
    } else if (mode === 'over') {
      drawBoard(1);
      drawEntities();
      drawHud();
      drawOver();
    } else {
      drawBoard(1);
      drawEntities();
      drawFloaters();
      drawHud();
      if (mode === 'ready') drawReady();
      else if (mode === 'hold') drawPaused();
      else if (mode === 'clear') drawClear();
    }
    drawScanlines();
    ctx.restore();
  }

  /* ---------- 13. 主循环 ---------- */
  function frame(ts) {
    if (!running) return;
    raf = rafAdd(frame);
    var t = typeof ts === 'number' ? ts : +new Date();
    if (!lastTs) lastTs = t;
    var dt = (t - lastTs) / 1000;
    lastTs = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;                // 切标签页不会瞬移
    update(dt);
    render();
  }

  function startLoop() {
    if (running || !ctx) return;
    running = true;
    lastTs = 0;
    raf = rafAdd(frame);
  }

  function stopLoop() {
    running = false;
    rafDel(raf);
    raf = 0;
  }

  /* ---------- 14. 输入 ---------- */
  var touchX = 0, touchY = 0, touchMoved = false;

  function dirFromKey(e) {
    var k = e.key, c = e.keyCode || e.which;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A' || c === 37 || c === 65) return D_L;
    if (k === 'ArrowRight' || k === 'd' || k === 'D' || c === 39 || c === 68) return D_R;
    if (k === 'ArrowUp' || k === 'w' || k === 'W' || c === 38 || c === 87) return D_U;
    if (k === 'ArrowDown' || k === 's' || k === 'S' || c === 40 || c === 83) return D_D;
    return null;
  }

  function confirmKey() {
    if (mode === 'title' || mode === 'over') newRound();
    else if (mode === 'hold') setMode(holdReturn === 'ready' ? 'play' : holdReturn);
  }

  function onKeyDown(e) {
    var d = dirFromKey(e);
    if (d) {
      if (e.preventDefault) e.preventDefault();   // 仅在弹窗激活期间拦截
      if (player) player.want = d;
      return;
    }
    var k = e.key, c = e.keyCode || e.which;
    if (k === 'p' || k === 'P' || c === 80) {
      if (mode === 'hold') setMode(holdReturn === 'ready' ? 'play' : holdReturn);
      else if (mode === 'play' || mode === 'ready') { holdReturn = mode; setMode('hold'); }
      return;
    }
    if (k === 'r' || k === 'R' || c === 82) { newRound(); return; }
    if (k === ' ' || k === 'Spacebar' || k === 'Space' || c === 32) confirmKey();
  }

  function onTouch(e) {
    if (e.type === 'touchend' || e.type === 'touchcancel') {
      if (!touchMoved) confirmKey();        // 轻点：标题 / 结束 / 暂停画面
      return;
    }
    var t = e.touches && e.touches[0];
    if (!t) return;
    if (e.type === 'touchstart') {
      touchX = t.clientX; touchY = t.clientY; touchMoved = false;
      return;
    }
    var dx = t.clientX - touchX, dy = t.clientY - touchY;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;   // 阈值 24px
    touchMoved = true;
    touchX = t.clientX; touchY = t.clientY;
    if (player) {
      if (Math.abs(dx) > Math.abs(dy)) player.want = dx > 0 ? D_R : D_L;
      else player.want = dy > 0 ? D_D : D_U;
    }
    if (e.preventDefault) e.preventDefault();
  }

  var TOUCH_EV = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];
  var attached = false;
  function attach() {
    if (attached) return;
    attached = true;
    window.addEventListener('keydown', onKeyDown, false);
    if (cv && cv.addEventListener) {
      for (var i = 0; i < TOUCH_EV.length; i++) cv.addEventListener(TOUCH_EV[i], onTouch, false);
    }
  }
  function detach() {
    if (!attached) return;
    attached = false;
    window.removeEventListener('keydown', onKeyDown, false);
    if (cv && cv.removeEventListener) {
      for (var i = 0; i < TOUCH_EV.length; i++) cv.removeEventListener(TOUCH_EV[i], onTouch, false);
    }
  }

  /* ---------- 15. 对外接口 ---------- */
  return {
    init: function (canvasEl) {
      try {
        var el = canvasEl || (document && document.getElementById ? document.getElementById('gameCanvas') : null);
        if (!el || !el.getContext) return;
        cv = el;
        if (el.width) CW = el.width;
        if (el.height) CH = el.height;
        ctx = ctx2d(cv);
        if (!ctx) return;                       // 无法取得 2D 上下文：静默降级
        buildLevel();
        buildSprites();
        wallLayer = buildWallLayer();
        scanPat = buildScanlinePattern();
        resetRound();
        setMode('title');
        render();                               // 先画一张标题画面，弹窗打开即有内容
      } catch (e) {
        ctx = null;                             // 出错则彻底静默
      }
    },

    start: function () {
      if (!ctx) return;
      attach();
      if (mode === 'over') setMode('title');
      if (mode !== 'hold' && mode !== 'title') { holdReturn = mode; setMode('hold'); }
      startLoop();
      render();
    },

    pause: function () {
      stopLoop();
      detach();
      if (mode === 'ready' || mode === 'play' || mode === 'dying' || mode === 'clear') {
        holdReturn = mode;
        setMode('hold');                        // 重新打开弹窗不会自动续玩
      }
    },

    destroy: function () {
      stopLoop();
      detach();
      cv = null;
      ctx = null;
      sprites = [];
      small = [];
      wallLayer = null;
      scanPat = null;
      ghosts = [];
      player = null;
      floaters = [];
    }
  };
})();
