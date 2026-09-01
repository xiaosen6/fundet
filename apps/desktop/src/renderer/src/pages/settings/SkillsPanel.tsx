import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { SkillView } from '../../../../shared/fundet-api.js';
import { getDefaultWorkDir } from '../../lib/defaults';

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="text-16 leading-[1.2] font-medium text-primary">{children}</h2>;
}

export function SkillsPanel(): React.JSX.Element {
  const workDir = getDefaultWorkDir();
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setSkills(await window.fundet.listSkills(workDir || undefined));
  }, [workDir]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importAt = async (scope: 'user' | 'project'): Promise<void> => {
    setError('');
    if (scope === 'project' && !workDir.trim()) {
      setError('导入到项目前，请先在「通用」里设置默认工作目录');
      return;
    }
    const file = await window.fundet.pickSkillFile();
    if (!file) return;
    setBusy(true);
    try {
      await window.fundet.importSkill(file, scope, workDir || undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (skill: SkillView): Promise<void> => {
    setError('');
    try {
      await window.fundet.uninstallSkill(skill.path);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionTitle>技能</SectionTitle>
          <p className="mt-1 text-13 text-secondary">
            安装自带 Video、social、geo、web-search。也可再导入 SKILL.md 或 zip。
            输入框输入 / 可点名，发送时写成 /skill:名字。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void importAt('user')}
            className="flex h-8 items-center gap-1 rounded-full bg-accent px-3 text-12 font-medium text-accent-fg"
          >
            <Plus size={13} />
            导入到全局
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void importAt('project')}
            className="flex h-8 items-center gap-1 rounded-full border border-board px-3 text-12 font-medium text-primary"
          >
            导入到项目
          </button>
        </div>
      </div>
      {error && <p className="text-12 text-error">{error}</p>}
      {skills.length === 0 ? (
        <div className="rounded-xl border border-board bg-card-ivory px-5 py-6 text-13 text-muted">
          还没有技能。导入一份带 name / description frontmatter 的 SKILL.md 即可。
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {skills.map((s) => (
            <div
              key={s.path}
              className="flex items-start gap-3 rounded-xl border border-board bg-card-ivory px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-14 font-medium text-primary">{s.name}</span>
                  <span className="rounded-full bg-chip px-2 py-0.5 text-11 text-muted">
                    {s.bundled ? '内置' : s.scope === 'user' ? '全局' : '项目'}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-12 text-secondary">{s.description}</p>
                <p className="mt-1 truncate font-mono text-11 text-muted">{s.path}</p>
              </div>
              {!s.bundled && (
                <button
                  type="button"
                  title="卸载"
                  onClick={() => void remove(s)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:text-error"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
