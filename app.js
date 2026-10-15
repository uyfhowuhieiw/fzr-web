/* =========================================================
   肥美先生烦着瑞 — 主页交互
   · 背景音乐控制（含自动播放被拦截时的兜底）
   · 人物轮廓线描渲染
   · 弹窗系统（右上角叉关闭 / ESC / 点背景）
   · 三个按钮分别挂载：个人简介 / 介绍视频 / 小游戏
   ========================================================= */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------------------------------------------------------
     1. 标题逐字渐入
     --------------------------------------------------------- */
  function buildTitle() {
    var sub = $('#titleSub'), main = $('#titleMain');
    if (!sub || !main) return;
    var SUB = '肥美先生', MAIN = '烦着瑞';
    var i;
    for (i = 0; i < SUB.length; i++) {
      var a = document.createElement('span');
      a.className = 'ch' + (i === 0 ? ' ch--accent' : '');
      a.textContent = SUB[i];
      a.style.animationDelay = (0.78 + i * 0.085).toFixed(3) + 's';
      sub.appendChild(a);
    }
    for (i = 0; i < MAIN.length; i++) {
      var b = document.createElement('span');
      b.className = 'ch' + (i === MAIN.length - 1 ? ' ch--accent' : '');
      b.textContent = MAIN[i];
      b.style.animationDelay = (1.02 + i * 0.11).toFixed(3) + 's';
      main.appendChild(b);
    }
  }

  /* ---------------------------------------------------------
     2. 人物轮廓线描（读取 assets/silhouette.json）
     --------------------------------------------------------- */
  function drawOutline() {
    var shape = $('#plShape'), outline = $('#plOutline'), group = $('#plDetails');
    if (!shape || !outline) return;

    function apply(data) {
      var poly = data.polygon || [];
      var pts = poly.map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
      shape.setAttribute('points', pts);
      outline.setAttribute('points', pts);
      // 周长估算，用于 dash 动画
      var len = 0, i, n = poly.length;
      for (i = 0; i < n; i++) {
        var a = poly[i], b = poly[(i + 1) % n];
        len += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      outline.style.setProperty('--len', (len * 1.06).toFixed(1));

      if (group) {
        var NS = 'http://www.w3.org/2000/svg';
        Object.keys(data.details || {}).forEach(function (k, idx) {
          var pl = document.createElementNS(NS, 'polyline');
          pl.setAttribute('points', (data.details[k] || []).map(function (p) {
            return p[0] + ',' + p[1];
          }).join(' '));
          pl.style.opacity = '0';
          pl.style.transition = 'opacity .5s ease ' + (0.35 + idx * 0.055).toFixed(2) + 's';
          group.appendChild(pl);
          requestAnimationFrame(function () { pl.style.opacity = ''; });
        });
      }
    }

    fetch('assets/silhouette.json', { cache: 'force-cache' })
      .then(function (r) { if (!r.ok) throw new Error('轮廓数据加载失败'); return r.json(); })
      .then(apply)
      .catch(function () { /* 纯装饰，失败可忽略 */ });
  }

  /* ---------------------------------------------------------
     3. 背景音乐
     --------------------------------------------------------- */
  var Audio_ = {
    el: null,
    btn: null,
    text: null,
    bars: null,
    wanted: false,
    started: false,
    failed: false,
    userToggled: false,
    target: 0.62,

    init: function () {
      this.btn = $('#audioBtn');
      this.text = $('#audioText');
      this.bars = $('#audioBars');
      var self = this;
      var el = new Audio();
      el.src = 'assets/bgm.ogg';
      el.loop = true;
      el.preload = 'auto';
      el.volume = 0;
      this.el = el;
      window.__fzrAudio = this;   // 便于调试 / 自动化验证

      el.addEventListener('play', function () { self.render(true); });
      el.addEventListener('pause', function () { self.render(false); });
      el.addEventListener('error', function () {
        self.failed = true;
        self.wanted = false;
        self.render(false);
        if (self.text) self.text.textContent = '音乐无法播放';
      });

      if (this.btn) {
        this.btn.addEventListener('click', function () {
          self.userToggled = true;
          if (self.failed) return;
          if (self.el.paused) { self.wanted = true; self.play(); }
          else { self.wanted = false; self.el.pause(); }
        });
      }

      // 首次交互自动起播（浏览器通常需要用户手势）
      var kick = function () {
        window.removeEventListener('pointerdown', kick);
        window.removeEventListener('keydown', kick);
        window.removeEventListener('touchstart', kick);
        if (self.started || self.userToggled || self.failed) return;
        self.wanted = true;
        self.play();
      };
      window.addEventListener('pointerdown', kick, { passive: true });
      window.addEventListener('keydown', kick);
      window.addEventListener('touchstart', kick, { passive: true });

      // 进页面先尝试静音自动播放，成功后淡入
      el.muted = true;
      var p = el.play();
      if (p && p.then) {
        p.then(function () {
          el.muted = false;
          self.started = true;
          self.wanted = true;
          self.fadeIn();
          self.render(true);
        }).catch(function () {
          el.muted = false;
          self.render(false);
        });
      }
    },

    play: function () {
      var self = this;
      if (this.failed) return;
      this.el.muted = false;
      var p = this.el.play();
      if (p && p.then) {
        p.then(function () { self.fadeIn(); })
          .catch(function () {
            if (self.failed) return;
            if (self.text) self.text.textContent = '再点一下播放';
          });
      } else { this.fadeIn(); }
    },

    fadeIn: function () {
      var self = this;
      if (this._fading) return;
      this._fading = true;
      var step = function () {
        if (!self.wanted || self.el.paused) { self._fading = false; return; }
        var v = Math.min(self.target, self.el.volume + 0.04);
        self.el.volume = v;
        if (v < self.target) requestAnimationFrame(step); else self._fading = false;
      };
      requestAnimationFrame(step);
    },

    render: function (playing) {
      if (this.btn) this.btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      if (this.bars) this.bars.classList.toggle('is-live', !!playing);
      if (this.text) this.text.textContent = playing ? '暂停BGM' : '播放BGM';
    }
  };

  /* ---------------------------------------------------------
     4. 弹窗系统
     --------------------------------------------------------- */
  var Modals = {
    open: null,
    lastFocus: null,

    init: function () {
      var self = this;
      $$('[data-open]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.classList.contains('btn')) {
            b.classList.remove('btn--flash');
            void b.offsetWidth;
            b.classList.add('btn--flash');
          }
          self.show(b.getAttribute('data-open'));
        });
      });
      $$('[data-close]').forEach(function (c) {
        c.addEventListener('click', function () { self.hide(); });
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self.open) self.hide();
      });
    },

    show: function (name) {
      var box = document.querySelector('[data-modal="' + name + '"]');
      if (!box) return;
      if (this.open && this.open !== box) this.open.hidden = true;
      this.lastFocus = document.activeElement;
      box.hidden = false;
      this.open = box;
      document.body.style.overflow = 'hidden';
      var x = $('.x', box);
      if (x) x.focus({ preventScroll: true });
      if (name === 'video' && window.FZR_VIDEO) window.FZR_VIDEO.play();
      if (name === 'game') {
        sizeGameCanvas();
        requestAnimationFrame(sizeGameCanvas);   // 等布局稳定后再量一次
        if (window.FZR_GAME) window.FZR_GAME.start();
      }
    },

    hide: function () {
      var box = this.open;
      if (!box) return;
      var name = box.getAttribute('data-modal');
      box.hidden = true;
      this.open = null;
      document.body.style.overflow = '';
      if (name === 'video' && window.FZR_VIDEO) window.FZR_VIDEO.stop();
      if (name === 'game' && window.FZR_GAME) window.FZR_GAME.pause();
      if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus({ preventScroll: true });
    },

    isOpen: function (name) {
      return !!this.open && this.open.getAttribute('data-modal') === name;
    }
  };

  /* ---------------------------------------------------------
     5. 小游戏画布自适应
     画布内部分辨率固定，用 CSS 像素尺寸等比缩放到弹窗宽度内；
     弹窗隐藏时量到的宽度为 0，因此小于阈值就直接跳过（交由 CSS 兜底）。
     --------------------------------------------------------- */
  var GAME_NW = 760, GAME_NH = 860;
  function sizeGameCanvas() {
    var cv = $('#gameCanvas');
    if (!cv) return;
    var box = cv.parentElement;
    var w = (box ? box.clientWidth : 0) || 880;
    if (w < 200) return;
    var avail = Math.min(w, 880);
    var h = Math.max(360, window.innerHeight * 0.72);
    var scale = Math.min(avail / GAME_NW, h / GAME_NH);
    cv.style.width = Math.round(GAME_NW * scale) + 'px';
    cv.style.height = Math.round(GAME_NH * scale) + 'px';
  }

  /* ---------------------------------------------------------
     启动
     --------------------------------------------------------- */
  function boot() {
    buildTitle();
    drawOutline();
    Audio_.init();
    Modals.init();
    sizeGameCanvas();
    window.addEventListener('resize', sizeGameCanvas);

    if (window.FZR_VIDEO) window.FZR_VIDEO.init($('#videoCanvas'));
    if (window.FZR_GAME) window.FZR_GAME.init($('#gameCanvas'));

    var vReplay = $('#videoReplay'), vSkip = $('#videoSkip'), vMute = $('#videoMute');
    if (vReplay && window.FZR_VIDEO) vReplay.addEventListener('click', function () { window.FZR_VIDEO.play(); });
    if (vSkip && window.FZR_VIDEO) vSkip.addEventListener('click', function () { window.FZR_VIDEO.skipToEnd(); });
    if (vMute && window.FZR_VIDEO) {
      vMute.addEventListener('click', function () {
        var on = window.FZR_VIDEO.toggleSound();
        vMute.textContent = '音效:' + (on ? '开' : '关');
        vMute.setAttribute('aria-pressed', on ? 'false' : 'true');
      });
    }

    // 入场动画
    requestAnimationFrame(function () {
      document.body.classList.remove('is-loading');
      document.body.classList.add('ready');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 保险：即使脚本中途出错，也要让首屏内容可见
  window.setTimeout(function () {
    if (!document.body.classList.contains('ready')) {
      document.body.classList.remove('is-loading');
      document.body.classList.add('ready');
    }
  }, 1500);
})();
