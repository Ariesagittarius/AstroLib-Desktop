/**
 * electron/server/canvas/client-script.ts
 * ============================================================================
 * 章节无限自由画布工作台客户端引擎脚本（笔迹渲染 / 卡片 / AST 引用 / 导出）
 * ============================================================================
 */

export function buildCanvasClientScript(metaJson: string): string {
  return `
  (function () {
    var META = ${metaJson};
    var urlParams = new URLSearchParams(window.location.search);
    var EXPORT_MODE = urlParams.get('exportMode') || META.exportMode || '';

    if (EXPORT_MODE) {
      document.body.classList.add('cv-export-mode');
    }

    var viewport = document.getElementById('cv-viewport');
    var cardsLayer = document.getElementById('cv-cards-layer');
    var staticCanvas = document.getElementById('cv-ink-static');
    var liveCanvas = document.getElementById('cv-ink-live');
    var staticCtx = staticCanvas.getContext('2d', { alpha: true });
    // 禁用低延迟非同步直出缓冲，防止 Windows DWM DirectComposition 合成下触控板/笔光标高频闪烁
    var liveCtx = liveCanvas.getContext('2d', { alpha: true });
    var saveDot = document.getElementById('cv-save-dot');
    var zoomReadout = document.getElementById('btn-zoom-reset');
    var toastEl = document.getElementById('cv-toast');
    var btnUndo = document.getElementById('btn-undo');
    var btnRedo = document.getElementById('btn-redo');

    function resolveThemeAccentHex() {
      try {
        var val = getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary').trim();
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(val)) return val;
      } catch (_) {}
      return '#0b57d0';
    }

    var viewportRect = null;
    function refreshViewportRect() {
      viewportRect = viewport.getBoundingClientRect();
      return viewportRect;
    }
    function getCanvasDpr() {
      return Math.min(window.devicePixelRatio || 1, 2);
    }

    var initialAccent = resolveThemeAccentHex();
    var state = {
      tool: 'select', // select | pan | pen | highlighter | eraser
      brushStyle: 'fountain', // fountain | monoline | pencil | highlighter
      color: initialAccent,
      usingThemeAccent: true,
      width: 2.5,
      panX: 80,
      panY: 80,
      zoom: 1,
      blocks: [],
      strokes: [],
      astNodes: [],
      selectedCardId: null,
      spacePressed: false,
      activePointerId: null,
      activeStroke: null,
      activeBbox: null,
      emaPressure: 0.5,
      liveDrawnIndex: 0,
      liveRafId: null,
      liveNeedsDraw: false,
      staticBasePanX: 80,
      staticBasePanY: 80,
      staticBaseZoom: 1,
      staticRedrawTimer: null,
      transformRafId: null,
      transformInteractive: false,
      saveTimer: null,
      maxSaveTimer: null,
      saveInFlight: false,
      savePendingAfterFlight: false,
      blocksDirty: false,
      strokesDirty: false,
      dirty: false,
      undoStack: [],
      redoStack: [],
      maxHistory: 120,
    };

    var ICON_QUOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.667-1.333 4.333-4 5"/><path d="M19 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.667-1.333 4.333-4 5"/></svg>';
    var ICON_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>';
    var ICON_LOCATE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
    var ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    var ICON_DONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    var ICON_DELETE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    var toastTimer = null;
    function showToast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
    }

    function escapeInlineHtml(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function computeStrokeBbox(points, width, brushStyle) {
      if (!points || points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < points.length; i++) {
        var pt = points[i];
        if (pt[0] < minX) minX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] > maxY) maxY = pt[1];
      }
      var pad = (width || 2.5) * (brushStyle === 'highlighter' ? 2.5 : 1.8) + 6;
      return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    }

    function ensureStrokeBbox(stroke) {
      if (!stroke._bbox) {
        stroke._bbox = computeStrokeBbox(stroke.points, stroke.width, stroke.brushStyle);
      }
      return stroke._bbox;
    }

    function cloneBlock(block) {
      return JSON.parse(JSON.stringify(block));
    }

    function syncUndoButtons() {
      btnUndo.disabled = state.undoStack.length === 0;
      btnRedo.disabled = state.redoStack.length === 0;
    }

    function pushUndoAction(action) {
      state.undoStack.push(action);
      if (state.undoStack.length > state.maxHistory) {
        state.undoStack.shift();
      }
      state.redoStack = [];
      syncUndoButtons();
    }

    function findCardElById(id) {
      return cardsLayer.querySelector('[data-card-id="' + CSS.escape(id) + '"]');
    }

    function applyBlockPatchToDom(block) {
      var el = findCardElById(block.id);
      if (!el) return;
      el.style.left = (block.x || 0) + 'px';
      el.style.top = (block.y || 0) + 'px';
      el.style.width = (block.width || 320) + 'px';
      if (block.height) el.style.height = block.height + 'px';
      else el.style.height = '';
    }

    function applyUndo() {
      if (state.undoStack.length === 0) return;
      var action = state.undoStack.pop();
      state.redoStack.push(action);
      syncUndoButtons();

      if (action.type === 'add-stroke') {
        var idx = state.strokes.lastIndexOf(action.stroke);
        if (idx !== -1) state.strokes.splice(idx, 1);
        else state.strokes = state.strokes.filter(function (s) { return s.id !== action.stroke.id; });
        redrawStaticInk();
        scheduleSave('stroke');
      } else if (action.type === 'remove-strokes') {
        var sortedAdd = action.removed.slice().sort(function (a, b) { return a.index - b.index; });
        for (var i = 0; i < sortedAdd.length; i++) {
          var item = sortedAdd[i];
          var insIdx = Math.min(item.index, state.strokes.length);
          state.strokes.splice(insIdx, 0, item.stroke);
        }
        redrawStaticInk();
        scheduleSave('stroke');
      } else if (action.type === 'add-block') {
        state.blocks = state.blocks.filter(function (b) { return b.id !== action.block.id; });
        var elAdd = findCardElById(action.block.id);
        if (elAdd) elAdd.remove();
        scheduleSave('block');
      } else if (action.type === 'remove-block') {
        var insPos = Math.min(action.index, state.blocks.length);
        var restored = cloneBlock(action.block);
        state.blocks.splice(insPos, 0, restored);
        renderAllCards();
        scheduleSave('block');
      } else if (action.type === 'move-block') {
        var mb = state.blocks.find(function (b) { return b.id === action.id; });
        if (mb) {
          mb.x = action.fromX;
          mb.y = action.fromY;
          mb.updatedAt = action.fromUpdatedAt || mb.updatedAt;
          applyBlockPatchToDom(mb);
          scheduleSave('block');
        }
      } else if (action.type === 'resize-block') {
        var rb = state.blocks.find(function (b) { return b.id === action.id; });
        if (rb) {
          rb.width = action.fromW;
          rb.height = action.fromH;
          rb.updatedAt = action.fromUpdatedAt || rb.updatedAt;
          applyBlockPatchToDom(rb);
          scheduleSave('block');
        }
      } else if (action.type === 'update-block') {
        var ub = state.blocks.find(function (b) { return b.id === action.id; });
        if (ub) {
          ub.content = action.before.content;
          ub.updatedAt = action.before.updatedAt || ub.updatedAt;
          if (ub.astRef) {
            if (action.before.renderedHtml) ub.astRef.renderedHtml = action.before.renderedHtml;
            else delete ub.astRef.renderedHtml;
          }
          var uEl = findCardElById(ub.id);
          if (uEl) {
            var bodyEl = uEl.querySelector('.cv-card-body');
            if (bodyEl) syncBlockRenderedContent(ub, bodyEl);
          }
          scheduleSave('block');
        }
      }
      showToast('已撤销');
    }

    function applyRedo() {
      if (state.redoStack.length === 0) return;
      var action = state.redoStack.pop();
      state.undoStack.push(action);
      syncUndoButtons();

      if (action.type === 'add-stroke') {
        state.strokes.push(action.stroke);
        stampStrokeToStatic(action.stroke);
        scheduleSave('stroke');
      } else if (action.type === 'remove-strokes') {
        var idSet = {};
        for (var i = 0; i < action.removed.length; i++) {
          idSet[action.removed[i].stroke.id] = true;
        }
        state.strokes = state.strokes.filter(function (s) { return !idSet[s.id]; });
        redrawStaticInk();
        scheduleSave('stroke');
      } else if (action.type === 'add-block') {
        var nb = cloneBlock(action.block);
        state.blocks.push(nb);
        cardsLayer.appendChild(renderCardElement(nb));
        scheduleSave('block');
      } else if (action.type === 'remove-block') {
        state.blocks = state.blocks.filter(function (b) { return b.id !== action.block.id; });
        var elDel = findCardElById(action.block.id);
        if (elDel) elDel.remove();
        scheduleSave('block');
      } else if (action.type === 'move-block') {
        var mb = state.blocks.find(function (b) { return b.id === action.id; });
        if (mb) {
          mb.x = action.toX;
          mb.y = action.toY;
          mb.updatedAt = action.toUpdatedAt || mb.updatedAt;
          applyBlockPatchToDom(mb);
          scheduleSave('block');
        }
      } else if (action.type === 'resize-block') {
        var rb = state.blocks.find(function (b) { return b.id === action.id; });
        if (rb) {
          rb.width = action.toW;
          rb.height = action.toH;
          rb.updatedAt = action.toUpdatedAt || rb.updatedAt;
          applyBlockPatchToDom(rb);
          scheduleSave('block');
        }
      } else if (action.type === 'update-block') {
        var ub = state.blocks.find(function (b) { return b.id === action.id; });
        if (ub) {
          ub.content = action.after.content;
          ub.updatedAt = action.after.updatedAt || ub.updatedAt;
          if (ub.astRef) {
            if (action.after.renderedHtml) ub.astRef.renderedHtml = action.after.renderedHtml;
            else delete ub.astRef.renderedHtml;
          }
          var uEl = findCardElById(ub.id);
          if (uEl) {
            var bodyEl = uEl.querySelector('.cv-card-body');
            if (bodyEl) syncBlockRenderedContent(ub, bodyEl);
          }
          scheduleSave('block');
        }
      }
      showToast('已重做');
    }

    /* 坐标系换算：无限世界坐标 <-> 视口屏幕坐标（零热路径回流） */
    function screenToWorld(clientX, clientY) {
      var rect = viewportRect || refreshViewportRect();
      return {
        x: (clientX - rect.left - state.panX) / state.zoom,
        y: (clientY - rect.top - state.panY) / state.zoom,
      };
    }

    function applyViewportTransformImmediate(isInteractive) {
      cardsLayer.style.transform =
        'translate3d(' + state.panX + 'px, ' + state.panY + 'px, 0) scale(' + state.zoom + ')';

      var dotStep = 24 * state.zoom;
      while (dotStep < 12) dotStep *= 2;
      while (dotStep > 52) dotStep /= 2;
      viewport.style.backgroundSize = dotStep.toFixed(2) + 'px ' + dotStep.toFixed(2) + 'px';
      viewport.style.backgroundPosition = state.panX.toFixed(1) + 'px ' + state.panY.toFixed(1) + 'px';

      zoomReadout.textContent = Math.round(state.zoom * 100) + '%';

      if (isInteractive) {
        var baseZoom = state.staticBaseZoom || 1;
        var relScale = state.zoom / baseZoom;
        var tx = state.panX - state.staticBasePanX * relScale;
        var ty = state.panY - state.staticBasePanY * relScale;
        staticCanvas.style.transformOrigin = '0 0';
        staticCanvas.style.transform =
          'translate3d(' + tx.toFixed(2) + 'px, ' + ty.toFixed(2) + 'px, 0) scale(' + relScale.toFixed(6) + ')';
        if (state.staticRedrawTimer) clearTimeout(state.staticRedrawTimer);
        state.staticRedrawTimer = setTimeout(function () {
          state.staticRedrawTimer = null;
          staticCanvas.style.transform = '';
          redrawStaticInk();
        }, 90);
      } else {
        if (state.staticRedrawTimer) {
          clearTimeout(state.staticRedrawTimer);
          state.staticRedrawTimer = null;
        }
        staticCanvas.style.transform = '';
        redrawStaticInk();
      }
    }

    function applyViewportTransform(isInteractive) {
      if (!isInteractive) {
        if (state.transformRafId) {
          cancelAnimationFrame(state.transformRafId);
          state.transformRafId = null;
        }
        applyViewportTransformImmediate(false);
        return;
      }
      state.transformInteractive = true;
      if (!state.transformRafId) {
        state.transformRafId = requestAnimationFrame(function () {
          state.transformRafId = null;
          applyViewportTransformImmediate(state.transformInteractive);
          state.transformInteractive = false;
        });
      }
    }

    function resizeCanvases() {
      var rect = refreshViewportRect();
      var dpr = getCanvasDpr();
      var w = Math.max(1, Math.floor(rect.width * dpr));
      var h = Math.max(1, Math.floor(rect.height * dpr));
      if (staticCanvas.width !== w || staticCanvas.height !== h) {
        staticCanvas.width = w;
        staticCanvas.height = h;
      }
      if (liveCanvas.width !== w || liveCanvas.height !== h) {
        liveCanvas.width = w;
        liveCanvas.height = h;
      }
      staticCanvas.style.transform = '';
      redrawStaticInk();
    }

    /* Windows Ink 顺滑曲线 + 四种笔触质感增量/整段渲染 */
    function drawStrokeRange(ctx, stroke, fromK, toK) {
      var pts = stroke.points;
      if (!pts || pts.length === 0) return;

      var style = stroke.brushStyle || (stroke.tool === 'highlighter' ? 'highlighter' : 'fountain');
      var baseW = Number(stroke.width || 2.5);
      var color = stroke.color || resolveThemeAccentHex();
      var baseOpacity = stroke.opacity != null ? Number(stroke.opacity) : (style === 'highlighter' ? 0.28 : 1);

      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.globalAlpha = baseOpacity;
      ctx.lineJoin = 'round';
      ctx.lineCap = style === 'highlighter' ? 'butt' : 'round';

      if (style === 'highlighter') {
        baseW = baseW * 3.2;
      }

      if (pts.length === 1) {
        if (fromK <= 0) {
          var r = Math.max(0.5, (baseW * (style === 'fountain' ? (0.4 + 0.9 * (pts[0][2] || 0.5)) : 1)) / 2);
          ctx.beginPath();
          ctx.arc(pts[0][0], pts[0][1], r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        return;
      }

      var startK = Math.max(0, fromK | 0);
      var endK = Math.min(pts.length - 2, toK | 0);
      if (startK > endK) {
        ctx.restore();
        return;
      }

      if (style === 'monoline' || style === 'highlighter') {
        ctx.lineWidth = baseW;
        ctx.beginPath();
        for (var i = startK; i <= endK; i++) {
          var mp0 = i > 0 ? pts[i - 1] : pts[i];
          var mp1 = pts[i];
          var mp2 = pts[i + 1];
          var mx0 = i === 0 ? mp1[0] : (mp0[0] + mp1[0]) * 0.5;
          var my0 = i === 0 ? mp1[1] : (mp0[1] + mp1[1]) * 0.5;
          var mx2 = i === pts.length - 2 ? mp2[0] : (mp1[0] + mp2[0]) * 0.5;
          var my2 = i === pts.length - 2 ? mp2[1] : (mp1[1] + mp2[1]) * 0.5;
          if (i === startK) ctx.moveTo(mx0, my0);
          ctx.quadraticCurveTo(mp1[0], mp1[1], mx2, my2);
        }
        ctx.stroke();
        ctx.restore();
        return;
      }

      var zoomScale = EXPORT_MODE ? 1 : (state.zoom || 1);
      var maxSteps = EXPORT_MODE ? 8 : 4;
      var stepDivisor = EXPORT_MODE ? 3 : 4.5;

      for (var k = startK; k <= endK; k++) {
        var p0 = k > 0 ? pts[k - 1] : pts[k];
        var p1 = pts[k];
        var p2 = pts[k + 1];

        var x0 = k === 0 ? p1[0] : (p0[0] + p1[0]) * 0.5;
        var y0 = k === 0 ? p1[1] : (p0[1] + p1[1]) * 0.5;
        var w0 = k === 0 ? (p1[2] != null ? p1[2] : 0.5) : ((p0[2] != null ? p0[2] : 0.5) + (p1[2] != null ? p1[2] : 0.5)) * 0.5;

        var x2 = k === pts.length - 2 ? p2[0] : (p1[0] + p2[0]) * 0.5;
        var y2 = k === pts.length - 2 ? p2[1] : (p1[1] + p2[1]) * 0.5;
        var w2 = k === pts.length - 2 ? (p2[2] != null ? p2[2] : 0.5) : ((p1[2] != null ? p1[2] : 0.5) + (p2[2] != null ? p2[2] : 0.5)) * 0.5;

        var segDist = Math.hypot(x2 - x0, y2 - y0) * zoomScale;
        var steps = Math.max(1, Math.min(maxSteps, Math.ceil(segDist / stepDivisor)));

        for (var s = 0; s < steps; s++) {
          var t0 = s / steps;
          var t1 = (s + 1) / steps;
          var qx0 = (1 - t0) * (1 - t0) * x0 + 2 * (1 - t0) * t0 * p1[0] + t0 * t0 * x2;
          var qy0 = (1 - t0) * (1 - t0) * y0 + 2 * (1 - t0) * t0 * p1[1] + t0 * t0 * y2;
          var qx1 = (1 - t1) * (1 - t1) * x0 + 2 * (1 - t1) * t1 * p1[0] + t1 * t1 * x2;
          var qy1 = (1 - t1) * (1 - t1) * y0 + 2 * (1 - t1) * t1 * p1[1] + t1 * t1 * y2;

          var pr = w0 + (w2 - w0) * ((t0 + t1) * 0.5);
          if (style === 'pencil') {
            ctx.globalAlpha = baseOpacity * (0.28 + 0.58 * pr);
            ctx.lineWidth = Math.max(0.6, baseW * (0.55 + 0.65 * pr));
          } else {
            ctx.lineWidth = Math.max(0.6, baseW * (0.35 + 1.15 * pr));
          }
          ctx.beginPath();
          ctx.moveTo(qx0, qy0);
          ctx.lineTo(qx1, qy1);
          ctx.stroke();

          if (style === 'pencil') {
            ctx.globalAlpha = baseOpacity * 0.22;
            ctx.lineWidth = Math.max(0.5, ctx.lineWidth * 0.65);
            ctx.beginPath();
            ctx.moveTo(qx0 + 0.6, qy0 - 0.5);
            ctx.lineTo(qx1 - 0.5, qy1 + 0.6);
            ctx.stroke();
          }
        }
      }

      ctx.restore();
    }

    function drawInkSegment(ctx, stroke) {
      var pts = stroke && stroke.points;
      if (!pts || pts.length === 0) return;
      drawStrokeRange(ctx, stroke, 0, Math.max(0, pts.length - 2));
    }

    function redrawStaticInk() {
      var dpr = getCanvasDpr();
      staticCtx.setTransform(1, 0, 0, 1, 0, 0);
      staticCtx.clearRect(0, 0, staticCanvas.width, staticCanvas.height);

      staticCtx.setTransform(
        dpr * state.zoom, 0, 0,
        dpr * state.zoom,
        dpr * state.panX, dpr * state.panY
      );
      state.staticBasePanX = state.panX;
      state.staticBasePanY = state.panY;
      state.staticBaseZoom = state.zoom;

      var rect = viewportRect || refreshViewportRect();
      var viewMinX = -state.panX / state.zoom - 40;
      var viewMinY = -state.panY / state.zoom - 40;
      var viewMaxX = (rect.width - state.panX) / state.zoom + 40;
      var viewMaxY = (rect.height - state.panY) / state.zoom + 40;

      for (var i = 0; i < state.strokes.length; i++) {
        var s = state.strokes[i];
        var b = ensureStrokeBbox(s);
        if (b.maxX < viewMinX || b.minX > viewMaxX || b.maxY < viewMinY || b.minY > viewMaxY) {
          continue;
        }
        drawInkSegment(staticCtx, s);
      }
    }

    function stampStrokeToStatic(stroke) {
      if (!stroke || !stroke.points || stroke.points.length === 0) return;
      if (state.staticRedrawTimer || staticCanvas.style.transform) {
        if (state.staticRedrawTimer) {
          clearTimeout(state.staticRedrawTimer);
          state.staticRedrawTimer = null;
        }
        staticCanvas.style.transform = '';
        redrawStaticInk();
        return;
      }
      var dpr = getCanvasDpr();
      staticCtx.setTransform(
        dpr * state.zoom, 0, 0,
        dpr * state.zoom,
        dpr * state.panX, dpr * state.panY
      );
      drawInkSegment(staticCtx, stroke);
    }

    function clearLiveInk() {
      liveCtx.setTransform(1, 0, 0, 1, 0, 0);
      liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
    }

    function flushLiveInkFrame() {
      state.liveRafId = null;
      if (!state.activeStroke) {
        clearLiveInk();
        state.liveDrawnIndex = 0;
        return;
      }
      state.liveNeedsDraw = false;
      var dpr = getCanvasDpr();
      var stroke = state.activeStroke;
      var pts = stroke.points;
      var style = stroke.brushStyle || (stroke.tool === 'highlighter' ? 'highlighter' : 'fountain');

      if (style === 'highlighter' || pts.length <= 1 || state.liveDrawnIndex === 0) {
        liveCtx.setTransform(1, 0, 0, 1, 0, 0);
        liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
        liveCtx.setTransform(
          dpr * state.zoom, 0, 0,
          dpr * state.zoom,
          dpr * state.panX, dpr * state.panY
        );
        drawInkSegment(liveCtx, stroke);
        state.liveDrawnIndex = pts.length > 1 ? pts.length - 1 : 0;
        return;
      }

      var fromK = Math.max(0, state.liveDrawnIndex - 1);
      var toK = pts.length - 2;
      if (fromK <= toK) {
        liveCtx.setTransform(
          dpr * state.zoom, 0, 0,
          dpr * state.zoom,
          dpr * state.panX, dpr * state.panY
        );
        drawStrokeRange(liveCtx, stroke, fromK, toK);
        state.liveDrawnIndex = pts.length - 1;
      }
    }

    function scheduleLiveInkDraw() {
      state.liveNeedsDraw = true;
      if (!state.liveRafId) {
        state.liveRafId = requestAnimationFrame(flushLiveInkFrame);
      }
    }

    function renderMarkdownSimple(text) {
      return escapeInlineHtml(text || '').replace(/\\n/g, '<br/>');
    }

    function sanitizeClientHtml(rawHtml) {
      if (!rawHtml) return '';
      var tpl = document.createElement('template');
      tpl.innerHTML = String(rawHtml);
      var blocked = tpl.content.querySelectorAll('script, style, iframe, frame, object, embed, applet, base, meta, link, form, input, textarea, select, noscript');
      for (var i = 0; i < blocked.length; i++) {
        blocked[i].remove();
      }
      var allEls = tpl.content.querySelectorAll('*');
      for (var j = 0; j < allEls.length; j++) {
        var node = allEls[j];
        var attrs = Array.prototype.slice.call(node.attributes);
        for (var k = 0; k < attrs.length; k++) {
          var attrName = attrs[k].name.toLowerCase();
          var attrVal = (attrs[k].value || '').replace(/[\\u0000-\\u0020\\u007f]+/g, '');
          if (attrName.indexOf('on') === 0 || attrName === 'srcdoc' || attrName === 'formaction') {
            node.removeAttribute(attrs[k].name);
          } else if (attrName === 'href' || attrName === 'xlink:href' || attrName === 'src') {
            if (/^(?:javascript:|vbscript:|data:text\\/html|data:image\\/svg\\+xml)/i.test(attrVal)) {
              node.removeAttribute(attrs[k].name);
            }
          }
        }
      }
      return tpl.innerHTML;
    }

    function syncBlockRenderedContent(block, bodyEl) {
      if (block.kind === 'ast-quote' && block.astRef && block.astRef.renderedHtml) {
        bodyEl.innerHTML = '<div class="cv-ast-quote-original markdown-content">' + sanitizeClientHtml(block.astRef.renderedHtml) + '</div>';
        return;
      }

      if (block.kind === 'ast-quote' && block.astRef && block.astRef.nodeId && !block.astRef.renderedHtml && !block._fetchingHtml) {
        block._fetchingHtml = true;
        fetch('/api/v1/content/books/' + encodeURIComponent(META.colSlug) + '/' + encodeURIComponent(META.bookSlug)
          + '/chapters/' + encodeURIComponent(META.chapterSlug) + '/nodes/' + encodeURIComponent(block.astRef.nodeId) + '/html')
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.data && res.data.html) {
              var cleanHtml = sanitizeClientHtml(res.data.html);
              block.astRef.renderedHtml = cleanHtml;
              bodyEl.innerHTML = '<div class="cv-ast-quote-original markdown-content">' + cleanHtml + '</div>';
              scheduleSave('block');
            }
          })
          .catch(function () {});
      }

      var raw = block.content || '';
      if (!raw.trim()) {
        bodyEl.innerHTML = '<span style="color:var(--cv-ink-muted);font-size:12px;">双击编辑按钮录入笔记（支持 Markdown 与 LaTeX）</span>';
        return;
      }
      bodyEl.innerHTML = renderMarkdownSimple(raw);
      fetch('/api/v1/content/annotations/render-markdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: raw }),
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.html && !bodyEl.querySelector('textarea')) {
            bodyEl.innerHTML = '<div class="cv-ast-quote-original">' + sanitizeClientHtml(res.html) + '</div>';
          }
        })
        .catch(function () {});
    }

    function renderCardElement(block) {
      var el = document.createElement('div');
      el.className = 'cv-card';
      el.setAttribute('data-card-id', block.id);
      if (state.selectedCardId === block.id) el.classList.add('selected');
      el.style.left = (block.x || 0) + 'px';
      el.style.top = (block.y || 0) + 'px';
      el.style.width = (block.width || 320) + 'px';
      if (block.height) el.style.height = block.height + 'px';
      if (block.color && block.color !== '#ffffff') {
        el.setAttribute('data-accent', '1');
        if (block.kind !== 'ast-quote') {
          el.style.setProperty('--card-accent', block.color);
        }
      }

      var header = document.createElement('div');
      header.className = 'cv-card-header';

      var badge = document.createElement('span');
      badge.className = 'cv-card-badge';
      if (block.kind === 'ast-quote' && block.astRef) {
        badge.innerHTML = ICON_QUOTE + '<span>原文引用 · ' + escapeInlineHtml(block.astRef.nodeId) + '</span>';
      } else {
        badge.innerHTML = ICON_NOTE + '<span>笔记卡片</span>';
      }

      var actions = document.createElement('div');
      actions.className = 'cv-card-actions';

      if (block.kind === 'ast-quote' && block.astRef && block.astRef.nodeId) {
        var jumpBtn = document.createElement('button');
        jumpBtn.type = 'button';
        jumpBtn.className = 'cv-card-mini-btn';
        jumpBtn.title = '在左侧原书高亮聚焦此段';
        jumpBtn.innerHTML = ICON_LOCATE;
        jumpBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          try {
            window.parent.postMessage({
              type: 'astrolib:focus-ast-node',
              colSlug: META.colSlug,
              bookSlug: META.bookSlug,
              chapterSlug: META.chapterSlug,
              nodeId: block.astRef.nodeId,
            }, '*');
          } catch (_) {}
          showToast('已通知原书定位 ' + block.astRef.nodeId);
        });
        actions.appendChild(jumpBtn);
      }

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'cv-card-mini-btn';
      editBtn.title = '编辑内容';
      editBtn.innerHTML = ICON_EDIT;

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'cv-card-mini-btn danger';
      delBtn.title = '删除卡片';
      delBtn.innerHTML = ICON_DELETE;
      delBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var rmIdx = state.blocks.findIndex(function (b) { return b.id === block.id; });
        if (rmIdx !== -1) {
          pushUndoAction({ type: 'remove-block', index: rmIdx, block: cloneBlock(state.blocks[rmIdx]) });
        }
        state.blocks = state.blocks.filter(function (b) { return b.id !== block.id; });
        el.remove();
        scheduleSave('block');
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      header.appendChild(badge);
      header.appendChild(actions);

      var body = document.createElement('div');
      body.className = 'cv-card-body';
      syncBlockRenderedContent(block, body);

      var isEditing = false;
      function toggleEdit() {
        isEditing = !isEditing;
        if (isEditing) {
          editBtn.innerHTML = ICON_DONE;
          editBtn.title = '完成编辑';
          var ta = document.createElement('textarea');
          ta.className = 'cv-card-editor';
          ta.value = block.content || '';
          ta.placeholder = '支持 Markdown 与 $LaTeX$ 公式...';
          ta.addEventListener('keydown', function (ke) {
            if (ke.key === 'Escape') {
              ke.preventDefault();
              toggleEdit();
            }
          });
          body.innerHTML = '';
          body.appendChild(ta);
          ta.focus();
        } else {
          editBtn.innerHTML = ICON_EDIT;
          editBtn.title = '编辑内容';
          var ta2 = body.querySelector('textarea');
          if (ta2) {
            if (ta2.value !== block.content) {
              var beforeSnap = {
                content: block.content,
                renderedHtml: block.astRef && block.astRef.renderedHtml ? block.astRef.renderedHtml : undefined,
                updatedAt: block.updatedAt,
              };
              block.content = ta2.value;
              if (block.kind === 'ast-quote' && block.astRef && block.astRef.renderedHtml) {
                delete block.astRef.renderedHtml;
              }
              block.updatedAt = new Date().toISOString();
              pushUndoAction({
                type: 'update-block',
                id: block.id,
                before: beforeSnap,
                after: { content: block.content, renderedHtml: undefined, updatedAt: block.updatedAt },
              });
              scheduleSave('block');
            }
          }
          syncBlockRenderedContent(block, body);
        }
      }
      editBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        toggleEdit();
      });

      var resizeHandle = document.createElement('div');
      resizeHandle.className = 'cv-card-resize';
      resizeHandle.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M11 14L14 11M6 14L14 6"/></svg>';

      el.addEventListener('pointerdown', function () {
        document.querySelectorAll('.cv-card.selected').forEach(function (n) { n.classList.remove('selected'); });
        el.classList.add('selected');
        state.selectedCardId = block.id;
      });

      header.addEventListener('pointerdown', function (e) {
        if (e.target.closest('button')) return;
        e.stopPropagation();
        var startX = e.clientX;
        var startY = e.clientY;
        var origX = block.x || 0;
        var origY = block.y || 0;
        var origUpdatedAt = block.updatedAt;
        var moved = false;

        function onMove(me) {
          var dx = (me.clientX - startX) / state.zoom;
          var dy = (me.clientY - startY) / state.zoom;
          if (!moved && Math.hypot(dx, dy) > 2) {
            moved = true;
          }
          if (moved) {
            block.x = Math.round(origX + dx);
            block.y = Math.round(origY + dy);
            el.style.left = block.x + 'px';
            el.style.top = block.y + 'px';
          }
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (moved) {
            block.updatedAt = new Date().toISOString();
            pushUndoAction({
              type: 'move-block',
              id: block.id,
              fromX: origX,
              fromY: origY,
              toX: block.x,
              toY: block.y,
              fromUpdatedAt: origUpdatedAt,
              toUpdatedAt: block.updatedAt,
            });
            scheduleSave('block');
          }
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });

      resizeHandle.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
        var startX = e.clientX;
        var startY = e.clientY;
        var origW = el.offsetWidth;
        var origH = el.offsetHeight;
        var origBW = block.width;
        var origBH = block.height;
        var origUpdatedAt = block.updatedAt;
        var resized = false;

        function onMove(me) {
          var dw = (me.clientX - startX) / state.zoom;
          var dh = (me.clientY - startY) / state.zoom;
          if (!resized && Math.hypot(dw, dh) > 2) {
            resized = true;
          }
          if (resized) {
            block.width = Math.max(220, Math.round(origW + dw));
            block.height = Math.max(110, Math.round(origH + dh));
            el.style.width = block.width + 'px';
            el.style.height = block.height + 'px';
          }
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (resized) {
            block.updatedAt = new Date().toISOString();
            pushUndoAction({
              type: 'resize-block',
              id: block.id,
              fromW: origBW,
              fromH: origBH,
              toW: block.width,
              toH: block.height,
              fromUpdatedAt: origUpdatedAt,
              toUpdatedAt: block.updatedAt,
            });
            scheduleSave('block');
          }
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });

      el.appendChild(header);
      el.appendChild(body);
      el.appendChild(resizeHandle);
      return el;
    }

    function renderAllCards() {
      cardsLayer.innerHTML = '';
      for (var i = 0; i < state.blocks.length; i++) {
        cardsLayer.appendChild(renderCardElement(state.blocks[i]));
      }
    }

    /* 工具切换 */
    function setTool(tool) {
      state.tool = tool;
      document.querySelectorAll('[data-tool]').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tool') === tool);
      });
      viewport.classList.remove('tool-pan', 'tool-draw', 'tool-eraser');
      if (tool === 'pan') {
        viewport.classList.add('tool-pan');
      } else if (tool === 'pen' || tool === 'highlighter') {
        viewport.classList.add('tool-draw');
        if (tool === 'highlighter' && state.brushStyle !== 'highlighter') {
          updateBrushUI('highlighter', state.width, state.color, true);
        } else if (tool === 'pen' && state.brushStyle === 'highlighter') {
          updateBrushUI('fountain', state.width, state.color, true);
        }
      } else if (tool === 'eraser') {
        viewport.classList.add('tool-eraser');
      }
    }

    function updateBrushUI(style, width, color, skipToolSync, isThemeSync) {
      state.brushStyle = style;
      state.width = Number(width);
      state.color = color;
      if (isThemeSync !== undefined) state.usingThemeAccent = Boolean(isThemeSync);

      var styleNames = { fountain: '钢笔', monoline: '匀速', pencil: '铅笔', highlighter: '荧光' };
      var themeSwatch = document.querySelector('.cv-swatch[data-theme-swatch="1"]');
      if (themeSwatch) {
        var accentHex = resolveThemeAccentHex();
        themeSwatch.setAttribute('data-color', accentHex);
      }
      document.getElementById('cv-brush-dot').style.background = color;
      document.getElementById('cv-brush-label').textContent = (styleNames[style] || '钢笔') + ' · ' + state.width;
      document.getElementById('cv-width-val').textContent = String(state.width);
      document.getElementById('cv-width-slider').value = String(state.width);
      document.getElementById('cv-color-picker').value = /^#[0-9a-f]{6}$/i.test(color) ? color : resolveThemeAccentHex();

      document.querySelectorAll('#cv-brush-style-row [data-style]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-style') === style);
      });
      document.querySelectorAll('.cv-width-chip').forEach(function (b) {
        b.classList.toggle('active', Math.abs(Number(b.getAttribute('data-w')) - state.width) < 0.05);
      });
      document.querySelectorAll('.cv-swatch').forEach(function (b) {
        var c = (b.getAttribute('data-color') || '').toLowerCase();
        b.classList.toggle('active', c === color.toLowerCase());
      });

      if (!skipToolSync) {
        if (style === 'highlighter') setTool('highlighter');
        else if (state.tool !== 'pen' && state.tool !== 'highlighter') setTool('pen');
      }
    }

    window.__astrolibCanvasSyncAccent = function () {
      var nextAccent = resolveThemeAccentHex();
      if (state.usingThemeAccent && nextAccent) {
        updateBrushUI(state.brushStyle, state.width, nextAccent, true, true);
      } else {
        var themeSwatch = document.querySelector('.cv-swatch[data-theme-swatch="1"]');
        if (themeSwatch) themeSwatch.setAttribute('data-color', nextAccent);
      }
    };

    /* 视口平移与缩放 */
    var isPanning = false;
    var panStart = { x: 0, y: 0, panX: 0, panY: 0 };

    viewport.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = viewportRect || refreshViewportRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey || !e.shiftKey) {
        var factor = e.deltaY < 0 ? 1.09 : 0.917;
        var nextZoom = Math.min(4, Math.max(0.15, state.zoom * factor));
        var scale = nextZoom / state.zoom;
        state.panX = mx - (mx - state.panX) * scale;
        state.panY = my - (my - state.panY) * scale;
        state.zoom = nextZoom;
        applyViewportTransform(true);
      } else {
        state.panX -= e.deltaY;
        state.panY -= e.deltaX;
        applyViewportTransform(true);
      }
    }, { passive: false });

    function pointToSegmentDist(px, py, ax, ay, bx, by) {
      var dx = bx - ax;
      var dy = by - ay;
      var len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(px - ax, py - ay);
      var t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }

    function eraseAtWorld(wx, wy) {
      var hitRadius = 14 / state.zoom;
      var hitIndices = [];
      for (var i = 0; i < state.strokes.length; i++) {
        var s = state.strokes[i];
        var b = ensureStrokeBbox(s);
        if (wx < b.minX - hitRadius || wx > b.maxX + hitRadius || wy < b.minY - hitRadius || wy > b.maxY + hitRadius) {
          continue;
        }
        var pts = s.points || [];
        for (var j = 0; j < pts.length - 1; j++) {
          if (pointToSegmentDist(wx, wy, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]) <= hitRadius) {
            hitIndices.push(i);
            break;
          }
        }
        if (pts.length === 1 && Math.hypot(wx - pts[0][0], wy - pts[0][1]) <= hitRadius) {
          hitIndices.push(i);
        }
      }
      if (hitIndices.length > 0) {
        var removedList = [];
        var hitSet = {};
        for (var h = 0; h < hitIndices.length; h++) {
          var hi = hitIndices[h];
          hitSet[hi] = true;
          removedList.push({ index: hi, stroke: state.strokes[hi] });
        }
        pushUndoAction({ type: 'remove-strokes', removed: removedList });
        state.strokes = state.strokes.filter(function (_, idx) { return !hitSet[idx]; });
        redrawStaticInk();
        scheduleSave('stroke');
      }
    }

    function closeAllPopovers() {
      document.getElementById('cv-brush-popover').classList.remove('open');
      document.getElementById('cv-export-popover').classList.remove('open');
    }

    function appendInkEvent(ev) {
      if (!state.activeStroke) return;
      if (!ev || !Number.isFinite(ev.clientX) || !Number.isFinite(ev.clientY)) return;
      var wPt = screenToWorld(ev.clientX, ev.clientY);
      if (!Number.isFinite(wPt.x) || !Number.isFinite(wPt.y)) return;
      var pts = state.activeStroke.points;
      var last = pts[pts.length - 1];
      var distScreen = Math.hypot((wPt.x - last[0]) * state.zoom, (wPt.y - last[1]) * state.zoom);
      if (distScreen < 1.35) return;

      var rawP = ev.pressure;
      if (ev.pointerType !== 'pen' || !rawP || rawP <= 0) {
        var speed = distScreen;
        rawP = Math.max(0.28, Math.min(0.88, 0.86 - speed * 0.018));
      }
      state.emaPressure = state.emaPressure * 0.62 + rawP * 0.38;
      pts.push([
        Number(wPt.x.toFixed(2)),
        Number(wPt.y.toFixed(2)),
        Number(state.emaPressure.toFixed(3)),
      ]);
    }

    function pickSafeInkEvents(e) {
      if (typeof e.getCoalescedEvents !== 'function') return [e];
      var list = e.getCoalescedEvents();
      if (!list || list.length === 0) return [e];
      var lastCe = list[list.length - 1];
      if (
        !lastCe ||
        !Number.isFinite(lastCe.clientX) ||
        !Number.isFinite(lastCe.clientY) ||
        Math.hypot(lastCe.clientX - e.clientX, lastCe.clientY - e.clientY) > 16
      ) {
        return [e];
      }
      var filtered = [];
      for (var i = 0; i < list.length; i++) {
        var ce = list[i];
        if (!ce || !Number.isFinite(ce.clientX) || !Number.isFinite(ce.clientY)) continue;
        if (ce.clientX === 0 && ce.clientY === 0 && Math.hypot(e.clientX, e.clientY) > 24) continue;
        if (Math.hypot(ce.clientX - e.clientX, ce.clientY - e.clientY) > 360) continue;
        filtered.push(ce);
      }
      return filtered.length > 0 ? filtered : [e];
    }

    viewport.addEventListener('pointerdown', function (e) {
      closeAllPopovers();
      if (e.target.closest('.cv-card')) return;
      refreshViewportRect();

      if (e.button === 1 || state.tool === 'pan' || state.spacePressed || (e.button === 0 && state.tool === 'select')) {
        isPanning = true;
        viewport.classList.add('tool-pan', 'panning');
        panStart = { x: e.clientX, y: e.clientY, panX: state.panX, panY: state.panY };
        try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
        return;
      }

      if (e.button !== 0 && e.pointerType === 'mouse') return;

      if (state.tool === 'eraser') {
        var wpE = screenToWorld(e.clientX, e.clientY);
        eraseAtWorld(wpE.x, wpE.y);
        state.activePointerId = e.pointerId;
        try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
        return;
      }

      if (state.tool === 'pen' || state.tool === 'highlighter') {
        var wp = screenToWorld(e.clientX, e.clientY);
        var style = state.tool === 'highlighter' ? 'highlighter' : state.brushStyle;
        var initP = (e.pointerType === 'pen' && e.pressure > 0) ? e.pressure : 0.55;
        state.emaPressure = initP;
        state.activePointerId = e.pointerId;
        state.liveDrawnIndex = 0;
        state.activeStroke = {
          id: 'cstroke-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
          color: state.color,
          width: state.width,
          opacity: style === 'highlighter' ? 0.28 : 1,
          brushStyle: style,
          tool: style === 'highlighter' ? 'highlighter' : 'pen',
          points: [[Number(wp.x.toFixed(2)), Number(wp.y.toFixed(2)), Number(initP.toFixed(3))]],
        };
        try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
        scheduleLiveInkDraw();
      }
    });

    function handleInkMove(e) {
      if (isPanning) {
        state.panX = panStart.panX + (e.clientX - panStart.x);
        state.panY = panStart.panY + (e.clientY - panStart.y);
        applyViewportTransform(true);
        return;
      }

      if (state.activePointerId !== e.pointerId) return;

      if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
        finishPointerAction(e);
        return;
      }

      if (state.tool === 'eraser') {
        var wpE = screenToWorld(e.clientX, e.clientY);
        eraseAtWorld(wpE.x, wpE.y);
        return;
      }

      if (!state.activeStroke) return;
      var prevLen = state.activeStroke.points.length;
      var events = pickSafeInkEvents(e);
      for (var i = 0; i < events.length; i++) {
        appendInkEvent(events[i]);
      }
      if (state.activeStroke.points.length > prevLen) {
        scheduleLiveInkDraw();
      }
    }

    viewport.addEventListener('pointermove', handleInkMove);

    function finishPointerAction(e) {
      if (isPanning) {
        isPanning = false;
        viewport.classList.remove('panning');
        if (state.tool !== 'pan') viewport.classList.remove('tool-pan');
        try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
        return;
      }

      if (state.activePointerId !== e.pointerId) return;
      state.activePointerId = null;
      try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}

      if (state.liveRafId) {
        cancelAnimationFrame(state.liveRafId);
        state.liveRafId = null;
      }
      state.liveNeedsDraw = false;

      if (state.activeStroke) {
        var finishedStroke = state.activeStroke;
        state.activeStroke = null;
        state.liveDrawnIndex = 0;
        clearLiveInk();

        if (finishedStroke.points.length >= 1) {
          ensureStrokeBbox(finishedStroke);
          state.strokes.push(finishedStroke);
          pushUndoAction({ type: 'add-stroke', stroke: finishedStroke });
          stampStrokeToStatic(finishedStroke);
          scheduleSave('stroke');
        }
      }
    }

    viewport.addEventListener('pointerup', finishPointerAction);
    viewport.addEventListener('pointercancel', finishPointerAction);

    /* 持久化读写 */
    function setSaveStatus(status) {
      saveDot.classList.remove('dirty', 'error');
      if (status === 'dirty') {
        saveDot.classList.add('dirty');
        saveDot.title = '有未保存笔记（停笔后自动保存 / Ctrl+S）';
      } else if (status === 'error') {
        saveDot.classList.add('error');
        saveDot.title = '保存失败，请检查本地服务';
      } else {
        saveDot.title = '全部更改已自动保存';
      }
    }

    function clearSaveTimers() {
      if (state.saveTimer) {
        clearTimeout(state.saveTimer);
        state.saveTimer = null;
      }
      if (state.maxSaveTimer) {
        clearTimeout(state.maxSaveTimer);
        state.maxSaveTimer = null;
      }
    }

    function flushSave(useKeepalive) {
      clearSaveTimers();
      if (state.saveInFlight && !useKeepalive) {
        state.savePendingAfterFlight = true;
        return Promise.resolve();
      }
      var hadBlocksDirty = state.blocksDirty;
      var prevStrokesDirty = state.strokesDirty;
      state.dirty = false;
      state.blocksDirty = false;
      state.strokesDirty = false;
      if (!useKeepalive) state.saveInFlight = true;

      var cleanStrokes = (state.strokes || []).map(function (s) {
        return {
          id: s.id,
          color: s.color,
          width: s.width,
          opacity: s.opacity,
          brushStyle: s.brushStyle,
          tool: s.tool,
          points: s.points,
        };
      });
      var payload = {
        action: 'save-canvas',
        chapterTitle: META.chapterTitle,
        canvasNote: {
          blocks: state.blocks,
          strokes: cleanStrokes,
          viewport: { panX: state.panX, panY: state.panY, zoom: state.zoom },
          updatedAt: new Date().toISOString(),
        },
      };
      var reqOpts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      };
      if (useKeepalive) {
        reqOpts.keepalive = true;
      }
      return fetch('/api/v1/content/annotations/books/' + encodeURIComponent(META.colSlug) + '/' + encodeURIComponent(META.bookSlug) + '/chapters/' + encodeURIComponent(META.chapterSlug), reqOpts)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          if (!state.dirty) setSaveStatus('saved');
          if (hadBlocksDirty) {
            try {
              window.parent.postMessage({ type: 'astrolib:refresh-annotations' }, '*');
            } catch (_) {}
          }
        })
        .catch(function (err) {
          state.dirty = true;
          if (hadBlocksDirty) state.blocksDirty = true;
          if (prevStrokesDirty) state.strokesDirty = true;
          setSaveStatus('error');
          console.error('[AstroLib Canvas] 保存失败:', err);
        })
        .finally(function () {
          if (!useKeepalive) {
            state.saveInFlight = false;
            if (state.savePendingAfterFlight || state.dirty) {
              state.savePendingAfterFlight = false;
              scheduleSave(state.blocksDirty ? 'block' : 'stroke');
            }
          }
        });
    }

    function tryFlushSaveIdle() {
      if (!state.dirty) {
        clearSaveTimers();
        return;
      }
      if (state.activePointerId !== null || isPanning) {
        if (state.saveTimer) clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(tryFlushSaveIdle, 1500);
        return;
      }
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(function () {
          if (state.activePointerId === null && !isPanning && state.dirty) {
            flushSave(false);
          } else if (state.dirty) {
            if (state.saveTimer) clearTimeout(state.saveTimer);
            state.saveTimer = setTimeout(tryFlushSaveIdle, 1500);
          }
        }, { timeout: 1000 });
      } else {
        flushSave(false);
      }
    }

    function scheduleSave(kind) {
      var k = kind || 'all';
      if (k === 'block' || k === 'all') state.blocksDirty = true;
      if (k === 'stroke' || k === 'all') state.strokesDirty = true;
      state.dirty = true;
      setSaveStatus('dirty');
      if (state.saveTimer) clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(tryFlushSaveIdle, 3000);
      if (!state.maxSaveTimer) {
        state.maxSaveTimer = setTimeout(tryFlushSaveIdle, 15000);
      }
    }

    function prepareExportRender() {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < state.blocks.length; i++) {
        var b = state.blocks[i];
        var bx = b.x || 0;
        var by = b.y || 0;
        var bw = b.width || 320;
        var domEl = cardsLayer.querySelector('[data-card-id="' + CSS.escape(b.id) + '"]');
        var bh = b.height || (domEl ? domEl.offsetHeight : 160);
        if (bx < minX) minX = bx;
        if (by < minY) minY = by;
        if (bx + bw > maxX) maxX = bx + bw;
        if (by + bh > maxY) maxY = by + bh;
      }
      for (var j = 0; j < state.strokes.length; j++) {
        var sb = ensureStrokeBbox(state.strokes[j]);
        if (sb.minX < minX) minX = sb.minX;
        if (sb.minY < minY) minY = sb.minY;
        if (sb.maxX > maxX) maxX = sb.maxX;
        if (sb.maxY > maxY) maxY = sb.maxY;
      }

      var pad = 48;
      if (!isFinite(minX)) {
        minX = 0; minY = 0; maxX = 800; maxY = 560;
      }
      var contentW = Math.max(480, Math.ceil(maxX - minX + pad * 2));
      var contentH = Math.max(360, Math.ceil(maxY - minY + pad * 2));

      state.zoom = 1;
      state.panX = pad - minX;
      state.panY = pad - minY;

      document.documentElement.style.width = contentW + 'px';
      document.documentElement.style.height = contentH + 'px';
      document.body.style.width = contentW + 'px';
      document.body.style.height = contentH + 'px';
      viewport.style.width = contentW + 'px';
      viewport.style.height = contentH + 'px';

      cardsLayer.style.transform = 'translate3d(' + state.panX + 'px, ' + state.panY + 'px, 0) scale(1)';

      var exportScale = 2;
      staticCanvas.width = contentW * exportScale;
      staticCanvas.height = contentH * exportScale;
      staticCanvas.style.width = contentW + 'px';
      staticCanvas.style.height = contentH + 'px';
      staticCtx.setTransform(exportScale, 0, 0, exportScale, exportScale * state.panX, exportScale * state.panY);
      staticCtx.clearRect(-state.panX, -state.panY, contentW, contentH);
      for (var k = 0; k < state.strokes.length; k++) {
        drawInkSegment(staticCtx, state.strokes[k]);
      }

      window.__astrolibExportSize = { width: contentW, height: contentH };
      window.__astrolibExportReady = true;
    }

    function loadCanvas() {
      return fetch('/api/v1/content/annotations/books/' + encodeURIComponent(META.colSlug) + '/' + encodeURIComponent(META.bookSlug) + '/chapters/' + encodeURIComponent(META.chapterSlug) + '?withAst=false')
        .then(function (r) { return r.json(); })
        .then(function (res) {
          var cn = (res && res.data && res.data.canvasNote) ? res.data.canvasNote : {};
          state.blocks = Array.isArray(cn.blocks) ? cn.blocks : [];
          state.strokes = Array.isArray(cn.strokes) ? cn.strokes : [];
          if (!EXPORT_MODE && cn.viewport && typeof cn.viewport.panX === 'number') {
            state.panX = cn.viewport.panX;
            state.panY = cn.viewport.panY;
            state.zoom = Math.min(4, Math.max(0.15, Number(cn.viewport.zoom || 1)));
          } else {
            state.panX = 80;
            state.panY = 80;
            state.zoom = 1;
          }
          renderAllCards();
          resizeCanvases();
          applyViewportTransform();
          setSaveStatus('saved');

          if (EXPORT_MODE) {
            Promise.resolve(document.fonts ? document.fonts.ready : null).then(function () {
              setTimeout(prepareExportRender, 260);
            });
          }
        })
        .catch(function (err) {
          console.error('[AstroLib Canvas] 加载失败:', err);
          if (EXPORT_MODE) {
            setTimeout(prepareExportRender, 260);
          }
        });
    }

    function fitToContent() {
      if (state.blocks.length === 0 && state.strokes.length === 0) {
        state.panX = 80;
        state.panY = 80;
        state.zoom = 1;
        applyViewportTransform();
        return;
      }
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      state.blocks.forEach(function (b) {
        minX = Math.min(minX, b.x || 0);
        minY = Math.min(minY, b.y || 0);
        maxX = Math.max(maxX, (b.x || 0) + (b.width || 320));
        maxY = Math.max(maxY, (b.y || 0) + (b.height || 200));
      });
      state.strokes.forEach(function (s) {
        var sb = ensureStrokeBbox(s);
        minX = Math.min(minX, sb.minX);
        minY = Math.min(minY, sb.minY);
        maxX = Math.max(maxX, sb.maxX);
        maxY = Math.max(maxY, sb.maxY);
      });
      var rect = viewport.getBoundingClientRect();
      var pad = 60;
      var cw = Math.max(100, maxX - minX);
      var ch = Math.max(100, maxY - minY);
      var zx = (rect.width - pad * 2) / cw;
      var zy = (rect.height - pad * 2) / ch;
      state.zoom = Math.min(1.35, Math.max(0.2, Math.min(zx, zy)));
      state.panX = (rect.width - cw * state.zoom) * 0.5 - minX * state.zoom;
      state.panY = (rect.height - ch * state.zoom) * 0.5 - minY * state.zoom;
      applyViewportTransform();
    }

    function zoomCenterBy(factor) {
      var rect = viewport.getBoundingClientRect();
      var cx = rect.width * 0.5;
      var cy = rect.height * 0.5;
      var nextZoom = Math.min(4, Math.max(0.15, state.zoom * factor));
      var scale = nextZoom / state.zoom;
      state.panX = cx - (cx - state.panX) * scale;
      state.panY = cy - (cy - state.panY) * scale;
      state.zoom = nextZoom;
      applyViewportTransform();
    }

    function createMarkdownCard() {
      var rect = viewportRect || refreshViewportRect();
      var center = screenToWorld(rect.left + rect.width * 0.5, rect.top + rect.height * 0.5);
      var offset = (state.blocks.length % 5) * 20;
      var block = {
        id: 'cblk-' + Date.now().toString(36),
        kind: 'markdown',
        x: Math.round(center.x - 160 + offset),
        y: Math.round(center.y - 90 + offset),
        width: 320,
        content: '### 新笔记\\n\\n支持插入 Markdown 与公式：$E = mc^2$',
        color: '#ffffff',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      pushUndoAction({ type: 'add-block', block: cloneBlock(block) });
      state.blocks.push(block);
      cardsLayer.appendChild(renderCardElement(block));
      scheduleSave('block');
    }

    var astModal = document.getElementById('cv-ast-modal');
    var astList = document.getElementById('cv-ast-list');
    var astSearch = document.getElementById('cv-ast-search');

    function renderAstList(filter) {
      var q = (filter || '').toLowerCase();
      var items = (state.astNodes || []).filter(function (n) {
        if (!q) return true;
        return (n.nodeId || '').toLowerCase().indexOf(q) >= 0 || (n.text || '').toLowerCase().indexOf(q) >= 0;
      });
      if (items.length === 0) {
        astList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--cv-ink-muted);font-size:13px;">未匹配到章节 AST 节点</div>';
        return;
      }
      astList.innerHTML = items.slice(0, 100).map(function (n) {
        var preview = (n.text || '').replace(/\\s+/g, ' ').slice(0, 140);
        return '<div class="cv-ast-row" data-pick-node="' + escapeInlineHtml(n.nodeId) + '">'
          + '<div class="cv-ast-meta"><span>' + escapeInlineHtml(n.nodeId) + '</span><span>[' + escapeInlineHtml(n.type || 'node') + ']</span></div>'
          + '<div class="cv-ast-preview">' + escapeInlineHtml(preview) + '</div>'
          + '</div>';
      }).join('');
    }

    function flattenAstTree(tree) {
      var list = [];
      function walk(arr) {
        if (!Array.isArray(arr)) return;
        for (var i = 0; i < arr.length; i++) {
          var node = arr[i];
          if (!node || !node.id) continue;
          var label = (node.title ? (node.title + ' · ') : '') + (node.preview || node.summary || node.latex || node.rawMdx || '');
          list.push({
            nodeId: node.id,
            type: node.type || 'node',
            text: label,
          });
          if (Array.isArray(node.children) && node.children.length > 0) {
            walk(node.children);
          }
        }
      }
      walk(tree);
      return list;
    }

    function openAstQuotePicker() {
      closeAllPopovers();
      astModal.classList.add('open');
      astSearch.value = '';
      astList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--cv-ink-muted);font-size:13px;">正在读取本章原文 AST 树...</div>';
      fetch('/api/v1/content/books/' + encodeURIComponent(META.colSlug) + '/' + encodeURIComponent(META.bookSlug) + '/chapters/' + encodeURIComponent(META.chapterSlug) + '/ast')
        .then(function (r) { return r.json(); })
        .then(function (res) {
          var data = (res && res.data) ? res.data : {};
          if (Array.isArray(data.tree) && data.tree.length > 0) {
            state.astNodes = flattenAstTree(data.tree);
          } else if (Array.isArray(data.nodes)) {
            state.astNodes = data.nodes;
          } else {
            state.astNodes = [];
          }
          renderAstList('');
          astSearch.focus();
        })
        .catch(function () {
          astList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--cv-danger);font-size:13px;">无法加载章节 AST 数据</div>';
        });
    }

    astSearch.addEventListener('input', function () { renderAstList(astSearch.value); });

    astList.addEventListener('click', function (e) {
      var row = e.target.closest('[data-pick-node]');
      if (!row) return;
      var nodeId = row.getAttribute('data-pick-node');
      var node = state.astNodes.find(function (n) { return n.nodeId === nodeId; });
      if (!node) return;
      astModal.classList.remove('open');

      var rect = viewport.getBoundingClientRect();
      var center = screenToWorld(rect.left + rect.width * 0.5, rect.top + rect.height * 0.5);
      var offset = (state.blocks.length % 5) * 20;

      fetch('/api/v1/content/books/' + encodeURIComponent(META.colSlug) + '/' + encodeURIComponent(META.bookSlug)
        + '/chapters/' + encodeURIComponent(META.chapterSlug) + '/nodes/' + encodeURIComponent(nodeId) + '/html')
        .then(function (r) { return r.json(); })
        .then(function (res) { return res && res.data && res.data.html ? res.data.html : ''; })
        .catch(function () { return ''; })
        .then(function (renderedHtml) {
          var block = {
            id: 'cblk-' + Date.now().toString(36),
            kind: 'ast-quote',
            x: Math.round(center.x - 190 + offset),
            y: Math.round(center.y - 100 + offset),
            width: 380,
            content: '> ' + String(node.text || '').replace(/\\s+/g, ' ').slice(0, 320),
            color: resolveThemeAccentHex(),
            astRef: {
              nodeId: node.nodeId,
              nodeType: node.type,
              excerpt: String(node.text || '').slice(0, 200),
              renderedHtml: renderedHtml || undefined,
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          pushUndoAction({ type: 'add-block', block: cloneBlock(block) });
          state.blocks.push(block);
          cardsLayer.appendChild(renderCardElement(block));
          scheduleSave('block');
        });
    });

    document.getElementById('cv-ast-close').addEventListener('click', function () {
      astModal.classList.remove('open');
    });

    function triggerCanvasExport(format, dpi) {
      closeAllPopovers();
      showToast(format === 'pdf' ? '正在渲染高清 PDF...' : '正在渲染 ' + dpi + ' DPI PNG...');
      Promise.resolve(state.dirty ? flushSave() : null).then(function () {
        var payload = {
          type: 'astrolib:export-canvas',
          format: format,
          dpi: Number(dpi || 300),
          colSlug: META.colSlug,
          bookSlug: META.bookSlug,
          chapterSlug: META.chapterSlug,
          title: (META.chapterTitle || META.chapterSlug) + '-自由画布',
        };
        if (window.astrolib && format === 'pdf' && typeof window.astrolib.exportCanvasPdf === 'function') {
          window.astrolib.exportCanvasPdf(payload).then(function (r) {
            if (r && r.canceled) return;
            showToast(r && r.ok ? 'PDF 已保存至：' + r.filePath : '导出失败：' + ((r && r.error) || '未知错误'));
          });
          return;
        }
        if (window.astrolib && format === 'png' && typeof window.astrolib.exportCanvasPng === 'function') {
          window.astrolib.exportCanvasPng(payload).then(function (r) {
            if (r && r.canceled) return;
            showToast(r && r.ok ? 'PNG 已保存至：' + r.filePath : '导出失败：' + ((r && r.error) || '未知错误'));
          });
          return;
        }
        window.parent.postMessage(payload, '*');
      });
    }

    document.querySelectorAll('[data-tool]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeAllPopovers();
        setTool(btn.getAttribute('data-tool'));
      });
    });

    document.getElementById('btn-brush-popover').addEventListener('click', function (e) {
      e.stopPropagation();
      var pop = document.getElementById('cv-brush-popover');
      var wasOpen = pop.classList.contains('open');
      closeAllPopovers();
      if (!wasOpen) pop.classList.add('open');
    });

    document.getElementById('btn-export-popover').addEventListener('click', function (e) {
      e.stopPropagation();
      var pop = document.getElementById('cv-export-popover');
      var wasOpen = pop.classList.contains('open');
      closeAllPopovers();
      if (!wasOpen) pop.classList.add('open');
    });

    document.getElementById('cv-brush-style-row').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-style]');
      if (!btn) return;
      updateBrushUI(btn.getAttribute('data-style'), state.width, state.color, false);
    });

    document.querySelectorAll('.cv-width-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        updateBrushUI(state.brushStyle, Number(btn.getAttribute('data-w')), state.color, false);
      });
    });

    document.getElementById('cv-width-slider').addEventListener('input', function (e) {
      updateBrushUI(state.brushStyle, Number(e.target.value), state.color, false);
    });

    document.querySelectorAll('.cv-swatch').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var isThemeSwatch = btn.getAttribute('data-theme-swatch') === '1';
        var col = isThemeSwatch ? resolveThemeAccentHex() : btn.getAttribute('data-color');
        updateBrushUI(state.brushStyle, state.width, col, false, isThemeSwatch);
      });
    });

    document.getElementById('cv-color-picker').addEventListener('input', function (e) {
      updateBrushUI(state.brushStyle, state.width, e.target.value, false, false);
    });

    document.getElementById('btn-add-card').addEventListener('click', function () {
      closeAllPopovers();
      createMarkdownCard();
    });
    document.getElementById('btn-quote-ast').addEventListener('click', openAstQuotePicker);
    document.getElementById('btn-undo').addEventListener('click', applyUndo);
    document.getElementById('btn-redo').addEventListener('click', applyRedo);
    document.getElementById('btn-zoom-in').addEventListener('click', function () { zoomCenterBy(1.16); });
    document.getElementById('btn-zoom-out').addEventListener('click', function () { zoomCenterBy(0.86); });
    document.getElementById('btn-zoom-reset').addEventListener('click', function () {
      state.zoom = 1;
      applyViewportTransform();
    });
    document.getElementById('btn-fit-view').addEventListener('click', fitToContent);

    document.getElementById('btn-export-pdf').addEventListener('click', function () {
      triggerCanvasExport('pdf', 300);
    });

    var dpiSelect = document.getElementById('cv-png-dpi-preset');
    var dpiCustom = document.getElementById('cv-png-dpi-custom');
    dpiSelect.addEventListener('change', function () {
      dpiCustom.value = dpiSelect.value;
    });
    document.getElementById('btn-export-png').addEventListener('click', function () {
      var dpiVal = Math.max(72, Math.min(600, Number(dpiCustom.value) || 300));
      dpiCustom.value = String(dpiVal);
      triggerCanvasExport('png', dpiVal);
    });

    document.getElementById('btn-export-anp').addEventListener('click', function () {
      closeAllPopovers();
      Promise.resolve(state.dirty ? flushSave() : null).then(function () {
        window.location.href = '/api/v1/content/annotations/books/' + encodeURIComponent(META.colSlug) + '/' + encodeURIComponent(META.bookSlug) + '/export';
      });
    });

    var importInput = document.getElementById('cv-import-file');
    document.getElementById('btn-import-anp').addEventListener('click', function () {
      closeAllPopovers();
      importInput.click();
    });
    importInput.addEventListener('change', function () {
      var file = importInput.files && importInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var pkg = JSON.parse(String(reader.result || '{}'));
          fetch('/api/v1/content/annotations/books/' + encodeURIComponent(META.colSlug) + '/' + encodeURIComponent(META.bookSlug) + '/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ packageData: pkg, strategy: 'merge' }),
          })
            .then(function (r) { return r.json(); })
            .then(function (res) {
              if (res && res.ok) {
                showToast('ANP 笔记包导入成功');
                loadCanvas();
              } else {
                showToast('导入失败：格式不匹配');
              }
            });
        } catch (_) {
          showToast('无效的 JSON / ANP 文件');
        }
      };
      reader.readAsText(file);
      importInput.value = '';
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.cv-popover') && !e.target.closest('#btn-brush-popover') && !e.target.closest('#btn-export-popover')) {
        closeAllPopovers();
      }
    });

    function releaseAllKeyStates() {
      state.spacePressed = false;
      if (isPanning) {
        isPanning = false;
        viewport.classList.remove('panning');
        if (state.tool !== 'pan') viewport.classList.remove('tool-pan');
      }
      if (state.liveRafId) {
        cancelAnimationFrame(state.liveRafId);
        state.liveRafId = null;
      }
      state.liveNeedsDraw = false;
      if (state.activeStroke) {
        var finished = state.activeStroke;
        state.activeStroke = null;
        state.liveDrawnIndex = 0;
        clearLiveInk();
        if (finished.points.length >= 1) {
          ensureStrokeBbox(finished);
          state.strokes.push(finished);
          pushUndoAction({ type: 'add-stroke', stroke: finished });
          stampStrokeToStatic(finished);
          scheduleSave('stroke');
        }
      }
      state.activePointerId = null;
    }

    window.addEventListener('blur', releaseAllKeyStates);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        releaseAllKeyStates();
        if (state.dirty) flushSave(true);
      }
    });
    window.addEventListener('pagehide', function () {
      if (state.dirty) flushSave(true);
    });
    window.addEventListener('beforeunload', function () {
      if (state.dirty) flushSave(true);
    });

    function isEditableTarget(el) {
      if (!el) return false;
      var tag = (el.tagName || '').toUpperCase();
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(el.isContentEditable);
    }

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeAllPopovers();
        astModal.classList.remove('open');
        if (document.activeElement && isEditableTarget(document.activeElement)) {
          document.activeElement.blur();
        }
        return;
      }

      if (isEditableTarget(e.target) || astModal.classList.contains('open')) return;

      var mod = e.ctrlKey || e.metaKey;
      var lower = (e.key || '').toLowerCase();

      if (mod && !e.altKey) {
        if (lower === 's') {
          e.preventDefault();
          flushSave(false).then(function () { showToast('已保存画布笔记'); });
          return;
        }
        if (lower === 'z' && !e.shiftKey) {
          e.preventDefault();
          applyUndo();
          return;
        }
        if (lower === 'y' || (lower === 'z' && e.shiftKey)) {
          e.preventDefault();
          applyRedo();
          return;
        }
        if (lower === 'e') {
          e.preventDefault();
          document.getElementById('btn-export-popover').click();
          return;
        }
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          zoomCenterBy(1.16);
          return;
        }
        if (e.key === '-') {
          e.preventDefault();
          zoomCenterBy(0.86);
          return;
        }
        if (e.key === '0') {
          e.preventDefault();
          state.zoom = 1;
          applyViewportTransform();
          return;
        }
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        state.spacePressed = true;
        viewport.classList.add('tool-pan');
        return;
      }

      if (e.altKey || e.shiftKey) return;

      if (lower === 'v') { e.preventDefault(); setTool('select'); }
      else if (lower === 'h') { e.preventDefault(); setTool('pan'); }
      else if (lower === 'p') { e.preventDefault(); setTool('pen'); }
      else if (lower === 'm') { e.preventDefault(); setTool('highlighter'); }
      else if (lower === 'e') { e.preventDefault(); setTool('eraser'); }
      else if (lower === 'b') { e.preventDefault(); document.getElementById('btn-brush-popover').click(); }
      else if (lower === 'n') { e.preventDefault(); createMarkdownCard(); }
      else if (lower === 'q') { e.preventDefault(); openAstQuotePicker(); }
      else if (lower === 'f') { e.preventDefault(); fitToContent(); }
    });

    window.addEventListener('keyup', function (e) {
      if (e.code === 'Space') {
        state.spacePressed = false;
        if (state.tool !== 'pan') viewport.classList.remove('tool-pan');
      }
    });

    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || typeof d.type !== 'string') return;
      if (d.type === 'astrolib:refresh-annotations') {
        loadCanvas();
        return;
      }
      if (d.type === 'astrolib:switch-canvas-chapter' && d.colSlug && d.bookSlug && d.chapterSlug) {
        if (
          d.colSlug === META.colSlug &&
          d.bookSlug === META.bookSlug &&
          d.chapterSlug === META.chapterSlug
        ) {
          return;
        }
        Promise.resolve(state.dirty ? flushSave() : null).then(function () {
          META.colSlug = d.colSlug;
          META.bookSlug = d.bookSlug;
          META.chapterSlug = d.chapterSlug;
          if (d.bookTitle) META.bookTitle = d.bookTitle;
          if (d.chapterTitle) META.chapterTitle = d.chapterTitle;
          document.title = (META.chapterTitle || META.chapterSlug) + ' · 自由画布 · AstroLib';
          state.undoStack = [];
          state.redoStack = [];
          state.astNodes = [];
          syncUndoButtons();
          try {
            var nextUrl = new URL(window.location.href);
            nextUrl.searchParams.set('col', META.colSlug);
            nextUrl.searchParams.set('book', META.bookSlug);
            nextUrl.searchParams.set('chapter', META.chapterSlug);
            if (META.bookTitle) nextUrl.searchParams.set('bookTitle', META.bookTitle);
            if (META.chapterTitle) nextUrl.searchParams.set('chapterTitle', META.chapterTitle);
            window.history.replaceState(null, '', nextUrl.toString());
          } catch (_) {}
          loadCanvas();
        });
      }
    });

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function () {
        resizeCanvases();
      }).observe(viewport);
    }
    window.addEventListener('resize', resizeCanvases);
    setTool('select');
    updateBrushUI('fountain', 2.5, resolveThemeAccentHex(), true, true);
    loadCanvas();
  })();
  `;
}
