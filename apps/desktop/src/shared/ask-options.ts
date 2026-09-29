/**
 * ask_user_question 选项过滤（手工移植 Cindy maker-shared/interaction.ts #5198）。
 *
 * 模型自造的「其他（回复说明）/Other (please specify)」式选项本质是自由输入
 * 逃生口：宿主问答卡应剔除它们并自供统一输入行——否则用户点击会把占位标签
 * 原样提交，模型读到的是「空答案」。
 *
 * 只认开头的 other 类 token + 分隔符/结尾边界，因此「其他任务」「Other tasks」
 * 这类实质选项不会被误杀。
 */

export function isFreeTextAskOptionLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  if (!normalized) return false;
  return /^(?:其他(?:答案|选项)?|其它(?:答案|选项)?|other|others|something else|その他|기타)(?=$|\s*[（(【[：:，,、.。\-—－…])/.test(
    normalized,
  );
}

/** 问答卡应渲染的选项：剔除模型自造自由输入项（全被剔除时返回空，调用方退回自由输入） */
export function visibleAskOptions<T extends { label: string }>(options: readonly T[] | undefined): T[] {
  return (options ?? []).filter((option) => !isFreeTextAskOptionLabel(option.label));
}
