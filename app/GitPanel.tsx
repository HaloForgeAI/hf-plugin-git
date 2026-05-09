/**
 * Built-in Git Integration panel (Level 1 — DevKit tab).
 *
 * This component is compiled directly into the main HaloForge app bundle
 * (not a separate ESM bundle). It uses the public plugin SDK helpers to
 * dispatch commands to the statically-linked GitPlugin backend.
 */
import { useCallback, useEffect, useState } from "react";
import { invokePlugin, pickHostDirectory } from "@haloforge/plugin-sdk";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Download, Folder, GitBranch, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useGitT } from "./i18n";

function gitInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  return invokePlugin<T>(cmd, args);
}

const LAST_REPO_STORAGE_KEY = "hf-plugin-git:selectedRepoPath";

interface SavedRepo {
  id: string;
  path: string;
  alias: string | null;
  added_at?: string;
}

interface GitStatus {
  repo_root: string;
  branch: string;
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

interface CommandResult {
  success?: boolean;
  output?: string;
}

type GitPage = "repos" | "detail";
type TranslateFn = ReturnType<typeof useGitT>;

function statusPrefix(line: string) { return line.slice(0, 2).trim(); }
function statusFile(line: string) { return line.slice(3); }

function repoLabel(repo: SavedRepo) {
  return repo.alias?.trim() || repo.path.split(/[\\/]/).filter(Boolean).pop() || repo.path;
}

function statusColor(prefix: string) {
  if (prefix === "M") return "text-yellow-400";
  if (prefix === "A") return "text-green-400";
  if (prefix === "D") return "text-red-400";
  if (prefix === "R") return "text-blue-400";
  return "text-zinc-400";
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

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-foreground-secondary/50">
      {label}
      {count !== undefined && (
        <span className="ml-auto rounded bg-background px-1.5 py-0.5 text-[10px] text-foreground-secondary">
          {count}
        </span>
      )}
    </div>
  );
}

function FileEntry({ line }: { line: string }) {
  const prefix = statusPrefix(line);
  const file = statusFile(line);

  return (
    <div className={`flex items-center gap-2 px-3 py-0.5 text-xs font-mono ${statusColor(prefix)}`}>
      <span className="w-4 shrink-0">{prefix || "?"}</span>
      <span className="truncate" title={file}>{file}</span>
    </div>
  );
}

function CommitRow({ commit }: { commit: Commit }) {
  return (
    <div className="flex items-start gap-2 border-b border-border px-3 py-1.5 transition-colors hover:bg-surface/50">
      <code className="mt-0.5 shrink-0 text-xs text-primary">{commit.short}</code>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-foreground" title={commit.message}>{commit.message}</p>
        <p className="mt-0.5 text-[10px] text-foreground-secondary/50">
          {commit.author} · {commit.when}
        </p>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  icon,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

function FeedbackBanner({
  tone,
  message,
}: {
  tone: "error" | "success";
  message: string;
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border px-3 py-2 text-xs",
        tone === "error"
          ? "border-red-500/20 bg-red-500/5 text-red-400"
          : "border-emerald-500/20 bg-emerald-500/5 text-emerald-300",
      )}
    >
      {message}
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
    <div className="mx-auto max-w-4xl space-y-4">
      <section className="rounded-2xl border border-border bg-surface/30 p-5">
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
              if (e.key === "Enter") {
                onAddRepo();
              }
            }}
          />
          <button
            onClick={onBrowse}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground-secondary transition-colors hover:bg-surface hover:text-foreground"
          >
            <Folder size={14} />
            {t("common.browse")}
          </button>
          <button
            onClick={onAddRepo}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus size={14} />
            {t("git.addRepo")}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface/20 p-3">
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
                    "group flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors",
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

                  <button
                    onClick={() => onSelectRepo(repo.path)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground-secondary transition-colors hover:bg-surface hover:text-foreground"
                  >
                    {t("git.openRepo")}
                    <ArrowRight size={12} />
                  </button>
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

function RepoDetailPage({
  currentRepo,
  repoPath,
  status,
  commits,
  branches,
  loading,
  busy,
  activeTab,
  commitMessage,
  checkoutBranch,
  createBranch,
  onBack,
  onRefresh,
  onAction,
  onCommitMessageChange,
  onCheckoutBranchChange,
  onCreateBranchChange,
  onCommit,
  onCheckout,
  onTabChange,
}: {
  currentRepo: SavedRepo | null;
  repoPath: string;
  status: GitStatus | null;
  commits: Commit[];
  branches: BranchInfo | null;
  loading: boolean;
  busy: boolean;
  activeTab: "status" | "log" | "branches";
  commitMessage: string;
  checkoutBranch: string;
  createBranch: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onAction: (cmd: string, label: string, extraArgs?: Record<string, unknown>) => void;
  onCommitMessageChange: (value: string) => void;
  onCheckoutBranchChange: (value: string) => void;
  onCreateBranchChange: (value: boolean) => void;
  onCommit: () => void;
  onCheckout: () => void;
  onTabChange: (tab: "status" | "log" | "branches") => void;
}) {
  const t = useGitT();
  const title = currentRepo
    ? repoLabel(currentRepo)
    : repoPath.split(/[\\/]/).filter(Boolean).pop() || repoPath;

  return (
    <section className="mx-auto flex min-h-[720px] max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-surface/20">
      <div className="border-b border-border p-4">
        <div className="flex flex-wrap items-start gap-3">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground-secondary transition-colors hover:bg-surface hover:text-foreground"
          >
            <ArrowLeft size={13} />
            {t("git.backToRepos")}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <GitBranch size={15} className="text-primary" />
              <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
            </div>
            <p className="mt-1 truncate text-xs text-foreground-secondary/60">{repoPath}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionButton
              label={t("git.action.refresh")}
              onClick={onRefresh}
              disabled={busy}
              icon={<RefreshCw size={13} />}
            />
            <ActionButton
              label={t("git.action.fetch")}
              onClick={() => onAction("git_fetch", t("git.action.fetch"), { remote: "origin", prune: true })}
              disabled={busy}
              icon={<Download size={13} />}
            />
            <ActionButton
              label={t("git.action.pull")}
              onClick={() => onAction("git_pull", t("git.action.pull"), { remote: "origin" })}
              disabled={busy}
              icon={<Download size={13} />}
            />
            <ActionButton
              label={t("git.action.push")}
              onClick={() => onAction("git_push", t("git.action.push"), { remote: "origin" })}
              disabled={busy}
              icon={<Upload size={13} />}
            />
          </div>
        </div>

        {status && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-background px-2.5 py-1 font-medium text-primary">
              {status.branch}
            </span>
            <span
              className={clsx(
                "rounded-full px-2.5 py-1",
                status.is_clean ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-300",
              )}
            >
              {status.is_clean ? t("git.state.clean") : t("git.state.dirty")}
            </span>
            <span className="rounded-full bg-background px-2.5 py-1 text-foreground-secondary">
              {t("git.state.staged", { count: status.staged.length })}
            </span>
            <span className="rounded-full bg-background px-2.5 py-1 text-foreground-secondary">
              {t("git.state.unstaged", { count: status.unstaged.length })}
            </span>
            {(status.ahead > 0 || status.behind > 0) && (
              <span className="rounded-full bg-background px-2.5 py-1 text-foreground-secondary">
                ↑{status.ahead} ↓{status.behind}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-background/70 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-secondary/50">
            {t("git.commitAll")}
          </p>
          <div className="flex gap-2">
            <input
              value={commitMessage}
              onChange={(e) => onCommitMessageChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onCommit();
                }
              }}
              placeholder={t("git.commitMessagePlaceholder")}
              className="flex-1 rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-foreground-secondary/40 outline-none transition-all focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
            />
            <button
              onClick={onCommit}
              disabled={busy}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {t("git.commit")}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-background/70 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-secondary/50">
            {t("git.checkoutBranch")}
          </p>
          <div className="flex gap-2">
            <input
              value={checkoutBranch}
              onChange={(e) => onCheckoutBranchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onCheckout();
                }
              }}
              placeholder={t("git.branchNamePlaceholder")}
              className="flex-1 rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-foreground-secondary/40 outline-none transition-all focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
            />
            <button
              onClick={onCheckout}
              disabled={busy}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {t("git.switchBranch")}
            </button>
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
      </div>

      <div className="flex border-b border-border text-xs">
        {([
          ["status", t("git.tab.status")],
          ["log", t("git.tab.log")],
          ["branches", t("git.tab.branches")],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={clsx(
              "px-4 py-2 transition-colors",
              activeTab === tab
                ? "border-b-2 border-primary text-primary"
                : "text-foreground-secondary/60 hover:text-foreground",
            )}
          >
            {label}
            {tab === "status" && status && !status.is_clean && (
              <span className="ml-1 text-yellow-400">({status.staged.length + status.unstaged.length})</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="flex h-16 items-center justify-center text-xs text-foreground-secondary/40">
            {t("git.loadingRepoData")}
          </div>
        )}

        {!loading && status && activeTab === "status" && (
          <div>
            {status.staged.length > 0 && (
              <>
                <SectionHeader label={t("git.section.staged")} count={status.staged.length} />
                {status.staged.map((line, index) => <FileEntry key={index} line={line} />)}
              </>
            )}
            {status.unstaged.length > 0 && (
              <>
                <SectionHeader label={t("git.section.unstaged")} count={status.unstaged.length} />
                {status.unstaged.map((line, index) => <FileEntry key={index} line={line} />)}
              </>
            )}
            {status.is_clean && (
              <div className="px-3 py-8 text-center text-xs text-foreground-secondary/40">
                {t("git.cleanWorkingTree")}
              </div>
            )}
            {status.last_commit && (
              <div className="border-t border-border px-3 py-2">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-foreground-secondary/40">
                  {t("git.lastCommit")}
                </p>
                <code className="text-xs text-foreground-secondary">{status.last_commit}</code>
              </div>
            )}
          </div>
        )}

        {!loading && activeTab === "log" && (
          <div>
            {commits.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-foreground-secondary/40">
                {t("git.noCommits")}
              </div>
            ) : (
              commits.map((commit) => <CommitRow key={commit.hash} commit={commit} />)
            )}
          </div>
        )}

        {!loading && activeTab === "branches" && branches && (
          <div>
            <SectionHeader label={t("git.branchScope.local")} count={branches.local.length} />
            {branches.local.map((branch) => (
              <button
                key={branch}
                onClick={() => onCheckoutBranchChange(branch)}
                className={clsx(
                  "flex w-full items-center px-4 py-1 text-left text-xs font-mono transition-colors hover:bg-surface/50",
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
                className="flex w-full items-center px-4 py-1 text-left text-xs font-mono text-foreground-secondary/60 transition-colors hover:bg-surface/50 hover:text-foreground-secondary"
              >
                {branch}
              </button>
            ))}
          </div>
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
  const [branches, setBranches] = useState<BranchInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"status" | "log" | "branches">("status");
  const [error, setError] = useState<string | null>(null);
  const [lastOutput, setLastOutput] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [checkoutBranch, setCheckoutBranch] = useState("");
  const [createBranch, setCreateBranch] = useState(false);

  const currentRepo = savedRepos.find((repo) => repo.path === repoPath) ?? null;
  const busy = loading || runningAction !== null;

  const rememberSelectedRepo = useCallback((path: string | null) => {
    try {
      if (path) {
        window.localStorage.setItem(LAST_REPO_STORAGE_KEY, path);
      } else {
        window.localStorage.removeItem(LAST_REPO_STORAGE_KEY);
      }
    } catch {
      // ignore storage failures
    }
  }, []);

  const clearRepoData = useCallback(() => {
    setRepoPath("");
    setStatus(null);
    setCommits([]);
    setBranches(null);
  }, []);

  const loadSavedRepos = useCallback(async () => {
    const result = await gitInvoke<{ repos: SavedRepo[] }>("git_saved_repos");
    setSavedRepos(result.repos);
    return result.repos;
  }, []);

  const fetchAll = useCallback(async (path: string) => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, nextLog, nextBranches] = await Promise.all([
        gitInvoke<GitStatus>("git_status", { path }),
        gitInvoke<{ commits: Commit[] }>("git_log", { path, limit: 40 }),
        gitInvoke<BranchInfo>("git_branches", { path }),
      ]);
      setRepoPath(nextStatus.repo_root || path);
      setInputPath(nextStatus.repo_root || path);
      rememberSelectedRepo(nextStatus.repo_root || path);
      setStatus(nextStatus);
      setCommits(nextLog.commits);
      setBranches(nextBranches);
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
        if (cancelled || repos.length === 0) {
          return;
        }

        let preferredPath: string | null = null;
        try {
          preferredPath = window.localStorage.getItem(LAST_REPO_STORAGE_KEY);
        } catch {
          preferredPath = null;
        }

        const initialRepo = repos.find((repo) => repo.path === preferredPath) ?? repos[0];
        setInputPath(initialRepo.path);
        await fetchAll(initialRepo.path);
        if (!cancelled) {
          setPage("detail");
        }
      } catch (e) {
        if (!cancelled) {
          setError(translateGitMessage(t, e instanceof Error ? e.message : String(e)));
        }
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [fetchAll, loadSavedRepos, t]);

  const handleSelectRepo = useCallback(async (path: string) => {
    setLastOutput(null);
    setInputPath(path);
    setPage("detail");
    await fetchAll(path);
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
      setPage("detail");
    } catch (e) {
      setError(translateGitMessage(t, e instanceof Error ? e.message : String(e)));
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
    setError(null);
    try {
      const result = await gitInvoke<CommandResult>(cmd, { path: repoPath, ...extraArgs });
      setLastOutput(result.output?.trim() || t("git.feedback.actionCompleted", { action: label }));
      afterAction?.();
      await fetchAll(repoPath);
    } catch (e) {
      setError(translateGitMessage(t, e instanceof Error ? e.message : String(e)));
    } finally {
      setRunningAction(null);
    }
  }, [fetchAll, repoPath, t]);

  const handleBrowse = useCallback(async () => {
    try {
      const picked = await pickHostDirectory({
        title: t("git.pickDirectoryTitle"),
      });
      if (picked) {
        setInputPath(picked);
        await handleAddRepo(picked);
      }
    } catch {
      // user cancelled — do nothing
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
      setError(translateGitMessage(t, e instanceof Error ? e.message : String(e)));
    } finally {
      setRunningAction(null);
    }
  }, [clearRepoData, fetchAll, loadSavedRepos, rememberSelectedRepo, repoPath, t]);

  const handleCommit = useCallback(async () => {
    const message = commitMessage.trim();
    if (!message) {
      setError(t("git.error.commitMessageRequired"));
      return;
    }

    await handleAction(
      "git_commit",
      t("git.commit"),
      { message, add_all: true },
      () => setCommitMessage(""),
    );
  }, [commitMessage, handleAction, t]);

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
    <div className="space-y-4">
      {error && <FeedbackBanner tone="error" message={error} />}
      {lastOutput && !error && <FeedbackBanner tone="success" message={lastOutput} />}

      {page === "detail" && repoPath ? (
        <RepoDetailPage
          currentRepo={currentRepo}
          repoPath={repoPath}
          status={status}
          commits={commits}
          branches={branches}
          loading={loading}
          busy={busy}
          activeTab={activeTab}
          commitMessage={commitMessage}
          checkoutBranch={checkoutBranch}
          createBranch={createBranch}
          onBack={() => setPage("repos")}
          onRefresh={() => void fetchAll(repoPath)}
          onAction={(cmd, label, extraArgs) => {
            void handleAction(cmd, label, extraArgs);
          }}
          onCommitMessageChange={setCommitMessage}
          onCheckoutBranchChange={setCheckoutBranch}
          onCreateBranchChange={setCreateBranch}
          onCommit={() => {
            void handleCommit();
          }}
          onCheckout={() => {
            void handleCheckout();
          }}
          onTabChange={setActiveTab}
        />
      ) : (
        <RepoListPage
          savedRepos={savedRepos}
          inputPath={inputPath}
          busy={busy}
          currentRepoPath={repoPath}
          onInputPathChange={setInputPath}
          onBrowse={() => {
            void handleBrowse();
          }}
          onAddRepo={() => {
            void handleAddRepo();
          }}
          onSelectRepo={(path) => {
            void handleSelectRepo(path);
          }}
          onRemoveRepo={(path) => {
            void handleRemoveRepo(path);
          }}
        />
      )}
    </div>
  );
}
