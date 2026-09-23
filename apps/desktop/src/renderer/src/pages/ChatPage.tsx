/**
 * ChatPage — 会话页：固定两栏（Sidebar 260px + 聊天主区）。
 *
 * 主区：slim 头部（标题 + Canvas）→ MessageStream → composer。
 * 上下文圆环在输入卡下方右侧（对齐 Cindy ChatInput 底栏）。
 * composer 在有悬挂审批时被 PermissionPrompt 替换。
 *
 * 发送复活逻辑：会话不在 main 内存（应用重启后打开旧会话）时，按 DB 行的
 * model 在 providers 里反查 providerId，带 create 参数重发让 main lazy-create。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight as ChevronRightIcon, Clock, KeyRound, PanelRight, Pencil, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Effort, PermissionMode } from '@fundet/agent-core';
import type { ProviderView, SessionAttachment, SkillView } from '../../../shared/fundet-api.ts';
import type { SlashItem } from '../components/SlashPalette';
import {
  abortSession,
  deleteAssistantTurn,
  deleteDraftSession,
  ensureDraftSession,
  ensureHistory,
  forkSessionAt,
  getDraftProviderId,
  getDraftSession,
  isDraftSession,
  markSessionSeen,
  refreshSessionList,
  renameSession,
  resendTurn,
  setSessionEffortLevel,
  resolvePermission,
  sendMessage,
  truncateItemsFrom,
  updateDraftSession,
  useRunningIds,
  useSessionList,
  useSessionSlice,
} from '../stores/sessionStore';
import {
  getDefaultWorkDir,
  getLastModel,
  getLastProviderId,
  rememberModelChoice,
  setDefaultWorkDir,
} from '../lib/defaults';
import { ChatInput } from '../components/ChatInput';
import { WelcomeSuggestions } from '../components/WelcomeSuggestions';
import { SessionRenameInput } from '../components/SessionRenameInput';
import { MessageStream } from '../components/MessageStream';
import { PermissionPrompt } from '../components/PermissionPrompt';
import { RunningStatus } from '../components/RunningStatus';
import { ModelSelector, PermissionSelector, EffortSelector } from '../components/SelectorChips';
import { ContextCapacityRing } from '../components/ContextCapacityRing';
import { DwsWidgets } from '../components/dws/DwsWidgets';
import { DynamicIsland } from '../components/dws/DynamicIsland';
import type { DwsWidgetsSnapshot } from '../../../shared/fundet-api.js';
import { brand } from '../../../shared/brand.js';
import { FolderPickerChip } from '../components/FolderPickerChip';
import { KnowledgeChip } from '../components/KnowledgeChip';
import { Sidebar } from '../components/Sidebar';
import { BrandMark } from '../components/BrandMark';
import { addRecentFolder } from '../lib/recentFolders';
import { collectArtifacts, type Artifact } from '../lib/artifacts';
import { fileKind } from '../../../shared/file-kind.ts';
import { dataTransferHasDirectory, dataTransferHasFiles, filesFromDataTransfer, firstDroppedDirectoryPath } from '../lib/file-drop';
import { CanvasPane } from '../components/CanvasPane';
import { hasFramelessControls } from '../components/WindowControls';
import { Tooltip } from '../components/ui/Tooltip';
import { confirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../components/ui/toast';
import { FindBar } from '../components/FindBar';
import { RewindDialog } from '../components/RewindDialog';
import { preferScannedContextWindow } from '../../../shared/context-window.js';
import { FadeSwitcher } from '../components/ui/FadeSwitcher';
import { PanelView, type SidebarPanelId } from '../components/sidebar/SidebarPanelDrawer';
import { cn } from '../lib/cn';

export function ChatPage(): React.JSX.Element {
  const sessions = useSessionList();
  const runningIds = useRunningIds();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState('');
  const [dwsWidgets, setDwsWidgets] = useState<DwsWidgetsSnapshot | null>(null);

  // 钉钉组件：订阅主进程 push + 回焦触发刷新（主进程按 TTL 去抖，不会刷爆）
  useEffect(() => {
    void window.fundet.dwsWidgets().then(setDwsWidgets);
    const off = window.fundet.onDwsWidgetsChanged(setDwsWidgets);
    const onFocus = (): void => {
      void window.fundet.dwsWidgets().then(setDwsWidgets);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      off();
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const refreshDwsWidgets = useCallback((): Promise<void> => {
    return window.fundet.dwsWidgets(true).then(setDwsWidgets);
  }, []);

  // 侧栏宽度拖拽（200–400px 夹紧；持久化到 localStorage）
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('fundet.sidebar-width'));
    return saved >= 200 && saved <= 400 ? saved : 260;
  });
  const startSidebarResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const move = (ev: PointerEvent): void => {
      const next = Math.min(400, Math.max(200, startW + ev.clientX - startX));
      setSidebarWidth(next);
      localStorage.setItem('fundet.sidebar-width', String(next));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [sidebarWidth]);
  const [workDir, setWorkDir] = useState(getDefaultWorkDir);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasPath, setCanvasPath] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<SessionAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [dragFolder, setDragFolder] = useState(false);
  const [renamingHeader, setRenamingHeader] = useState(false);
  const [headerTitleDraft, setHeaderTitleDraft] = useState('');
  const headerRenameCommitted = useRef(false);
  const dragCountRef = useRef(0);

  const slice = useSessionSlice(activeId);

  // Ctrl+F 页内搜索（仅会话页生效；FindBar 内部处理 Esc/清高亮）
  const [findOpen, setFindOpen] = useState(false);
  // 主区面板（IM/技能/MCP/知识库）：右侧就地显示，替代会话视图；侧栏保持可见
  const [activePanel, setActivePanel] = useState<SidebarPanelId | null>(null);
  // 编辑上一条用户消息：记录原消息时间戳，发送时截断其后重发（Cindy 同款 Pen）
  // 粘贴长文本 chip：发送时按序展开为原文追加
  const [pastedTexts, setPastedTexts] = useState<Array<{ id: number; text: string; lines: number }>>([]);
  const [rewindOpen, setRewindOpen] = useState(false);
  // 消息排队：运行中 Enter 入队，本轮结束后自动按序发送（Cindy PendingQueue 简化版）
  const [queuedTexts, setQueuedTexts] = useState<string[]>([]);
  const queueDispatching = useRef(false);
  const queueText = useCallback((t: string): void => {
    setQueuedTexts((q) => [...q, t]);
    setInput('');
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        if (!activeId) return;
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId]);

  useEffect(() => {
    setRenamingHeader(false);
    headerRenameCommitted.current = false;
    setPastedTexts([]);
    // 切进即视为已看：清侧栏关注点，此后该会话完成不再打未读标
    markSessionSeen(activeId);
  }, [activeId]);

  const activeMeta = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? getDraftSession(activeId) ?? null,
    [sessions, activeId],
  );

  const artifacts = useMemo(() => {
    const fromItems = collectArtifacts(slice.items);
    const seen = new Set(fromItems.map((a) => a.path));
    const extra: Artifact[] = [];
    for (const a of attachments) {
      if (seen.has(a.path)) continue;
      extra.push({ path: a.path, kind: fileKind(a.path), toolName: 'attach' });
    }
    return extra.length > 0 ? [...fromItems, ...extra] : fromItems;
  }, [slice.items, attachments]);
  const modelSpec = useMemo(() => {
    const id = activeMeta?.model;
    if (!id) return undefined;
    for (const p of providers) {
      const found = p.models.find((m) => m.id === id);
      if (found) return found;
    }
    return undefined;
  }, [providers, activeMeta?.model]);

  useEffect(() => {
    setCanvasOpen(false);
    setCanvasPath(null);
    setAttachments([]);
    setDragOver(false);
    dragCountRef.current = 0;
  }, [activeId]);

  const latestArtifact = artifacts[artifacts.length - 1]?.path;
  // 只跟踪最新产物路径（顶栏 Canvas 按钮用），不强制打开——
  // 产物每回合都在变，强制开会让用户"关不掉"（对齐 Cindy：数据变化不打扰用户）。
  useEffect(() => {
    if (latestArtifact && canvasPath === null) setCanvasPath(latestArtifact);
  }, [latestArtifact, canvasPath]);

  const openCanvas = useCallback((p: string) => {
    setCanvasPath(p);
    setCanvasOpen(true);
  }, []);

  useEffect(() => {
    void window.fundet.listProviders().then(setProviders);
    void (async () => {
      if (getDefaultWorkDir().trim()) return;
      const home = await window.fundet.userHome();
      if (!home) return;
      addRecentFolder(home);
      setDefaultWorkDir(home);
      setWorkDir(home);
    })();
  }, []);

  useEffect(() => {
    const dir = activeMeta?.workDir || getDefaultWorkDir();
    void window.fundet.listSkills(dir || undefined).then(setSkills);
  }, [activeMeta?.workDir]);

  const slashItems = useMemo<SlashItem[]>(() => {
    const skillItems: SlashItem[] = skills.map((s) => ({
      id: `skill:${s.path}`,
      label: s.name,
      hint: s.description,
      insert: `/skill:${s.name}`,
      kind: 'skill',
    }));
    return skillItems;
  }, [skills]);

  // 切会话：重建历史（仅首次）
  useEffect(() => {
    if (activeId) void ensureHistory(activeId);
  }, [activeId]);

  // ---------- 会话动作 ----------

  // 新建会话只建本地草稿（不调 session:create、不 spawn pi）；
  // 首条消息 send 时由 main 侧 lazy-create 落 DB + 起进程。
  const applyWorkDir = useCallback(
    (picked: string): void => {
      addRecentFolder(picked);
      setDefaultWorkDir(picked);
      setWorkDir(picked);
      if (activeId && isDraftSession(activeId)) {
        updateDraftSession(activeId, { workDir: picked });
        // 工作目录进了预热指纹：重预热（main 侧弃旧建新）
        const providerId = getDraftProviderId(activeId);
        const provider = providerId
          ? providers.find((p) => p.id === providerId)
          : undefined;
        const model =
          provider?.models.find((m) => m.id === getLastModel())?.id ?? provider?.models[0]?.id;
        if (providerId && model) {
          void window.fundet.sessionPrewarm({
            sessionId: activeId,
            providerId,
            model,
            workDir: picked,
          });
        }
      }
    },
    [activeId, providers],
  );

  const createSession = useCallback((): void => {
    setNotice('');
    setInput('');
    const dir = workDir.trim() || getDefaultWorkDir();
    if (!dir) {
      setNotice('请先选择工作目录');
      return;
    }
    const provider =
      providers.find((p) => p.id === getLastProviderId()) ?? providers[0];
    const model =
      provider?.models.find((m) => m.id === getLastModel())?.id ?? provider?.models[0]?.id;
    if (!provider || !model) {
      setNotice('请先在设置页配置 provider 和模型');
      return;
    }
    const meta = ensureDraftSession({
      workDir: dir,
      providerId: provider.id,
      model,
      title: '新对话',
    });
    rememberModelChoice(provider.id, model);
    setActiveId(meta.id);
    // 草稿预热：打字期间后台把 pi 会话拉起来，首条消息免等冷启动（失败静默）
    void window.fundet.sessionPrewarm({
      sessionId: meta.id,
      providerId: provider.id,
      model,
      workDir: dir,
    });
  }, [providers, workDir]);

  /** 钉钉组件 AI 钩子：开新会话并预填 prompt（用户过目后手动发送） */
  const askDwsAgent = useCallback(
    (prompt: string): void => {
      createSession();
      setInput(prompt);
    },
    [createSession],
  );

  const deleteSession = useCallback(
    async (id: string): Promise<void> => {
      // 草稿预热过的话回收 pi 会话与零消息行；纯本地草稿照旧直接移除
      if (isDraftSession(id)) {
        deleteDraftSession(id);
        void window.fundet.sessionPrewarmDiscard(id).catch(() => undefined);
        if (activeId === id) setActiveId(null);
        return;
      }
      const ok = await confirmDialog({
        title: '删除这个会话？',
        description: '会话记录将一并删除，此操作不可撤销。',
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return;
      await window.fundet.deleteSession(id);
      if (activeId === id) setActiveId(null);
      await refreshSessionList();
    },
    [activeId],
  );

  // ---------- 发送 / 中断 ----------

  const mergeAttachments = useCallback((incoming: SessionAttachment[]): void => {
    setAttachments((prev) => {
      const seen = new Set(prev.map((a) => a.path));
      const next = [...prev];
      for (const a of incoming) {
        if (seen.has(a.path)) continue;
        seen.add(a.path);
        next.push(a);
      }
      return next;
    });
    const last = incoming[incoming.length - 1];
    if (last) setCanvasPath(last.path);
  }, []);

  const sessionWorkDir = activeMeta?.workDir || workDir;

  const stagePaths = useCallback(
    async (paths: string[]): Promise<void> => {
      const dir = sessionWorkDir.trim();
      if (!dir) {
        setNotice('请先选择工作目录');
        return;
      }
      try {
        const staged = await window.fundet.stageFiles(dir, paths);
        mergeAttachments(staged);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    },
    [mergeAttachments, sessionWorkDir],
  );

  const addDroppedFiles = useCallback(
    async (fileList: File[]): Promise<void> => {
      const dir = sessionWorkDir.trim();
      if (!dir) {
        setNotice('请先选择工作目录');
        return;
      }
      const paths: string[] = [];
      const blobs: File[] = [];
      for (const f of fileList) {
        const p = window.fundet.getPathForFile(f);
        if (p) paths.push(p);
        else blobs.push(f);
      }
      if (paths.length > 0) await stagePaths(paths);
      for (const f of blobs) {
        try {
          const buf = await f.arrayBuffer();
          const staged = await window.fundet.stageBytes(dir, f.name || 'paste', buf);
          mergeAttachments([staged]);
        } catch (err) {
          setNotice(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [mergeAttachments, sessionWorkDir, stagePaths],
  );

  // lazy-create 参数：草稿带精确 providerId，历史会话按 model 在 providers 反查。
  // send 与错误卡「重新发送」共用——重发不带 create 的话，会话被终态错误回收
  // 或应用重启后 main 侧会拒收（ensureSession 无 create 即抛错）。
  const buildCreateParam = useCallback((): Parameters<typeof sendMessage>[2] => {
    if (!activeId || !activeMeta) return undefined;
    const draftProviderId = getDraftProviderId(activeId);
    const provider = draftProviderId
      ? providers.find((p) => p.id === draftProviderId)
      : providers.find((p) => p.models.some((m) => m.id === activeMeta.model));
    if (!provider) return undefined;
    return {
      sessionId: activeId,
      workDir: activeMeta.workDir,
      providerId: provider.id,
      model: activeMeta.model,
      title: activeMeta.title,
      // 草稿上选的权限档位随首条消息一起落库（历史会话该值本就已在 DB）
      ...(activeMeta.permissionMode
        ? { permissionMode: activeMeta.permissionMode as PermissionMode }
        : {}),
      // effort 同理：死会话落库的档位要在 lazy-create 时带上
      ...(activeMeta.effort ? { effort: activeMeta.effort as Effort } : {}),
    };
  }, [activeId, activeMeta, providers]);

  const shownWindow = activeMeta?.model
    ? preferScannedContextWindow(activeMeta.model, modelSpec?.contextWindow) ?? 0
    : 0;

  // 队列派发：本轮空闲（非运行/无审批）且队列有货 → 按序发下一条
  useEffect(() => {
    if (slice.isRunning || slice.pendingInteraction || queueDispatching.current) return;
    if (queuedTexts.length === 0 || !activeId) return;
    queueDispatching.current = true;
    const [first, ...rest] = queuedTexts;
    setQueuedTexts(rest);
    void sendMessage(activeId, first ?? '', buildCreateParam(), undefined).finally(() => {
      queueDispatching.current = false;
    });
  }, [slice.isRunning, slice.pendingInteraction, queuedTexts, activeId, buildCreateParam]);

  // 终态错误卡的「重新发送」：重发本轮最后一条用户消息（含附件路径引用）。
  // 走 store 的 resendTurn（记录重试参数，限流/网络错误仍可自动重试）。
  const resendLast = useCallback((): void => {
    if (!activeId) return;
    const lastUser = [...slice.items].reverse().find((it) => it.kind === 'user');
    if (!lastUser || lastUser.kind !== 'user') return;
    const create = buildCreateParam();
    void resendTurn(
      activeId,
      lastUser.text,
      create ?? undefined,
      lastUser.attachments && lastUser.attachments.length > 0 ? lastUser.attachments : undefined,
    );
  }, [activeId, buildCreateParam, slice.items]);

  const pickFiles = useCallback(async (): Promise<void> => {
    const picked = await window.fundet.pickFiles();
    if (picked && picked.length > 0) await stagePaths(picked);
  }, [stagePaths]);

  // 编辑（Cindy edit-last-message 同款）：入口只在最后一条 user 消息；点编辑瞬间
  // 若 turn 还在跑立即中断（点编辑的意图就是"停下来我要改"）；提交 = 截断重发
  const handleEditStart = useCallback((): void => {
    if (activeId && slice.isRunning) void abortSession(activeId);
  }, [activeId, slice.isRunning]);

  const submitUserEdit = useCallback(
    async (text: string, createdAt: number | undefined, attachments?: SessionAttachment[]): Promise<void> => {
      if (!activeId || createdAt === undefined) return;
      setNotice('');
      // 运行中（刚点编辑触发的中断还在收尾）：等 abort 收口再截断，防重发被拒
      if (slice.isRunning) await abortSession(activeId);
      if (!isDraftSession(activeId)) {
        try {
          await window.fundet.deleteTurn(activeId, createdAt - 1, Date.now() + 60_000);
        } catch (err) {
          setNotice(`编辑发送失败：${err instanceof Error ? err.message : String(err)}`);
          return;
        }
      }
      truncateItemsFrom(activeId, createdAt);
      setQueuedTexts([]);
      await sendMessage(activeId, text, buildCreateParam(), attachments && attachments.length > 0 ? attachments : undefined);
    },
    [activeId, slice.isRunning, buildCreateParam],
  );

  // 删除某条用户消息及其后全部内容（composer 卡下方「⋯」/消息操作栏入口）
  const deleteUserMessage = useCallback(
    async (createdAt: number): Promise<void> => {
      if (!activeId) return;
      const ok = await confirmDialog({
        title: '删除这条提问？',
        description: '该提问及其后的全部回复将一并删除，此操作不可撤销。',
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return;
      if (!isDraftSession(activeId)) {
        try {
          await window.fundet.deleteTurn(activeId, createdAt - 1, Date.now() + 60_000);
        } catch (err) {
          setNotice(`删除失败：${err instanceof Error ? err.message : String(err)}`);
          return;
        }
      }
      truncateItemsFrom(activeId, createdAt);
    },
    [activeId],
  );

  // 粘贴长文本 chip
  const pasteLongText = useCallback((text: string, lines: number): void => {
    setPastedTexts((prev) => [...prev, { id: Date.now() + Math.random(), text, lines }]);
  }, []);
  const removePastedText = useCallback((id: number): void => {
    setPastedTexts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const send = useCallback(async (): Promise<void> => {
    const text = input.trim();
    if (!activeId || (!text && attachments.length === 0 && pastedTexts.length === 0)) return;
    const pending = attachments;
    setInput('');
    setAttachments([]);
    setNotice('');
    // 粘贴 chip 展开：正文 = 输入框文本 + 各 chip 原文（按粘贴顺序追加）
    let fullText = text;
    if (pastedTexts.length > 0) {
      for (const p of pastedTexts) fullText += (fullText ? '\n\n' : '') + p.text;
      setPastedTexts([]);
    }
    // 重启后旧会话 / 本地草稿都不在 main 内存：带 create 让 main lazy-create。
    const create = buildCreateParam();
    await sendMessage(activeId, fullText, create, pending.length > 0 ? pending : undefined);
  }, [activeId, attachments, buildCreateParam, input, pastedTexts]);

  const abort = useCallback(async (): Promise<void> => {
    if (activeId) await abortSession(activeId);
  }, [activeId]);

  // ---------- composer chips ----------

  const selectModel = useCallback(
    async (providerId: string, modelId: string): Promise<void> => {
      if (!activeId) return;
      rememberModelChoice(providerId, modelId);
      // 草稿还没有 main 侧会话，只改本地；首条消息 send 时随 create 参数生效
      if (isDraftSession(activeId)) {
        updateDraftSession(activeId, { providerId, model: modelId });
        return;
      }
      try {
        await window.fundet.setSessionModel(activeId, modelId, providerId);
        await refreshSessionList();
      } catch (err) {
        setNotice(`切换模型失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [activeId],
  );

  const permissionMode = (activeMeta?.permissionMode as PermissionMode | null) ?? 'ask';
  const selectPermission = useCallback(
    async (mode: PermissionMode): Promise<void> => {
      if (!activeId) return;
      // 草稿同上：纯本地
      if (isDraftSession(activeId)) {
        updateDraftSession(activeId, { permissionMode: mode });
        return;
      }
      try {
        await window.fundet.setSessionPermissionMode(activeId, mode);
        await refreshSessionList();
      } catch (err) {
        setNotice(`切换权限档位失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [activeId],
  );


  // ---------- 渲染 ----------

  const pendingPermission =
    slice.pendingInteraction?.kind === 'permission' ? slice.pendingInteraction : null;

  // 无可用模型（没配 provider / 草稿没选到模型）：发送禁用（对齐 cindy-09 的
  // 禁用态，不报错）；空态下再叠一张内联引导面板（对齐 cindy-02 的 Connect 面板）。
  const noModel = providers.length === 0 || !activeMeta?.model;

  return (
    <div className="flex h-full">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        runningIds={runningIds}
        onSelect={(id) => {
          setActivePanel(null);
          setActiveId(id);
        }}
        onCreate={() => {
          setActivePanel(null);
          void createSession();
        }}
        onDelete={(id) => void deleteSession(id)}
        onRename={async (id, title) => {
          try {
            await renameSession(id, title);
          } catch (err) {
            setNotice(`重命名失败：${err instanceof Error ? err.message : String(err)}`);
          }
        }}
        showNewHint={sessions.length === 0 && !activeId}
        width={sidebarWidth}
        onResizeStart={startSidebarResize}
        activePanel={activePanel}
        onOpenPanel={setActivePanel}
      />

      {/* Canvas 开关钉在窗口右上（WindowControls 左侧），不随主列/Canvas 面板
          宽度变化漂移——对齐 Cindy「折叠 toggle 钉在窗口层，不跟面板跑」；
          面板视图时隐藏（右侧不是会话） */}
      {activeId && !activePanel && (
        <Tooltip label="Canvas 产物画布" side="bottom">
          <button
            type="button"
            onClick={() => setCanvasOpen((v) => !v)}
            className={cn(
              'no-drag fixed top-0 z-40 flex h-[46px] w-10 items-center justify-center hover:bg-hover',
              hasFramelessControls() ? 'right-[138px]' : 'right-0',
              canvasOpen ? 'text-primary' : 'text-muted',
            )}
          >
            <PanelRight size={14} />
          </button>
        </Tooltip>
      )}

      <main className="relative flex min-w-0 flex-1 flex-col">
        <FindBar open={findOpen} onClose={() => setFindOpen(false)} />
        {rewindOpen && activeId && (
          <RewindDialog sessionId={activeId} onClose={() => setRewindOpen(false)} />
        )}
        {/* 面板 ↔ 会话切换整块淡入（不重挂子树，输入草稿保留） */}
        <FadeSwitcher trigger={activePanel ?? 'chat'} className="min-h-0 min-w-0 flex-1">
        {activePanel ? (
          // 能力面板：右侧主区就地显示（相当于会话的部分），侧栏保持可见
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <PanelView id={activePanel} onBack={() => setActivePanel(null)} />
          </div>
        ) : !activeId ? (
          // 空态（对齐 cindy-02 首页解剖）：品牌 wordmark 居中 + 引导卡
          <div className="flex min-h-0 flex-1 flex-col">
            {/* 拖拽条在窗口按钮左侧截止（mr 而非 pr：app-region 按元素矩形算，
                padding 缩不掉；悬浮 no-drag 挖洞在 Electron 37/Windows 上不可靠） */}
            <div className={cn('drag-region h-[46px] shrink-0', hasFramelessControls() && 'mr-[150px]')} />
          {/* 整列撑满可用高度（h-full + 板区 flex-1）：右侧主区永不因内容超高出滚动条 */}
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
            <div className="flex h-full w-full max-w-[720px] flex-col items-stretch gap-2.5 px-6 py-2">
              <div className="flex shrink-0 flex-col items-center gap-1.5 select-none">
                <BrandMark size={40} />
                {/* 品牌 wordmark（图3 同款）：斜体粗体压缩红字 FunDet */}
                <div className="text-[30px] leading-none font-bold italic tracking-tighter text-[#c8102e]">
                  Fun<span className="font-black">Det</span>
                </div>
              </div>
              {providers.length === 0 ? (
                // 无 provider：内联「连接模型提供商」引导面板（cindy-02 的 Connect 面板）
                <div className="shrink-0 rounded-container border border-board bg-card p-6">
                  <p className="text-18 font-medium text-primary select-none">
                    连接模型提供商以开始
                  </p>
                  <p className="mt-1.5 text-13 text-secondary select-none">
                    还没有可用模型。配置一个 OpenAI / Anthropic 兼容端点（BYOK）即可开始对话。
                  </p>
                  <Link
                    to="/settings"
                    className="mt-4 flex items-center gap-3 rounded-inner px-3 py-3 transition-colors hover:bg-menu-item-hover select-none"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-chip text-secondary">
                      <KeyRound size={15} strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-14 font-medium text-primary">添加 Provider</span>
                      <span className="block text-12 text-muted">粘贴 API key 完成连接</span>
                    </span>
                    <ChevronRightIcon size={16} className="shrink-0 text-muted" />
                  </Link>
                  {notice && <p className="mt-2 text-13 text-error">{notice}</p>}
                </div>
              ) : (
                <div className="flex shrink-0 flex-col rounded-container border border-board bg-card px-8 py-3.5 text-center select-none">
                  <p className="text-14 text-secondary">选择文件夹，再开启新对话</p>
                  <div className="mt-2.5 flex flex-col items-center gap-2.5">
                    <FolderPickerChip cwd={workDir} onSelect={applyWorkDir} size="big" />
                    <button
                      type="button"
                      className="h-9 rounded-full bg-accent px-4 text-13 text-accent-fg"
                      onClick={() => void createSession()}
                    >
                      开启新对话
                    </button>
                  </div>
                  {notice && <p className="mt-2 text-13 text-error">{notice}</p>}
                </div>
              )}
              <div className="flex w-full min-h-0 flex-1 flex-col">
                <DwsWidgets snapshot={dwsWidgets} onAskAgent={askDwsAgent} onRefresh={refreshDwsWidgets} expandMode="popover" />
              </div>
            </div>
          </div>
          </div>
        ) : (
          <div
            className="relative flex min-h-0 min-w-0 flex-1"
            onDragEnter={(e) => {
              if (!dataTransferHasFiles(e.dataTransfer)) return;
              e.preventDefault();
              e.stopPropagation();
              dragCountRef.current += 1;
              setDragFolder(dataTransferHasDirectory(e.dataTransfer));
              setDragOver(true);
            }}
            onDragOver={(e) => {
              if (!dataTransferHasFiles(e.dataTransfer)) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dragCountRef.current = Math.max(0, dragCountRef.current - 1);
              if (dragCountRef.current === 0) setDragOver(false);
            }}
            onDrop={(e) => {
              if (!dataTransferHasFiles(e.dataTransfer)) return;
              e.preventDefault();
              e.stopPropagation();
              dragCountRef.current = 0;
              setDragOver(false);
              setDragFolder(false);
              // 文件夹拖入 = 切工作目录（唯一目录优先；混拖文件按工作目录处理）
              const dirPath = firstDroppedDirectoryPath(e.dataTransfer);
              if (dirPath) {
                applyWorkDir(dirPath);
                toast.success(`工作目录已切换：${dirPath.split(/[\\/]/).pop() || dirPath}`);
                return;
              }
              const { files } = filesFromDataTransfer(e.dataTransfer);
              if (files.length > 0) void addDroppedFiles(files);
            }}
          >
            {dragOver && (
              <div
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-none border-2 border-dashed border-[var(--focus-ring)]"
                style={{ backgroundColor: 'color-mix(in srgb, var(--focus-ring) 10%, transparent)' }}
              >
                <div className="rounded-container border border-board bg-card px-4 py-2 text-13 text-primary">
                  {dragFolder ? '松手设为工作目录' : '放到这里，发给助手'}
                </div>
              </div>
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* slim 头部：46px 行高 + 1px Board 下发丝（对齐 Cindy ContentHeader：标题，不是用量环）。
                空消息态按 Cindy 首页风格隐去内容，只留 46px 拖拽区 */}
            <header
              className={cn(
                'relative flex h-[46px] shrink-0 items-center gap-3 px-4 select-none',
                slice.items.length > 0 && 'justify-between border-b border-board',
                slice.items.length === 0 && 'justify-end',
                hasFramelessControls() && 'pr-[186px]',
              )}
            >
              {/* 拖拽层铺底、在窗口按钮左侧截止：悬浮 no-drag 挖洞在 Electron 37
                  /Windows 上对真实鼠标不可靠，干脆不与按钮区重叠 */}
              <div
                aria-hidden
                className={cn(
                  'drag-region absolute inset-y-0 left-0',
                  hasFramelessControls() ? 'right-[150px]' : 'right-0',
                )}
              />
              {slice.items.length > 0 && (
              <div className="no-drag group/title relative flex min-w-0 flex-1 items-center gap-1">
                {renamingHeader ? (
                  <SessionRenameInput
                    value={headerTitleDraft}
                    onChange={setHeaderTitleDraft}
                    onCommit={(raw) => {
                      if (headerRenameCommitted.current) return;
                      headerRenameCommitted.current = true;
                      setRenamingHeader(false);
                      const trimmed = raw.replace(/\s+/g, ' ').trim();
                      if (!activeId || !trimmed || trimmed === (activeMeta?.title ?? '')) return;
                      void renameSession(activeId, trimmed).catch((err) => {
                        setNotice(`重命名失败：${err instanceof Error ? err.message : String(err)}`);
                      });
                    }}
                    onCancel={() => {
                      headerRenameCommitted.current = true;
                      setRenamingHeader(false);
                    }}
                    className="max-w-[min(420px,70%)]"
                  />
                ) : (
                  <>
                    <Tooltip label="双击重命名">
                      <button
                        type="button"
                        className="min-w-0 truncate text-left text-14 font-medium text-primary"
                        onDoubleClick={() => {
                          headerRenameCommitted.current = false;
                          setHeaderTitleDraft(activeMeta?.title || '会话');
                          setRenamingHeader(true);
                        }}
                      >
                        {activeMeta?.title || '会话'}
                      </button>
                    </Tooltip>
                    <Tooltip label="重命名">
                      <button
                        type="button"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted opacity-0 hover:bg-hover hover:text-primary group-hover/title:opacity-100 focus-visible:opacity-100"
                        onClick={() => {
                          headerRenameCommitted.current = false;
                          setHeaderTitleDraft(activeMeta?.title || '会话');
                          setRenamingHeader(true);
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                    </Tooltip>
                    {activeMeta?.workDir ? (
                      <span className="ml-1 min-w-0 truncate font-normal text-12 text-muted" title={activeMeta.workDir}>
                        {activeMeta.workDir.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/')}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
              )}
              {/* 灵动岛：驻进会话头部尾部（与标题同层，不再是悬浮异物） */}
              <DynamicIsland snapshot={dwsWidgets} onAskAgent={askDwsAgent} onRefresh={refreshDwsWidgets} />
            </header>

            {/* 会话切换时消息区淡入（composer 不包——草稿/焦点跨会话保留）。
                空消息态不挂 MessageStream（Cindy 首页布局接管，见 composer 段） */}
            {slice.items.length > 0 && (
            <FadeSwitcher trigger={activeId ?? 'none'} className="min-h-0 flex-1">
            <MessageStream
              slice={slice}
              workDir={activeMeta?.workDir || workDir}
              onOpenFile={openCanvas}
              canFork={Boolean(activeId) && !isDraftSession(activeId)}
              onFork={async (createdAt) => {
                if (!activeId) return;
                try {
                  const id = await forkSessionAt(activeId, createdAt);
                  setActiveId(id);
                } catch (err) {
                  setNotice(`分叉失败：${err instanceof Error ? err.message : String(err)}`);
                }
              }}
              onAddToChat={(text) => {
                const quote = text
                  .trim()
                  .split('\n')
                  .map((line) => `> ${line}`)
                  .join('\n');
                setInput((prev) => {
                  const p = prev.trimEnd();
                  return p ? `${p}\n\n${quote}\n\n` : `${quote}\n\n`;
                });
                requestAnimationFrame(() => {
                  document.querySelector<HTMLTextAreaElement>('main textarea')?.focus();
                });
              }}
              onDelete={async (assistantId) => {
                if (!activeId) return;
                const ok = await confirmDialog({
                  title: '删除这条回复？',
                  description: '其工作过程（思考与工具调用）将一并删除，此操作不可撤销。',
                  confirmText: '删除',
                  danger: true,
                });
                if (!ok) return;
                try {
                  await deleteAssistantTurn(activeId, assistantId);
                } catch (err) {
                  setNotice(`删除失败：${err instanceof Error ? err.message : String(err)}`);
                }
              }}
              onRetryError={resendLast}
              onEditStart={handleEditStart}
              onEditSubmit={submitUserEdit}
              onDeleteUserMessage={(createdAt) => void deleteUserMessage(createdAt)}
              onRewind={
                activeId && !isDraftSession(activeId) && slice.items.length > 0
                  ? () => setRewindOpen(true)
                  : undefined
              }
            />
            </FadeSwitcher>
            )}

            {/* composer：审批悬挂时换成 PermissionPrompt；运行状态行在输入卡上方。
                空消息态（Cindy 首页）：整个块垂直居中，lockup 上置、输入框、建议卡 */}
            <div
              className={cn(
                'flex flex-col px-6',
                slice.items.length === 0 ? 'min-h-0 flex-1 items-center justify-center pb-4 pt-[10vh]' : 'pt-1 pb-4',
              )}
            >
              <div className={cn('mx-auto flex w-full flex-col', slice.items.length === 0 ? 'max-w-[790px]' : 'max-w-[820px]')}>
                {slice.items.length === 0 && (
                  <div className="mb-3.5 flex items-center gap-3 self-start select-none">
                    <BrandMark size={44} />
                    {/* 品牌 wordmark（图3）：斜体粗体压缩红字 FunDet */}
                    <span className="text-44 leading-none font-bold italic tracking-tighter text-[#c8102e]">
                      Fun<span className="font-black">Det</span>
                    </span>
                  </div>
                )}
                {notice && <div className="pb-1 text-12 text-error">{notice}</div>}
                {pendingPermission ? (
                  <PermissionPrompt
                    request={pendingPermission}
                    onRespond={(behavior) =>
                      void resolvePermission(activeId, pendingPermission, behavior)
                    }
                  />
                ) : (
                  <>
                    {queuedTexts.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {queuedTexts.map((t, i) => (
                          <span
                            key={`${i}-${t.slice(0, 8)}`}
                            className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-board bg-card py-1 pl-2.5 pr-1.5 text-12 text-secondary"
                            title={t.slice(0, 200)}
                          >
                            <Clock size={12} className="shrink-0 text-muted" aria-hidden />
                            <span className="min-w-0 max-w-[280px] truncate">
                              排队 {i + 1}：{t.replace(/\s+/g, ' ').slice(0, 30) || '（空）'}
                            </span>
                            <button
                              type="button"
                              title="移除"
                              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-hover hover:text-primary"
                              onClick={() => setQueuedTexts((q) => q.filter((_, j) => j !== i))}
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <RunningStatus
                      visible={slice.isRunning}
                      status={slice.statusText}
                      tokenUsage={slice.usage.tokenUsage}
                    />
                    <ChatInput
                      value={input}
                      onChange={setInput}
                      onSend={() => void send()}
                      onAbort={() => void abort()}
                      isRunning={slice.isRunning}
                      tall={slice.items.length === 0}
                      sendDisabled={noModel}
                      slashItems={slashItems}
                      placeholder={noModel ? '先在设置页添加 Provider，再开始对话…' : '输入消息；@ 引用文件，或拖入文件…'}
                      attachments={attachments}
                      onRemoveAttachment={(p) =>
                        setAttachments((prev) => prev.filter((a) => a.path !== p))
                      }
                      onAddFiles={(files) => void addDroppedFiles(files)}
                      onPickFiles={() => void pickFiles()}
                      dragOver={dragOver}
                      pastedTexts={pastedTexts}
                      onPasteLongText={pasteLongText}
                      onRemovePastedText={removePastedText}
                      workDir={sessionWorkDir}
                      onStagePaths={(paths) => void stagePaths(paths)}
                      onQueue={queueText}
                      leadingControls={
                        <>
                          <KnowledgeChip sessionId={activeId} />
                          <PermissionSelector
                            current={permissionMode}
                            onSelect={(m) => void selectPermission(m)}
                          />
                          {(modelSpec?.reasoning || modelSpec?.thinkingLevelMap) && (
                            <EffortSelector
                              current={activeMeta?.effort ?? null}
                              thinkingLevelMap={modelSpec?.thinkingLevelMap}
                              onSelect={(effort) => {
                                if (!activeId) return;
                                void setSessionEffortLevel(activeId, effort);
                              }}
                            />
                          )}
                        </>
                      }
                      trailingControls={
                        <ModelSelector
                          providers={providers}
                          currentModel={activeMeta?.model ?? ''}
                          onSelect={(pid, mid) => void selectModel(pid, mid)}
                        />
                      }
                    />
                  </>
                )}
                {/* Cindy：路径按钮在输入卡下方左侧（「WX」位），用量环 + 费用在右侧 */}
                <div className="mt-1.5 flex w-full items-center justify-between gap-3 px-1">
                  <FolderPickerChip cwd={activeMeta?.workDir || workDir} onSelect={applyWorkDir} />
                  <div className="flex items-center justify-end gap-3">
                  {slice.usage.costUsd > 0 && (
                    <span className="text-12 tabular-nums text-muted">
                      ${slice.usage.costUsd.toFixed(4)}
                    </span>
                  )}
                  <ContextCapacityRing
                    contextTokens={slice.usage.contextTokens}
                    contextWindow={shownWindow}
                  />
                  </div>
                </div>
                {/* Cindy 首页建议卡：空消息时展示，点击预填 prompt 由用户发送 */}
                {slice.items.length === 0 && (
                  <div className="mt-5 w-full px-1">
                    <WelcomeSuggestions onPick={setInput} />
                  </div>
                )}
              </div>
            </div>
            </div>
            {canvasOpen && (
              <CanvasPane
                workDir={activeMeta?.workDir || workDir}
                artifacts={artifacts}
                activePath={canvasPath}
                onSelect={setCanvasPath}
                onClose={() => setCanvasOpen(false)}
              />
            )}
          </div>
        )}
        </FadeSwitcher>
      </main>
    </div>
  );
}
