/**
 * Built-in Git Integration panel.
 *
 * The panel is compiled directly into the HaloForge app bundle and talks to
 * the statically-linked GitPlugin backend through the public plugin SDK.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  invokePlugin,
  OperationResultDialog,
  pickHostDirectory,
  type OperationResultDialogState,
} from "@haloforge/plugin-sdk";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileDiff,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  History,
  Layers,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useGitT } from "./i18n";

function gitInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  return invokePlugin<T>(cmd, args);
}

const LAST_REPO_STORAGE_KEY = "hf-plugin-git:selectedRepoPath";
const HISTORY_PAGE_SIZE = 40;

interface SavedRepo {
  id: string;
  path: string;
  alias: string | null;
  added_at?: string;
}

interface GitChange {
  path: string;
  original_path?: string;
  code: string;
  index: string;
  worktree: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

interface GitStatus {
  repo_root: string;
  branch: string;
  changes?: GitChange[];
  staged: string[];
  unstaged: string[];
  ahead: number;
  behind: number;
  last_commit: string;
  is_clean: boolean;
}

interface Commit {
  hash: string;
  short: string;
  author: string;
  when: string;
  message: string;
}

interface BranchInfo {
  current: string;
  local: string[];
  remote: string[];
}

interface GitRemote {
  name: string;
  fetch: string;
  push: string;
}

interface CommandResult {
  success?: boolean;
  output?: string;
}

interface CommitLogResult {
  commits: Commit[];
  limit?: number;
  offset?: number;
  has_more?: boolean;
}

interface GitGraphResult {
  lines: string[];
}

type GitPage = "repos" | "detail";
type GitTab = "overview" | "changes" | "history" | "branches" | "sync";
type TranslateFn = ReturnType<typeof useGitT>;

function repoLabel(repo: SavedRepo) {
  return repo.alias?.trim() || repo.path.split(/[\\/]/).filter(Boolean).pop() || repo.path;
}

function translateGitMessage(t: TranslateFn, message: string) {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;
  if (trimmed === "Selected folder is not a Git repository and cannot be added.") {
    return t("git.error.notGitRepoAdd");
  }
  if (trimmed === "Selected folder is not a Git repository.") {
    return t("git.error.notGitRepo");
  }
  if (trimmed === "missing required field: path") {
    return t("git.error.missingPath");
  }
  if (trimmed.startsWith("path not found: ")) {
    return t("git.error.pathNotFound", { path: trimmed.slice("path not found: ".length) });
  }
  if (trimmed.startsWith("path is not a directory: ")) {
    return t("git.error.notDirectory", { path: trimmed.slice("path is not a directory: ".length) });
  }
  return message;
}

function legacyStatusToChanges(status: GitStatus | null): GitChange[] {
  if (!status) return [];
  if (status.changes) return status.changes;

  const parseLine = (line: string): GitChange => {
    const code = line.slice(0, 2);
    const index = code[0] || " ";
    const worktree = code[1] || " ";
    const untracked = code === "??";
    return {
      path: line.slice(3),
      code,
      index,
      worktree,
      staged: !untracked && index !== " ",
      unstaged: untracked || worktree !== " ",
      untracked,
    };
  };

  const staged = status.staged.map(parseLine);
  const unstaged = status.unstaged.map(parseLine);
  return [...staged, ...unstaged];
}

function changeCode(change: GitChange, staged: boolean) {
  if (change.untracked) return "??";
  const code = staged ? change.index : change.worktree;
  return code.trim() || change.code.trim() || "M";
}

function changeTone(code: string) {
  if (code === "A" || code === "??") return "text-emerald-300";
  if (code === "D") return "text-red-300";
  if (code === "R" || code === "C") return "text-sky-300";
  return "text-yellow-300";
}

function diffLineClass(line: string) {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return "hf-git-diff-file";
  if (line.startsWith("@@")) return "hf-git-diff-hunk";
  if (line.startsWith("+")) return "hf-git-diff-add";
  if (line.startsWith("-")) return "hf-git-diff-delete";
  return "";
}

function formatActionOutput(output: string | undefined, fallback: string) {
  const trimmed = output?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function firstOutputLine(message: string) {
  return message.trim().split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() || message;
}

function defaultRemote(remotes: GitRemote[]) {
  return remotes.find((remote) => remote.name === "origin")?.name || remotes[0]?.name || "origin";
}

function SectionHeader({ label, count, action }: { label: string; count?: number; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2 text-xs font-semibold text-foreground-secondary/70">
      <span>{label}</span>
      {count !== undefined && (
        <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-foreground-secondary">
          {count}
        </span>
      )}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  icon,
  variant = "secondary",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  variant?: "secondary" | "primary" | "danger";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "border-primary bg-primary text-white hover:bg-primary/90",
        variant === "danger" && "border-red-500/30 bg-red-500/5 text-red-300 hover:bg-red-500/10",
        variant === "secondary" && "border-border bg-background text-foreground-secondary hover:bg-surface hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function FeedbackBanner({ tone, message }: { tone: "error" | "success"; message: string }) {
  return (
    <div
      className={clsx(
        "rounded-lg border px-3 py-2 text-xs",
        tone === "error"
          ? "border-red-500/20 bg-red-500/5 text-red-400"
          : "border-emerald-500/20 bg-emerald-500/5 text-emerald-300",
      )}
    >
      {message}
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/70 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-secondary/45">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      {detail && <p className="mt-1 truncate text-[11px] text-foreground-secondary/55">{detail}</p>}
    </div>
  );
}

function RepoListPage({
  savedRepos,
  inputPath,
  busy,
  currentRepoPath,
  onInputPathChange,
  onBrowse,
  onAddRepo,
  onSelectRepo,
  onRemoveRepo,
}: {
  savedRepos: SavedRepo[];
  inputPath: string;
  busy: boolean;
  currentRepoPath: string;
  onInputPathChange: (value: string) => void;
  onBrowse: () => void;
  onAddRepo: () => void;
  onSelectRepo: (path: string) => void;
  onRemoveRepo: (path: string) => void;
}) {
  const t = useGitT();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <section className="rounded-lg border border-border bg-surface/30 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Folder size={16} className="text-primary" />
              <h2 className="text-sm font-semibold text-foreground">{t("git.page.repositories")}</h2>
              <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-foreground-secondary">
                {savedRepos.length}
              </span>
            </div>
            <p className="mt-1 text-xs text-foreground-secondary/60">{t("git.page.repositoriesDesc")}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr),auto,auto]">
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground-secondary/40 outline-none transition-all focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
            placeholder={t("git.repoPathPlaceholder")}
            value={inputPath}
            onChange={(e) => onInputPathChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAddRepo();
            }}
          />
          <ActionButton label={t("common.browse")} onClick={onBrowse} icon={<Folder size={14} />} />
          <ActionButton label={t("git.addRepo")} onClick={onAddRepo} disabled={busy} icon={<Plus size={14} />} variant="primary" />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface/20 p-3">
        {savedRepos.length === 0 ? (
          <div className="flex min-h-[320px] items-center justify-center px-6 text-center text-sm text-foreground-secondary/45">
            {t("git.emptySaved")}
          </div>
        ) : (
          <div className="space-y-2">
            {savedRepos.map((repo) => {
              const isCurrent = repo.path === currentRepoPath;

              return (
                <div
                  key={repo.id}
                  className={clsx(
                    "group flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors",
                    isCurrent
                      ? "border-primary/30 bg-primary/8"
                      : "border-border/60 bg-background/70 hover:border-border hover:bg-background",
                  )}
                >
                  <button onClick={() => onSelectRepo(repo.path)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{repoLabel(repo)}</span>
                      {isCurrent && (
                        <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-primary">
                          {t("git.tag.lastOpened")}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 truncate text-xs text-foreground-secondary/60">{repo.path}</div>
                  </button>

                  <ActionButton label={t("git.openRepo")} onClick={() => onSelectRepo(repo.path)} icon={<ArrowRight size={12} />} />
                  <button
                    onClick={() => onRemoveRepo(repo.path)}
                    title={t("git.removeRepo")}
                    className="rounded-md p-1.5 text-foreground-secondary/70 transition-colors hover:bg-background hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function ChangeRow({
  change,
  staged,
  busy,
  onStage,
  onUnstage,
  onDiscard,
  onDiff,
}: {
  change: GitChange;
  staged: boolean;
  busy: boolean;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (change: GitChange) => void;
  onDiff: (change: GitChange, staged: boolean) => void;
}) {
  const t = useGitT();
  const code = changeCode(change, staged);

  return (
    <div className="group flex items-center gap-2 border-b border-border/20 px-3 py-1.5 transition-colors hover:bg-surface/30">
      <span className={clsx("w-5 shrink-0 text-xs font-semibold", changeTone(code))}>{code}</span>
      <div className="min-w-0 flex-1">
        <span className="block break-all font-mono text-xs leading-snug text-foreground" title={change.path}>
          {change.path}
        </span>
        {change.original_path && (
          <span className="block break-all text-[10px] leading-snug text-foreground-secondary/45" title={change.original_path}>
            {change.original_path}
          </span>
        )}
      </div>
      <div className="flex shrink-0 gap-1 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
        <button
          onClick={() => onDiff(change, staged)}
          disabled={busy}
          className="rounded-md px-2 py-1 text-[10px] text-foreground-secondary/60 hover:bg-surface hover:text-foreground disabled:opacity-40"
        >
          {t("git.action.diff")}
        </button>
        {staged ? (
          <button
            onClick={() => onUnstage(change.path)}
            disabled={busy}
            className="rounded-md px-2 py-1 text-[10px] text-foreground-secondary/60 hover:bg-surface hover:text-foreground disabled:opacity-40"
          >
            {t("git.action.unstage")}
          </button>
        ) : (
          <>
            <button
              onClick={() => onStage(change.path)}
              disabled={busy}
              className="rounded-md px-2 py-1 text-[10px] text-foreground-secondary/60 hover:bg-surface hover:text-foreground disabled:opacity-40"
            >
              {t("git.action.stage")}
            </button>
            <button
              onClick={() => onDiscard(change)}
              disabled={busy}
              className="rounded-md px-2 py-1 text-[10px] text-red-300/80 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
            >
              {t("git.action.discard")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CommitRow({ commit }: { commit: Commit }) {
  return (
    <div className="flex items-start gap-2 border-b border-border/30 px-3 py-2 transition-colors hover:bg-surface/40">
      <code className="mt-0.5 shrink-0 text-xs text-primary">{commit.short}</code>
      <div className="min-w-0 flex-1">
        <p className="break-words text-xs text-foreground" title={commit.message}>{commit.message}</p>
        <p className="mt-0.5 text-[10px] text-foreground-secondary/50">
          {commit.author} · {commit.when}
        </p>
      </div>
    </div>
  );
}

function DiffPanel({
  title,
  output,
  loading,
  onClose,
}: {
  title: string;
  output: string;
  loading: boolean;
  onClose: () => void;
}) {
  const t = useGitT();

  return (
    <div className="border-b border-border bg-background/60">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <FileDiff size={13} className="text-primary" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{title}</span>
        <button onClick={onClose} className="rounded px-2 py-1 text-[10px] text-foreground-secondary hover:bg-surface hover:text-foreground">
          {t("git.action.closeDiff")}
        </button>
      </div>
      <div className="max-h-[420px] overflow-auto">
        {loading ? (
          <div className="py-10 text-center text-xs text-foreground-secondary/45">{t("git.loadingDiff")}</div>
        ) : output.trim() ? (
          <pre className="hf-git-diff whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground-secondary">
            {output.split("\n").map((line, index) => (
              <span key={`${index}:${line.slice(0, 12)}`} className={diffLineClass(line)}>
                {line || " "}
                {"\n"}
              </span>
            ))}
          </pre>
        ) : (
          <div className="py-10 text-center text-xs text-foreground-secondary/45">{t("git.diff.empty")}</div>
        )}
      </div>
    </div>
  );
}

function RepoDetailPage({
  currentRepo,
  repoPath,
  status,
  commits,
  graphLines,
  branches,
  remotes,
  loading,
  busy,
  activeTab,
  commitMessage,
  stageAllBeforeCommit,
  checkoutBranch,
  createBranch,
  stashMessage,
  diffState,
  historyQuery,
  historyOffset,
  historyHasMore,
  historyLoading,
  onBack,
  onRefresh,
  onAction,
  onHistoryQueryChange,
  onHistoryPage,
  onCommitMessageChange,
  onStageAllBeforeCommitChange,
  onCheckoutBranchChange,
  onCreateBranchChange,
  onStashMessageChange,
  onCommit,
  onCheckout,
  onTabChange,
  onStage,
  onUnstage,
  onDiscard,
  onDiff,
  onCloseDiff,
}: {
  currentRepo: SavedRepo | null;
  repoPath: string;
  status: GitStatus | null;
  commits: Commit[];
  graphLines: string[];
  branches: BranchInfo | null;
  remotes: GitRemote[];
  loading: boolean;
  busy: boolean;
  activeTab: GitTab;
  commitMessage: string;
  stageAllBeforeCommit: boolean;
  checkoutBranch: string;
  createBranch: boolean;
  stashMessage: string;
  diffState: { title: string; output: string; loading: boolean } | null;
  historyQuery: string;
  historyOffset: number;
  historyHasMore: boolean;
  historyLoading: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onAction: (cmd: string, label: string, extraArgs?: Record<string, unknown>, afterAction?: () => void) => void;
  onHistoryQueryChange: (value: string) => void;
  onHistoryPage: (direction: "prev" | "next") => void;
  onCommitMessageChange: (value: string) => void;
  onStageAllBeforeCommitChange: (value: boolean) => void;
  onCheckoutBranchChange: (value: string) => void;
  onCreateBranchChange: (value: boolean) => void;
  onStashMessageChange: (value: string) => void;
  onCommit: () => void;
  onCheckout: () => void;
  onTabChange: (tab: GitTab) => void;
  onStage: (files?: string[]) => void;
  onUnstage: (files?: string[]) => void;
  onDiscard: (change: GitChange) => void;
  onDiff: (change: GitChange, staged: boolean) => void;
  onCloseDiff: () => void;
}) {
  const t = useGitT();
  const title = currentRepo ? repoLabel(currentRepo) : repoPath.split(/[\\/]/).filter(Boolean).pop() || repoPath;
  const changes = useMemo(() => legacyStatusToChanges(status), [status]);
  const stagedChanges = useMemo(() => changes.filter((change) => change.staged), [changes]);
  const worktreeChanges = useMemo(() => changes.filter((change) => change.unstaged), [changes]);
  const remoteName = defaultRemote(remotes);

  const tabs: { key: GitTab; label: string; badge?: number; icon: ReactNode }[] = [
    { key: "overview", label: t("git.tab.overview"), icon: <Layers size={12} /> },
    { key: "changes", label: t("git.tab.changes"), badge: changes.length || undefined, icon: <FileDiff size={12} /> },
    { key: "history", label: t("git.tab.history"), icon: <History size={12} /> },
    { key: "branches", label: t("git.tab.branches"), icon: <GitBranch size={12} /> },
    { key: "sync", label: t("git.tab.sync"), icon: <RefreshCw size={12} /> },
  ];

  return (
    <section className="mx-auto flex min-h-[720px] max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-surface/20">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex flex-wrap items-start gap-3">
          <ActionButton label={t("git.backToRepos")} onClick={onBack} icon={<ArrowLeft size={13} />} />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <GitBranch size={15} className="text-primary" />
              <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
            </div>
            <p className="mt-1 truncate text-xs text-foreground-secondary/60">{repoPath}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionButton label={t("git.action.refresh")} onClick={onRefresh} disabled={busy} icon={<RefreshCw size={13} />} />
            <ActionButton label={t("git.action.fetch")} onClick={() => onAction("git_fetch", t("git.action.fetch"), { remote: remoteName, prune: true })} disabled={busy} icon={<Download size={13} />} />
            <ActionButton label={t("git.action.pull")} onClick={() => onAction("git_pull", t("git.action.pull"), { remote: remoteName })} disabled={busy} icon={<Download size={13} />} />
            <ActionButton label={t("git.action.push")} onClick={() => onAction("git_push", t("git.action.push"), { remote: remoteName })} disabled={busy} icon={<Upload size={13} />} variant="primary" />
          </div>
        </div>

        {status && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-background px-2.5 py-1 font-medium text-primary">{status.branch}</span>
            <span className={clsx("rounded-full px-2.5 py-1", status.is_clean ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-300")}>
              {status.is_clean ? t("git.state.clean") : t("git.state.dirty")}
            </span>
            <span className="rounded-full bg-background px-2.5 py-1 text-foreground-secondary">
              {t("git.state.staged", { count: stagedChanges.length })}
            </span>
            <span className="rounded-full bg-background px-2.5 py-1 text-foreground-secondary">
              {t("git.state.unstaged", { count: worktreeChanges.length })}
            </span>
            {(status.ahead > 0 || status.behind > 0) && (
              <span className="rounded-full bg-background px-2.5 py-1 text-foreground-secondary">↑{status.ahead} ↓{status.behind}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 overflow-x-auto border-b border-border text-xs">
        {tabs.map(({ key, label, badge, icon }) => (
          <button
            key={key}
            onClick={() => onTabChange(key)}
            className={clsx(
              "inline-flex shrink-0 items-center gap-1.5 px-4 py-2.5 transition-colors",
              activeTab === key ? "border-b-2 border-primary text-primary" : "text-foreground-secondary/60 hover:text-foreground",
            )}
          >
            {icon}
            {label}
            {badge !== undefined && (
              <span className={clsx("rounded px-1.5 py-0.5 text-[9px]", activeTab === key ? "bg-primary/20 text-primary" : "bg-background text-foreground-secondary/60")}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {diffState && (
        <DiffPanel title={diffState.title} output={diffState.output} loading={diffState.loading} onClose={onCloseDiff} />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-24 items-center justify-center text-xs text-foreground-secondary/40">
            {t("git.loadingRepoData")}
          </div>
        ) : (
          <>
            {activeTab === "overview" && status && (
              <div className="space-y-4 p-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <MetricCard label={t("git.metric.branch")} value={status.branch} detail={status.is_clean ? t("git.state.clean") : t("git.state.dirty")} />
                  <MetricCard label={t("git.metric.changedFiles")} value={changes.length} detail={`${stagedChanges.length} ${t("git.label.staged")} / ${worktreeChanges.length} ${t("git.label.worktree")}`} />
                  <MetricCard label={t("git.metric.sync")} value={`↑${status.ahead} ↓${status.behind}`} detail={remoteName} />
                  <MetricCard label={t("git.metric.remotes")} value={remotes.length} detail={remotes[0]?.fetch || t("git.remote.none")} />
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),360px]">
                  <div className="rounded-lg border border-border bg-background/55">
                    <SectionHeader label={t("git.section.recentChanges")} count={changes.length} />
                    {changes.length === 0 ? (
                      <div className="px-3 py-8 text-center text-xs text-foreground-secondary/40">{t("git.cleanWorkingTree")}</div>
                    ) : (
                      changes.slice(0, 8).map((change, index) => (
                        <ChangeRow
                          key={`${change.path}:${index}:overview`}
                          change={change}
                          staged={change.staged}
                          busy={busy}
                          onStage={(path) => onStage([path])}
                          onUnstage={(path) => onUnstage([path])}
                          onDiscard={onDiscard}
                          onDiff={onDiff}
                        />
                      ))
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-lg border border-border bg-background/55 p-3">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-secondary/50">{t("git.section.quickActions")}</p>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton label={t("git.action.stageAll")} onClick={() => onStage()} disabled={busy || changes.length === 0} icon={<Plus size={12} />} />
                        <ActionButton label={t("git.action.unstageAll")} onClick={() => onUnstage()} disabled={busy || stagedChanges.length === 0} icon={<Minus size={12} />} />
                        <ActionButton label={t("git.action.stash")} onClick={() => onAction("git_stash", t("git.action.stash"), { message: stashMessage || undefined, include_untracked: true }, () => onStashMessageChange(""))} disabled={busy || changes.length === 0} icon={<RotateCcw size={12} />} />
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-background/55 p-3">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-secondary/50">{t("git.lastCommit")}</p>
                      <code className="block truncate text-xs text-foreground-secondary">{status.last_commit || t("git.noCommits")}</code>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "changes" && status && (
              <div className="grid min-h-full gap-0 lg:grid-cols-[minmax(0,1fr),360px]">
                <div className="border-r border-border/60">
                  <SectionHeader
                    label={t("git.section.staged")}
                    count={stagedChanges.length}
                    action={<ActionButton label={t("git.action.unstageAll")} onClick={() => onUnstage()} disabled={busy || stagedChanges.length === 0} />}
                  />
                  {stagedChanges.length === 0 ? (
                    <div className="px-3 py-7 text-center text-xs text-foreground-secondary/40">{t("git.noStagedChanges")}</div>
                  ) : (
                    stagedChanges.map((change, index) => (
                      <ChangeRow
                        key={`${change.path}:${index}:staged`}
                        change={change}
                        staged
                        busy={busy}
                        onStage={(path) => onStage([path])}
                        onUnstage={(path) => onUnstage([path])}
                        onDiscard={onDiscard}
                        onDiff={onDiff}
                      />
                    ))
                  )}

                  <SectionHeader
                    label={t("git.section.worktree")}
                    count={worktreeChanges.length}
                    action={<ActionButton label={t("git.action.stageAll")} onClick={() => onStage()} disabled={busy || worktreeChanges.length === 0} />}
                  />
                  {worktreeChanges.length === 0 ? (
                    <div className="px-3 py-7 text-center text-xs text-foreground-secondary/40">{t("git.noWorktreeChanges")}</div>
                  ) : (
                    worktreeChanges.map((change, index) => (
                      <ChangeRow
                        key={`${change.path}:${index}:worktree`}
                        change={change}
                        staged={false}
                        busy={busy}
                        onStage={(path) => onStage([path])}
                        onUnstage={(path) => onUnstage([path])}
                        onDiscard={onDiscard}
                        onDiff={onDiff}
                      />
                    ))
                  )}
                </div>

                <aside className="space-y-3 p-3">
                  <div className="rounded-lg border border-border bg-background/70 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-secondary/50">{t("git.commitStaged")}</p>
                    <div className="flex gap-2">
                      <input
                        value={commitMessage}
                        onChange={(e) => onCommitMessageChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") onCommit();
                        }}
                        placeholder={t("git.commitMessagePlaceholder")}
                        className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-foreground-secondary/40 outline-none transition-all focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
                      />
                      <ActionButton label={t("git.commit")} onClick={onCommit} disabled={busy} icon={<GitCommitHorizontal size={12} />} variant="primary" />
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-[11px] text-foreground-secondary/70">
                      <input
                        type="checkbox"
                        checked={stageAllBeforeCommit}
                        onChange={(e) => onStageAllBeforeCommitChange(e.target.checked)}
                        className="rounded border-border bg-background"
                      />
                      {t("git.stageAllBeforeCommit")}
                    </label>
                  </div>
                </aside>
              </div>
            )}

            {activeTab === "history" && (
              <div>
                <div className="flex flex-wrap items-center gap-2 border-b border-border/50 p-3">
                  <div className="relative min-w-[220px] flex-1">
                    <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-secondary/40" />
                    <input
                      value={historyQuery}
                      onChange={(e) => onHistoryQueryChange(e.target.value)}
                      placeholder={t("git.history.searchPlaceholder")}
                      className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-xs text-foreground placeholder:text-foreground-secondary/40 outline-none transition-all focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onHistoryPage("prev")}
                      disabled={busy || historyLoading || historyOffset === 0}
                      className="rounded-md border border-border bg-background p-1.5 text-foreground-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      title={t("git.history.prevPage")}
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="min-w-[72px] text-center text-[10px] text-foreground-secondary/50">
                      {t("git.history.pageLabel", { page: Math.floor(historyOffset / HISTORY_PAGE_SIZE) + 1 })}
                    </span>
                    <button
                      onClick={() => onHistoryPage("next")}
                      disabled={busy || historyLoading || !historyHasMore}
                      className="rounded-md border border-border bg-background p-1.5 text-foreground-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      title={t("git.history.nextPage")}
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>

                {graphLines.length > 0 && (
                  <details className="border-b border-border/40 bg-background/40">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-foreground-secondary hover:text-foreground">
                      {t("git.history.revisionGraph")}
                    </summary>
                    <pre className="max-h-48 overflow-auto px-3 pb-3 font-mono text-[11px] leading-relaxed text-foreground-secondary/75">
                      {graphLines.join("\n")}
                    </pre>
                  </details>
                )}

                {historyLoading ? (
                  <div className="px-3 py-8 text-center text-xs text-foreground-secondary/40">{t("git.history.loading")}</div>
                ) : commits.length === 0 ? (
                  <div className="px-3 py-8 text-center text-xs text-foreground-secondary/40">
                    {historyQuery.trim() ? t("git.history.noSearchResults") : t("git.noCommits")}
                  </div>
                ) : (
                  <>
                    <div className="border-b border-border/30 px-3 py-1.5 text-[10px] text-foreground-secondary/45">
                      {t("git.history.showing", {
                        start: historyOffset + 1,
                        end: historyOffset + commits.length,
                      })}
                    </div>
                    {commits.map((commit) => <CommitRow key={commit.hash} commit={commit} />)}
                  </>
                )}
              </div>
            )}

            {activeTab === "branches" && branches && (
              <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr),360px]">
                <div className="border-r border-border/60">
                  <SectionHeader label={t("git.branchScope.local")} count={branches.local.length} />
                  {branches.local.map((branch) => (
                    <button
                      key={branch}
                      onClick={() => onCheckoutBranchChange(branch)}
                      className={clsx(
                        "flex w-full items-center px-4 py-1.5 text-left text-xs font-mono transition-colors hover:bg-surface/50",
                        branch === branches.current ? "font-semibold text-primary" : "text-foreground-secondary",
                      )}
                    >
                      {branch === branches.current ? "* " : "  "}
                      {branch}
                    </button>
                  ))}
                  <SectionHeader label={t("git.branchScope.remote")} count={branches.remote.length} />
                  {branches.remote.map((branch) => (
                    <button
                      key={branch}
                      onClick={() => onCheckoutBranchChange(branch.replace(/^origin\//, ""))}
                      className="flex w-full items-center px-4 py-1.5 text-left text-xs font-mono text-foreground-secondary/60 transition-colors hover:bg-surface/50 hover:text-foreground-secondary"
                    >
                      {branch}
                    </button>
                  ))}
                </div>

                <aside className="p-3">
                  <div className="rounded-lg border border-border bg-background/70 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-secondary/50">{t("git.checkoutBranch")}</p>
                    <div className="flex gap-2">
                      <input
                        value={checkoutBranch}
                        onChange={(e) => onCheckoutBranchChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") onCheckout();
                        }}
                        placeholder={t("git.branchNamePlaceholder")}
                        className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-foreground-secondary/40 outline-none transition-all focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
                      />
                      <ActionButton label={t("git.switchBranch")} onClick={onCheckout} disabled={busy} variant="primary" />
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-[11px] text-foreground-secondary/70">
                      <input
                        type="checkbox"
                        checked={createBranch}
                        onChange={(e) => onCreateBranchChange(e.target.checked)}
                        className="rounded border-border bg-background"
                      />
                      {t("git.createBranchIfMissing")}
                    </label>
                  </div>
                </aside>
              </div>
            )}

            {activeTab === "sync" && (
              <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr),360px]">
                <div className="rounded-lg border border-border bg-background/55">
                  <SectionHeader label={t("git.section.remotes")} count={remotes.length} />
                  {remotes.length === 0 ? (
                    <div className="px-3 py-8 text-center text-xs text-foreground-secondary/40">{t("git.remote.none")}</div>
                  ) : (
                    remotes.map((remote) => (
                      <div key={remote.name} className="border-b border-border/25 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{remote.name}</span>
                          {remote.name === remoteName && <span className="text-[10px] text-foreground-secondary/45">{t("git.label.defaultRemote")}</span>}
                        </div>
                        <p className="mt-1 truncate font-mono text-[10px] text-foreground-secondary/55">{remote.fetch || remote.push}</p>
                      </div>
                    ))
                  )}
                </div>

                <aside className="space-y-3">
                  <div className="rounded-lg border border-border bg-background/70 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-secondary/50">{t("git.section.syncActions")}</p>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton label={t("git.action.fetch")} onClick={() => onAction("git_fetch", t("git.action.fetch"), { remote: remoteName, prune: true })} disabled={busy} icon={<Download size={12} />} />
                      <ActionButton label={t("git.action.pull")} onClick={() => onAction("git_pull", t("git.action.pull"), { remote: remoteName })} disabled={busy} icon={<Download size={12} />} />
                      <ActionButton label={t("git.action.pullRebase")} onClick={() => onAction("git_pull", t("git.action.pullRebase"), { remote: remoteName, rebase: true })} disabled={busy} icon={<Download size={12} />} />
                      <ActionButton label={t("git.action.push")} onClick={() => onAction("git_push", t("git.action.push"), { remote: remoteName })} disabled={busy} icon={<Upload size={12} />} variant="primary" />
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-background/70 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-secondary/50">{t("git.action.stash")}</p>
                    <input
                      value={stashMessage}
                      onChange={(e) => onStashMessageChange(e.target.value)}
                      placeholder={t("git.stashMessagePlaceholder")}
                      className="mb-2 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-foreground-secondary/40 outline-none transition-all focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
                    />
                    <ActionButton
                      label={t("git.action.stashWorktree")}
                      onClick={() => onAction("git_stash", t("git.action.stash"), { message: stashMessage || undefined, include_untracked: true }, () => onStashMessageChange(""))}
                      disabled={busy || !status || status.is_clean}
                      icon={<RotateCcw size={12} />}
                    />
                  </div>
                </aside>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function GitPanel() {
  const t = useGitT();
  const [page, setPage] = useState<GitPage>("repos");
  const [savedRepos, setSavedRepos] = useState<SavedRepo[]>([]);
  const [repoPath, setRepoPath] = useState("");
  const [inputPath, setInputPath] = useState("");
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [graphLines, setGraphLines] = useState<string[]>([]);
  const [branches, setBranches] = useState<BranchInfo | null>(null);
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<GitTab>("overview");
  const [error, setError] = useState<string | null>(null);
  const [lastOutput, setLastOutput] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [stageAllBeforeCommit, setStageAllBeforeCommit] = useState(false);
  const [checkoutBranch, setCheckoutBranch] = useState("");
  const [createBranch, setCreateBranch] = useState(false);
  const [stashMessage, setStashMessage] = useState("");
  const [diffState, setDiffState] = useState<{ title: string; output: string; loading: boolean } | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [operationResult, setOperationResult] = useState<OperationResultDialogState | null>(null);
  const historyQueryRef = useRef("");
  const historyOffsetRef = useRef(0);

  const currentRepo = savedRepos.find((repo) => repo.path === repoPath) ?? null;
  const busy = loading || runningAction !== null;

  useEffect(() => {
    historyQueryRef.current = historyQuery;
  }, [historyQuery]);

  useEffect(() => {
    historyOffsetRef.current = historyOffset;
  }, [historyOffset]);

  const rememberSelectedRepo = useCallback((path: string | null) => {
    try {
      if (path) window.localStorage.setItem(LAST_REPO_STORAGE_KEY, path);
      else window.localStorage.removeItem(LAST_REPO_STORAGE_KEY);
    } catch {
      // ignore storage failures
    }
  }, []);

  const clearRepoData = useCallback(() => {
    setRepoPath("");
    setStatus(null);
    setCommits([]);
    setGraphLines([]);
    setBranches(null);
    setRemotes([]);
    setDiffState(null);
  }, []);

  const loadSavedRepos = useCallback(async () => {
    const result = await gitInvoke<{ repos: SavedRepo[] }>("git_saved_repos");
    setSavedRepos(result.repos);
    return result.repos;
  }, []);

  const fetchHistory = useCallback(async (path: string, query: string, offset: number) => {
    if (!path) return;
    setHistoryLoading(true);
    setError(null);
    try {
      const result = await gitInvoke<CommitLogResult>("git_log", {
        path,
        limit: HISTORY_PAGE_SIZE,
        offset,
        query: query.trim() || undefined,
      });
      setCommits(result.commits);
      setHistoryHasMore(Boolean(result.has_more));
    } catch (e) {
      setError(translateGitMessage(t, e instanceof Error ? e.message : String(e)));
    } finally {
      setHistoryLoading(false);
    }
  }, [t]);

  const fetchAll = useCallback(async (path: string, options?: { resetHistory?: boolean }) => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const nextHistoryOffset = options?.resetHistory ? 0 : historyOffsetRef.current;
      const nextHistoryQuery = options?.resetHistory ? "" : historyQueryRef.current;
      const [nextStatus, nextLog, nextGraph, nextBranches, nextRemotes] = await Promise.all([
        gitInvoke<GitStatus>("git_status", { path }),
        gitInvoke<CommitLogResult>("git_log", {
          path,
          limit: HISTORY_PAGE_SIZE,
          offset: nextHistoryOffset,
          query: nextHistoryQuery.trim() || undefined,
        }),
        gitInvoke<GitGraphResult>("git_graph", { path, limit: 80 }),
        gitInvoke<BranchInfo>("git_branches", { path }),
        gitInvoke<{ remotes: GitRemote[] }>("git_remotes", { path }),
      ]);
      setRepoPath(nextStatus.repo_root || path);
      setInputPath(nextStatus.repo_root || path);
      rememberSelectedRepo(nextStatus.repo_root || path);
      if (options?.resetHistory) {
        setHistoryQuery("");
        setHistoryOffset(0);
      }
      setStatus(nextStatus);
      setCommits(nextLog.commits);
      setHistoryHasMore(Boolean(nextLog.has_more));
      setGraphLines(nextGraph.lines);
      setBranches(nextBranches);
      setRemotes(nextRemotes.remotes);
    } catch (e) {
      setError(translateGitMessage(t, e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, [rememberSelectedRepo, t]);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const repos = await loadSavedRepos();
        if (cancelled || repos.length === 0) return;

        let preferredPath: string | null = null;
        try {
          preferredPath = window.localStorage.getItem(LAST_REPO_STORAGE_KEY);
        } catch {
          preferredPath = null;
        }

        const initialRepo = repos.find((repo) => repo.path === preferredPath) ?? repos[0];
        setInputPath(initialRepo.path);
        await fetchAll(initialRepo.path);
        if (!cancelled) setPage("detail");
      } catch (e) {
        if (!cancelled) setError(translateGitMessage(t, e instanceof Error ? e.message : String(e)));
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [fetchAll, loadSavedRepos, t]);

  useEffect(() => {
    if (!repoPath) return;
    const handle = window.setTimeout(() => {
      setHistoryOffset(0);
      historyOffsetRef.current = 0;
      void fetchHistory(repoPath, historyQuery, 0);
    }, 250);

    return () => window.clearTimeout(handle);
  }, [fetchHistory, historyQuery, repoPath]);

  const handleSelectRepo = useCallback(async (path: string) => {
    setLastOutput(null);
    setDiffState(null);
    setInputPath(path);
    setActiveTab("overview");
    setPage("detail");
    setHistoryQuery("");
    setHistoryOffset(0);
    historyQueryRef.current = "";
    historyOffsetRef.current = 0;
    await fetchAll(path, { resetHistory: true });
  }, [fetchAll]);

  const handleAddRepo = useCallback(async (pathOverride?: string) => {
    const candidatePath = (pathOverride ?? inputPath).trim();
    if (!candidatePath) {
      setError(t("git.error.missingPath"));
      return;
    }

    setRunningAction("add");
    setError(null);
    try {
      const result = await gitInvoke<{ repo: SavedRepo }>("git_add_repo", { path: candidatePath });
      await loadSavedRepos();
      setLastOutput(t("git.feedback.savedRepo", { name: repoLabel(result.repo) }));
      await fetchAll(result.repo.path);
      setActiveTab("overview");
      setPage("detail");
    } catch (e) {
      const message = translateGitMessage(t, e instanceof Error ? e.message : String(e));
      setError(message);
      setOperationResult({
        tone: "error",
        title: t("git.feedback.errorTitle", { action: t("git.addRepo") }),
        summary: firstOutputLine(message),
        details: message,
      });
    } finally {
      setRunningAction(null);
    }
  }, [fetchAll, inputPath, loadSavedRepos, t]);

  const handleAction = useCallback(async (
    cmd: string,
    label: string,
    extraArgs?: Record<string, unknown>,
    afterAction?: () => void,
  ) => {
    if (!repoPath) return;
    setRunningAction(label);
    setLastOutput(t("git.feedback.actionRunning", { action: label }));
    setError(null);
    try {
      const result = await gitInvoke<CommandResult>(cmd, { path: repoPath, ...extraArgs });
      const message = formatActionOutput(result.output, t("git.feedback.actionCompleted", { action: label }));
      setLastOutput(message);
      setOperationResult({
        tone: "success",
        title: t("git.feedback.successTitle", { action: label }),
        summary: firstOutputLine(message),
        details: message,
      });
      afterAction?.();
      await fetchAll(repoPath);
    } catch (e) {
      const message = translateGitMessage(t, e instanceof Error ? e.message : String(e));
      setError(message);
      setOperationResult({
        tone: "error",
        title: t("git.feedback.errorTitle", { action: label }),
        summary: firstOutputLine(message),
        details: message,
      });
    } finally {
      setRunningAction(null);
    }
  }, [fetchAll, repoPath, t]);

  const handleHistoryPage = useCallback((direction: "prev" | "next") => {
    if (!repoPath) return;
    const nextOffset = direction === "next"
      ? historyOffset + HISTORY_PAGE_SIZE
      : Math.max(0, historyOffset - HISTORY_PAGE_SIZE);
    setHistoryOffset(nextOffset);
    historyOffsetRef.current = nextOffset;
    void fetchHistory(repoPath, historyQuery, nextOffset);
  }, [fetchHistory, historyOffset, historyQuery, repoPath]);

  const handleBrowse = useCallback(async () => {
    try {
      const picked = await pickHostDirectory({ title: t("git.pickDirectoryTitle") });
      if (picked) {
        setInputPath(picked);
        await handleAddRepo(picked);
      }
    } catch {
      // user cancelled
    }
  }, [handleAddRepo, t]);

  const handleRemoveRepo = useCallback(async (path: string) => {
    setRunningAction("remove");
    setError(null);
    try {
      await gitInvoke<CommandResult>("git_remove_repo", { path });
      const repos = await loadSavedRepos();
      const message = t("git.feedback.removedRepo", { path });

      if (repoPath === path) {
        const nextRepo = repos[0] ?? null;
        if (nextRepo) {
          setLastOutput(message);
          await fetchAll(nextRepo.path);
          setPage("repos");
        } else {
          clearRepoData();
          setInputPath("");
          setLastOutput(message);
          rememberSelectedRepo(null);
          setPage("repos");
        }
      } else {
        setLastOutput(message);
      }
    } catch (e) {
      const message = translateGitMessage(t, e instanceof Error ? e.message : String(e));
      setError(message);
      setOperationResult({
        tone: "error",
        title: t("git.feedback.errorTitle", { action: t("git.removeRepo") }),
        summary: firstOutputLine(message),
        details: message,
      });
    } finally {
      setRunningAction(null);
    }
  }, [clearRepoData, fetchAll, loadSavedRepos, rememberSelectedRepo, repoPath, t]);

  const handleStage = useCallback((files?: string[]) => {
    void handleAction("git_stage", files?.length ? t("git.action.stage") : t("git.action.stageAll"), files?.length ? { files } : undefined);
  }, [handleAction, t]);

  const handleUnstage = useCallback((files?: string[]) => {
    void handleAction("git_unstage", files?.length ? t("git.action.unstage") : t("git.action.unstageAll"), files?.length ? { files } : undefined);
  }, [handleAction, t]);

  const handleDiscard = useCallback((change: GitChange) => {
    if (!window.confirm(t("git.confirm.discard", { path: change.path }))) return;
    void handleAction("git_discard", t("git.action.discard"), { files: [change.path], confirm: true });
  }, [handleAction, t]);

  const handleShowDiff = useCallback(async (change: GitChange, staged: boolean) => {
    if (!repoPath) return;
    const title = `${staged ? t("git.section.staged") : t("git.section.worktree")} · ${change.path}`;
    setDiffState({ title, output: "", loading: true });
    try {
      const res = await gitInvoke<{ output: string }>("git_diff", { path: repoPath, file: change.path, staged });
      setDiffState({ title, output: res.output || "", loading: false });
    } catch (e) {
      setDiffState(null);
      const message = translateGitMessage(t, e instanceof Error ? e.message : String(e));
      setError(message);
      setOperationResult({
        tone: "error",
        title: t("git.feedback.errorTitle", { action: t("git.action.diff") }),
        summary: firstOutputLine(message),
        details: message,
      });
    }
  }, [repoPath, t]);

  const handleCommit = useCallback(async () => {
    const message = commitMessage.trim();
    if (!message) {
      setError(t("git.error.commitMessageRequired"));
      return;
    }

    const stagedCount = legacyStatusToChanges(status).filter((change) => change.staged).length;
    if (!stageAllBeforeCommit && stagedCount === 0) {
      setError(t("git.error.noStagedChanges"));
      return;
    }

    await handleAction(
      "git_commit",
      t("git.commit"),
      { message, add_all: stageAllBeforeCommit },
      () => {
        setCommitMessage("");
        setStageAllBeforeCommit(false);
      },
    );
  }, [commitMessage, handleAction, stageAllBeforeCommit, status, t]);

  const handleCheckout = useCallback(async () => {
    const branch = checkoutBranch.trim();
    if (!branch) {
      setError(t("git.error.branchRequired"));
      return;
    }

    await handleAction(
      "git_checkout",
      t("git.switchBranch"),
      { branch, create: createBranch },
      () => {
        setCheckoutBranch("");
        setCreateBranch(false);
      },
    );
  }, [checkoutBranch, createBranch, handleAction, t]);

  return (
    <div className="hf-git-panel space-y-4">
      <OperationResultDialog
        result={operationResult}
        onClose={() => setOperationResult(null)}
        detailsLabel={t("git.feedback.details")}
        closeLabel={t("git.action.close")}
      />
      {error && <FeedbackBanner tone="error" message={error} />}
      {lastOutput && !error && <FeedbackBanner tone="success" message={lastOutput} />}

      {page === "detail" && repoPath ? (
        <RepoDetailPage
          currentRepo={currentRepo}
          repoPath={repoPath}
          status={status}
          commits={commits}
          graphLines={graphLines}
          branches={branches}
          remotes={remotes}
          loading={loading}
          busy={busy}
          activeTab={activeTab}
          commitMessage={commitMessage}
          stageAllBeforeCommit={stageAllBeforeCommit}
          checkoutBranch={checkoutBranch}
          createBranch={createBranch}
          stashMessage={stashMessage}
          diffState={diffState}
          onBack={() => setPage("repos")}
          onRefresh={() => void fetchAll(repoPath)}
          onAction={handleAction}
          onHistoryQueryChange={setHistoryQuery}
          onHistoryPage={handleHistoryPage}
          onCommitMessageChange={setCommitMessage}
          onStageAllBeforeCommitChange={setStageAllBeforeCommit}
          onCheckoutBranchChange={setCheckoutBranch}
          onCreateBranchChange={setCreateBranch}
          onStashMessageChange={setStashMessage}
          onCommit={() => void handleCommit()}
          onCheckout={() => void handleCheckout()}
          onTabChange={setActiveTab}
          onStage={handleStage}
          onUnstage={handleUnstage}
          onDiscard={handleDiscard}
          onDiff={handleShowDiff}
          onCloseDiff={() => setDiffState(null)}
        />
      ) : (
        <RepoListPage
          savedRepos={savedRepos}
          inputPath={inputPath}
          busy={busy}
          currentRepoPath={repoPath}
          onInputPathChange={setInputPath}
          onBrowse={() => void handleBrowse()}
          onAddRepo={() => void handleAddRepo()}
          onSelectRepo={(path) => void handleSelectRepo(path)}
          onRemoveRepo={(path) => void handleRemoveRepo(path)}
        />
      )}
    </div>
  );
}
