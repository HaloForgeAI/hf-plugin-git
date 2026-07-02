import { useCallback } from "react";

const en = {
  "common.browse": "Browse",

  "git.page.repositories": "Repositories",
  "git.page.repositoriesDesc": "Manage saved repositories here, then open a repository workspace for changes, history, branches, and sync.",
  "git.repoPathPlaceholder": "Repository path...",
  "git.addRepo": "Add Repo",
  "git.emptySaved": "No saved Git repositories yet. Added folders are validated before they are stored.",
  "git.tag.lastOpened": "last opened",
  "git.openRepo": "Open",
  "git.removeRepo": "Remove saved repository",
  "git.backToRepos": "Repositories",

  "git.action.refresh": "Refresh",
  "git.action.fetch": "Fetch",
  "git.action.pull": "Pull",
  "git.action.push": "Push",
  "git.action.diff": "Diff",
  "git.action.stage": "Stage",
  "git.action.unstage": "Unstage",
  "git.action.discard": "Discard",
  "git.action.stageAll": "Stage all",
  "git.action.unstageAll": "Unstage all",
  "git.action.stash": "Stash",
  "git.action.stashWorktree": "Stash worktree",
  "git.action.closeDiff": "Close",

  "git.state.clean": "clean",
  "git.state.dirty": "dirty",
  "git.state.staged": "staged {count}",
  "git.state.unstaged": "worktree {count}",

  "git.tab.overview": "Overview",
  "git.tab.changes": "Changes",
  "git.tab.history": "History",
  "git.tab.branches": "Branches",
  "git.tab.sync": "Sync",

  "git.metric.branch": "Branch",
  "git.metric.changedFiles": "Changed files",
  "git.metric.sync": "Sync",
  "git.metric.remotes": "Remotes",

  "git.label.staged": "staged",
  "git.label.worktree": "worktree",
  "git.label.defaultRemote": "default",

  "git.section.quickActions": "Quick Actions",
  "git.section.recentChanges": "Recent Changes",
  "git.section.staged": "Staged",
  "git.section.worktree": "Worktree",
  "git.section.remotes": "Remotes",
  "git.section.syncActions": "Sync Actions",

  "git.commitStaged": "Commit Staged Changes",
  "git.commitMessagePlaceholder": "Commit message...",
  "git.commit": "Commit",
  "git.stageAllBeforeCommit": "Stage all changes before commit",
  "git.checkoutBranch": "Checkout Branch",
  "git.branchNamePlaceholder": "Branch name...",
  "git.switchBranch": "Switch",
  "git.createBranchIfMissing": "Create branch if it does not exist",
  "git.branchScope.local": "Local",
  "git.branchScope.remote": "Remote",
  "git.stashMessagePlaceholder": "Stash message...",

  "git.loadingRepoData": "Loading repository data...",
  "git.loadingDiff": "Loading diff...",
  "git.diff.empty": "No diff output for this selection.",
  "git.cleanWorkingTree": "Nothing to commit. Working tree clean.",
  "git.lastCommit": "Last commit",
  "git.noCommits": "No commits found.",
  "git.noStagedChanges": "No staged changes.",
  "git.noWorktreeChanges": "No unstaged or untracked changes.",
  "git.remote.none": "No remotes configured.",

  "git.feedback.savedRepo": "Saved repository: {name}",
  "git.feedback.removedRepo": "Removed repository: {path}",
  "git.feedback.actionCompleted": "{action} completed.",

  "git.confirm.discard": "Discard local changes in {path}? This cannot be undone.",
  "git.error.commitMessageRequired": "Commit message is required.",
  "git.error.branchRequired": "Branch name is required.",
  "git.error.noStagedChanges": "Stage files first, or enable stage-all before commit.",
  "git.error.notGitRepo": "Selected folder is not a Git repository.",
  "git.error.notGitRepoAdd": "Selected folder is not a Git repository and cannot be added.",
  "git.error.missingPath": "Repository path is required.",
  "git.error.pathNotFound": "Path not found: {path}",
  "git.error.notDirectory": "Path is not a directory: {path}",
  "git.pickDirectoryTitle": "Select Git Repository",
} as const;

type GitTranslationKey = keyof typeof en;

const zh: Record<GitTranslationKey, string> = {
  "common.browse": "浏览",

  "git.page.repositories": "仓库",
  "git.page.repositoriesDesc": "管理已保存仓库，再进入单个仓库工作区处理改动、历史、分支和同步。",
  "git.repoPathPlaceholder": "仓库路径...",
  "git.addRepo": "添加仓库",
  "git.emptySaved": "还没有保存任何 Git 仓库。添加时会先校验目录是否真的是 Git 仓库。",
  "git.tag.lastOpened": "上次打开",
  "git.openRepo": "打开",
  "git.removeRepo": "移除已保存仓库",
  "git.backToRepos": "仓库列表",

  "git.action.refresh": "刷新",
  "git.action.fetch": "获取",
  "git.action.pull": "拉取",
  "git.action.push": "推送",
  "git.action.diff": "Diff",
  "git.action.stage": "暂存",
  "git.action.unstage": "取消暂存",
  "git.action.discard": "丢弃",
  "git.action.stageAll": "全部暂存",
  "git.action.unstageAll": "全部取消暂存",
  "git.action.stash": "贮藏",
  "git.action.stashWorktree": "贮藏工作区",
  "git.action.closeDiff": "关闭",

  "git.state.clean": "干净",
  "git.state.dirty": "有改动",
  "git.state.staged": "已暂存 {count}",
  "git.state.unstaged": "工作区 {count}",

  "git.tab.overview": "概览",
  "git.tab.changes": "改动",
  "git.tab.history": "历史",
  "git.tab.branches": "分支",
  "git.tab.sync": "同步",

  "git.metric.branch": "分支",
  "git.metric.changedFiles": "改动文件",
  "git.metric.sync": "同步状态",
  "git.metric.remotes": "远端",

  "git.label.staged": "已暂存",
  "git.label.worktree": "工作区",
  "git.label.defaultRemote": "默认",

  "git.section.quickActions": "快捷操作",
  "git.section.recentChanges": "最近改动",
  "git.section.staged": "已暂存",
  "git.section.worktree": "工作区",
  "git.section.remotes": "远端",
  "git.section.syncActions": "同步操作",

  "git.commitStaged": "提交已暂存改动",
  "git.commitMessagePlaceholder": "提交说明...",
  "git.commit": "提交",
  "git.stageAllBeforeCommit": "提交前自动暂存全部改动",
  "git.checkoutBranch": "切换分支",
  "git.branchNamePlaceholder": "分支名称...",
  "git.switchBranch": "切换",
  "git.createBranchIfMissing": "分支不存在时自动创建",
  "git.branchScope.local": "本地",
  "git.branchScope.remote": "远程",
  "git.stashMessagePlaceholder": "贮藏说明...",

  "git.loadingRepoData": "正在加载仓库数据...",
  "git.loadingDiff": "正在加载 Diff...",
  "git.diff.empty": "当前选择没有 Diff 输出。",
  "git.cleanWorkingTree": "没有可提交内容，工作区是干净的。",
  "git.lastCommit": "最近一次提交",
  "git.noCommits": "没有找到提交记录。",
  "git.noStagedChanges": "没有已暂存改动。",
  "git.noWorktreeChanges": "没有未暂存或未跟踪改动。",
  "git.remote.none": "未配置远端。",

  "git.feedback.savedRepo": "已保存仓库：{name}",
  "git.feedback.removedRepo": "已移除仓库：{path}",
  "git.feedback.actionCompleted": "{action} 已完成。",

  "git.confirm.discard": "丢弃 {path} 的本地改动？此操作无法撤销。",
  "git.error.commitMessageRequired": "提交说明不能为空。",
  "git.error.branchRequired": "分支名称不能为空。",
  "git.error.noStagedChanges": "请先暂存文件，或开启提交前自动暂存全部改动。",
  "git.error.notGitRepo": "所选文件夹不是 Git 仓库。",
  "git.error.notGitRepoAdd": "所选文件夹不是 Git 仓库，无法添加。",
  "git.error.missingPath": "仓库路径不能为空。",
  "git.error.pathNotFound": "路径不存在：{path}",
  "git.error.notDirectory": "该路径不是目录：{path}",
  "git.pickDirectoryTitle": "选择 Git 仓库",
};

const translations = { en, zh };

export function useGitT() {
  const locale = getLocale();
  const dict = translations[locale];

  return useCallback((key: GitTranslationKey, vars?: Record<string, string | number>): string => {
    const raw = dict[key] ?? en[key] ?? key;
    if (!vars) return raw;
    return Object.entries(vars).reduce<string>(
      (acc, [name, value]) => acc.split(`{${name}}`).join(String(value)),
      raw,
    );
  }, [dict]);
}

export type { GitTranslationKey };

function getLocale(): "en" | "zh" {
  const stored = window.localStorage.getItem("hf:locale");
  if (stored === "zh" || stored === "en") return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}
