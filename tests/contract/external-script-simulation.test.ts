import { describe, it, expect } from 'vitest';
import { ContentApiService } from '../../src/core/content-api/content-api-service.ts';

describe('Phase 1: External Script Consumption Simulation', () => {
  const service = ContentApiService.getInstance();

  it('场景 1: 外部脚本跨章节对比 —— 辨析两章节卡片与公式密度', () => {

    const ch1 = service.getChapterAst('math', 'linear_algebra_geometry', '11_二三阶行列式');
    const ch2 = service.getChapterAst('math', 'linear_algebra_geometry', '12_全排列及其逆序数');

    expect(ch1).toBeDefined();
    expect(ch2).toBeDefined();

    const analysisReport = {
      ch1: {
        title: ch1.title,
        cardsCount: ch1.cards.length,
        formulasCount: ch1.formulas.length,
        readingTime: ch1.readingTimeMinutes,
      },
      ch2: {
        title: ch2.title,
        cardsCount: ch2.cards.length,
        formulasCount: ch2.formulas.length,
        readingTime: ch2.readingTimeMinutes,
      },
      densityComparison: {
        formulaDifference: ch1.formulas.length - ch2.formulas.length,
        cardsDifference: ch1.cards.length - ch2.cards.length,
      },
    };

    expect(analysisReport.ch1.cardsCount).toBeGreaterThan(0);
    expect(analysisReport.ch2.formulasCount).toBeGreaterThan(0);
    expect(typeof analysisReport.densityComparison.formulaDifference).toBe('number');
  });

  it('场景 2: 外部脚本习题讲解组装 —— 将章节卡片与对应习题自动绑定', () => {
    const ast = service.getChapterAst('math', 'linear_algebra_geometry', '11_二三阶行列式');
    const exercises = service.getChapterExercises('math', 'linear_algebra_geometry', '1.1_二三阶行列式');

    expect(exercises.length).toBeGreaterThan(0);

    const definitionCard = ast.cards.find((c) => c.title?.includes('二阶行列式'));
    expect(definitionCard).toBeDefined();

    const studyWorksheet = {
      chapterTitle: ast.title,
      coreKnowledge: definitionCard?.content,
      exercises: exercises.map((ex) => ({
        id: ex.id,
        question: ex.question,
        referenceCard: definitionCard?.id,
      })),
    };

    expect(studyWorksheet.exercises.length).toBe(exercises.length);
    expect(studyWorksheet.exercises[0].referenceCard).toBe(definitionCard?.id);
  });

  it('场景 3: 外部脚本 MinerU 质量巡检 —— 审查 OCR 产物图片与布局块完整性', () => {
    const tasks = service.listMineruTasks();
    if (tasks.length === 0) return;

    const task = tasks[0];
    const auditReport = {
      bookHash: task.bookHash,
      hasFullMarkdown: task.hasFullMarkdown,
      hasLayoutJson: task.hasLayoutJson,
      imageAssetsCount: task.imageCount,
      isReadyForAbp: task.hasFullMarkdown && task.imageCount > 0,
    };

    expect(auditReport.bookHash).toBeDefined();
    expect(auditReport.isReadyForAbp).toBe(true);
  });
});
