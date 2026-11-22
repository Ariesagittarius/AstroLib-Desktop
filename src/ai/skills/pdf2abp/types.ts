/**
 * src/ai/skills/pdf2abp/types.ts
 * ============================================================================
 * 内置 PDF2ABP Skill 与 ABP 规范文档结构定义
 * ============================================================================
 */

export interface SkillSection {
  id: string;
  title: string;
  content: string;
}

export interface SkillDocument {
  id: string;
  title: string;
  summary: string;
  audience: 'main' | 'subagent' | 'both';
  tags: string[];
  sections: SkillSection[];
}

export interface SkillSummary {
  id: string;
  title: string;
  summary: string;
  audience: 'main' | 'subagent' | 'both';
  tags: string[];
  sectionIds: string[];
}
