import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBuiltInSkill } from '../data/skills.js';
import { resolveSkillSource } from './skill.js';

vi.mock('../data/skills.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/skills.js')>();
  return {
    ...actual,
    getBuiltInSkill: vi.fn(actual.getBuiltInSkill),
  };
});

describe('resolveSkillSource', () => {
  const realCwd = process.cwd;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-test-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('prefers skills/<name>.md when present', () => {
    const skillPath = path.join(tempDir, 'skills', 'example.md');
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, 'local content');

    const result = resolveSkillSource('example');
    expect(result).toEqual({ content: 'local content', source: skillPath });
  });

  it('falls back to built-in content when local files are missing', () => {
    (getBuiltInSkill as unknown as vi.Mock).mockReturnValue({
      content: 'builtin content',
      sourceLabel: 'built-in: example',
    });

    const result = resolveSkillSource('example');
    expect(result).toEqual({ content: 'builtin content', source: 'built-in: example' });
    expect(getBuiltInSkill).toHaveBeenCalledWith('example');
  });

  it('throws if no local file or built-in entry exists', () => {
    (getBuiltInSkill as unknown as vi.Mock).mockReturnValue(undefined);
    expect(() => resolveSkillSource('missing')).toThrowError(/Skill 'missing' not found/);
  });
});
