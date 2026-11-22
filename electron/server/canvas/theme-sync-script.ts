export function buildCanvasThemeSyncScript(exportMode?: string): string {
  const isExport = Boolean(exportMode);
  return `
  (function () {
    var EXPORT_MODE = ${isExport ? 'true' : 'false'};
    var root = document.documentElement;
    root.dataset.siteTheme = 'material-you';

    function resolveThemeMode(raw) {
      if (EXPORT_MODE) return 'light';
      if (raw === 'dark' || raw === 'light') return raw;
      try {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
          return 'dark';
        }
      } catch (_) {}
      return 'light';
    }

    function applyDynamicCss(cssText) {
      if (!cssText || EXPORT_MODE) return;
      var styleEl = document.getElementById('m3-dynamic-color-theme');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'm3-dynamic-color-theme';
      }
      if (styleEl.textContent !== cssText) {
        styleEl.textContent = cssText;
      }
      if (document.head && document.head.lastElementChild !== styleEl) {
        document.head.appendChild(styleEl);
      }
    }

    function applyFontPreference(rawFont) {
      if (!rawFont) return;
      try {
        var parsed = typeof rawFont === 'string' ? JSON.parse(rawFont) : rawFont;
        if (parsed && typeof parsed === 'object') {
          if (parsed.latin) root.dataset.fontLatin = parsed.latin;
          if (parsed.cjk) root.dataset.fontCjk = parsed.cjk;
        }
      } catch (_) {}
    }

    function applyFontSizePref(rawSize) {
      var fsVal = parseInt(String(rawSize || ''), 10);
      if (!isNaN(fsVal) && fsVal >= 14 && fsVal <= 22) {
        root.style.setProperty('--academic-font-size-body', parseFloat((fsVal * 0.75).toFixed(2)) + 'pt');
      }
    }

    function syncAllFromStorage() {
      var storedTheme = null;
      try {
        storedTheme = localStorage.getItem('starlight-theme') || localStorage.getItem('astrolib_theme');
      } catch (_) {}
      var effective = resolveThemeMode(storedTheme);
      root.setAttribute('data-theme', effective);
      root.style.colorScheme = effective;

      if (!EXPORT_MODE) {
        try {
          var m3Color = localStorage.getItem('starlight-m3-theme-color');
          if (m3Color) root.dataset.m3ThemeColor = m3Color;
          var cachedCss = localStorage.getItem('astrolib_m3_cached_css');
          if (cachedCss) applyDynamicCss(cachedCss);
        } catch (_) {}
      }

      try {
        applyFontPreference(localStorage.getItem('starlight-font'));
        applyFontSizePref(localStorage.getItem('astrolib_font_size'));
      } catch (_) {}

      if (typeof window.__astrolibCanvasSyncAccent === 'function') {
        window.__astrolibCanvasSyncAccent();
      }
    }

    function syncParentFontFaces() {
      try {
        if (document.getElementById('astrolib-canvas-parent-fonts')) return;
        if (!window.parent || window.parent === window) return;
        var parentDoc = window.parent.document;
        if (!parentDoc || !parentDoc.styleSheets) return;
        var rules = [];
        var baseFallback = (window.parent.location && window.parent.location.href) || window.location.href;
        for (var i = 0; i < parentDoc.styleSheets.length; i++) {
          var sheet = parentDoc.styleSheets[i];
          var sheetHref = sheet.href || baseFallback;
          var cssRules = null;
          try {
            cssRules = sheet.cssRules;
          } catch (_) {
            continue;
          }
          if (!cssRules) continue;
          for (var j = 0; j < cssRules.length; j++) {
            var rule = cssRules[j];
            if (rule && rule.type === CSSRule.FONT_FACE_RULE && rule.cssText) {
              var resolvedCss = rule.cssText.replace(/url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/gi, function (m, _quote, rawUrl) {
                var trimmed = String(rawUrl || '').trim();
                if (!trimmed || /^(data:|blob:|https?:|#)/i.test(trimmed)) return m;
                try {
                  return 'url("' + new URL(trimmed, sheetHref).href + '")';
                } catch (_) {
                  return m;
                }
              });
              rules.push(resolvedCss);
            }
          }
        }
        if (rules.length > 0 && document.head) {
          var fontStyleEl = document.createElement('style');
          fontStyleEl.id = 'astrolib-canvas-parent-fonts';
          fontStyleEl.textContent = rules.join('\\n');
          document.head.appendChild(fontStyleEl);
        }
      } catch (_) {}
    }

    syncAllFromStorage();
    syncParentFontFaces();

    window.addEventListener('storage', syncAllFromStorage);

    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        var saved = null;
        try { saved = localStorage.getItem('starlight-theme'); } catch (_) {}
        if (!saved || saved === 'auto') syncAllFromStorage();
      });
    } catch (_) {}

    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || d.type !== 'M3_THEME_COLOR_CHANGED') return;
      if (!EXPORT_MODE && (d.resolvedTheme || d.theme)) {
        var eff = d.resolvedTheme === 'dark' || d.resolvedTheme === 'light'
          ? d.resolvedTheme
          : resolveThemeMode(d.theme);
        root.setAttribute('data-theme', eff);
        root.style.colorScheme = eff;
      }
      if (d.color) root.dataset.m3ThemeColor = d.color;
      var cssText = d.schemeCss || d.css;
      if (cssText) applyDynamicCss(cssText);
      if (d.font) applyFontPreference(d.font);
      if (d.fontSize !== undefined && d.fontSize !== null) applyFontSizePref(d.fontSize);
      if (typeof window.__astrolibCanvasSyncAccent === 'function') {
        window.__astrolibCanvasSyncAccent();
      }
    });
  })();
  `;
}
