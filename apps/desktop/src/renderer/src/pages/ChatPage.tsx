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
import { ChevronRight as ChevronRightIcon, Clock, ExternalLink, FileDown, KeyRound, PanelRight, Pencil, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Effort, PermissionMode } from '@fundet/agent-core';
import type { ProviderView, SessionAttachment, SessionOutboxItem, SkillView } from '../../../shared/fundet-api.ts';
import type { SlashItem } from '../components/SlashPalette';
import {
  abortSession,
  appendTurnArtifacts,
  deleteAssistantTurn,
  deleteDraftSession,
  ensureDraftSession,
  ensureHistory,
  forkSessionAt,
  getComposerDraft,
  getDraftProviderId,
  getDraftSession,
  isDraftSession,
  markSessionSeen,
  setActiveSessionId,
  setComposerDraft,
  useActiveSessionId,
  useComposerDraft,
  refreshSessionList,
  patchSessionInList,
  removeSessionFromList,
  removeOutboxItem,
  renameSession,
  resendTurn,
  retryOutboxItem,
  resolveAskUser,
  setSessionEffortLevel,
  resolvePermission,
  sendMessage,
  truncateItemsFrom,
  updateDraftSession,
  useRunningIds,
  useSessionList,
  useSessionOutbox,
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
import { PinnedPlanCard } from '../components/chat/PinnedPlanCard';
import { isTodoToolItem } from '../components/WorkGroupBlock';
import { latestTodoSnapshot } from '../lib/todoList';
import { generatedFileOpenAction } from '../lib/generatedFiles';
import { AskUserQuestionPrompt } from '../components/AskUserQuestionPrompt';
import { WelcomeSuggestions } from '../components/WelcomeSuggestions';
import { SessionRenameInput } from '../components/SessionRenameInput';
import { MessageStream } from '../components/MessageStream';
import { PermissionPrompt } from '../components/PermissionPrompt';
import { RunningStatus } from '../components/RunningStatus';
import { TurnChangesBar, type TurnChangeEntry } from '../components/TurnChangesBar';
import { PlanCard } from '../components/PlanCard';
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
import { formatTokenCount, preferScannedContextWindow } from '../../../shared/context-window.js';
import { FadeSwitcher } from '../components/ui/FadeSwitcher';
import { PanelView, type SidebarPanelId } from '../components/sidebar/SidebarPanelDrawer';
import { cn } from '../lib/cn';

/** 产物去重键：Windows 路径分隔符/大小写归一（write 工具、附件与扫描可能给同一路径的不同写法） */
/** 轮末扫描产物（per-session 累积）：模块级 Map，背景会话完成的 push 也不丢 */
const turnArtifactPathsStore = new Map<string, string[]>();

/** 已落库会话改工作目录的拒答文案（工作目录进预热指纹、绑 pi 会话与记忆仓） */
const WORKDIR_LOCKED_HINT =
  '工作目录在新建会话时确定，已开始的会话不能改。新对话会直接使用这个目录。';

/** 历史加载骨架：宽度按「用户气泡右对齐 + 若干助手段落」排，别做成整齐的方块阵 */
const HISTORY_SKELETON_ROWS: readonly string[] = [
  'w-1/3',
  'w-11/12',
  'w-4/5',
  'w-2/3',
];

function artifactKey(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase();
}

export function ChatPage(): React.JSX.Element {
  const sessions = useSessionList();
  const runningIds = useRunningIds();
  // activeId / composer 草稿放 store 模块级：路由切到设置页会卸载 ChatPage，
  // 放组件 state 里等于「去趟设置就把正在聊的会话和没发出去的半句话丢掉」
  const activeId = useActiveSessionId();
  const setActiveId = setActiveSessionId;
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [skills, setSkills] = useState<SkillView[]>([]);
  const input = useComposerDraft(activeId);
  const setInput = useCallback(
    (next: string | ((prev: string) => string)): void => {
      const prev = getComposerDraft(activeId);
      setComposerDraft(activeId, typeof next === 'function' ? next(prev) : next);
    },
    [activeId],
  );
  const [notice, setNotice] = useState('');
  const [dwsWidgets, setDwsWidgets] = useState<DwsWidgetsSnapshot | null>(null);
  const [dwsEnabled, setDwsEnabled] = useState(true);
  const [turnChanges, setTurnChanges] = useState<{ sessionId: string; files: TurnChangeEntry[]; baseSha: string | null } | null>(null);
  // 轮末产物扫描：脚本生成的文件路径（跨轮累积，activeId 切换清空）
  const [turnArtifactPathsTick, setTurnArtifactPathsTick] = useState(0);
  // 计划卡：plan 档会话轮末/切换时拉取的最新 Plan Steps（undefined=尚无数据不显示）
  const [planContent, setPlanContent] = useState<string | undefined>(undefined);

  // 钉钉总开关（设置→钉钉）：关=隐藏工作台/灵动岛（新对话不注入 dws 速查表在主进程门控）
  useEffect(() => {
    void window.fundet.dwsStatus().then((s) => setDwsEnabled(s.enabled)).catch(() => undefined);
    const off = window.fundet.onDwsEnabledChanged(setDwsEnabled);
    return off;
  }, []);

  // 计划卡数据：切换会话清空；plan 档会话轮次结束（isRunning 落 false）时拉取
  useEffect(() => {
    setPlanContent(undefined);
  }, [activeId]);

  // 轮末改动（对齐 Cindy TurnChangesCard）：只显示当前会话最新一轮；切会话清空。
  // baseSha=轮前快照（卡片「撤销」的回滚目标）
  useEffect(() => {
    setTurnChanges(null);
    const off = window.fundet.onTurnChanges((p) => {
      if (p.sessionId === activeId) setTurnChanges({ sessionId: p.sessionId, files: p.files, baseSha: p.baseSha ?? null });
    });
    return off;
  }, [activeId]);

  // 轮末产物扫描：主进程 turn:artifacts push 补充进 Canvas 产物列表 + 轮末
  // 产出卡（live 追加条目；未展开的会话跳过，切进时由落库行重建）。
  // 累积在模块级 Map（per-session），背景会话完成的 push 也不丢（review P1-2：
  // 此前按 activeId 过滤直接丢弃，切回后产物永远消失）。
  useEffect(() => {
    const off = window.fundet.onTurnArtifacts((p) => {
      appendTurnArtifacts(p.sessionId, p.paths);
      const cur = turnArtifactPathsStore.get(p.sessionId) ?? [];
      const seen = new Set(cur);
      let added = false;
      const merged = [...cur];
      for (const filePath of p.paths) {
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        merged.push(filePath);
        added = true;
      }
      if (added) {
        turnArtifactPathsStore.set(p.sessionId, merged);
        setTurnArtifactPathsTick((n) => n + 1);
      }
    });
    return off;
  }, []);
  // 当前会话的扫描产物（切会话自动切换到对应集合）
  const turnArtifactPaths = activeId ? (turnArtifactPathsStore.get(activeId) ?? []) : [];

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
  // 历史在途 = 切进会话后、DB 历史回来之前。此窗口 items 必为空，不能当「真空
  // 会话」渲染首页（品牌 lockup + 建议卡），否则切到有历史的会话会先闪一屏
  // 新对话页再整块换掉。草稿是纯内存的，永远不算在途。
  const historyLoading = activeId !== null && !isDraftSession(activeId) && slice.historyLoading;
  /** 主区按「有内容」排版（头部标题、正常 composer 位、隐藏首页 lockup）。
   *  加载中也算有内容——否则会在加载窗口里闪一屏首页再跳回来。 */
  const hasContent = slice.items.length > 0 || historyLoading;
  /** 当前会话工作目录已钉死（已落库）——路径 chip / 拖拽文案据此如实表述 */
  const workDirLocked = activeId !== null && !isDraftSession(activeId);
  // durable outbox 队列快照（排队/自动重试/失败重试都在主进程，渲染层只展示）
  const outboxItems = useSessionOutbox(activeId);
  // 只把「需要用户注意」的条目挂成 chip：发送中已有乐观气泡 + Working… 状态行，
  // 再挂一条「发送中：你好」是重复噪声（2026-10-20 用户点名去掉）。排队/自动
  // 重试/失败/结果未知仍需可见——那是用户唯一能看到队列状态的地方。
  const outboxNotices = outboxItems.filter((item) => item.state !== 'sending');

  const outboxStateLabel = (item: SessionOutboxItem): string => {
    switch (item.state) {
      case 'sending': return '发送中';
      case 'failed': return `发送失败${item.lastError ? `（${item.lastError.slice(0, 40)}）` : ''}`;
      case 'outcome_unknown': return '结果未知（可能已执行，重试需谨慎）';
      case 'queued':
        if (item.nextAttemptAt != null) {
          const remain = Math.max(0, Math.round((item.nextAttemptAt - Date.now()) / 1000));
          return `自动重试（${remain} 秒后，第 ${item.autoRetryCount}/3 次）`;
        }
        return `排队 ${item.seq}`;
      default: return item.state;
    }
  };

  const handleOutboxRetry = async (item: SessionOutboxItem): Promise<void> => {
    if (!activeId) return;
    if (item.state === 'outcome_unknown') {
      const ok = await confirmDialog({
        title: '重试这条发送？',
        description: '应用退出时这条消息可能已经发出。重试有概率重复执行同一任务（如重复写文件/重复下单类操作）。确认继续？',
        confirmText: '仍然重试',
        danger: true,
      });
      if (!ok) return;
    }
    await retryOutboxItem(activeId, item.id);
  };

  // Ctrl+F 页内搜索（仅会话页生效；FindBar 内部处理 Esc/清高亮）
  const [findOpen, setFindOpen] = useState(false);
  // 主区面板（IM/技能/MCP/知识库）：右侧就地显示，替代会话视图；侧栏保持可见
  const [activePanel, setActivePanel] = useState<SidebarPanelId | null>(null);
  // 编辑上一条用户消息：记录原消息时间戳，发送时截断其后重发（Cindy 同款 Pen）
  // 粘贴长文本 chip：发送时按序展开为原文追加
  const [pastedTexts, setPastedTexts] = useState<Array<{ id: number; text: string; lines: number }>>([]);
  const [rewindOpen, setRewindOpen] = useState(false);
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
    const seen = new Set<string>();
    for (const a of fromItems) seen.add(artifactKey(a.path));
    const extra: Artifact[] = [];
    const add = (path: string, toolName: string): void => {
      const k = artifactKey(path);
      if (seen.has(k)) return;
      seen.add(k);
      extra.push({ path, kind: fileKind(path), toolName });
    };
    for (const a of attachments) add(a.path, 'attach');
    // 轮末扫描产物（脚本生成）最后并入：与 write/edit 工具面/附件按归一路径去重
    for (const p of turnArtifactPaths) add(p, 'script');
    return extra.length > 0 ? [...fromItems, ...extra] : fromItems;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.items, attachments, turnArtifactPaths, turnArtifactPathsTick, activeId]);
  // 助手正文路径 chip 的已知产物全集（stable 引用，AssistantMessage memo 依赖）
  const artifactPathList = useMemo(() => artifacts.map((a) => a.path), [artifacts]);
  const modelSpec = useMemo(() => {
    const id = activeMeta?.model;
    if (!id) return undefined;
    for (const p of providers) {
      const found = p.models.find((m) => m.id === id);
      if (found) return found;
    }
    return undefined;
  }, [providers, activeMeta?.model]);

  // 计划卡拉取：plan 档会话轮次结束（isRunning 落 false）时取最新 Plan Steps
  useEffect(() => {
    if (slice.isRunning || !activeId) return;
    if ((activeMeta?.permissionMode ?? 'ask') !== 'plan') return;
    let alive = true;
    void window.fundet
      .getSessionPlan(activeId)
      .then((p) => {
        if (alive) setPlanContent(p ?? undefined);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [slice.isRunning, activeId, activeMeta?.permissionMode]);

  useEffect(() => {
    setCanvasOpen(false);
    setCanvasPath(null);
    setAttachments([]);
    // 桌宠截图问答：强制新建会话并携带截图——截图在会话切换清空后自动恢复
    if (pendingShotRef.current) {
      setAttachments([pendingShotRef.current]);
      pendingShotRef.current = null;
    }
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

  // 消息流内点击文件（正文路径 chip / 工具卡 / 产出卡回流的 canvas 类）统一路由：
  // 文档类（pdf/docx/pptx/xlsx 等）直接系统默认应用打开——走 Canvas 只会出
  // 「无法预览」占位还多一步；其余（文本/图/网页/音视频）开 Canvas 侧栏。
  // 与产出卡 generatedFileOpenAction 同一判定，不另立口径。
  const openArtifact = useCallback(
    (p: string) => {
      if (generatedFileOpenAction(p) === 'system') {
        void window.fundet.openPath(p, activeMeta?.workDir || workDir || undefined).catch((err: unknown) => {
          toast.error(`打开文件失败：${err instanceof Error ? err.message : String(err)}`);
        });
        return;
      }
      openCanvas(p);
    },
    [openCanvas, activeMeta?.workDir, workDir],
  );

  // providers 就绪门控：启动后 listProviders 异步返回前的窗口期里，桌宠等
  // 入口触发 createSession 会误报「请先配置 provider」（2026-09-29 用户实报）
  const providersReadyRef = useRef(false);
  const providersWaitersRef = useRef<Array<() => void>>([]);
  const whenProvidersReady = useCallback((): Promise<void> => {
    if (providersReadyRef.current) return Promise.resolve();
    // 8s 兜底：加载失败也放行，让 createSession 给出准确提示
    return new Promise((resolve) => {
      providersWaitersRef.current.push(resolve);
      window.setTimeout(resolve, 8000);
    });
  }, []);

  useEffect(() => {
    void window.fundet.listProviders().then((p) => {
      setProviders(p);
      providersReadyRef.current = true;
      providersWaitersRef.current.splice(0).forEach((w) => w());
    });
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

  // ---------- 桌宠联动（截图注入 + 新对话） ----------
  const workDirRef = useRef(workDir);
  workDirRef.current = workDir;
  const pendingShotRef = useRef<SessionAttachment | null>(null);
  // 下方 pet 订阅 effect deps=[]，回调用 ref 取最新 createSession——直接捕获会把
  // 首渲染的空 providers 闭包进去（桌宠左键/截图的强制新建会话会静默失效）
  const createSessionRef = useRef<() => string | null>(() => null);
  useEffect(() => {
    const unSubShot = window.fundet?.onPetScreenshot?.(async (payload) => {
      if (payload?.base64) {
        // 截图问答 = 强制新建会话并携带截图（pendingRef 保证穿过会话切换清空）
        await whenProvidersReady(); // 启动竞态门控：providers 未载完先等（8s 兜底）
        createSessionRef.current();
        // base64 → ArrayBuffer → stageBytes 走现有附件管线
        const bin = atob(payload.base64);
        const buf = new ArrayBuffer(bin.length);
        const view = new Uint8Array(buf);
        for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
        const name = `截图_${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.png`;
        void window.fundet
          .stageBytes(workDirRef.current, name, buf)
          .then((att) => {
            pendingShotRef.current = att;
            setAttachments([att]);
            toast.success('截图已附上，请输入你的问题');
          })
          .catch((err: unknown) => {
            toast.error(err instanceof Error ? err.message : '截图附加失败');
          });
      }
    });
    const unSubChat = window.fundet?.onPetNewChat?.(() => {
      void whenProvidersReady().then(() => createSessionRef.current());
    });
    return () => {
      unSubShot?.();
      unSubChat?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 完成提醒：点击系统通知 → 切到对应会话（主进程已聚焦主窗；顺手清关注态）
  useEffect(() => {
    return window.fundet?.onNotifyOpenSession?.(({ sessionId }) => {
      if (!sessionId) return;
      markSessionSeen(sessionId);
      setActiveId(sessionId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 会话动作 ----------

  // 新建会话只建本地草稿（不调 session:create、不 spawn pi）；
  // 首条消息 send 时由 main 侧 lazy-create 落 DB + 起进程。
  /** 切工作目录。返回 false = 当前会话已落库、目录在建会话时就钉死了（工作目录
   *  进预热指纹、绑 pi 会话与记忆仓），本次只更新「新建会话的默认目录」——
   *  调用方必须如实告知，不能再弹「工作目录已切换」。
   *  旧实现无论当前是不是草稿都弹成功提示，而 sessionWorkDir 仍取 activeMeta，
   *  于是出现「提示说切了、路径 chip 没变、附件仍 stage 到旧目录」的假成功。 */
  const applyWorkDir = useCallback(
    (picked: string): boolean => {
      addRecentFolder(picked);
      setDefaultWorkDir(picked);
      setWorkDir(picked);
      if (activeId && !isDraftSession(activeId)) return false;
      if (activeId) {
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
      return true;
    },
    [activeId, providers],
  );

  const createSession = useCallback((): string | null => {
    setNotice('');
    const dir = workDir.trim() || getDefaultWorkDir();
    if (!dir) {
      setNotice('请先选择工作目录');
      return null;
    }
    const provider =
      providers.find((p) => p.id === getLastProviderId()) ?? providers[0];
    const model =
      provider?.models.find((m) => m.id === getLastModel())?.id ?? provider?.models[0]?.id;
    if (!provider || !model) {
      setNotice('请先在设置页配置 provider 和模型');
      return null;
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
    return meta.id;
  }, [providers, workDir]);
  createSessionRef.current = createSession;

  /** 钉钉组件 AI 钩子：开新会话并预填 prompt（用户过目后手动发送）。
   *  草稿按会话分桶，必须写到**新会话**的桶里——闭包里的 activeId 还是旧的。 */
  const askDwsAgent = useCallback(
    (prompt: string): void => {
      const id = createSession();
      if (id) setComposerDraft(id, prompt);
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
      // 乐观删除：列表立即移除；主进程杀 pi/删快照仓均已后台异步，
      // invoke 仅删 DB（毫秒级）——不再等它返回后刷新（删除卡顿渲染层半边）
      removeSessionFromList(id);
      if (activeId === id) setActiveId(null);
      void window.fundet.deleteSession(id).catch(() => undefined);
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

  // 右上角常驻计划卡：todo 增量确认重放出的最新清单快照（进行中的 todo
  // 没有结果，传空串参与重放=状态沿用）
  const planEntries = useMemo(() => {
    const texts = slice.items
      .filter((it): it is Extract<typeof it, { kind: 'tool' }> => it.kind === 'tool' && isTodoToolItem(it))
      .map((it) => (it.done ? (it.resultText ?? '') : ''));
    return latestTodoSnapshot(texts) ?? [];
  }, [slice.items]);

  // 上下文圆环点击 → 确认 → 手动压缩（对齐 Cindy：pi 原生 compact）。运行中
  // 静默放弃（pi 会拒绝活跃 turn 的压缩）；null=无 live 会话给信息提示。
  const handleCompactContext = useCallback(async () => {
    if (!activeId || slice.isRunning) return;
    const used = Math.min(slice.usage.contextTokens, shownWindow || Infinity);
    const pct = shownWindow > 0 ? Math.round((used / shownWindow) * 100) : 0;
    const ok = await confirmDialog({
      title: '压缩上下文？',
      description:
        shownWindow > 0
          ? `当前上下文 ${formatTokenCount(used)} / ${formatTokenCount(shownWindow)}（${pct}%）。压缩会把历史对话总结为摘要后继续，让上下文重新变空。`
          : '压缩会把历史对话总结为摘要后继续，让上下文重新变空。',
      confirmText: '压缩',
    });
    if (!ok || !activeId) return;
    try {
      const res = await window.fundet.compactSession(activeId);
      if (res === null) {
        toast.info('会话还没启动，先发条消息再压缩');
      } else if (res.noop) {
        toast.info('上下文还很小，无需压缩');
      } else if (typeof res.estimatedTokensAfter === 'number') {
        const before = typeof res.tokensBefore === 'number' ? `（${formatTokenCount(res.tokensBefore)} → ${formatTokenCount(res.estimatedTokensAfter)}）` : '';
        toast.success(`上下文已压缩${before}`);
      } else {
        toast.success('上下文已压缩');
      }
    } catch (err) {
      console.warn('[fundet] 手动压缩上下文失败', err);
      toast.error('压缩失败，请稍后再试');
    }
  }, [activeId, slice.isRunning, slice.usage.contextTokens, shownWindow]);

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
    async (text: string, createdAt: number | undefined, attachments?: SessionAttachment[]): Promise<boolean> => {
      if (!activeId || createdAt === undefined) return false;
      setNotice('');
      // 运行中（刚点编辑触发的中断还在收尾）：等 abort 收口再截断，防重发被拒
      if (slice.isRunning) await abortSession(activeId);
      if (!isDraftSession(activeId)) {
        try {
          await window.fundet.deleteTurn(activeId, createdAt - 1, Date.now() + 60_000);
        } catch (err) {
          // 失败必须在气泡旁提示（用户视线在编辑框），并返回 false 保住编辑态
          toast.error(`编辑发送失败：${err instanceof Error ? err.message : String(err)}`);
          return false;
        }
      }
      truncateItemsFrom(activeId, createdAt);
      // 编辑=截断重发：连带取消该会话未发送的排队条目（语义同删除该轮）
      void window.fundet.cancelAllOutbox(activeId).catch(() => undefined);
      return sendMessage(activeId, text, buildCreateParam(), attachments && attachments.length > 0 ? attachments : undefined);
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
    // 发送即清上一轮改动卡：无改动轮结束后旧卡不再"复活"（review P1——
    // 旧卡带旧 baseSha，撤销会把多轮改动一起回滚）
    setTurnChanges(null);
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
    const ok = await sendMessage(activeId, fullText, create, pending.length > 0 ? pending : undefined);
    if (!ok) {
      // 入队失败：草稿交还（错误详情 store 已就地展示）
      setInput(text);
      setAttachments(pending);
      if (pastedTexts.length > 0) setPastedTexts(pastedTexts);
    }
  }, [activeId, attachments, buildCreateParam, input, pastedTexts]);

  const abort = useCallback(async (): Promise<void> => {
    if (activeId) await abortSession(activeId);
  }, [activeId]);

  // ---------- composer chips ----------

  const selectModel = useCallback(
    async (providerId: string, modelId: string): Promise<void> => {
      if (!activeId) return;
      rememberModelChoice(providerId, modelId);
      // 乐观更新：立即改本地列表让 chip 标签变
      patchSessionInList(activeId, { model: modelId });
      if (isDraftSession(activeId)) {
        updateDraftSession(activeId, { providerId, model: modelId });
        toast.success(`模型已切换为 ${modelId}`);
        return;
      }
      try {
        await window.fundet.setSessionModel(activeId, modelId, providerId);
        toast.success(`模型已切换为 ${modelId}`);
      } catch (err) {
        await refreshSessionList();
        toast.error(`切换模型失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [activeId],
  );

  const permissionMode = (activeMeta?.permissionMode as PermissionMode | null) ?? 'ask';
  const selectPermission = useCallback(
    async (mode: PermissionMode): Promise<void> => {
      if (!activeId) return;
      const labels: Record<string, string> = { ask: '每次询问', auto: '自动审批', bypassPermissions: '完全放行' };
      // 乐观更新：立即改本地列表让 chip 标签变（不等服务器）
      patchSessionInList(activeId, { permissionMode: mode });
      if (isDraftSession(activeId)) {
        updateDraftSession(activeId, { permissionMode: mode });
        toast.success(`权限已切换为「${labels[mode] ?? mode}」`);
        return;
      }
      try {
        await window.fundet.setSessionPermissionMode(activeId, mode);
        toast.success(`权限已切换为「${labels[mode] ?? mode}」`);
      } catch (err) {
        // 失败回滚：重拉真实状态
        await refreshSessionList();
        toast.error(`切换权限档位失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [activeId],
  );

  // 导出会话为网页（null = 用户在保存对话框取消，静默）
  const exportHtml = useCallback(async (): Promise<void> => {
    if (!activeId) return;
    try {
      const result = await window.fundet.exportSessionHtml(activeId);
      if (!result) return;
      toast.success('已导出并打开所在文件夹');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败');
    }
  }, [activeId]);


  // ---------- 渲染 ----------

  const pendingPermission =
    slice.pendingInteraction?.kind === 'permission' ? slice.pendingInteraction : null;
  // ask_user_question 问答卡（此前只认 permission，问答请求无卡可点会挂死 turn）
  const pendingAsk =
    slice.pendingInteraction?.kind === 'ask_user_question' ? slice.pendingInteraction : null;

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
      {activeId && !activePanel && !canvasOpen && (
        <Tooltip label="Canvas 产物画布" side="bottom">
          <button
            type="button"
            onClick={() => setCanvasOpen((v) => !v)}
            className={cn(
              'no-drag fixed top-0 z-50 flex h-[46px] w-10 items-center justify-center hover:bg-hover',
              hasFramelessControls() ? 'right-[138px]' : 'right-0',
              canvasOpen ? 'text-primary' : 'text-muted',
            )}
          >
            <PanelRight size={14} />
          </button>
        </Tooltip>
      )}

      <main className="relative flex min-w-0 flex-1 flex-col">
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
                padding 缩不掉）。no-drag 挖洞规则（Cindy #5202 修正）：先序上报、
                重叠处靠后者胜——挖洞元素须在布局树中位于 drag 元素之后 */}
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
                    <FolderPickerChip cwd={workDir} onSelect={(p) => void applyWorkDir(p)} size="big" />
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
                {dwsEnabled && (
                  <DwsWidgets snapshot={dwsWidgets} onAskAgent={askDwsAgent} onRefresh={refreshDwsWidgets} expandMode="popover" />
                )}
              </div>
            </div>
          </div>
          </div>
        ) : (
          <div
            className="relative flex min-h-0 min-w-0 flex-1 flex-row"
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
                const name = dirPath.split(/[\\/]/).pop() || dirPath;
                if (applyWorkDir(dirPath)) toast.success(`工作目录已切换：${name}`);
                else toast.info(WORKDIR_LOCKED_HINT);
                return;
              }
              const { files } = filesFromDataTransfer(e.dataTransfer);
              if (files.length > 0) void addDroppedFiles(files);
            }}
            onDragEnd={(e) => {
              e.preventDefault();
              dragCountRef.current = 0;
              setDragOver(false);
              setDragFolder(false);
            }}
          >
            {dragOver && (
              <div
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-none border-2 border-dashed border-[var(--focus-ring)]"
                style={{ backgroundColor: 'color-mix(in srgb, var(--focus-ring) 10%, transparent)' }}
              >
                <div className="rounded-container border border-board bg-card px-4 py-2 text-13 text-primary">
                  {dragFolder
                    ? workDirLocked
                      ? '松手设为新对话的默认目录（本会话目录已固定）'
                      : '松手设为工作目录'
                    : '放到这里，发给助手'}
                </div>
              </div>
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* slim 头部：46px 行高 + 1px Board 下发丝（对齐 Cindy ContentHeader：标题，不是用量环）。
                空消息态按 Cindy 首页风格隐去内容，只留 46px 拖拽区 */}
            <header
              className={cn(
                'relative flex h-[46px] shrink-0 items-center gap-3 px-4 select-none',
                hasContent && 'justify-between border-b border-board',
                !hasContent && 'justify-end',
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
              {hasContent && (
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
                    <Tooltip label="导出会话为网页">
                      <button
                        type="button"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted opacity-0 hover:bg-hover hover:text-primary group-hover/title:opacity-100 focus-visible:opacity-100"
                        onClick={() => void exportHtml()}
                      >
                        <FileDown size={13} />
                      </button>
                    </Tooltip>
                    <Tooltip label="在独立窗口打开（只读，可全文搜索）">
                      <button
                        type="button"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted opacity-0 hover:bg-hover hover:text-primary group-hover/title:opacity-100 focus-visible:opacity-100"
                        onClick={() => {
                          if (activeId && !isDraftSession(activeId)) {
                            void window.fundet.openSessionPopout(activeId).catch((err: unknown) => {
                              toast.error(`打开弹窗失败：${err instanceof Error ? err.message : String(err)}`);
                            });
                          }
                        }}
                      >
                        <ExternalLink size={13} />
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
              {/* 灵动岛：驻进会话头部尾部（与标题同层，不再是悬浮异物）；钉钉总开关关=隐藏 */}
              {dwsEnabled && (
                <DynamicIsland snapshot={dwsWidgets} onAskAgent={askDwsAgent} onRefresh={refreshDwsWidgets} />
              )}
            </header>

            {/* 会话切换时消息区淡入（composer 不包——草稿/焦点跨会话保留）。
                空消息态不挂 MessageStream（Cindy 首页布局接管，见 composer 段） */}
            {slice.items.length > 0 && (
            <FadeSwitcher trigger={activeId ?? 'none'} className="min-h-0 flex-1">
            <MessageStream
              slice={slice}
              workDir={activeMeta?.workDir || workDir}
              onOpenFile={openArtifact}
              artifactPaths={artifactPathList}
              turnChanges={slice.isRunning ? null : turnChanges}
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
            {/* 历史在途：占住消息区一定高度（不让 composer 从页面中部弹到底部），
                但不用遮罩——消息回来是原地替换，视觉上只是占位块消失 */}
            {historyLoading && (
              <div className="flex min-h-0 flex-1 flex-col px-6 py-4" aria-busy="true" aria-label="正在加载会话历史">
                <div className="mx-auto flex w-full max-w-[820px] flex-col gap-3">
                  {HISTORY_SKELETON_ROWS.map((w, i) => (
                    <div
                      key={i}
                      className={cn(
                        'h-4 rounded bg-chip',
                        w,
                        i === 0 && 'ml-auto',
                      )}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* composer：审批悬挂时换成 PermissionPrompt；运行状态行在输入卡上方。
                空消息态（Cindy 首页）：整个块垂直居中，lockup 上置、输入框、建议卡 */}
            <div
              className={cn(
                'flex flex-col px-6',
                hasContent ? 'pt-1 pb-4' : 'min-h-0 flex-1 items-center justify-center pb-4 pt-[10vh]',
              )}
            >
              <div className={cn('mx-auto flex w-full flex-col', hasContent ? 'max-w-[820px]' : 'max-w-[790px]')}>
                {!hasContent && (
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
                ) : pendingAsk ? (
                  <AskUserQuestionPrompt
                    request={pendingAsk}
                    onAnswer={(requestId, answers) => {
                      // 失败要如实反馈（会话已关/超时 deny 等）：卡片保留、输入不清，
                      // 用户可改可重提——不再静默吞错（Cindy #1a50e8fe3 同语义）
                      resolveAskUser(activeId, pendingAsk, answers).catch((err: unknown) => {
                        toast.error(`回答提交失败：${err instanceof Error ? err.message : String(err)}`);
                      });
                    }}
                  />
                ) : (
                  <>
                    {outboxNotices.length > 0 && (
                      <div className="mb-2 flex flex-col gap-1.5">
                        {outboxNotices.map((item) => (
                          <div
                            key={item.id}
                            className="inline-flex max-w-full flex-wrap items-center gap-1.5 self-start rounded-xl border border-board bg-card py-1 pl-2.5 pr-1.5 text-12 text-secondary"
                            title={item.lastError ?? item.text.slice(0, 200)}
                          >
                            {item.state === 'failed' || item.state === 'outcome_unknown' ? (
                              <span
                                className={item.state === 'failed' ? 'text-error' : 'text-warning'}
                                aria-hidden
                              >
                                !
                              </span>
                            ) : (
                              <Clock size={12} className="shrink-0 text-muted" aria-hidden />
                            )}
                            <span className="min-w-0 max-w-[280px] truncate">
                              {outboxStateLabel(item)}：{item.text.replace(/\s+/g, ' ').slice(0, 30) || '（空）'}
                              {item.attachmentNames.length > 0 ? ` +${item.attachmentNames.length} 附件` : ''}
                            </span>
                            {(item.state === 'failed' || item.state === 'outcome_unknown') && (
                              <button
                                type="button"
                                className="rounded-full px-1.5 text-12 font-medium text-accent hover:underline"
                                onClick={() => void handleOutboxRetry(item)}
                              >
                                重试
                              </button>
                            )}
                            {item.state !== 'sending' && (
                              <button
                                type="button"
                                title="移除"
                                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-hover hover:text-primary"
                                onClick={() => void removeOutboxItem(activeId, item.id)}
                              >
                                <X size={10} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <RunningStatus
                      visible={slice.isRunning}
                      status={slice.statusText}
                      tokenUsage={slice.usage.tokenUsage}
                      outputTokens={slice.usage.outputTokens ?? 0}
                      generationDurationMs={slice.usage.generationDurationMs ?? 0}
                      generationReliable={slice.usage.generationTimingReliable !== false}
                    />
                    {!slice.isRunning && permissionMode === 'plan' && planContent !== undefined && (
                      <div className="mb-1.5">
                        <PlanCard content={planContent} />
                      </div>
                    )}
                    <ChatInput
                      value={input}
                      onChange={setInput}
                      onSend={() => void send()}
                      onAbort={() => void abort()}
                      isRunning={slice.isRunning}
                      tall={!hasContent}
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
                  <FolderPickerChip
                    cwd={activeMeta?.workDir || workDir}
                    onSelect={(p) => {
                      if (!applyWorkDir(p)) toast.info(WORKDIR_LOCKED_HINT);
                    }}
                  />
                  <div className="flex items-center justify-end gap-3">
                  {slice.usage.costUsd > 0 && (
                    <span className="text-12 tabular-nums text-muted">
                      ${slice.usage.costUsd.toFixed(4)}
                    </span>
                  )}
                  <ContextCapacityRing
                    contextTokens={slice.usage.contextTokens}
                    contextWindow={shownWindow}
                    onCompact={activeId && !slice.isRunning ? handleCompactContext : undefined}
                  />
                  </div>
                </div>
                {/* Cindy 首页建议卡：空消息时展示，点击预填 prompt 由用户发送 */}
                {!hasContent && (
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
                turnActive={slice.isRunning}
              />
            )}
            {/* 计划悬浮卡：与 Canvas 同级挂（absolute 不占布局位），可收放 */}
            {slice.items.length > 0 && (
              <PinnedPlanCard entries={planEntries} running={slice.isRunning} />
            )}
          </div>
        )}
        </FadeSwitcher>
        {/* FindBar 必须排在 FadeSwitcher（含各视图 46px 拖拽条）**之后**：
            Electron 拖拽区按布局树先序上报 drag/no-drag 矩形、重叠处列表靠后者胜
            （Cindy #5202 实测修正，2026-09-30 继承）——排在前面的话挖洞会被
            后上报的拖拽条盖回去，关闭/翻页按钮会被当拖窗吞掉 */}
        <FindBar open={findOpen} onClose={() => setFindOpen(false)} />
      </main>
    </div>
  );
}
