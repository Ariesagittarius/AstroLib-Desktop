import { describe, it, expect, beforeEach } from 'vitest';
import { PluginEnvironment } from '../../src/plugins/harness/plugin-environment.ts';
import { ArtifactStore } from '../../src/features/harness/artifact-store.ts';

describe('Harness Permissions, Tool Registry & Artifact Store Suite', () => {
  let env: PluginEnvironment;

  beforeEach(() => {
    env = PluginEnvironment.getInstance();
  });

  describe('1. 三档权限边界裁决 (read-only / workspace / full)', () => {
    it('1.1 read-only 模式应放行书库只读工具，拦截写入与 Python 执行', () => {
      expect(env.evaluateToolPermission('search_library_text', 'read-only', {}).decision).toBe('allow');
      expect(env.evaluateToolPermission('create_canvas_artifact', 'read-only', {}).decision).toBe('allow');

      const pyRes = env.evaluateToolPermission('run_python', 'read-only', { code: 'print(1)' });
      expect(pyRes.decision).toBe('deny');

      const writeRes = env.evaluateToolPermission('write_workspace_file', 'read-only', {
        relPath: 'a.txt',
      });
      expect(writeRes.decision).toBe('deny');
    });

    it('1.2 workspace 模式应自动放行工作区沙箱运算，并对本机外部路径触发 prompt 确认', () => {
      expect(
        env.evaluateToolPermission('run_python', 'workspace', { code: 'print(1+1)' }).decision
      ).toBe('allow');
      expect(
        env.evaluateToolPermission('write_workspace_file', 'workspace', { relPath: 'notes/a.md' })
          .decision
      ).toBe('allow');
      expect(
        env.evaluateToolPermission('read_local_file', 'workspace', {
          filePath: 'workspace/notes/a.md',
        }).decision
      ).toBe('allow');

      const externalWin = env.evaluateToolPermission('read_local_file', 'workspace', {
        filePath: 'C:\\Users\\demo\\secret.txt',
      });
      expect(externalWin.decision).toBe('prompt');
      expect(externalWin.targetPath).toBe('C:\\Users\\demo\\secret.txt');

      const externalPdf = env.evaluateToolPermission('inspect_pdf', 'workspace', {
        pdfPath: '/tmp/book.pdf',
      });
      expect(externalPdf.decision).toBe('prompt');
    });

    it('1.3 full 模式应静默放行全部已注册工具与外部只读路径', () => {
      expect(
        env.evaluateToolPermission('read_local_file', 'full', {
          filePath: 'D:\\books\\algebra.pdf',
        }).decision
      ).toBe('allow');
      expect(env.evaluateToolPermission('run_python', 'full', {}).decision).toBe('allow');
    });
  });

  describe('2. 工具注册表快照与自定义覆写 (Icon / Description / Enabled)', () => {
    it('2.1 应暴露新增工具与源文件白名单路径，并响应 ToolOverrideConfig 覆写', () => {
      const snap = env.getToolRegistrySnapshot('workspace', {
        run_python: {
          displayName: '我的核验器',
          description: '自定义数值验证器',
          icon: { type: 'mdicon', value: 'calculate' },
          enabled: false,
        },
      });

      const pyMeta = snap.find((t) => t.name === 'run_python');
      expect(pyMeta).toBeDefined();
      expect(pyMeta?.displayName).toBe('我的核验器');
      expect(pyMeta?.description).toBe('自定义数值验证器');
      expect(pyMeta?.icon).toEqual({ type: 'mdicon', value: 'calculate' });
      expect(pyMeta?.enabled).toBe(false);
      expect(pyMeta?.sourceFile).toBe('src/plugins/harness/builtin/runtime-tools.plugin.ts');

      const activeTools = env.toOpenAITools({
        permissionMode: 'workspace',
        overrides: {
          run_python: { enabled: false },
        },
      });
      expect(activeTools.some((t) => t.function.name === 'run_python')).toBe(false);
      expect(activeTools.some((t) => t.function.name === 'search_library_text')).toBe(true);
      expect(activeTools.some((t) => t.function.name === 'create_canvas_artifact')).toBe(true);
    });
  });

  describe('3. ArtifactStore 多态成果物历史仓与 Canvas 版本栈', () => {
    it('3.1 AST / PDF2ABP / Python 产物应并存而不互相覆盖，Canvas 应支持撤销与重做', () => {
      const store = ArtifactStore.createIsolated();

      store.syncPdf2AbpJob(
        {
          jobId: 'job-1',
          sourceFileName: 'algebra.pdf',
          status: 'running',
          phase: 'chunking',
          createdAt: 1000,
          updatedAt: 2000,
        },
        false
      );

      store.upsertArtifact({
        kind: 'ast',
        title: '1.1 行列式 AST',
        badge: 'AST',
        html: '<div>AST</div>',
      });

      const pyArt = store.recordPythonRun({
        title: '矩阵特征值验算',
        code: 'print([1, 2])',
        result: {
          stdout: '[1, 2]\n',
          stderr: '',
          exitCode: 0,
          durationMs: 32,
          images: [],
        },
      });
      expect(pyArt.kind).toBe('python');

      const canvas = store.upsertArtifact({
        id: 'canvas-euler',
        kind: 'canvas',
        title: 'Euler 公式相图',
        code: '<div>v1</div>',
        badge: 'Canvas · v1',
      });
      expect(canvas.versions?.length).toBe(1);

      const v2 = store.pushCanvasVersion('canvas-euler', '<div>v2</div>', '加入阻尼参数滑块');
      expect(v2?.versions?.length).toBe(2);
      expect(v2?.code).toBe('<div>v2</div>');
      expect(v2?.badge).toBe('Canvas · v2');

      const undoItem = store.stepCanvasVersion('canvas-euler', -1);
      expect(undoItem?.code).toBe('<div>v1</div>');
      expect(undoItem?.badge).toBe('Canvas · v1');

      const redoItem = store.stepCanvasVersion('canvas-euler', 1);
      expect(redoItem?.code).toBe('<div>v2</div>');

      const kinds = new Set(store.getState().items.map((i) => i.kind));
      expect(kinds.has('pdf2abp')).toBe(true);
      expect(kinds.has('ast')).toBe(true);
      expect(kinds.has('python')).toBe(true);
      expect(kinds.has('canvas')).toBe(true);
    });
  });
});
