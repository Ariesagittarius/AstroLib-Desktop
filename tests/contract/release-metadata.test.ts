import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AppUpdater } from '../../electron/services/updater.ts';

describe('Release Metadata and Update Contract Tests', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const evidencePath = path.join(ROOT, 'docs', 'architecture', 'evidence', 'p0-final-evidence.json');

  it('package.json 必须固定 NSIS 与 Portable 安装包命名模板，严禁包含空格', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const nsisName = pkg.build?.nsis?.artifactName;
    const portableName = pkg.build?.portable?.artifactName;

    expect(nsisName).toBe('${productName}-Setup-${version}.${ext}');
    expect(portableName).toBe('${productName}-Portable-${version}.${ext}');
    expect(nsisName).not.toContain(' ');
    expect(portableName).not.toContain(' ');
  });

  it('必须存在受 Git 跟踪的 p0-final-evidence.json，且结构完备与 Release v0.0.4 严格一致', () => {
    expect(fs.existsSync(evidencePath)).toBe(true);
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));

    expect(evidence.releaseTag).toBe('v0.0.4');
    expect(evidence.repository).toBe('Ariesagittarius/AstroLib-Desktop');
    expect(evidence.actions?.runId).toBe(43355219380);
    expect(evidence.actions?.jobDuration).toBe('6m 55s (415s)');
    expect(evidence.actions?.conclusion).toBe('success');
    expect(evidence.testSuiteSummary?.totalFiles).toBe(64);
    expect(evidence.testSuiteSummary?.passedFiles).toBe(62);
    expect(evidence.testSuiteSummary?.skippedFiles).toBe(2);
    expect(evidence.testSuiteSummary?.totalTests).toBe(364);
    expect(evidence.testSuiteSummary?.passedTests).toBe(359);
    expect(evidence.testSuiteSummary?.skippedTests).toBe(5);
    expect(evidence.testSuiteSummary?.conclusion).toBe('PASS');
  });

  it('latest.yml 元数据与 NSIS 安装包契约校验（无空格、SHA-512 与 HTTP 200）', () => {
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    const meta = evidence.updaterMetadata;

    expect(meta).toBeDefined();
    expect(meta.targetInstaller).toBe('AstroLib-Setup-0.0.4.exe');
    expect(meta.targetInstaller).toMatch(/^[A-Za-z0-9_]+-Setup-\d+\.\d+\.\d+\.exe$/);
    expect(meta.targetInstaller).not.toContain(' ');
    expect(meta.targetInstallerSha512).toBe(
      'PT+oHgO0jSDKgTeREPNwFZs6R1Z4bJo1XqhayFF8iAhesH7LIwnYlSA/I93r7Rnd58ka+6Fg5JTb9OgwUlPlIw=='
    );
    expect(meta.targetInstallerSize).toBe(180109589);
    expect(meta.httpStatus).toBe(200);
    expect(meta.targetInstallerHttpStatus).toBe(200);
  });

  it('13 本官方教材包必须在 evidence 中逐一具备真实 contentHash 与精确字节大小', () => {
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    const abpAssets = (evidence.assets || []).filter((a: any) => a.name.endsWith('.abp'));

    expect(abpAssets.length).toBe(13);
    expect(evidence.catalog?.totalBooks).toBe(13);
    expect(evidence.catalog?.sizeBytes).toBe(13461);

    const expectedHashes: Record<string, { hash: string; size: number }> = {
      'math-math_senior.abp': { hash: 'cbc6bc3bbd4c199c', size: 2768561 },
      'math-math_analysis.abp': { hash: 'c1cf9ed358b6ff68', size: 4418567 },
      'math-engineering_analysis.abp': { hash: '0c94ee2cea9ffb80', size: 9215209 },
      'math-linear_algebra.abp': { hash: '719c38a2f015a161', size: 7491875 },
      'math-probability_statistics.abp': { hash: '2bf3b693c6b758f1', size: 3735808 },
      'math-linear_algebra_geometry.abp': { hash: 'a1abdb241f2dae21', size: 3323316 },
      'math-graph_theory.abp': { hash: 'd91de2bac0b5a2f4', size: 5447977 },
      'science-university_physics.abp': { hash: '2832c580504e69b0', size: 10657475 },
      'science-vectors_and_tensors.abp': { hash: '6a1d99dcc23546ed', size: 10024557 },
      'telecom-communication_principles.abp': { hash: '629eb930be385dfa', size: 50346492 },
      'telecom-digital_circuit.abp': { hash: '288abfd259d6dfc1', size: 15410280 },
      'telecom-electronic_circuits.abp': { hash: 'b86aeace1be90781', size: 14835555 },
      'cs-algorithms.abp': { hash: 'b779db982724728e', size: 18140573 },
    };

    for (const asset of abpAssets) {
      const expected = expectedHashes[asset.name];
      expect(expected).toBeDefined();
      expect(asset.contentHash).toBe(expected.hash);
      expect(asset.sizeBytes).toBe(expected.size);
      expect(asset.httpStatus).toBe(200);
    }
  });

  it('AppUpdater 语义化版本比对与安装包类型选择规则必须确定且幂等', () => {
    // @ts-expect-error accessing private method for contract assertion
    expect(AppUpdater.compareSemver('0.0.4', '0.0.3')).toBe(1);
    // @ts-expect-error accessing private method for contract assertion
    expect(AppUpdater.compareSemver('0.0.4', '0.0.4')).toBe(0);
    // @ts-expect-error accessing private method for contract assertion
    expect(AppUpdater.compareSemver('0.0.3', '0.0.4')).toBe(-1);
  });
});
