import { describe, expect, it } from 'vitest';
import { SEED_CATALOGS } from '@crm/data/seedCatalogs';
import type { Project } from '@crm/types/crm';
import { ALL_SEGMENTS, filterProjectsBySegment, getProjectSegments, getProjectStatusTone, toInterestedCounts } from './projectCatalog';

const projects: Project[] = SEED_CATALOGS.projects;

describe('projectCatalog', () => {
  it('phân khúc duy nhất, bỏ rỗng', () => {
    const withBlank = [...projects, { ...projects[0], id: 'p-x', segment: '  ' }];
    const segments = getProjectSegments(withBlank);
    expect(new Set(segments).size).toBe(segments.length);
    expect(segments).not.toContain('');
  });

  it('lọc theo phân khúc; "tất cả" trả bản sao đủ', () => {
    const [segment] = getProjectSegments(projects);
    expect(filterProjectsBySegment(projects, segment).every((project) => project.segment === segment)).toBe(true);
    const all = filterProjectsBySegment(projects, ALL_SEGMENTS);
    expect(all).toHaveLength(projects.length);
    expect(all).not.toBe(projects);
  });

  it('màu trạng thái dự án', () => {
    expect(getProjectStatusTone('SELLING')).toBe('success');
    expect(getProjectStatusTone('UPCOMING')).toBe('warning');
    expect(getProjectStatusTone('SOLD_OUT')).toBe('neutral');
    expect(getProjectStatusTone(null)).toBe('neutral');
  });

  it('số khách quan tâm theo id dự án', () => {
    const counts = toInterestedCounts([{ key: { id: 'proj-1', label: 'A' }, count: 4, percent: 40, averageProgress: 50 }]);
    expect(counts.get('proj-1')).toBe(4);
    expect(counts.get('proj-2')).toBeUndefined();
  });
});
