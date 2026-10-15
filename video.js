/* =========================================================
   介绍视频 — 女神异闻录5风格「手书」(v2 · 全部由代码实时绘制)
   ---------------------------------------------------------
   设计原则（针对 v1 反馈重做）：
   · 以真实照片为主角 —— 每段都有明确的「照片 / 剪影」视觉主体，不再堆抽象花纹
   · 版式统一 —— 白卡 / 红块 / 黑斜切，字体、描边、错位规则全局一致
   · 每个字板都不同 —— 照片二值化 / 红底白字 / 线描剪影 / 双层叠字 / 五字合体
   · 动作干脆 —— 短促飞入 + 回弹定格 + 冲击线，不做无意义的持续抖动
   素材：assets/portrait.jpg、assets/silhouette.json（照片提取的轮廓）
   音效：WebAudio 实时合成，无任何外部视频/音频文件
   ========================================================= */
window.FZR_VIDEO = (function () {
  'use strict';

  var RED = '#e01228', INK = '#0b0b0f', PAPER = '#f6f3ee', KHAKI = '#f2e4b8';
  var W = 1280, H = 720, TOTAL = 34.0;
  var FONT = '"Noto Sans SC","Source Han Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
  var EN_FONT = '"Arial Black","Impact",Haettenschweiler,sans-serif';

  var cv = null, ctx = null, raf = 0, t0 = 0, clock = 0, running = false;
  var img = null, imgOk = false;
  var sil = null, silReady = false, silCut = null, silHalf = null;
  var glyphs = {}, tex = {};
  var soundOn = true, pending = false, cued = {}, loading = false;
  var onEndFn = null;

  /* ---------------- 数学 / 缓动 ---------------- */
  function cl(v, a, b) { return v < a ? a : v > b ? b : v; }
  function seg(t, a, b) { return cl((t - a) / (b - a), 0, 1); }
  function eo(p) { return 1 - Math.pow(1 - p, 3); }
  function eio(p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function back(p, s) { s = s || 1.7; return 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2); }
  function h1(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* ---------------- 音效（实时合成） ---------------- */
  var AC = null;
  function ac() {
    if (!soundOn) return null;
    if (!AC) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { AC = new C(); } catch (e) { return null; }
    }
    if (AC.state === 'suspended') { try { AC.resume(); } catch (e) { } }
    return AC;
  }
  function tone(f, dur, type, gain, slide) {
    var c = ac(); if (!c) return;
    var o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = type || 'square';
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(28, slide), t + dur);
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || .1, t + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + .02);
  }
  function noise(dur, gain, hp, shape) {
    var c = ac(); if (!c) return;
    var n = Math.max(1, Math.floor(c.sampleRate * dur));
    var b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, shape || 2.4);
    var s = c.createBufferSource(); s.buffer = b;
    var f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp || 800;
    var g = c.createGain(); g.gain.value = gain || .1;
    s.connect(f); f.connect(g); g.connect(c.destination); s.start();
  }
  var SFX = {
    whoosh: function () { noise(.3, .085, 620, 2.0); },
    swipe: function () { noise(.16, .075, 1500, 3.0); },
    impact: function () { tone(150, .26, 'sawtooth', .15, 44); noise(.13, .07, 380); },
    stamp: function () { tone(196, .3, 'square', .13, 62); noise(.2, .06, 300); },
    tick: function () { tone(1180, .05, 'square', .05); },
    riser: function () { tone(240, .5, 'sawtooth', .05, 1200); },
    ding: function () { tone(1568, .35, 'triangle', .07); tone(2093, .35, 'triangle', .04); }
  };

  /* ---------------- 纹理缓存（避免每帧重画上万图元） ---------------- */
  function texOf(key, w, h, draw) {
    var c = tex[key];
    if (c) return c;
    c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    tex[key] = c; return c;
  }
  function dotsPat(c2, step, color, alpha) {
    var t = texOf('d' + step + color + alpha, step * 4, step * 4, function (g, w, h) {
      g.globalAlpha = alpha; g.fillStyle = color;
      for (var y = 0; y < h; y += step) for (var x = 0; x < w; x += step) {
        g.beginPath(); g.arc(x + step / 2, y + step / 2, step * .33, 0, 6.2832); g.fill();
      }
    });
    return c2.createPattern(t, 'repeat');
  }
  function stripePat(c2, band, color, alpha) {
    var size = band * 6;
    var t = texOf('s' + band + color + alpha, size, size, function (g, w, h) {
      g.globalAlpha = alpha; g.fillStyle = color;
      g.translate(w / 2, h / 2); g.rotate(-Math.PI / 4); g.translate(-w, -h);
      for (var y = 0; y < h * 3; y += band * 2) g.fillRect(0, y, w * 2, band);
    });
    return c2.createPattern(t, 'repeat');
  }
  function grainTex() {
    if (tex.__g) return tex.__g;
    var arr = [];
    for (var k = 0; k < 3; k++) {
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var g = c.getContext('2d');
      for (var i = 0; i < 4200; i++) {
        g.fillStyle = Math.random() > .5 ? 'rgba(255,255,255,.42)' : 'rgba(0,0,0,.42)';
        g.fillRect(Math.random() * W | 0, Math.random() * H | 0, 2, 2);
      }
      arr.push(c);
    }
    tex.__g = arr; return arr;
  }
  function dots(c, x, y, w, h, step, color, alpha) {
    c.save(); c.fillStyle = dotsPat(c, step, color, alpha); c.fillRect(x, y, w, h); c.restore();
  }
  function stripes(c, x, y, w, h, band, color, alpha) {
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.fillStyle = stripePat(c, band, color, alpha); c.fillRect(x, y, w, h); c.restore();
  }
  function rays(c, cx, cy, r0, r1, n, color, alpha, phase) {
    c.save(); c.globalAlpha = alpha == null ? 1 : alpha; c.fillStyle = color || INK;
    for (var i = 0; i < n; i++) {
      var a = i / n * 6.2832 + (phase || 0);
      var wd = .008 + .05 * h1(i * 3.7 + Math.floor(phase || 0));
      var rr = r0 + (r1 - r0) * (.45 + .55 * h1(i * 5.1));
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a - wd) * rr, cy + Math.sin(a - wd) * rr);
      c.lineTo(cx + Math.cos(a + wd) * rr, cy + Math.sin(a + wd) * rr);
      c.closePath(); c.fill();
    }
    c.restore();
  }
  // 带描边文字（预渲染缓存）
  function text(c, txt, x, y, size, o) {
    o = o || {};
    var font = (o.weight || 900) + ' ' + size + 'px ' + (o.font || FONT);
    var stroke = o.sw || 0;
    var key = font + '|' + txt + '|' + stroke + '|' + (o.fill || '') + '|' + (o.sc || INK);
    var m = glyphs[key];
    if (!m) {
      var mc = document.createElement('canvas'), mg = mc.getContext('2d');
      mg.font = font;
      var tw = Math.ceil(mg.measureText(txt).width);
      var pad = Math.ceil(size * .42) + Math.ceil(stroke);
      mc.width = Math.max(4, tw + pad * 2);
      mc.height = Math.ceil(size * 1.42) + pad;
      mg = mc.getContext('2d');
      mg.font = font; mg.textAlign = 'center'; mg.textBaseline = 'middle';
      if (stroke) {
        mg.lineJoin = 'round'; mg.lineWidth = stroke; mg.strokeStyle = o.sc || INK;
        mg.strokeText(txt, mc.width / 2, mc.height / 2);
      }
      mg.fillStyle = o.fill || PAPER;
      mg.fillText(txt, mc.width / 2, mc.height / 2);
      m = glyphs[key] = { cv: mc, w: mc.width, h: mc.height };
    }
    c.drawImage(m.cv, Math.round(x - m.w / 2), Math.round(y - m.h / 2));
    return m;
  }
  // 主视觉字：红色错位立体字（out 指定错位层颜色，out 与 fill 必须不同以保证辨识度）
  function bigChar(c, ch, x, y, size, fill, off, out) {
    off = off == null ? size * .055 : off;
    out = out || RED;
    text(c, ch, x + off, y + off, size, { fill: out, sw: size * .115, sc: out });
    text(c, ch, x, y, size, { fill: fill || PAPER, sw: size * .12, sc: INK });
  }
  function bands(c, x, y, w, h, bg, stripe, alpha) {
    if (w <= 0 || h <= 0) return;
    c.fillStyle = bg; c.fillRect(x, y, w, h);
    if (w > 12) stripes(c, x, y, w, h, 30, stripe, alpha == null ? .2 : alpha);
  }

  /* ---------------- 素材 ---------------- */
  function silPath(c, w, h) {
    c.beginPath();
    for (var i = 0; i < sil.polygon.length; i++) {
      var p = sil.polygon[i], X = p[0] / 100 * w, Y = p[1] / 100 * h;
      if (i === 0) c.moveTo(X, Y); else c.lineTo(X, Y);
    }
    c.closePath();
  }
  function buildCut() {
    if (!sil || !sil.polygon || !sil.polygon.length) return;
    var S = 1080, SH = Math.round(S * 672 / 504);
    silCut = document.createElement('canvas'); silCut.width = S; silCut.height = SH;
    var a = silCut.getContext('2d');
    silPath(a, S, SH); a.fillStyle = RED; a.fill();

    silHalf = document.createElement('canvas'); silHalf.width = S; silHalf.height = SH;
    var b = silHalf.getContext('2d');
    b.fillStyle = INK;
    for (var y = 0; y < SH; y += 8) for (var x = 0; x < S; x += 8) {
      b.beginPath(); b.arc(x, y, 1 + 2.4 * h1(x * .11 + y * .27), 0, 6.2832); b.fill();
    }
    b.globalCompositeOperation = 'destination-in';
    silPath(b, S, SH); b.fillStyle = '#000'; b.fill();

    silReady = true;
    if (pending && ready()) { pending = false; api.play(); }
  }
  function ready() { return silReady && (!img || img.complete); }
  function load() {
    if (loading) return;
    loading = true;
    fetch('assets/silhouette.json', { cache: 'force-cache' })
      .then(function (r) { return r.json(); })
      .then(function (j) { sil = j; buildCut(); })
      .catch(function () { silReady = true; if (pending && ready()) { pending = false; api.play(); } });
    img = new Image();
    img.onload = function () { imgOk = true; if (pending && ready()) { pending = false; api.play(); } };
    img.onerror = function () { imgOk = false; if (pending && ready()) { pending = false; api.play(); } };
    img.src = 'assets/portrait.jpg';
  }
  // 照片按 cover 裁切绘制
  function photo(c, x, y, w, h, fx, fy, zoom, alpha, tint) {
    if (!imgOk || w <= 0 || h <= 0) return;
    c.save();
    if (alpha != null) c.globalAlpha = c.globalAlpha * cl(alpha, 0, 1);
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    var s = Math.max(w / img.width, h / img.height) * (zoom || 1);
    var dw = img.width * s, dh = img.height * s;
    c.drawImage(img, x + (w - dw) * (fx == null ? .5 : fx), y + (h - dh) * (fy == null ? .5 : fy), dw, dh);
    if (tint) { c.fillStyle = tint; c.fillRect(x, y, w, h); }
    c.restore();
  }

  /* =========================================================
     分镜 1 · 登场 —— 照片亮起 + 标题
     ========================================================= */
  function s1(p) {
    ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
    var e = eo(seg(p, .04, .5));

    var cw = 366 * (.94 + .06 * e), chh = cw * 672 / 504;
    var cx = 306, cy = H / 2 + 8;
    ctx.save();
    ctx.globalAlpha = e;
    ctx.fillStyle = RED;
    ctx.fillRect(cx - cw / 2 + 20, cy - chh / 2 + 20, cw, chh);
    photo(ctx, cx - cw / 2, cy - chh / 2, cw, chh, .5, .34, 1.05 - .05 * e, 1, 'rgba(11,11,15,.12)');
    ctx.lineWidth = 5; ctx.strokeStyle = PAPER;
    ctx.strokeRect(cx - cw / 2, cy - chh / 2, cw, chh);
    var sy = cy - chh / 2 + chh * seg(p, .3, .84);
    var lg = ctx.createLinearGradient(0, sy - 40, 0, sy + 40);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(.5, 'rgba(255,255,255,.4)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg; ctx.fillRect(cx - cw / 2, sy - 40, cw, 80);
    ctx.strokeStyle = PAPER; ctx.lineWidth = 3;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (d) {
      var X = cx + d[0] * cw / 2, Y = cy + d[1] * chh / 2;
      ctx.beginPath();
      ctx.moveTo(X + d[0] * 22, Y); ctx.lineTo(X, Y); ctx.lineTo(X, Y + d[1] * 22);
      ctx.stroke();
    });
    ctx.restore();

    // 右侧标题（两块横条 + 文字）
    var t1 = eo(seg(p, .18, .52));
    ctx.save();
    ctx.globalAlpha = t1;
    ctx.translate(742, 258); ctx.rotate(-.03);
    bands(ctx, -230, -80, 460 * t1, 160, RED, INK, .18);
    text(ctx, '肥美先生', 0, 4, 84, { fill: PAPER, sw: 11 });
    ctx.restore();

    var t2 = eo(seg(p, .34, .7));
    ctx.save();
    ctx.globalAlpha = t2;
    ctx.translate(742, 404); ctx.rotate(-.03);
    bands(ctx, -252, -70, 504 * t2, 140, PAPER, RED, .22);
    text(ctx, '烦着瑞', 0, 4, 84, { fill: INK, sw: 0 });
    ctx.restore();

    var tp = seg(p, .5, .95);
    var str = 'FZR — PERSONAL PROFILE MOVIE';
    ctx.save(); ctx.globalAlpha = .95;
    text(ctx, str.slice(0, Math.floor(tp * str.length)), 742, 524, 25, { fill: PAPER, sw: 6, font: EN_FONT });
    ctx.restore();

    var d = seg(p, .62, 1);
    if (d > 0) {
      ctx.save(); ctx.globalAlpha = d;
      ctx.fillStyle = RED; ctx.fillRect(500, 556, 484 * d, 44);
      ctx.restore();
      ctx.save(); ctx.globalAlpha = d;
      text(ctx, 'A FILM BY 肥美工作室', 742, 578, 26, { fill: PAPER, sw: 0 });
      ctx.restore();
    }

    var out = seg(p, .92, 1);
    if (out > 0) { ctx.fillStyle = 'rgba(11,11,15,' + out + ')'; ctx.fillRect(0, 0, W, H); }
  }

  /* =========================================================
     分镜 2 · 惊闪 —— 放射 + 巨型「肥」砸下
     ========================================================= */
  function s2(p) {
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.rotate(-.06 + .1 * p);
    rays(ctx, 0, 0, 70, 1500, 42, INK, 1, .35);
    ctx.restore();

    var barP = eo(seg(p, .1, .45));
    ctx.fillStyle = RED;
    ctx.fillRect(0, H / 2 - 96 * barP, W, 192 * barP);

    var e = back(seg(p, .16, .62), 1.5);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-.07 * (1 - e));
    ctx.scale(.62 + .38 * e, .62 + .38 * e);
    bigChar(ctx, '肥', 0, 8, 296);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = seg(p, .5, .85);
    text(ctx, 'FATTY  GENERAL', W / 2, H - 82, 30, { fill: INK, sw: 5, sc: PAPER, font: EN_FONT });
    ctx.restore();

    var out = seg(p, .9, 1);
    if (out > 0) { ctx.fillStyle = 'rgba(11,11,15,' + out + ')'; ctx.fillRect(0, 0, W, H); }
  }

  /* =========================================================
     分镜 3 · 剪影显形 —— 照片 → 红色剪影 + 轮廓线描
     ========================================================= */
  function s3(p) {
    ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = .07;
    ctx.translate(W / 2, H / 2); ctx.rotate(clock * .04);
    rays(ctx, 0, 0, 150, 1500, 28, PAPER, 1, .2);
    ctx.restore();

    var pw = 452, phh = pw * 672 / 504;
    var px = W * .5 - pw / 2 + 54, py = H * .5 - phh / 2 + 6;

    ctx.save();
    ctx.globalAlpha = eo(seg(p, 0, .28));
    ctx.fillStyle = 'rgba(11,11,15,.92)';
    ctx.fillRect(px - 24, py - 24, pw + 48, phh + 48);
    ctx.strokeStyle = PAPER; ctx.lineWidth = 4;
    ctx.strokeRect(px - 24, py - 24, pw + 48, phh + 48);
    ctx.restore();

    var ph = Math.min(eo(seg(p, 0, .22)), 1 - eo(seg(p, .44, .74)));
    photo(ctx, px, py, pw, phh, .5, .32, 1.06 - .06 * p, ph, 'rgba(224,18,40,.2)');

    var se = eo(seg(p, .3, .68));
    if (silCut && se > .01) {
      ctx.save();
      ctx.globalAlpha = se;
      ctx.translate(px + pw / 2, py + phh / 2);
      ctx.scale(1 + .04 * p, 1 + .04 * p);
      ctx.translate(-pw / 2, -phh / 2);
      ctx.drawImage(silCut, 0, 0, pw, phh);
      ctx.globalAlpha = se * .5;
      ctx.drawImage(silHalf, 0, 0, pw, phh);
      ctx.restore();
    }

    if (sil && sil.polygon) {
      var dp = eio(seg(p, .12, .74));
      if (dp > 0) {
        ctx.save();
        ctx.translate(px, py);
        silPath(ctx, pw, phh);
        ctx.setLineDash([5200]);
        ctx.lineDashOffset = 5200 * (1 - dp);
        ctx.lineWidth = 5; ctx.lineJoin = 'round';
        ctx.strokeStyle = PAPER;
        ctx.shadowColor = 'rgba(255,43,69,.95)'; ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.setLineDash([]); ctx.shadowBlur = 0;
        var keys = Object.keys(sil.details || {});
        var kp = seg(p, .38, .95) * keys.length;
        ctx.lineWidth = 4; ctx.strokeStyle = INK;
        for (var i = 0; i < keys.length; i++) {
          if (i > kp) break;
          var arr = sil.details[keys[i]];
          ctx.globalAlpha = cl(kp - i, 0, 1) * dp;
          ctx.beginPath();
          for (var j = 0; j < arr.length; j++) {
            var X = arr[j][0] / 100 * pw, Y = arr[j][1] / 100 * phh;
            if (j === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }

    // 左侧竖排英文 + 红线
    var lp = eo(seg(p, .45, .85));
    if (lp > 0) {
      ctx.save(); ctx.globalAlpha = lp;
      ctx.fillStyle = RED; ctx.fillRect(72, H / 2 - 150 * lp, 6, 300 * lp);
      ctx.restore();
      ctx.save(); ctx.globalAlpha = lp;
      ctx.translate(126, H / 2); ctx.rotate(-Math.PI / 2);
      text(ctx, 'SILHOUETTE  /  LINE  ART', 0, 0, 26, { fill: PAPER, sw: 5, font: EN_FONT });
      ctx.restore();
    }

    var cp = eo(seg(p, .55, .9));
    if (cp > 0) {
      ctx.save();
      ctx.translate(0, H - 104);
      bands(ctx, 0, 0, W * cp, 82, RED, INK, .2);
      if (cp > .55) text(ctx, '军帽 · 绿色军装 · 黑框眼镜 · 憨厚将军', W / 2, 42, 38, { fill: PAPER, sw: 7 });
      ctx.restore();
    }

    var out = seg(p, .94, 1);
    if (out > 0) { ctx.fillStyle = 'rgba(11,11,15,' + out + ')'; ctx.fillRect(0, 0, W, H); }
  }

  /* =========================================================
     分镜 4 · 五个字板（每字 ~2.4s，版式各不相同）
     ========================================================= */
  var CH = '肥美范哲睿';
  function s4(p) {
    var idx = Math.min(4, Math.floor(p * 5));
    panel(idx, cl(p * 5 - idx, 0, 1));
  }

  function panel(i, lp) {
    var enter = eo(seg(lp, 0, .3)), hold = seg(lp, .3, .8), out = seg(lp, .9, 1);
    var ch = CH[i];

    if (i === 0) {
      // ① 照片二值化 + 剪影 + 右侧白卡
      ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
      dots(ctx, 0, 0, W, H, 28, RED, .42);
      var pw = 700, phh = pw * 672 / 504;
      var ox = -110 + (1 - enter) * -300;
      photo(ctx, ox, H / 2 - phh / 2, pw, phh, .5, .3, 1.28 - .08 * lp,
        cl(enter * 1.4, 0, 1), 'rgba(224,18,40,.6)');
      if (silCut && lp > .3) {
        ctx.save();
        ctx.globalAlpha = seg(lp, .3, .62) * .8;
        ctx.drawImage(silCut, ox, H / 2 - phh / 2, pw, phh);
        ctx.restore();
      }
      var cw = 466 * enter;
      if (cw > 4) {
        ctx.save();
        ctx.globalAlpha = cl(enter * 1.3, 0, 1);
        ctx.translate(W - 262, H / 2 + 8); ctx.rotate(-.04);
        bands(ctx, -cw / 2, -250, cw, 500, INK, RED, .3);
        ctx.lineWidth = 5; ctx.strokeStyle = PAPER;
        ctx.strokeRect(-cw / 2, -250, cw, 500);
        bigChar(ctx, ch, 0, 0, 292, PAPER, 13, RED);
        ctx.restore();
      }
      label(i, lp, 'DUOTONE');

    } else if (i === 1) {
      // ② 白底 + 黑斜块 + 红字 + 照片小卡
      ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
      stripes(ctx, 0, 0, W, H, 26, RED, .26);
      var bw = W * 1.12 * enter;
      ctx.save();
      ctx.translate(W / 2, H / 2 + 6); ctx.rotate(.045);
      ctx.fillStyle = INK; ctx.fillRect(-bw / 2, -172, bw, 344);
      ctx.restore();

      var sw = 178 + 46 * hold, sh = sw * 672 / 504;
      ctx.save();
      ctx.globalAlpha = seg(lp, .18, .46);
      ctx.translate(112 + (1 - enter) * -180, H - 92 - sh / 2);
      ctx.rotate(-.07);
      ctx.fillStyle = RED; ctx.fillRect(-sw / 2 + 14, -sh / 2 + 14, sw, sh);
      photo(ctx, -sw / 2, -sh / 2, sw, sh, .5, .32, 1.05, 1);
      ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
      ctx.restore();

      var e2 = back(enter, 1.4);
      ctx.save();
      ctx.globalAlpha = cl(enter * 1.3, 0, 1);
      ctx.translate(W / 2 + (1 - enter) * 80, H / 2 + 4);
      ctx.rotate(.02);
      ctx.scale(.82 + .18 * e2, .82 + .18 * e2);
      bigChar(ctx, ch, 0, 0, 310, PAPER, 15, RED);
      ctx.restore();
      label(i, lp, 'ZIPPER');

    } else if (i === 2) {
      // ③ 线描剪影特写 + 右侧竖卡
      ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalAlpha = .1;
      ctx.translate(W / 2, H / 2); ctx.rotate(-clock * .05);
      rays(ctx, 0, 0, 220, 1500, 32, RED, 1, .1);
      ctx.restore();

      if (sil && sil.polygon) {
        var z = (1 + .1 * eo(lp)) * (1 + .08 * (1 - enter));
        ctx.save();
        ctx.translate(W / 2 - 140 + (1 - enter) * 180, H / 2 + 18);
        ctx.scale(z, z);
        ctx.translate(-190, -253);
        silPath(ctx, 380, 507);
        ctx.fillStyle = 'rgba(224,18,40,.96)'; ctx.fill();
        ctx.lineWidth = 6; ctx.strokeStyle = PAPER; ctx.stroke();
        ctx.save(); silPath(ctx, 380, 507); ctx.clip();
        dots(ctx, -420, -420, 1300, 1500, 12, INK, .48);
        ctx.restore();
        var keys2 = Object.keys(sil.details || {});
        var kp2 = seg(lp, .22, .8) * keys2.length;
        ctx.lineWidth = 4; ctx.strokeStyle = INK;
        for (var q = 0; q < keys2.length; q++) {
          if (q > kp2) break;
          var arr2 = sil.details[keys2[q]];
          ctx.beginPath();
          for (var j2 = 0; j2 < arr2.length; j2++) {
            var X2 = arr2[j2][0] / 100 * 380, Y2 = arr2[j2][1] / 100 * 507;
            if (j2 === 0) ctx.moveTo(X2, Y2); else ctx.lineTo(X2, Y2);
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      var cw2 = 300 * enter;
      if (cw2 > 4) {
        ctx.save();
        ctx.globalAlpha = cl(enter * 1.3, 0, 1);
        ctx.translate(W - 214 + (1 - enter) * 200, H / 2); ctx.rotate(-.02);
        bands(ctx, -cw2 / 2, -256, cw2, 512, PAPER, INK, .12);
        bigChar(ctx, ch, 0, 0, 320, RED, 14);
        ctx.restore();
      }
      label(i, lp, 'LINE ART');

    } else if (i === 3) {
      // ④ 双层错位叠字 + 上下横条
      ctx.fillStyle = RED; ctx.fillRect(0, 0, W, H);
      dots(ctx, 0, 0, W, H, 18, INK, .38);
      var e3 = back(seg(lp, 0, .34), 1.5);
      ctx.save();
      ctx.globalAlpha = cl(seg(lp, 0, .2) * 1.4, 0, 1);
      ctx.translate(W / 2, H / 2 + 8);
      ctx.rotate(-.05 + .06 * hold);
      ctx.scale(e3, e3);
      // 黑字（带白描边）+ 红字错位，叠在红底上
      text(ctx, ch, 34, 30, 380, { fill: RED, sw: 26, sc: RED });
      text(ctx, ch, 0, 0, 380, { fill: INK, sw: 26, sc: PAPER });
      ctx.restore();

      var bp = eo(seg(lp, .18, .55));
      if (bp > 0) {
        ctx.fillStyle = INK; ctx.fillRect(0, 0, W, 72 * bp);
        ctx.fillStyle = PAPER; ctx.fillRect(0, H - 72 * bp, W, 72 * bp);
        if (bp > .6) {
          text(ctx, 'FATTY  ·  MEI  ·  FAN', W / 2, 36 * bp, 28, { fill: PAPER, sw: 0, font: EN_FONT });
          text(ctx, '哲  ·  THE  WISE  ONE', W / 2, H - 36 * bp, 28, { fill: INK, sw: 0, font: EN_FONT });
        }
      }
      label(i, lp, 'OVERPRINT');

    } else {
      // ⑤ 五字合体
      ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
      dots(ctx, 0, 0, W, H, 22, RED, .38);
      if (silCut) {
        ctx.save();
        ctx.globalAlpha = .3 + .06 * Math.sin(clock * 2);
        ctx.drawImage(silCut, W - 452, H - 602, 452, 602);
        ctx.restore();
      }
      var lay = [
        { x: .17, y: .29, s: 144, r: -.1, d: 0 },
        { x: .35, y: .20, s: 126, r: .07, d: 1 },
        { x: .52, y: .35, s: 162, r: -.04, d: 2 },
        { x: .70, y: .22, s: 134, r: .09, d: 3 },
        { x: .41, y: .60, s: 188, r: -.02, d: 4 }
      ];
      for (var k = 0; k < 5; k++) {
        var L = lay[k];
        var ap = seg(lp, L.d * .06, L.d * .06 + .22);
        if (ap <= 0) continue;
        var e4 = back(ap, 1.8);
        var odd = k % 2 === 1;
        ctx.save();
        ctx.globalAlpha = cl(ap * 1.5, 0, 1);
        ctx.translate(L.x * W, L.y * H - (1 - e4) * 190);
        ctx.rotate(L.r);
        ctx.scale(.55 + .45 * e4, .55 + .45 * e4);
        ctx.fillStyle = odd ? PAPER : RED;
        ctx.fillRect(-L.s * .5, -L.s * .5, L.s, L.s);
        bigChar(ctx, CH[k], 0, 6, L.s * .84,
          odd ? INK : PAPER, L.s * .05, odd ? RED : INK);
        ctx.restore();
      }
      label(i, lp, 'ALL FIVE');
    }

    if (out > 0) { ctx.fillStyle = 'rgba(11,11,15,' + out + ')'; ctx.fillRect(0, 0, W, H); }
  }

  function label(c, i, lp, tag) {
    var a = cl(seg(lp, 0, .18) * 1.2, 0, 1);
    if (a > 0) {
      c.save();
      c.globalAlpha = a;
      c.translate(100, 88); c.rotate(-.08);
      c.fillStyle = PAPER; c.fillRect(-40, -40, 80, 80);
      text(c, '0' + (i + 1), 0, 2, 46, { fill: INK, sw: 0 });
      c.restore();
    }
    var b = cl(seg(lp, .1, .3), 0, .85);
    if (b > 0) {
      c.save(); c.globalAlpha = b;
      text(c, 'CHARACTER  ' + (i + 1) + ' / 5   ·   ' + tag, W - 296, H - 42, 22,
        { fill: PAPER, sw: 5, font: EN_FONT });
      c.restore();
    }
  }

  /* =========================================================
     分镜 5 · 片尾
     ========================================================= */
  function s5(p) {
    ctx.fillStyle = RED; ctx.fillRect(0, 0, W, H);
    stripes(ctx, 0, 0, W, H, 64, INK, .1);
    dots(ctx, 0, 0, W, H, 16, 'rgba(0,0,0,.25)', .45);

    if (silCut) {
      var sh = H * .84, sw = sh * 504 / 672;
      var se = eo(seg(p, 0, .45));
      ctx.save();
      ctx.globalAlpha = se * .96;
      ctx.translate(W - sw - 76, H - sh + 44);
      ctx.drawImage(silCut, 0, 0, sw, sh);
      ctx.globalAlpha = se * .34;
      ctx.drawImage(silHalf, 0, 0, sw, sh);
      ctx.globalAlpha = se;
      pathSilLocal(ctx, sw, sh);
      ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.stroke();
      ctx.restore();
    }

    var e = eo(seg(p, .05, .45));
    ctx.save();
    ctx.globalAlpha = e;
    ctx.translate(424, 300); ctx.rotate(-.04);
    bands(ctx, -320, -136, 640, 272, INK, RED, .12);
    text(ctx, '肥美先生', 0, -52, 82, { fill: PAPER, sw: 10 });
    text(ctx, '烦着瑞', 0, 46, 82, { fill: KHAKI, sw: 10 });
    ctx.restore();

    var st = eo(seg(p, .4, .75));
    if (st > 0) {
      ctx.save();
      ctx.globalAlpha = st;
      ctx.translate(424, 552);
      ctx.rotate(-Math.PI / 10);
      ctx.scale(1.4 - .4 * st, 1.4 - .4 * st);
      ctx.strokeStyle = INK; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.arc(0, 0, 84, 0, 6.2832); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 70, 0, 6.2832); ctx.lineWidth = 3; ctx.stroke();
      text(ctx, '肥美', 0, -23, 46, { fill: INK, sw: 0 });
      text(ctx, '认证', 0, 27, 46, { fill: INK, sw: 0 });
      ctx.restore();
    }

    var ep = eo(seg(p, .5, .85));
    if (ep > 0) {
      ctx.save();
      ctx.globalAlpha = ep;
      ctx.translate(W / 2, H - 58);
      bands(ctx, -250 * ep, -29, 500 * ep, 58, PAPER, INK, .14);
      if (ep > .6) text(ctx, '完  ·  THE END', 0, 2, 33, { fill: INK, sw: 0 });
      ctx.restore();
    }

    var hp = seg(p, .72, 1);
    if (hp > 0) {
      ctx.save();
      ctx.globalAlpha = hp * (.6 + .4 * Math.sin(clock * 3.4));
      text(ctx, 'CLICK  ×  TO  CLOSE     ·     REPLAY  ANYTIME', W / 2, 90, 25,
        { fill: PAPER, sw: 5, font: EN_FONT });
      ctx.restore();
    }
  }
  function pathSilLocal(c, w, h) {
    c.beginPath();
    for (var i = 0; i < sil.polygon.length; i++) {
      var p = sil.polygon[i], X = p[0] / 100 * w, Y = p[1] / 100 * h;
      if (i === 0) c.moveTo(X, Y); else c.lineTo(X, Y);
    }
    c.closePath();
  }

  /* ---------------- 时间轴 ---------------- */
  var SCENES = [
    { a: 0.0, b: 6.4, fn: s1 },
    { a: 6.4, b: 8.6, fn: s2 },
    { a: 8.6, b: 14.2, fn: s3 },
    { a: 14.2, b: 26.2, fn: s4 },
    { a: 26.2, b: TOTAL, fn: s5 }
  ];
  var CUES = [
    [0.3, 'riser'], [1.0, 'whoosh'], [2.6, 'tick'], [3.3, 'tick'], [4.0, 'tick'],
    [6.5, 'impact'], [7.4, 'impact'], [8.7, 'whoosh'], [10.2, 'swipe'],
    [14.3, 'swipe'], [16.6, 'stamp'], [18.7, 'swipe'], [20.9, 'stamp'],
    [23.1, 'swipe'], [25.4, 'stamp'], [26.3, 'impact'], [28.6, 'ding'], [31.4, 'tick']
  ];

  function render(t) {
    for (var i = 0; i < CUES.length; i++) {
      if (!cued[CUES[i][0]] && t >= CUES[i][0]) { cued[CUES[i][0]] = 1; if (SFX[CUES[i][1]]) SFX[CUES[i][1]](); }
    }
    for (var k = 0; k < SCENES.length; k++) {
      var s = SCENES[k];
      if (t >= s.a && t < s.b) {
        ctx.save();
        s.fn((t - s.a) / (s.b - s.a), t);
        ctx.restore();
        break;
      }
    }
    var g = grainTex()[Math.abs(Math.floor(t * 16)) % 3];
    ctx.save(); ctx.globalAlpha = .035; ctx.drawImage(g, 0, 0); ctx.restore();
    var vg = ctx.createRadialGradient(W / 2, H / 2, H * .42, W / 2, H / 2, H);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  function frame(now) {
    if (!running) return;
    var t = (now - t0) / 1000;
    clock = t;
    if (t >= TOTAL) { render(TOTAL - .001); running = false; if (onEndFn) onEndFn(); return; }
    render(t);
    raf = requestAnimationFrame(frame);
  }

  /* ---------------- 对外 API ---------------- */
  var api = {
    init: function (canvas) {
      if (!canvas || !canvas.getContext) return;
      cv = canvas; cv.width = W; cv.height = H;
      ctx = cv.getContext('2d');
      if (!ctx) return;
      load();
      ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
      text(ctx, 'FZR — PROFILE MOVIE', W / 2, H / 2, 34, { fill: PAPER, sw: 8 });
    },
    play: function () {
      if (!ctx) return;
      if (!loading) load();
      if (!ready()) { pending = true; return; }
      pending = false; cued = {}; clock = 0; running = true;
      t0 = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
      if (soundOn) { ac(); SFX.whoosh(); }
    },
    stop: function () { running = false; cancelAnimationFrame(raf); },
    skipToEnd: function () { if (!ctx) return; this.stop(); clock = TOTAL - .02; render(TOTAL - .02); },
    seek: function (t) { if (!ctx) return; this.stop(); cued = {}; clock = t; render(cl(t, 0, TOTAL - .01)); },
    toggleSound: function () { soundOn = !soundOn; return soundOn; },
    isSoundOn: function () { return soundOn; },
    onEnd: function (fn) { onEndFn = fn; },
    get duration() { return TOTAL; }
  };
  return api;
})();
