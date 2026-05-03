import { useCallback } from "react";

const en = {
  "common.browse": "Browse",
  "git.page.repositories": "Repositories",
  "git.page.repositoriesDesc": "Manage saved repositories here, then open one repository detail page for status, commits, branches, and quick actions.",
  "git.repoPathPlaceholder": "Repository path…",
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
  "git.state.clean": "clean",
  "git.state.dirty": "dirty",
  "git.state.staged": "staged {count}",
  "git.state.unstaged": "unstaged {count}",
  "git.commitAll": "Commit All Changes",
  "git.commitMessagePlaceholder": "Commit message…",
  "git.commit": "Commit",
  "git.checkoutBranch": "Checkout Branch",
  "git.branchNamePlaceholder": "Branch name…",
  "git.switchBranch": "Switch",
  "git.createBranchIfMissing": "Create branch if it does not exist",
  "git.tab.status": "Status",
  "git.tab.log": "Log",
  "git.tab.branches": "Branches",
  "git.loadingRepoData": "Loading repository data…",
  "git.section.staged": "Staged",
  "git.section.unstaged": "Unstaged / Untracked",
  "git.cleanWorkingTree": "Nothing to commit — working tree clean.",
  "git.lastCommit": "Last commit",
  "git.noCommits": "No commits found.",
  "git.branchScope.local": "Local",
  "git.branchScope.remote": "Remote",
  "git.feedback.savedRepo": "Saved repository: {name}",
  "git.feedback.removedRepo": "Removed repository: {path}",
  "git.feedback.actionCompleted": "{action} completed.",
  "git.error.commitMessageRequired": "Commit message is required.",
  "git.error.branchRequired": "Branch name is required.",
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
  "git.page.repositoriesDesc": "先管理已保存仓库，再进入单个仓库详情页查看状态、提交记录、分支和快捷操作。",
  "git.repoPathPlaceholder": "仓库路径…",
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
  "git.state.clean": "干净",
  "git.state.dirty": "有改动",
  "git.state.staged": "已暂存 {count}",
  "git.state.unstaged": "未暂存 {count}",
  "git.commitAll": "提交全部改动",
  "git.commitMessagePlaceholder": "提交说明…",
  "git.commit": "提交",
  "git.checkoutBranch": "切换分支",
  "git.branchNamePlaceholder": "分支名称…",
  "git.switchBranch": "切换",
  "git.createBranchIfMissing": "分支不存在时自动创建",
  "git.tab.status": "状态",
  "git.tab.log": "日志",
  "git.tab.branches": "分支",
  "git.loadingRepoData": "正在加载仓库数据…",
  "git.section.staged": "已暂存",
  "git.section.unstaged": "未暂存 / 未跟踪",
  "git.cleanWorkingTree": "没有可提交内容，工作区是干净的。",
  "git.lastCommit": "最近一次提交",
  "git.noCommits": "没有找到提交记录。",
  "git.branchScope.local": "本地",
  "git.branchScope.remote": "远程",
  "git.feedback.savedRepo": "已保存仓库：{name}",
  "git.feedback.removedRepo": "已移除仓库：{path}",
  "git.feedback.actionCompleted": "{action} 已完成。",
  "git.error.commitMessageRequired": "提交说明不能为空。",
  "git.error.branchRequired": "分支名称不能为空。",
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
