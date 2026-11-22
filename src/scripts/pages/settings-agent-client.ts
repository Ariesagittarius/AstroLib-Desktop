import { PluginEnvironment } from '../../plugins/harness/plugin-environment.ts';
import {
  DEFAULT_HARNESS_SYSTEM_PROMPT,
  HARNESS_SETTINGS_CHANGED_EVENT,
  HarnessSettingsStore,
} from '../../features/harness/settings-store.ts';
import { renderToolIconHtml } from '../../features/harness/turn-timeline-renderer.ts';
import type {
  AgentPermissionMode,
  ModelOption,
  ProviderConfig,
  ToolIconSpec,
  ToolMetadata,
  WebSearchProviderKind,
} from '../../features/harness/types.ts';

type AgentSubtab = 'tools' | 'models' | 'presets';

function esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function snackbar(message: string): void {
  window.dispatchEvent(
    new CustomEvent('astrolib:show-snackbar', { detail: { message, durationMs: 3000 } })
  );
}

const PERM_HINTS: Record<AgentPermissionMode, string> = {
  'read-only':
    '仅查看模式：仅允许检索知识库、批注、Diff 与展示交互画布；严禁运行 Python 或写入文件。',
  workspace:
    '工作区模式（推荐）：沙箱 Python 计算与工作区文件写入自动放行；访问本机外部路径或 PDF 时弹出确认卡片。',
  full:
    '完全权限模式：静默放行本地只读、PDF 页面渲染与隔离沙箱运算（写操作仍受限于隔离工作区）。',
};

const RISK_LABEL: Record<string, string> = {
  read: '只读',
  workspace: '工作区写入/运算',
  system: '系统级',
};

export function initAgentSettingsPanel(): { switchSubtab: (tab: AgentSubtab) => void } {
  const panel = document.getElementById('panel-agent');
  if (!panel) return { switchSubtab: () => {} };

  const settingsStore = HarnessSettingsStore.getInstance();
  const pluginEnv = PluginEnvironment.getInstance();

  let activeSubtab: AgentSubtab = 'tools';
  let searchQuery = '';
  let activeCategory = '全部';
  let selectedToolName: string | null = null;
  let editingProviderId: string | null = null;

  const switchSubtab = (tab: AgentSubtab) => {
    activeSubtab = tab;
    panel.querySelectorAll<any>('#agent-hub-subtabs md-filter-chip').forEach((chip) => {
      chip.selected = chip.getAttribute('data-agent-subtab') === tab;
    });
    panel.querySelectorAll<HTMLElement>('.agent-subpane').forEach((pane) => {
      const match = pane.id === `agent-subpane-${tab}`;
      pane.classList.toggle('active', match);
      if (match) pane.removeAttribute('hidden');
      else pane.setAttribute('hidden', '');
    });
    if (tab === 'tools') renderToolsRegistry();
    else if (tab === 'models') renderProvidersList();
    else if (tab === 'presets') syncPresetsFields();
  };

  panel.querySelectorAll<any>('#agent-hub-subtabs md-filter-chip').forEach((chip) => {
    chip.addEventListener('click', (ev: Event) => {
      const tab = chip.getAttribute('data-agent-subtab') as AgentSubtab | null;
      if (!tab) return;
      if (tab === activeSubtab) {
        ev.preventDefault();
        chip.selected = true;
        return;
      }
      ev.stopPropagation();
      switchSubtab(tab);
    });
  });

  const permChipSet = document.getElementById('agent-perm-mode-chips');
  const permHint = document.getElementById('agent-perm-mode-hint');
  const autoCollapseSwitch = document.getElementById('agent-auto-collapse-switch') as any;

  const syncPermissionsUi = () => {
    const st = settingsStore.getState();
    permChipSet?.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
      chip.selected = chip.getAttribute('data-perm-val') === st.permissionMode;
    });
    if (permHint) permHint.textContent = PERM_HINTS[st.permissionMode];
    if (autoCollapseSwitch) autoCollapseSwitch.selected = st.autoCollapseTrace;
  };

  permChipSet?.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
    chip.addEventListener('click', (ev: Event) => {
      const val = chip.getAttribute('data-perm-val') as AgentPermissionMode | null;
      if (!val) return;
      if (val === settingsStore.getState().permissionMode) {
        ev.preventDefault();
        chip.selected = true;
        return;
      }
      ev.stopPropagation();
      settingsStore.setPermissionMode(val);
      syncPermissionsUi();
      renderToolsRegistry();
    });
  });

  autoCollapseSwitch?.addEventListener('change', () => {
    settingsStore.setAutoCollapseTrace(Boolean(autoCollapseSwitch.selected));
  });

  const toolsSearch = document.getElementById('agent-tools-search') as any;
  toolsSearch?.addEventListener('input', () => {
    searchQuery = String(toolsSearch.value || '').trim().toLowerCase();
    renderToolsRegistry();
  });

  const openCodeModal = (title: string, sub: string, content: string) => {
    const modal = document.getElementById('agent-code-modal');
    const titleEl = document.getElementById('agent-code-modal-title');
    const subEl = document.getElementById('agent-code-modal-sub');
    const preEl = document.getElementById('agent-code-modal-pre');
    if (!modal || !preEl) return;
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = sub;
    preEl.textContent = content;
    modal.removeAttribute('hidden');
  };

  document.getElementById('agent-code-modal-close')?.addEventListener('click', () => {
    document.getElementById('agent-code-modal')?.setAttribute('hidden', '');
  });
  document.getElementById('agent-code-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById('agent-code-modal')?.setAttribute('hidden', '');
    }
  });
  document.getElementById('agent-code-modal-copy')?.addEventListener('click', () => {
    const txt = document.getElementById('agent-code-modal-pre')?.textContent || '';
    navigator.clipboard?.writeText(txt);
    snackbar('已复制内容到剪贴板');
  });

  const renderSchemaParamsTable = (parameters: Record<string, any>): string => {
    const props = parameters?.properties || {};
    const requiredSet = new Set<string>(Array.isArray(parameters?.required) ? parameters.required : []);
    const entries = Object.entries(props);
    if (entries.length === 0) {
      return '<div class="ft-settings-hint-text">无入参（直接调用）。</div>';
    }
    const rows = entries
      .map(([k, v]: [string, any]) => {
        const typeStr = Array.isArray(v?.enum)
          ? `enum(${v.enum.join(' | ')})`
          : String(v?.type || 'any');
        return `
          <tr>
            <td><code>${esc(k)}</code></td>
            <td><code>${esc(typeStr)}</code></td>
            <td>${requiredSet.has(k) ? '<span class="agent-req-badge">必填</span>' : '可选'}</td>
            <td>${esc(v?.description || '')}</td>
          </tr>
        `;
      })
      .join('');
    return `
      <div class="agent-schema-table-wrap">
        <table class="agent-schema-table">
          <thead><tr><th>参数名</th><th>类型</th><th>约束</th><th>接口说明</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  };

  const renderToolInspector = (tools: ToolMetadata[]) => {
    const host = document.getElementById('agent-tool-inspector');
    if (!host) return;
    const tool = selectedToolName ? tools.find((t) => t.name === selectedToolName) : undefined;
    if (!tool) {
      host.setAttribute('hidden', '');
      host.innerHTML = '';
      return;
    }

    host.removeAttribute('hidden');
    host.innerHTML = `
      <div class="agent-inspector-head">
        <div class="agent-inspector-title-row">
          <div class="agent-inspector-icon-box" id="inspector-icon-preview">${renderToolIconHtml(tool.icon)}</div>
          <div>
            <div class="agent-inspector-name">${esc(tool.displayName)} <code class="agent-code-tag">${esc(tool.name)}</code></div>
            <div class="agent-inspector-sub">${esc(tool.pluginName)} · ${esc(tool.category)} · 风险级别：${esc(RISK_LABEL[tool.riskLevel] || tool.riskLevel)}</div>
          </div>
        </div>
        <md-text-button id="inspector-close-btn" type="button">收起详情</md-text-button>
      </div>

      <div class="agent-inspector-section">
        <div class="ft-sub-label">对话导览图显示图标与功能描述</div>
        <div class="agent-icon-editor">
          <md-chip-set id="inspector-icon-type-chips">
            <md-filter-chip label="Material 图标名" data-itype="mdicon" ${tool.icon.type === 'mdicon' ? 'selected' : ''}></md-filter-chip>
            <md-filter-chip label="自定义 SVG" data-itype="svg" ${tool.icon.type === 'svg' ? 'selected' : ''}></md-filter-chip>
            <md-filter-chip label="图片 URL" data-itype="image" ${tool.icon.type === 'image' ? 'selected' : ''}></md-filter-chip>
          </md-chip-set>
          <div class="agent-icon-input-row">
            <md-outlined-text-field
              id="inspector-icon-value"
              label="${tool.icon.type === 'mdicon' ? 'Material Symbol 图标名（如 terminal / calculate）' : tool.icon.type === 'svg' ? '内联 <svg>...</svg> 源码' : '图片 URL 或 Data URI'}"
              value="${esc(tool.icon.value)}"
              style="flex:1;"
            ></md-outlined-text-field>
          </div>
        </div>

        <div class="agent-override-fields">
          <md-outlined-text-field
            id="inspector-display-name"
            label="显示标题"
            value="${esc(tool.displayName)}"
            style="width:100%;"
          ></md-outlined-text-field>
          <md-outlined-text-field
            id="inspector-description"
            type="textarea"
            rows="3"
            label="对外暴露给大模型的工具描述 (Tool Description)"
            value="${esc(tool.description)}"
            style="width:100%;"
          ></md-outlined-text-field>
          <div class="agent-form-actions">
            <md-text-button id="inspector-reset-override" type="button">还原默认配置</md-text-button>
            <md-filled-tonal-button id="inspector-save-override" type="button">保存图标与描述</md-filled-tonal-button>
          </div>
        </div>
      </div>

      <div class="agent-inspector-section">
        <div class="ft-sub-label">对外暴露接口契约 (Function Calling Schema)</div>
        ${renderSchemaParamsTable(tool.parameters)}
        <details class="agent-raw-schema-details">
          <summary>查看原始 JSON Schema</summary>
          <pre class="agent-raw-schema-pre">${esc(JSON.stringify(tool.parameters, null, 2))}</pre>
        </details>
      </div>

      <div class="agent-inspector-section">
        <div class="ft-sub-label">实现源文件与开发者审计</div>
        <div class="agent-source-row">
          <code class="agent-source-path">${esc(tool.sourceFile)}</code>
          <div class="agent-source-btns">
            <md-outlined-button id="inspector-reveal-btn" type="button">定位文件</md-outlined-button>
            <md-filled-tonal-button id="inspector-view-source-btn" type="button">查看源代码</md-filled-tonal-button>
          </div>
        </div>
      </div>
    `;

    host.querySelector('#inspector-close-btn')?.addEventListener('click', () => {
      selectedToolName = null;
      renderToolsRegistry();
    });

    let curIconType: ToolIconSpec['type'] = tool.icon.type;
    const iconValInput = host.querySelector<any>('#inspector-icon-value');
    const iconPreview = host.querySelector<HTMLElement>('#inspector-icon-preview');

    const updatePreview = () => {
      if (iconPreview && iconValInput) {
        iconPreview.innerHTML = renderToolIconHtml({
          type: curIconType,
          value: String(iconValInput.value || '').trim(),
        });
      }
    };

    host.querySelectorAll<any>('#inspector-icon-type-chips md-filter-chip').forEach((chip) => {
      chip.addEventListener('click', (ev: Event) => {
        const t = chip.getAttribute('data-itype') as ToolIconSpec['type'] | null;
        if (!t) return;
        ev.stopPropagation();
        curIconType = t;
        host.querySelectorAll<any>('#inspector-icon-type-chips md-filter-chip').forEach((c) => {
          c.selected = c.getAttribute('data-itype') === t;
        });
        updatePreview();
      });
    });

    iconValInput?.addEventListener('input', updatePreview);

    host.querySelector('#inspector-save-override')?.addEventListener('click', () => {
      const nameInput = host.querySelector<any>('#inspector-display-name');
      const descInput = host.querySelector<any>('#inspector-description');
      const iconValue = String(iconValInput?.value || '').trim();
      settingsStore.setToolOverride(tool.name, {
        displayName: String(nameInput?.value || '').trim() || tool.displayName,
        description: String(descInput?.value || '').trim() || tool.defaultDescription,
        ...(iconValue ? { icon: { type: curIconType, value: iconValue } } : {}),
      });
      snackbar(`已更新工具 ${tool.name} 的自定义外观与描述`);
      renderToolsRegistry();
    });

    host.querySelector('#inspector-reset-override')?.addEventListener('click', () => {
      settingsStore.resetToolOverride(tool.name);
      snackbar(`已还原工具 ${tool.name} 的默认配置`);
      renderToolsRegistry();
    });

    host.querySelector('#inspector-reveal-btn')?.addEventListener('click', async () => {
      const bridge = (window as any).astrolib || (window as any).astrolibDesktop;
      if (bridge?.revealFileInFolder) {
        const res = await bridge.revealFileInFolder(tool.sourceFile);
        if (res?.ok) {
          snackbar(`已在文件管理器中定位：${tool.sourceFile}`);
          return;
        }
      }
      try {
        const res = await fetch('/api/v1/content/agent-tools/reveal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: tool.sourceFile }),
        });
        const json = await res.json();
        const abs = json?.data?.absPath || tool.sourceFile;
        navigator.clipboard?.writeText(abs);
        snackbar(`已复制源文件完整路径：${abs}`);
      } catch {
        navigator.clipboard?.writeText(tool.sourceFile);
        snackbar(`已复制相对路径：${tool.sourceFile}`);
      }
    });

    host.querySelector('#inspector-view-source-btn')?.addEventListener('click', async () => {
      try {
        const res = await fetch(
          `/api/v1/content/agent-tools/source?file=${encodeURIComponent(tool.sourceFile)}`
        );
        const json = await res.json();
        if (!json.success) {
          snackbar(`读取源码失败：${json.error || '无权限'}`);
          return;
        }
        openCodeModal(
          `${tool.displayName} · 源代码`,
          `${json.data.absPath} (${json.data.lineCount} 行)`,
          json.data.content
        );
      } catch (err: any) {
        snackbar(`无法拉取源文件：${err?.message || err}`);
      }
    });
  };

  const renderToolsRegistry = () => {
    const st = settingsStore.getState();
    const allTools = pluginEnv.getToolRegistrySnapshot(st.permissionMode, st.toolOverrides);
    const categories = ['全部', ...Array.from(new Set(allTools.map((t) => t.category)))];

    const catHost = document.getElementById('agent-tools-cat-chips');
    if (catHost) {
      catHost.innerHTML = categories
        .map(
          (cat) =>
            `<md-filter-chip label="${esc(cat)}" data-cat="${esc(cat)}" ${activeCategory === cat ? 'selected' : ''}></md-filter-chip>`
        )
        .join('');
      catHost.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
        chip.addEventListener('click', (ev: Event) => {
          const cat = chip.getAttribute('data-cat') || '全部';
          ev.stopPropagation();
          activeCategory = cat;
          renderToolsRegistry();
        });
      });
    }

    const filtered = allTools.filter((t) => {
      if (activeCategory !== '全部' && t.category !== activeCategory) return false;
      if (!searchQuery) return true;
      return (
        t.name.toLowerCase().includes(searchQuery) ||
        t.displayName.toLowerCase().includes(searchQuery) ||
        t.description.toLowerCase().includes(searchQuery) ||
        t.sourceFile.toLowerCase().includes(searchQuery)
      );
    });

    const countHint = document.getElementById('agent-tools-count-hint');
    if (countHint) {
      const enabledCount = allTools.filter((t) => t.enabled && t.allowedInCurrentMode !== 'deny').length;
      countHint.textContent = `共注册 ${allTools.length} 个工具，当前权限下已启用 ${enabledCount} 个`;
    }

    const grid = document.getElementById('agent-tools-grid');
    if (!grid) return;

    grid.innerHTML = filtered
      .map((t) => {
        const isSelected = selectedToolName === t.name;
        const permLabel =
          t.allowedInCurrentMode === 'deny'
            ? '当前模式禁用'
            : t.allowedInCurrentMode === 'prompt'
              ? '外部路径需确认'
              : RISK_LABEL[t.riskLevel] || '可用';
        return `
          <div class="agent-tool-card ${isSelected ? 'is-selected' : ''} ${!t.enabled || t.allowedInCurrentMode === 'deny' ? 'is-muted' : ''}" data-tool-card="${esc(t.name)}">
            <div class="agent-tool-card__top">
              <div class="agent-tool-card__id-group">
                <span class="agent-tool-card__icon">${renderToolIconHtml(t.icon)}</span>
                <div>
                  <div class="agent-tool-card__title">${esc(t.displayName)}</div>
                  <div class="agent-tool-card__name"><code>${esc(t.name)}</code>${t.slashCommand ? ` · <code>${esc(t.slashCommand)}</code>` : ''}</div>
                </div>
              </div>
              <md-switch class="agent-tool-enable-switch" data-tool-switch="${esc(t.name)}" ${t.enabled ? 'selected' : ''} aria-label="启用或禁用 ${esc(t.displayName)}"></md-switch>
            </div>
            <div class="agent-tool-card__desc">${esc(t.description)}</div>
            <div class="agent-tool-card__foot">
              <span class="agent-tool-pill">${esc(t.category)}</span>
              <span class="agent-tool-pill ${t.allowedInCurrentMode === 'deny' ? 'is-warn' : ''}">${esc(permLabel)}</span>
              <span class="agent-tool-inspect-hint">查看接口与源码 ›</span>
            </div>
          </div>
        `;
      })
      .join('');

    grid.querySelectorAll<any>('.agent-tool-enable-switch').forEach((sw) => {
      sw.addEventListener('click', (e: Event) => e.stopPropagation());
      sw.addEventListener('change', (e: Event) => {
        e.stopPropagation();
        const tName = sw.getAttribute('data-tool-switch');
        if (tName) {
          settingsStore.setToolOverride(tName, { enabled: Boolean(sw.selected) });
          renderToolsRegistry();
        }
      });
    });

    grid.querySelectorAll<HTMLElement>('.agent-tool-card').forEach((card) => {
      card.addEventListener('click', () => {
        const name = card.dataset.toolCard || '';
        selectedToolName = selectedToolName === name ? null : name;
        renderToolsRegistry();
      });
    });

    renderToolInspector(allTools);
  };

  const renderProvidersList = () => {
    const listHost = document.getElementById('agent-providers-list');
    if (!listHost) return;

    const st = settingsStore.getState();
    listHost.innerHTML = '';

    for (const prov of st.providers) {
      if (prov.isAccount) continue;
      const isEditing = editingProviderId === prov.id;
      const card = document.createElement('div');
      card.className = `agent-provider-card ${isEditing ? 'is-editing' : ''}`;

      const dotCls =
        prov.status === 'connected' || prov.apiKey || prov.id === 'antigravity-cli'
          ? 'green'
          : 'gray';

      card.innerHTML = `
        <div class="agent-provider-card__head">
          <div class="agent-provider-meta">
            <span class="status-dot ${dotCls}"></span>
            <span class="agent-provider-name">${esc(prov.displayName)}</span>
            <code class="agent-code-tag">${esc(prov.id)}</code>
            ${prov.isCustom ? '<span class="agent-tool-pill">自定义</span>' : ''}
            ${st.currentProviderId === prov.id ? '<span class="agent-tool-pill is-active">当前激活</span>' : ''}
          </div>
          <div class="agent-provider-actions">
            ${
              prov.id !== 'antigravity-cli'
                ? `<md-outlined-button data-prov-edit="${esc(prov.id)}" type="button">${isEditing ? '收起' : '配置'}</md-outlined-button>`
                : ''
            }
            ${
              prov.isCustom && prov.id !== 'baigong'
                ? `<md-text-button data-prov-del="${esc(prov.id)}" type="button">删除</md-text-button>`
                : ''
            }
          </div>
        </div>
        ${prov.desc ? `<div class="agent-provider-desc">${esc(prov.desc)}</div>` : ''}
      `;

      if (isEditing && prov.id !== 'antigravity-cli') {
        const modelRowsHtml = prov.models
          .map(
            (m, mIdx) => `
          <div class="agent-model-cap-row" data-model-cap-idx="${mIdx}" data-model-id="${esc(m.id)}" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 8px;border:1px solid var(--md-sys-color-outline-variant);border-radius:8px;margin-top:6px;">
            <code style="min-width:140px;font-size:0.78rem;">${esc(m.id)}</code>
            <label style="display:inline-flex;align-items:center;gap:4px;font-size:0.78rem;cursor:pointer;">
              <input type="checkbox" data-cap="vision" ${m.supportsVision !== false ? 'checked' : ''} />
              <span>支持看图</span>
            </label>
            <input type="number" data-cap="maxImages" min="0" max="16" placeholder="最大图数" value="${m.maxImagesPerRequest ?? ''}" title="单次最大图片数 (0=禁用)" style="width:82px;padding:3px 6px;border-radius:6px;border:1px solid var(--md-sys-color-outline-variant);font-size:0.76rem;" />
            <input type="number" data-cap="maxCtx" min="4096" step="1024" placeholder="上下文(Tokens)" value="${m.maxContextTokens ?? ''}" title="覆盖上下文窗口" style="width:120px;padding:3px 6px;border-radius:6px;border:1px solid var(--md-sys-color-outline-variant);font-size:0.76rem;" />
          </div>
        `
          )
          .join('');

        const form = document.createElement('div');
        form.className = 'agent-provider-form';
        form.innerHTML = `
          <md-outlined-text-field data-field="apiKey" type="password" label="API 密钥" value="${esc(prov.apiKey || '')}" style="width:100%;"></md-outlined-text-field>
          <md-outlined-text-field data-field="baseURL" label="Base URL (接口根地址)" value="${esc(prov.baseURL)}" style="width:100%;"></md-outlined-text-field>
          <md-outlined-text-field data-field="headers" label="自定义 Headers (JSON)" value="${esc(JSON.stringify(prov.headers || {}))}" style="width:100%;"></md-outlined-text-field>
          <md-outlined-text-field data-field="models" label="模型列表 (逗号分隔)" value="${esc(prov.models.map((m) => m.id).join(', '))}" style="width:100%;"></md-outlined-text-field>
          <div style="margin-top:4px;">
            <div class="ft-sub-label">各模型模态与上下文覆写（留空则遵循智能默认）</div>
            ${modelRowsHtml}
          </div>
          <div class="agent-form-actions">
            <md-text-button data-action="cancel" type="button">取消</md-text-button>
            <md-filled-button data-action="save" type="button">保存配置</md-filled-button>
          </div>
        `;
        form.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
          editingProviderId = null;
          renderProvidersList();
        });
        form.querySelector('[data-action="save"]')?.addEventListener('click', () => {
          const capOverrides = new Map<
            string,
            Partial<Pick<ModelOption, 'supportsVision' | 'maxImagesPerRequest' | 'maxContextTokens'>>
          >();
          form.querySelectorAll<HTMLElement>('.agent-model-cap-row').forEach((row) => {
            const mid = row.dataset.modelId || '';
            if (!mid) return;
            const visionChk = row.querySelector<HTMLInputElement>('[data-cap="vision"]');
            const maxImgInp = row.querySelector<HTMLInputElement>('[data-cap="maxImages"]');
            const maxCtxInp = row.querySelector<HTMLInputElement>('[data-cap="maxCtx"]');
            const maxImgNum = maxImgInp?.value?.trim() ? Number(maxImgInp.value) : undefined;
            const maxCtxNum = maxCtxInp?.value?.trim() ? Number(maxCtxInp.value) : undefined;
            capOverrides.set(mid, {
              supportsVision: visionChk ? Boolean(visionChk.checked) : undefined,
              maxImagesPerRequest:
                maxImgNum !== undefined && Number.isFinite(maxImgNum) ? Math.max(0, maxImgNum) : undefined,
              maxContextTokens:
                maxCtxNum !== undefined && Number.isFinite(maxCtxNum) && maxCtxNum >= 4096
                  ? Math.round(maxCtxNum)
                  : undefined,
            });
          });

          const next = settingsStore.getState().providers.map((p) => {
            if (p.id !== prov.id) return p;
            const keyVal = String((form.querySelector('[data-field="apiKey"]') as any)?.value || '').trim();
            const urlVal = String((form.querySelector('[data-field="baseURL"]') as any)?.value || '').trim();
            const hdrVal = String((form.querySelector('[data-field="headers"]') as any)?.value || '').trim();
            const modVal = String((form.querySelector('[data-field="models"]') as any)?.value || '').trim();

            let nextHeaders = p.headers;
            if (hdrVal) {
              try {
                nextHeaders = JSON.parse(hdrVal);
              } catch {}
            }
            const nextModels = (
              modVal
                ? modVal
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((id) => p.models.find((m) => m.id === id) || { id, name: id, reasoningEffort: 'high' as const })
                : p.models
            ).map((m) => {
              const ov = capOverrides.get(m.id);
              return ov ? { ...m, ...ov } : m;
            });

            return {
              ...p,
              ...(keyVal ? { apiKey: keyVal } : {}),
              ...(urlVal ? { baseURL: urlVal } : {}),
              headers: nextHeaders,
              models: nextModels,
              status: (keyVal || p.apiKey ? 'connected' : 'configured') as ProviderConfig['status'],
            };
          });
          settingsStore.setProviders(next);
          editingProviderId = null;
          snackbar(`已保存服务商 ${prov.displayName} 配置`);
          renderProvidersList();
        });
        card.appendChild(form);
      }

      card.querySelector('[data-prov-edit]')?.addEventListener('click', () => {
        editingProviderId = editingProviderId === prov.id ? null : prov.id;
        renderProvidersList();
      });
      card.querySelector('[data-prov-del]')?.addEventListener('click', () => {
        const next = settingsStore.getState().providers.filter((p) => p.id !== prov.id);
        settingsStore.setProviders(next);
        snackbar(`已移除自定义服务商 ${prov.displayName}`);
        renderProvidersList();
      });

      listHost.appendChild(card);
    }
  };

  document.getElementById('agent-btn-view-config')?.addEventListener('click', () => {
    openCodeModal(
      '模型服务商配置文件 (只读预览)',
      'localStorage: astrolib_harness_providers_v1',
      JSON.stringify(settingsStore.getState().providers, null, 2)
    );
  });

  const addProvForm = document.getElementById('agent-add-provider-form');
  document.getElementById('agent-btn-toggle-add-provider')?.addEventListener('click', () => {
    if (!addProvForm) return;
    if (addProvForm.hasAttribute('hidden')) addProvForm.removeAttribute('hidden');
    else addProvForm.setAttribute('hidden', '');
  });
  document.getElementById('agent-cancel-add-prov')?.addEventListener('click', () => {
    addProvForm?.setAttribute('hidden', '');
  });
  document.getElementById('agent-confirm-add-prov')?.addEventListener('click', () => {
    const name = String((document.getElementById('agent-new-prov-name') as any)?.value || '').trim();
    const rawId = String((document.getElementById('agent-new-prov-id') as any)?.value || '').trim();
    const baseURL = String((document.getElementById('agent-new-prov-url') as any)?.value || '').trim();
    const apiKey = String((document.getElementById('agent-new-prov-key') as any)?.value || '').trim();
    const modelsCsv = String((document.getElementById('agent-new-prov-models') as any)?.value || '').trim();

    if (!name || !baseURL) {
      snackbar('请填写显示名称与 Base URL');
      return;
    }

    const id = (rawId || `custom-${Date.now().toString(36)}`).toLowerCase().replace(/\s+/g, '-');
    const models = (modelsCsv || 'default-model')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((mid) => ({ id: mid, name: mid, reasoningEffort: 'high' as const }));

    const newProv: ProviderConfig = {
      id,
      displayName: name,
      isCustom: true,
      status: apiKey ? 'connected' : 'configured',
      api: 'openai-completions',
      baseURL,
      apiKey,
      models,
      defaultModelId: models[0]?.id || 'default-model',
    };

    const st = settingsStore.getState();
    settingsStore.setProviders([...st.providers.filter((p) => p.id !== id), newProv]);
    addProvForm?.setAttribute('hidden', '');
    snackbar(`已添加模型服务商 ${name}`);
    renderProvidersList();
  });

  const reasoningChips = document.getElementById('agent-reasoning-default-chips');
  const tokenWindowInput = document.getElementById('agent-token-window-input') as any;
  const maxRoundsInput = document.getElementById('agent-max-rounds-input') as any;
  const sysPromptInput = document.getElementById('agent-system-prompt-input') as any;

  const syncPresetsFields = () => {
    const st = settingsStore.getState();
    reasoningChips?.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
      chip.selected = chip.getAttribute('data-r-val') === st.defaultReasoningEffort;
    });
    if (tokenWindowInput) tokenWindowInput.value = String(st.tokenWindowLimit);
    if (maxRoundsInput) maxRoundsInput.value = String(st.maxAgentRounds ?? 30);
    if (sysPromptInput) sysPromptInput.value = st.systemPrompt;
  };

  reasoningChips?.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
    chip.addEventListener('click', (ev: Event) => {
      const val = chip.getAttribute('data-r-val') as 'high' | 'low' | 'off' | null;
      if (!val) return;
      ev.stopPropagation();
      settingsStore.setPresetOptions({ defaultReasoningEffort: val });
      syncPresetsFields();
    });
  });

  document.getElementById('agent-save-presets-btn')?.addEventListener('click', () => {
    const tok = Number(tokenWindowInput?.value || 16384);
    const maxR = Number(maxRoundsInput?.value || 30);
    const prompt = String(sysPromptInput?.value || '').trim() || DEFAULT_HARNESS_SYSTEM_PROMPT;
    settingsStore.setPresetOptions({ tokenWindowLimit: tok, maxAgentRounds: maxR });
    settingsStore.setSystemPrompt(prompt);
    snackbar('已保存 Agent 系统预设');
  });

  const pyEnvStatusEl = document.getElementById('agent-py-env-status');
  const pyCustomPathInput = document.getElementById('agent-py-custom-path') as any;
  const pyInstallInput = document.getElementById('agent-py-install-input') as any;
  const pyPkgListEl = document.getElementById('agent-py-packages-list');
  const PROTECTED_PY = new Set(['pip', 'setuptools', 'wheel', 'pymupdf', 'pypdf']);

  const refreshPythonEnvUi = async (force = false) => {
    if (pyCustomPathInput) {
      pyCustomPathInput.value = settingsStore.getState().customAgentPythonPath || '';
    }
    const customPath = settingsStore.getState().customAgentPythonPath || '';
    const qs = new URLSearchParams();
    if (force) qs.set('force', '1');
    if (customPath) qs.set('pythonPath', customPath);

    try {
      const res = await fetch(`/api/v1/content/agent-tools/python/env?${qs.toString()}`);
      const json = await res.json();
      const d = json.data;
      if (pyEnvStatusEl) {
        pyEnvStatusEl.textContent = d?.available
          ? `${d.isolated ? '已隔离 (.venv-agent)' : '未隔离（将在首次安装时自动创建 .venv-agent）'} · Python ${d.pythonVersion || '?'} · ${d.pythonPath}`
          : '未检测到可用 Python 解释器';
      }
      if (pyPkgListEl) {
        const pkgs: Array<{ name: string; version: string }> = Array.isArray(d?.packages)
          ? d.packages
          : [];
        pyPkgListEl.innerHTML =
          pkgs.length > 0
            ? pkgs
                .map((p) => {
                  const canDel = d?.isolated && !PROTECTED_PY.has(p.name.toLowerCase());
                  return `<span class="agent-tool-pill" style="display:inline-flex;align-items:center;gap:4px;"><span>${esc(p.name)}==${esc(p.version)}</span>${
                    canDel
                      ? `<button type="button" data-py-uninst="${esc(p.name)}" title="卸载 ${esc(p.name)}" style="border:none;background:transparent;cursor:pointer;font-size:13px;padding:0 2px;color:inherit;">×</button>`
                      : ''
                  }</span>`;
                })
                .join('')
            : '<span class="ft-settings-hint-text">当前仅可用 Python 标准库</span>';

        pyPkgListEl.querySelectorAll<HTMLElement>('[data-py-uninst]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const pkg = btn.dataset.pyUninst || '';
            if (!pkg) return;
            btn.setAttribute('disabled', 'true');
            const r = await fetch('/api/v1/content/agent-tools/python/packages/uninstall', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ package: pkg, pythonPath: customPath }),
            });
            const j = await r.json();
            if (j.success) {
              snackbar(`已卸载 ${pkg}`);
              await refreshPythonEnvUi(true);
            } else {
              snackbar(`卸载失败：${j.error || '未知错误'}`);
            }
          });
        });
      }
    } catch {
      if (pyEnvStatusEl) pyEnvStatusEl.textContent = '无法连接本地后端 Python 探测接口';
    }
  };

  document.getElementById('agent-py-refresh-btn')?.addEventListener('click', () => {
    void refreshPythonEnvUi(true);
  });

  document.getElementById('agent-py-save-path-btn')?.addEventListener('click', () => {
    const val = String(pyCustomPathInput?.value || '').trim();
    settingsStore.setPresetOptions({ customAgentPythonPath: val });
    snackbar('已更新 Agent Python 解释器路径设置');
    void refreshPythonEnvUi(true);
  });

  document.getElementById('agent-py-install-btn')?.addEventListener('click', async () => {
    const raw = String(pyInstallInput?.value || '').trim();
    const packages = raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (packages.length === 0) {
      snackbar('请填写要安装的包名');
      return;
    }
    const btn = document.getElementById('agent-py-install-btn');
    btn?.setAttribute('disabled', 'true');
    snackbar(`正在安装 ${packages.join(', ')}...`);
    try {
      const res = await fetch('/api/v1/content/agent-tools/python/packages/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packages,
          pythonPath: settingsStore.getState().customAgentPythonPath,
        }),
      });
      const json = await res.json();
      if (json.success) {
        if (pyInstallInput) pyInstallInput.value = '';
        snackbar(`安装成功：${packages.join(', ')}`);
        await refreshPythonEnvUi(true);
      } else {
        snackbar(`安装失败：${json.error || '未知错误'}`);
      }
    } finally {
      btn?.removeAttribute('disabled');
    }
  });

  const wsSwitch = document.getElementById('agent-websearch-enable-switch') as any;
  const wsChips = document.getElementById('agent-websearch-provider-chips');
  const wsApiKeyInput = document.getElementById('agent-websearch-apikey') as any;
  const wsBaseUrlInput = document.getElementById('agent-websearch-baseurl') as any;
  const wsStatusEl = document.getElementById('agent-websearch-test-status');
  let selectedWsProvider: WebSearchProviderKind = settingsStore.getState().webSearch?.provider || 'none';

  const syncWebSearchFields = () => {
    const ws = settingsStore.getState().webSearch || { enabled: false, provider: 'none' };
    selectedWsProvider = ws.provider || 'none';
    if (wsSwitch) wsSwitch.selected = Boolean(ws.enabled);
    if (wsApiKeyInput) wsApiKeyInput.value = ws.apiKey || '';
    if (wsBaseUrlInput) wsBaseUrlInput.value = ws.baseUrl || '';
    wsChips?.querySelectorAll<any>('md-filter-chip').forEach((c) => {
      c.selected = c.getAttribute('data-ws-prov') === selectedWsProvider;
    });
  };

  wsChips?.querySelectorAll<any>('md-filter-chip').forEach((chip) => {
    chip.addEventListener('click', (ev: Event) => {
      const p = chip.getAttribute('data-ws-prov') as WebSearchProviderKind | null;
      if (!p) return;
      ev.stopPropagation();
      selectedWsProvider = p;
      wsChips.querySelectorAll<any>('md-filter-chip').forEach((c) => {
        c.selected = c.getAttribute('data-ws-prov') === p;
      });
    });
  });

  document.getElementById('agent-websearch-save-btn')?.addEventListener('click', () => {
    settingsStore.setWebSearchConfig({
      enabled: Boolean(wsSwitch?.selected) && selectedWsProvider !== 'none',
      provider: selectedWsProvider,
      apiKey: String(wsApiKeyInput?.value || '').trim(),
      baseUrl: String(wsBaseUrlInput?.value || '').trim(),
    });
    snackbar('已保存联网搜索配置');
    syncWebSearchFields();
  });

  document.getElementById('agent-websearch-test-btn')?.addEventListener('click', async () => {
    if (wsStatusEl) wsStatusEl.textContent = '正在测试搜索接口连通性...';
    try {
      const res = await fetch('/api/v1/content/agent-tools/web-search/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedWsProvider,
          apiKey: String(wsApiKeyInput?.value || '').trim(),
          baseUrl: String(wsBaseUrlInput?.value || '').trim(),
        }),
      });
      const json = await res.json();
      if (wsStatusEl) {
        wsStatusEl.textContent = json.success
          ? `连通成功 (${json.data?.latencyMs || 0}ms · 命中 ${json.data?.results?.length || 0} 条)`
          : `测试失败：${json.error || '请检查地址或密钥'}`;
      }
    } catch (err: any) {
      if (wsStatusEl) wsStatusEl.textContent = `测试失败：${err?.message || err}`;
    }
  });

  syncWebSearchFields();
  void refreshPythonEnvUi(false);

  document.getElementById('agent-reset-presets-btn')?.addEventListener('click', () => {
    settingsStore.resetSystemPrompt();
    syncPresetsFields();
    snackbar('已恢复默认系统提示词');
  });

  window.addEventListener(HARNESS_SETTINGS_CHANGED_EVENT, () => {
    syncPermissionsUi();
    if (activeSubtab === 'tools') {
      renderToolsRegistry();
      syncWebSearchFields();
    } else if (activeSubtab === 'models') {
      renderProvidersList();
    } else if (activeSubtab === 'presets') {
      syncPresetsFields();
    }
  });

  window.addEventListener('astrolib:agent-settings-subtab', ((
    e: CustomEvent<{ subtab?: AgentSubtab }>
  ) => {
    const sub = e?.detail?.subtab;
    if (sub === 'tools' || sub === 'models' || sub === 'presets') {
      switchSubtab(sub);
    }
  }) as EventListener);

  syncPermissionsUi();
  renderToolsRegistry();
  syncPresetsFields();

  return { switchSubtab };
}
