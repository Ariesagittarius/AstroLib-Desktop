/**
 * src/ai/skills/pdf2abp/index.ts
 * ============================================================================
 * 内置 PDF2ABP Skill 与 ABP 规范文档索引中心
 * ============================================================================
 */

import { abpSpecSkill } from './abp-spec.ts';
import { academicTypesettingSkill } from './academic-typesetting-rules.ts';
import { orchestratorSopSkill } from './orchestrator-sop.ts';
import { subagentProtocolSkill } from './subagent-proofreader-protocol.ts';
import { mineruPitfallsSkill } from './mineru-pitfalls-and-python-recipes.ts';
import type { SkillDocument, SkillSummary } from './types.ts';

const ALL_SKILLS: SkillDocument[] = [
  orchestratorSopSkill,
  abpSpecSkill,
  academicTypesettingSkill,
  subagentProtocolSkill,
  mineruPitfallsSkill,
];

const SKILL_MAP = new Map<string, SkillDocument>(ALL_SKILLS.map((s) => [s.id, s]));

export function listPdf2AbpSkills(): SkillSummary[] {
  return ALL_SKILLS.map((s) => ({
    id: s.id,
    title: s.title,
    summary: s.summary,
    audience: s.audience,
    tags: s.tags,
    sectionIds: s.sections.map((sec) => sec.id),
  }));
}

export function readPdf2AbpSkill(
  id: string,
  sectionId?: string
): {
  id: string;
  title: string;
  summary: string;
  sectionIds: string[];
  content: string;
} {
  const doc = SKILL_MAP.get(id);
  if (!doc) {
    const validIds = ALL_SKILLS.map((s) => s.id).join(', ');
    throw new Error(`未找到 Skill "${id}"。可用 Skills: ${validIds}`);
  }

  let sectionsToRender = doc.sections;
  if (sectionId && sectionId.trim()) {
    const matched = doc.sections.filter((s) => s.id === sectionId.trim());
    if (matched.length === 0) {
      throw new Error(`Skill "${id}" 中不存在章节 "${sectionId}"。可用章节: ${doc.sections.map((s) => s.id).join(', ')}`);
    }
    sectionsToRender = matched;
  }

  const content = sectionsToRender.map((s) => `## ${s.title}\n\n${s.content}`).join('\n\n---\n\n');
  return {
    id: doc.id,
    title: doc.title,
    summary: doc.summary,
    sectionIds: doc.sections.map((s) => s.id),
    content,
  };
}

export type { SkillDocument, SkillSummary, SkillSection } from './types.ts';
