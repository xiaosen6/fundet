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
import { ChevronRight as ChevronRightIcon, KeyRound, PanelRight, Pencil } from 'lucide-react';
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
  refreshSessionList,
  renameSession,
  resolvePermission,
  sendMessage,
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
import { SessionRenameInput } from '../components/SessionRenameInput';
import { MessageStream } from '../components/MessageStream';
import { PermissionPrompt } from '../components/PermissionPrompt';
import { RunningStatus } from '../components/RunningStatus';
import { ModelSelector, PermissionSelector } from '../components/SelectorChips';
import { UsageDashboard } from '../components/UsageDashboard';
import { brand } from '../../../shared/brand.js';
import { FolderPickerChip } from '../components/FolderPickerChip';
import { Sidebar } from '../components/Sidebar';
import { BrandMark } from '../components/BrandMark';
import { addRecentFolder } from '../lib/recentFolders';
import { collectArtifacts, type Artifact } from '../lib/artifacts';
import { fileKind } from '../../../shared/file-kind.ts';
import { dataTransferHasFiles, filesFromDataTransfer } from '../lib/file-drop';
import { CanvasPane } from '../components/CanvasPane';
import { ContextCapacityRing } from '../components/ContextCapacityRing';
import { hasFramelessControls } from '../components/WindowControls';
import { preferScannedContextWindow } from '../../../shared/context-window.js';
import { cn } from '../lib/cn';

export function ChatPage(): React.JSX.Element {
  const sessions = useSessionList();
  const runningIds = useRunningIds();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState('');

  // 侧栏宽度拖拽（200–400px 夹紧；持久化到 localStorage）
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('longma.sidebar-width'));
    return saved >= 200 && saved <= 400 ? saved : 260;
  });
  const startSidebarResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const move = (ev: PointerEvent): void => {
      const next = Math.min(400, Math.max(200, startW + ev.clientX - startX));
      setSidebarWidth(next);
      localStorage.setItem('longma.sidebar-width', String(next));
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
  const [renamingHeader, setRenamingHeader] = useState(false);
  const [headerTitleDraft, setHeaderTitleDraft] = useState('');
  const headerRenameCommitted = useRef(false);
  const dragCountRef = useRef(0);

  const slice = useSessionSlice(activeId);

  useEffect(() => {
    setRenamingHeader(false);
    headerRenameCommitted.current = false;
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
  const shownWindow = activeMeta?.model
    ? preferScannedContextWindow(activeMeta.model, modelSpec?.contextWindow) ?? 0
    : 0;

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
      }
    },
    [activeId],
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
  }, [providers, workDir]);

  const deleteSession = useCallback(
    async (id: string): Promise<void> => {
      // 草稿在 main/DB 里不存在，纯本地移除即可
      if (isDraftSession(id)) {
        deleteDraftSession(id);
        if (activeId === id) setActiveId(null);
        return;
      }
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

  // 终态错误卡的「重新发送」：重发本轮最后一条用户消息（含附件路径引用）
  const resendLast = useCallback((): void => {
    if (!activeId) return;
    const lastUser = [...slice.items].reverse().find((it) => it.kind === 'user');
    if (!lastUser || lastUser.kind !== 'user') return;
    void (async () => {
      try {
        await window.fundet.sendMessage({
          sessionId: activeId,
          text: lastUser.text,
          ...(lastUser.attachments && lastUser.attachments.length > 0
            ? { attachments: lastUser.attachments }
            : {}),
        });
      } catch (err) {
        setNotice(`重新发送失败：${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, [activeId, slice.items]);

  const pickFiles = useCallback(async (): Promise<void> => {
    const picked = await window.fundet.pickFiles();
    if (picked && picked.length > 0) await stagePaths(picked);
  }, [stagePaths]);

  const send = useCallback(async (): Promise<void> => {
    const text = input.trim();
    if (!activeId || (!text && attachments.length === 0)) return;
    const pending = attachments;
    setInput('');
    setAttachments([]);
    setNotice('');
    // 重启后旧会话 / 本地草稿都不在 main 内存：带 create 让 main lazy-create。
    // 草稿有精确的 providerId；历史会话按 model 在 providers 里反查。
    let create: Parameters<typeof sendMessage>[2];
    if (activeMeta) {
      const draftProviderId = getDraftProviderId(activeId);
      const provider = draftProviderId
        ? providers.find((p) => p.id === draftProviderId)
        : providers.find((p) => p.models.some((m) => m.id === activeMeta.model));
      if (provider) {
        create = {
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
      }
    }
    await sendMessage(activeId, text, create, pending.length > 0 ? pending : undefined);
  }, [activeId, activeMeta, attachments, input, providers]);

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
        onSelect={setActiveId}
        onCreate={() => void createSession()}
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
      />

      {/* Canvas 开关钉在窗口右上（WindowControls 左侧），不随主列/Canvas 面板
          宽度变化漂移——对齐 Cindy「折叠 toggle 钉在窗口层，不跟面板跑」 */}
      {activeId && (
        <button
          type="button"
          title="Canvas"
          onClick={() => setCanvasOpen((v) => !v)}
          className={cn(
            'no-drag fixed top-0 z-40 flex h-[46px] w-10 items-center justify-center hover:bg-hover',
            hasFramelessControls() ? 'right-[138px]' : 'right-0',
            canvasOpen ? 'text-primary' : 'text-muted',
          )}
        >
          <PanelRight size={14} />
        </button>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {!activeId ? (
          // 空态（对齐 cindy-02 首页解剖）：品牌 wordmark 居中 + 引导卡
          <div className="flex flex-1 flex-col">
            {/* 拖拽条在窗口按钮左侧截止（mr 而非 pr：app-region 按元素矩形算，
                padding 缩不掉；悬浮 no-drag 挖洞在 Electron 37/Windows 上不可靠） */}
            <div className={cn('drag-region h-[46px] shrink-0', hasFramelessControls() && 'mr-[150px]')} />
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
            <div className="flex w-full max-w-[720px] flex-col items-stretch gap-8 px-6">
              <div className="flex flex-col items-center gap-3 select-none">
                <BrandMark size={56} />
                <div className="text-[40px] leading-none font-medium tracking-tight text-primary">
                  {brand.name}
                </div>
              </div>
              {providers.length === 0 ? (
                // 无 provider：内联「连接模型提供商」引导面板（cindy-02 的 Connect 面板）
                <div className="rounded-container border border-board bg-card p-6">
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
                <div className="rounded-container border border-board bg-card px-8 py-8 text-center select-none">
                  <p className="text-14 text-secondary">选择文件夹，再开启新对话</p>
                  <div className="mt-4 flex flex-col items-center gap-3">
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
              <div className="w-full">
                <UsageDashboard />
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
              const { files, skippedDirectory } = filesFromDataTransfer(e.dataTransfer);
              if (skippedDirectory) setNotice('暂不支持拖入文件夹，请拖文件或改工作目录');
              if (files.length > 0) void addDroppedFiles(files);
            }}
          >
            {dragOver && (
              <div
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-none border-2 border-dashed border-[var(--focus-ring)]"
                style={{ backgroundColor: 'color-mix(in srgb, var(--focus-ring) 10%, transparent)' }}
              >
                <div className="rounded-container border border-board bg-card px-4 py-2 text-13 text-primary">
                  放到这里，发给助手
                </div>
              </div>
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* slim 头部：46px 行高 + 1px Board 下发丝（对齐 Cindy ContentHeader：标题，不是用量环） */}
            <header
              className={cn(
                'relative flex h-[46px] shrink-0 items-center justify-between gap-3 border-b border-board px-4 select-none',
                hasFramelessControls() && 'pr-[150px]',
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
                    <button
                      type="button"
                      className="min-w-0 truncate text-left text-14 font-medium text-primary"
                      title="双击重命名"
                      onDoubleClick={() => {
                        headerRenameCommitted.current = false;
                        setHeaderTitleDraft(activeMeta?.title || '会话');
                        setRenamingHeader(true);
                      }}
                    >
                      {activeMeta?.title || '会话'}
                    </button>
                    <button
                      type="button"
                      title="重命名"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted opacity-0 hover:bg-hover hover:text-primary group-hover/title:opacity-100 focus-visible:opacity-100"
                      onClick={() => {
                        headerRenameCommitted.current = false;
                        setHeaderTitleDraft(activeMeta?.title || '会话');
                        setRenamingHeader(true);
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                    {activeMeta?.workDir ? (
                      <span className="ml-1 min-w-0 truncate font-normal text-12 text-muted" title={activeMeta.workDir}>
                        {activeMeta.workDir.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/')}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            </header>

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
                if (!window.confirm('删除这条回复及其工作过程？此操作不可撤销。')) return;
                try {
                  await deleteAssistantTurn(activeId, assistantId);
                } catch (err) {
                  setNotice(`删除失败：${err instanceof Error ? err.message : String(err)}`);
                }
              }}
              onRetryError={resendLast}
            />

            {/* composer：审批悬挂时换成 PermissionPrompt；运行状态行在输入卡上方 */}
            <div className="px-6 pt-1 pb-4">
              <div className="mx-auto flex max-w-[820px] flex-col">
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
                      sendDisabled={noModel}
                      slashItems={slashItems}
                      placeholder={noModel ? '先在设置页添加 Provider，再开始对话…' : '输入消息，或拖入文件…'}
                      attachments={attachments}
                      onRemoveAttachment={(p) =>
                        setAttachments((prev) => prev.filter((a) => a.path !== p))
                      }
                      onAddFiles={(files) => void addDroppedFiles(files)}
                      onPickFiles={() => void pickFiles()}
                      dragOver={dragOver}
                      leadingControls={
                        <>
                          <FolderPickerChip
                            cwd={activeMeta?.workDir || workDir}
                            onSelect={applyWorkDir}
                          />
                          <PermissionSelector
                            current={permissionMode}
                            onSelect={(m) => void selectPermission(m)}
                          />
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
                {/* Cindy：用量环在输入卡下方右侧，不在顶栏 */}
                <div className="mt-1.5 flex w-full items-center justify-end gap-3 px-1">
                  {slice.usage.costUsd > 0 && (
                    <span className="text-12 tabular-nums text-muted">
                      ${slice.usage.costUsd.toFixed(4)}
                    </span>
                  )}
                  {activeId && !activeId.startsWith('draft-') && (
                    <span
                      className="font-mono text-10 text-muted select-text"
                      title={'会话 ID：' + activeId}
                    >
                      {activeId.slice(0, 8)}
                    </span>
                  )}
                  <ContextCapacityRing
                    contextTokens={slice.usage.contextTokens}
                    contextWindow={shownWindow}
                  />
                </div>
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
      </main>
    </div>
  );
}
