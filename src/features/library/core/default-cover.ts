import type { UnifiedReadingEntity } from '../../../types/library-entity';

function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveBookSlug(item: UnifiedReadingEntity): string {
  if (item.metadata?.bookSlug) {
    return String(item.metadata.bookSlug).trim();
  }
  if (item.id && item.id.startsWith('book:')) {
    const rest = item.id.slice('book:'.length);
    if (item.metadata?.colSlug && rest.startsWith(`${item.metadata.colSlug}-`)) {
      return rest.slice(item.metadata.colSlug.length + 1);
    }
    const dashIdx = rest.indexOf('-');
    if (dashIdx > 0 && dashIdx < rest.length - 1) {
      return rest.slice(dashIdx + 1);
    }
  }
  return '';
}

export function getLocalCoverFallbackCandidates(
  item: UnifiedReadingEntity,
  excludeUrls: string[] = []
): string[] {
  if (item.kind !== 'book') return [];
  const slug = resolveBookSlug(item);
  if (!slug) return [];

  const excluded = new Set(excludeUrls.filter(Boolean));
  excluded.add('/favicon.png');

  const rawCandidates = [
    `/covers/thumbs/${slug}.webp`,
    `/covers/${slug}.jpg`,
    `/covers/${slug}.png`,
    `/covers/${slug}.webp`,
  ];

  const out: string[] = [];
  for (const c of rawCandidates) {
    if (!excluded.has(c) && !out.includes(c)) {
      out.push(c);
    }
  }
  return out;
}

type CoverTone = 'math' | 'physics' | 'cs' | 'telecom' | 'literature' | 'paper' | 'general';

function resolveCoverTheme(item: UnifiedReadingEntity): { tone: CoverTone; overline: string } {
  const cat = (item.category || '').toLowerCase();
  const fmt = item.metadata?.sourceFormat || 'abp';

  if (item.kind === 'paper') {
    const pub = (item.publisher || '').trim();
    const label = pub && !/mineru/i.test(pub) ? `${pub.toUpperCase()} · PAPER` : 'ACADEMIC PAPER';
    return { tone: 'paper', overline: label.slice(0, 24) };
  }
  if (cat === 'math' || cat.includes('math')) {
    return { tone: 'math', overline: 'MATHEMATICS' };
  }
  if (cat === 'physics' || cat === 'science') {
    return { tone: 'physics', overline: 'PHYSICS & SCIENCE' };
  }
  if (cat === 'cs' || cat.includes('comp')) {
    return { tone: 'cs', overline: 'COMPUTER SCIENCE' };
  }
  if (cat === 'telecom') {
    return { tone: 'telecom', overline: 'TELECOM & EE' };
  }
  if (cat === 'literature' || cat === 'acg' || fmt === 'epub') {
    return { tone: 'literature', overline: fmt === 'epub' ? 'LITERATURE · EPUB' : 'LITERATURE' };
  }
  return { tone: 'general', overline: 'MONOGRAPH' };
}

function getTitleMonogram(title: string): string {
  const trimmed = title.replace(/^[《「『【(\s]+/, '').trim();
  const first = Array.from(trimmed)[0];
  return first ? first.toUpperCase() : 'A';
}

export function buildAcademicDefaultCoverHtml(item: UnifiedReadingEntity): string {
  const { tone, overline } = resolveCoverTheme(item);
  const title = (item.title || 'Untitled').trim();
  const subtitle = (item.subtitle || '').trim();
  const footer = (item.author || item.publisher || (item.kind === 'paper' ? 'Research Archive' : 'AstroLib')).trim();
  const monogram = getTitleMonogram(title);

  return `<div class="academic-default-cover is-tone-${escapeHtml(tone)}" aria-label="${escapeHtml(title)}">
    <div class="adc-spine" aria-hidden="true"></div>
    <div class="adc-inner">
      <div class="adc-overline">${escapeHtml(overline)}</div>
      <div class="adc-body">
        <div class="adc-rule" aria-hidden="true"></div>
        <div class="adc-title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="adc-subtitle">${escapeHtml(subtitle)}</div>` : ''}
      </div>
      <div class="adc-footer">
        <span class="adc-author">${escapeHtml(footer)}</span>
        <span class="adc-monogram" aria-hidden="true">${escapeHtml(monogram)}</span>
      </div>
    </div>
  </div>`;
}
