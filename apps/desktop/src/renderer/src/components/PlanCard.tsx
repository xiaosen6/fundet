/**
 * PlanCard —— 计划先行档的计划步骤卡（数据源：plan-mode 扩展产出的
 * "**Plan Steps (N):**\n\n1. ☐ xxx" custom entry，经 session:get-plan 拉取）。
 * v1 只读展示；执行进度跟踪走待办卡（todo 扩展）。
 */
import { ClipboardList } from 'lucide-react';

const PLAN_LINE = /^\d+\.\s*(?:☐|☐\s*|☑|☑\s*|\[[ x]\]\s*)?(.*)$/;

export function parsePlanSteps(content: string | null | undefined): string[] | null {
  if (!content) return null;
  const steps: string[] = [];
  for (const raw of content.split('\n')) {
    const m = PLAN_LINE.exec(raw.trim());
    if (!m) continue;
    const text = (m[1] ?? '').trim();
    if (text) steps.push(text);
  }
  return steps.length > 0 ? steps : null;
}

export function PlanCard({ content }: { content: string | null | undefined }): React.JSX.Element | null {
  const steps = parsePlanSteps(content);
  if (!steps) return null;
  return (
    <div className="rounded-container border border-board bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <ClipboardList size={14} className="text-muted" />
        <span className="text-13 font-medium text-primary">计划</span>
        <span className="ml-auto text-11 text-muted">{steps.length} 步</span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-13 text-primary">
            <span className="mt-px min-w-4 shrink-0 text-right text-11 tabular-nums text-muted">{i + 1}.</span>
            <span className="min-w-0 break-words">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
