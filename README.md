# hf-plugin-git — Git Integration

A built-in Level 1 plugin that provides Git repository management directly inside the DevKit module.

## Features

- **Saved repositories** — persist previously opened repositories and restore them inside DevKit
- **Repository validation** — reject non-Git folders with a clear error before adding them
- **Status** — view staged, unstaged, and untracked files with color-coded prefixes
- **Log** — browse the last 40 commits with author and timestamp
- **Branches** — list local and remote branches, with current branch highlighted
- **Quick actions** — fetch, pull, push, commit, and checkout directly from the panel
- **Directory picker** — browse for a repository instead of typing the path

## Plugin levels

| Level | What it provides |
|-------|-----------------|
| 1 | Adds a **Git** tab to the DevKit module |
| 4 | Registers workflow step types: `git_pull`, `git_fetch`, `git_commit`, `git_checkout` |

## Structure

```
hf-plugin-git/
├── backend/          # Rust crate — packaged as the native plugin backend
│   └── src/
│       ├── lib.rs              # Plugin entry point, IPC command registration
│       ├── commands.rs         # repo persistence + status/log/branch/action commands
│       └── workflow_steps.rs   # Workflow step executor
├── app/              # React UI packaged as the plugin frontend
│   └── GitPanel.tsx            # Full panel UI
└── manifest.json     # Plugin manifest
```

## Packaging

This repository builds independently from the main HaloForge app. The backend uses the published
`haloforge-plugin-api` crate, and the frontend uses `@haloforge/plugin-sdk`.

Local package check:

```bash
npx @haloforge/plugin-pack@0.2.11 check .
npx @haloforge/plugin-pack@0.2.11 pack . --release --out dist/plugin-release
```

GitHub release packaging uses `.github/workflows/plugin-release.yml` and the public `/plugin-pack` npm package. Set `HF_ADMIN_TOKEN` to submit generated catalog metadata to the production plugin catalog.

## IPC commands

All plugin backend commands are dispatched through `invokePlugin()` from `@haloforge/plugin-sdk`:

| Command | Args | Returns |
|---------|------|---------|
| `git_saved_repos` | `{}` | `{ repos: SavedRepo[] }` |
| `git_add_repo` | `{ path, alias? }` | `{ repo: SavedRepo }` |
| `git_remove_repo` | `{ path }` | `{ success: true }` |
| `git_status` | `{ path }` | `GitStatus` |
| `git_log` | `{ path, limit? }` | `{ commits: Commit[] }` |
| `git_branches` | `{ path }` | `BranchInfo` |
| `git_pull` | `{ path, remote? }` | `{}` |
| `git_fetch` | `{ path, remote?, prune? }` | `{}` |
| `git_push` | `{ path, remote?, branch?, set_upstream? }` | `{}` |
| `git_commit` | `{ path, message, add_all? }` | `{}` |
| `git_checkout` | `{ path, branch, create? }` | `{}` |

## Workflow step types

- `dev.haloforge.git:git_pull` — Pull latest changes from remote
- `dev.haloforge.git:git_fetch` — Fetch remote tracking branches
- `dev.haloforge.git:git_commit` — Stage all and commit
- `dev.haloforge.git:git_checkout` — Switch branch
