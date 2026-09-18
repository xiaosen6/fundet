/**
 * IM 交互问答桥（机制与文案照 Cindy im/dingtalk/interaction.ts 手工移植）：
 * 把会话的工具审批 / 计划审批 / 追问转成 IM 文本问答——格式化提问发给用户，
 * 下一条入站消息按词表解析成 InteractionDecision；解析不了回 null（重问）。
 * Fundet 差异：无 auto-review 附加行；plan_review 保留（agent-core 有该请求形态）。
 */
import type { InteractionDecision, InteractionRequest } from '@fundet/agent-core';

export function formatInteractionPrompt(request: InteractionRequest): string {
  if (request.kind === 'permission') {
    return [`需要确认操作：${request.toolName}`, '回复“允许”继续，或回复“拒绝”取消。'].join('\n');
  }
  if (request.kind === 'plan_review') {
    return ['计划已准备好。', '回复“批准”继续，或回复“拒绝”取消。'].join('\n');
  }
  const lines: string[] = ['需要你补充以下信息：'];
  request.questions.forEach((question, questionIndex) => {
    lines.push(`${questionIndex + 1}. ${question.question}`);
    question.options?.forEach((option, optionIndex) => {
      lines.push(`   ${optionIndex + 1}) ${option.label}`);
    });
  });
  lines.push('请直接回复选项序号或你的答案。');
  return lines.join('\n');
}

type AskQuestion = Extract<InteractionRequest, { kind: 'ask_user_question' }>['questions'][number];

export function formatQuestionPrompt(question: AskQuestion, index: number, total: number): string {
  const lines = [`需要你补充信息（${index + 1}/${total}）：${question.question}`];
  question.options?.forEach((option, optionIndex) => {
    lines.push(`${optionIndex + 1}) ${option.label}`);
  });
  lines.push('请回复选项序号或你的答案。');
  return lines.join('\n');
}

export function parseQuestionAnswer(question: AskQuestion, rawText: string): string | null {
  const text = rawText.trim();
  if (!text) return null;
  const index = Number.parseInt(text, 10);
  const option = Number.isInteger(index) && index >= 1 ? question.options?.[index - 1] : undefined;
  return option?.label ?? text;
}

export function parseInteractionReply(
  request: InteractionRequest,
  rawText: string,
): InteractionDecision | null {
  const text = rawText.trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (request.kind === 'permission') {
    if (['允许', '同意', '确认', '继续', 'allow', 'yes', 'y'].includes(normalized)) {
      return { kind: 'permission', behavior: 'allow' };
    }
    if (['拒绝', '取消', 'deny', 'no', 'n'].includes(normalized)) {
      return { kind: 'permission', behavior: 'deny', reason: 'im_user_denied' };
    }
    return null;
  }
  if (request.kind === 'plan_review') {
    if (['批准', '同意', '确认', '继续', 'approve', 'yes', 'y'].includes(normalized)) {
      return { kind: 'plan_review', behavior: 'allow' };
    }
    if (['拒绝', '取消', 'deny', 'no', 'n'].includes(normalized)) {
      return { kind: 'plan_review', behavior: 'deny', reason: 'im_user_denied' };
    }
    return null;
  }
  const answers: Record<string, string> = {};
  for (const question of request.questions) {
    const index = Number.parseInt(text, 10);
    const option =
      Number.isInteger(index) && index >= 1 ? question.options?.[index - 1] : undefined;
    answers[question.question] = option?.label ?? text;
  }
  return { kind: 'ask_user_question', answers };
}

export const __testing = {
  formatInteractionPrompt,
  formatQuestionPrompt,
  parseQuestionAnswer,
  parseInteractionReply,
};
