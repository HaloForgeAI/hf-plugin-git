use hf_plugin_api::{
    HaloForgePlugin, IpcRegistrar, LogLevel, PluginContext, PluginError, PluginMetadata,
    WorkflowStepTypeDefinition, PLUGIN_ABI_VERSION,
};
use serde_json::Value;

mod commands;
mod workflow_steps;

// ─── Plugin struct ────────────────────────────────────────────────────────────

pub struct GitPlugin;

impl GitPlugin {
    pub fn new() -> Self {
        Self
    }
}

impl Default for GitPlugin {
    fn default() -> Self {
        Self::new()
    }
}

// ─── HaloForgePlugin impl ─────────────────────────────────────────────────────

impl HaloForgePlugin for GitPlugin {
    fn metadata(&self) -> PluginMetadata {
        PluginMetadata {
            id: "dev.haloforge.git".into(),
            name: "Git Integration".into(),
            version: "1.1.2".into(),
            description: "Git branch, status, and log inside DevKit.".into(),
            author: "HaloForge Team".into(),
            abi_version: PLUGIN_ABI_VERSION,
        }
    }

    fn on_load(
        &mut self,
        ctx: &dyn PluginContext,
        ipc: &mut dyn IpcRegistrar,
    ) -> Result<(), PluginError> {
        // Create plugin-owned table for tracking repo configurations
        ctx.db().create_table(
            "repos",
            r#"
            id         TEXT PRIMARY KEY,
            path       TEXT NOT NULL UNIQUE,
            alias      TEXT,
            added_at   TEXT NOT NULL
            "#,
        )?;

        // ── Register IPC commands ──────────────────────────────────────────
        ipc.register("git_saved_repos", Box::new(commands::git_saved_repos))?;
        ipc.register("git_add_repo", Box::new(commands::git_add_repo))?;
        ipc.register("git_remove_repo", Box::new(commands::git_remove_repo))?;
        ipc.register("git_status", Box::new(commands::git_status))?;
        ipc.register("git_log", Box::new(commands::git_log))?;
        ipc.register("git_graph", Box::new(commands::git_graph))?;
        ipc.register("git_branches", Box::new(commands::git_branches))?;
        ipc.register("git_remotes", Box::new(commands::git_remotes))?;
        ipc.register("git_pull", Box::new(commands::git_pull))?;
        ipc.register("git_fetch", Box::new(commands::git_fetch))?;
        ipc.register("git_push", Box::new(commands::git_push))?;
        ipc.register("git_commit", Box::new(commands::git_commit))?;
        ipc.register("git_checkout", Box::new(commands::git_checkout))?;
        ipc.register("git_stage", Box::new(commands::git_stage))?;
        ipc.register("git_unstage", Box::new(commands::git_unstage))?;
        ipc.register("git_discard", Box::new(commands::git_discard))?;
        ipc.register("git_diff", Box::new(commands::git_diff))?;
        ipc.register("git_stash", Box::new(commands::git_stash))?;

        // ── Register workflow step types ───────────────────────────────────
        ipc.register_workflow_step_type(WorkflowStepTypeDefinition {
            type_id: "git_pull".into(),
            display_name: "Git: Pull".into(),
            description: "Run `git pull` in the specified directory.".into(),
            icon: "GitPullRequest".into(),
            category: "Source Control".into(),
            config_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "title": "Repository path",
                        "description": "Absolute path to the git repo (supports {{VARIABLE}} substitution)"
                    },
                    "remote": { "type": "string", "title": "Remote", "default": "origin" },
                    "branch": { "type": "string", "title": "Branch (leave empty for current)", "default": "" },
                    "rebase": { "type": "boolean", "title": "Rebase instead of merge (--rebase)", "default": false }
                },
                "required": ["path"]
            }),
        })?;

        ipc.register_workflow_step_type(WorkflowStepTypeDefinition {
            type_id: "git_fetch".into(),
            display_name: "Git: Fetch".into(),
            description: "Run `git fetch` to update remote tracking branches.".into(),
            icon: "RefreshCw".into(),
            category: "Source Control".into(),
            config_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path":    { "type": "string", "title": "Repository path" },
                    "remote":  { "type": "string", "title": "Remote", "default": "origin" },
                    "prune":   { "type": "boolean", "title": "Prune deleted remote branches (--prune)", "default": true }
                },
                "required": ["path"]
            }),
        })?;

        ipc.register_workflow_step_type(WorkflowStepTypeDefinition {
            type_id: "git_commit".into(),
            display_name: "Git: Commit".into(),
            description: "Stage all changes and create a commit.".into(),
            icon: "GitCommitHorizontal".into(),
            category: "Source Control".into(),
            config_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path":    { "type": "string", "title": "Repository path" },
                    "message": { "type": "string", "title": "Commit message" },
                    "add_all": { "type": "boolean", "title": "Stage all changes first (git add -A)", "default": true }
                },
                "required": ["path", "message"]
            }),
        })?;

        ipc.register_workflow_step_type(WorkflowStepTypeDefinition {
            type_id: "git_checkout".into(),
            display_name: "Git: Checkout".into(),
            description: "Switch to a specific branch.".into(),
            icon: "GitBranch".into(),
            category: "Source Control".into(),
            config_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path":   { "type": "string", "title": "Repository path" },
                    "branch": { "type": "string", "title": "Branch name" },
                    "create": { "type": "boolean", "title": "Create branch if it does not exist (-b)", "default": false }
                },
                "required": ["path", "branch"]
            }),
        })?;

        ctx.log(LogLevel::Info, "Git Integration plugin loaded");
        Ok(())
    }

    fn on_unload(&mut self) -> Result<(), PluginError> {
        Ok(())
    }

    fn execute_workflow_step(
        &mut self,
        step_type: &str,
        config: Value,
        ctx: &dyn PluginContext,
    ) -> Result<Value, PluginError> {
        workflow_steps::execute(step_type, config, ctx)
    }
}

// declare_plugin! is intentionally omitted for built-in plugins:
// they are registered via constructor function pointers (no dlopen needed)
// and the #[no_mangle] exports would clash with other built-in rlibs on MSVC.
hf_plugin_api::declare_plugin!(GitPlugin, GitPlugin::new);
