//! IPC command handlers for the Git plugin.

use hf_plugin_api::{PluginContext, PluginError};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

const REPOS_TABLE: &str = "plugin_dev_haloforge_git_repos";

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(target_os = "windows")]
fn hide_windows_command_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn hide_windows_command_window(_command: &mut Command) {}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn run_git(args: &[&str], cwd: &str) -> Result<String, PluginError> {
    let mut command = Command::new("git");
    hide_windows_command_window(&mut command);
    let output = command
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| PluginError::Process(format!("failed to run git: {e}")))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(PluginError::Process(format!("git error: {stderr}")))
    }
}

fn get_path(args: &Value) -> Result<String, PluginError> {
    args["path"]
        .as_str()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(String::from)
        .ok_or_else(|| PluginError::Custom("missing required field: path".into()))
}

fn get_non_empty_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args[key].as_str().map(str::trim).filter(|value| !value.is_empty())
}

fn sql_escape(value: &str) -> String {
    value.replace('\'', "''")
}

fn row_to_json(row: HashMap<String, Value>) -> Value {
    Value::Object(row.into_iter().collect())
}

fn default_repo_alias(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}

fn normalize_existing_directory(path: &str) -> Result<String, PluginError> {
    let trimmed = path.trim();
    let dir = Path::new(trimmed);
    if !dir.exists() {
        return Err(PluginError::NotFound(format!("path not found: {trimmed}")));
    }
    if !dir.is_dir() {
        return Err(PluginError::Custom(format!("path is not a directory: {trimmed}")));
    }

    dir.canonicalize()
        .map(|value| value.to_string_lossy().to_string())
        .map_err(|e| PluginError::Process(format!("failed to resolve path: {e}")))
}

fn resolve_repo_root(path: &str) -> Result<String, PluginError> {
    let normalized_path = normalize_existing_directory(path)?;
    match run_git(&["rev-parse", "--show-toplevel"], &normalized_path) {
        Ok(root) => Ok(root),
        Err(PluginError::Process(message)) if message.contains("not a git repository") => {
            Err(PluginError::Custom("Selected folder is not a Git repository.".into()))
        }
        Err(error) => Err(error),
    }
}

fn get_repo_path(args: &Value) -> Result<String, PluginError> {
    let path = get_path(args)?;
    resolve_repo_root(&path)
}

// ─── Saved repos ─────────────────────────────────────────────────────────────

pub fn git_saved_repos(_args: Value, ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let mut rows = ctx
        .db()
        .query(&format!("SELECT * FROM {REPOS_TABLE}"), &[])?;

    rows.sort_by(|left, right| {
        let left_added = left
            .get("added_at")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right_added = right
            .get("added_at")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let left_alias = left
            .get("alias")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right_alias = right
            .get("alias")
            .and_then(Value::as_str)
            .unwrap_or_default();

        right_added
            .cmp(left_added)
            .then_with(|| left_alias.cmp(right_alias))
    });

    Ok(json!({
        "repos": rows.into_iter().map(row_to_json).collect::<Vec<_>>()
    }))
}

pub fn git_add_repo(args: Value, ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let input_path = get_path(&args)?;
    let repo_root = resolve_repo_root(&input_path).map_err(|error| match error {
        PluginError::Custom(message) if message == "Selected folder is not a Git repository." => {
            PluginError::Custom("Selected folder is not a Git repository and cannot be added.".into())
        }
        other => other,
    })?;
    let repo_id = repo_root.clone();
    let alias = get_non_empty_str(&args, "alias")
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| default_repo_alias(&repo_root));

    let quoted_path = sql_escape(&repo_root);
    let quoted_id = sql_escape(&repo_id);
    let quoted_alias = sql_escape(&alias);
    let update_sql = format!(
        "UPDATE {REPOS_TABLE} SET \"alias\" = '{quoted_alias}' WHERE \"path\" = '{quoted_path}' OR \"id\" = '{quoted_id}'"
    );
    let updated = ctx.db().execute(&update_sql, &[])?;

    if updated == 0 {
        let insert_sql = format!(
            "INSERT INTO {REPOS_TABLE} VALUES ('{quoted_id}', '{quoted_path}', '{quoted_alias}', CURRENT_TIMESTAMP)"
        );
        ctx.db().execute(&insert_sql, &[])?;
    }

    Ok(json!({
        "repo": {
            "id": repo_id,
            "path": repo_root,
            "alias": alias,
        }
    }))
}

pub fn git_remove_repo(args: Value, ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_path(&args)?;
    let quoted_path = sql_escape(path.trim());
    let sql = format!(
        "DELETE FROM {REPOS_TABLE} WHERE \"path\" = '{quoted_path}' OR \"id\" = '{quoted_path}'"
    );
    ctx.db().execute(&sql, &[])?;
    Ok(json!({ "success": true }))
}

// ─── git_status ───────────────────────────────────────────────────────────────

pub fn git_status(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;

    let branch = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], &path)
        .unwrap_or_else(|_| "unknown".into());

    let status_raw = run_git(&["status", "--porcelain"], &path).unwrap_or_default();

    let staged: Vec<String> = status_raw
        .lines()
        .filter(|l| !l.starts_with("??") && !l.starts_with(' '))
        .map(|l| l.to_string())
        .collect();

    let unstaged: Vec<String> = status_raw
        .lines()
        .filter(|l| l.starts_with(' ') || l.starts_with('?'))
        .map(|l| l.to_string())
        .collect();

    // ahead/behind
    let ahead_behind = run_git(
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        &path,
    )
    .ok();
    let (ahead, behind) = if let Some(ab) = ahead_behind {
        let parts: Vec<&str> = ab.split_whitespace().collect();
        (
            parts.first().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0),
            parts.get(1).and_then(|s| s.parse::<i64>().ok()).unwrap_or(0),
        )
    } else {
        (0, 0)
    };

    let last_commit = run_git(&["log", "-1", "--pretty=format:%h %s", "--"], &path)
        .unwrap_or_default();

    Ok(json!({
        "repo_root": path,
        "branch": branch,
        "staged": staged,
        "unstaged": unstaged,
        "ahead": ahead,
        "behind": behind,
        "last_commit": last_commit,
        "is_clean": staged.is_empty() && unstaged.is_empty(),
    }))
}

// ─── git_log ──────────────────────────────────────────────────────────────────

pub fn git_log(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;
    let limit = args["limit"].as_u64().unwrap_or(20);

    let raw = run_git(
        &[
            "log",
            &format!("-{limit}"),
            "--pretty=format:%H|%h|%an|%ae|%ar|%s",
            "--",
        ],
        &path,
    )?;

    let commits: Vec<Value> = raw
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.splitn(6, '|').collect();
            json!({
                "hash":    parts.first().copied().unwrap_or(""),
                "short":   parts.get(1).copied().unwrap_or(""),
                "author":  parts.get(2).copied().unwrap_or(""),
                "email":   parts.get(3).copied().unwrap_or(""),
                "when":    parts.get(4).copied().unwrap_or(""),
                "message": parts.get(5).copied().unwrap_or(""),
            })
        })
        .collect();

    Ok(json!({ "commits": commits }))
}

// ─── git_branches ─────────────────────────────────────────────────────────────

pub fn git_branches(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;

    let current = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], &path)
        .unwrap_or_default();

    let local_raw = run_git(&["branch", "--format=%(refname:short)"], &path)?;
    let local: Vec<String> = local_raw.lines().map(|l| l.trim().to_string()).collect();

    let remote_raw =
        run_git(&["branch", "-r", "--format=%(refname:short)"], &path).unwrap_or_default();
    let remote: Vec<String> = remote_raw
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.contains("HEAD"))
        .collect();

    Ok(json!({
        "current": current,
        "local":  local,
        "remote": remote,
    }))
}

// ─── git_pull ─────────────────────────────────────────────────────────────────

pub fn git_pull(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;
    let remote = get_non_empty_str(&args, "remote").unwrap_or("origin");
    let branch = get_non_empty_str(&args, "branch");
    let rebase = args["rebase"].as_bool().unwrap_or(false);

    let mut git_args = vec!["pull"];
    if rebase { git_args.push("--rebase"); }
    git_args.push(remote);
    if let Some(branch) = branch {
        git_args.push(branch);
    }

    let output = run_git(&git_args, &path)?;
    Ok(json!({ "success": true, "output": output }))
}

// ─── git_fetch ────────────────────────────────────────────────────────────────

pub fn git_fetch(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;
    let remote = get_non_empty_str(&args, "remote").unwrap_or("origin");
    let prune = args["prune"].as_bool().unwrap_or(true);

    let mut git_args = vec!["fetch", remote];
    if prune { git_args.push("--prune"); }

    let output = run_git(&git_args, &path)?;
    Ok(json!({ "success": true, "output": output }))
}

// ─── git_push ─────────────────────────────────────────────────────────────────

pub fn git_push(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;
    let remote = get_non_empty_str(&args, "remote").unwrap_or("origin");
    let branch = get_non_empty_str(&args, "branch");
    let set_upstream = args["set_upstream"].as_bool().unwrap_or(false);

    let mut git_args = vec!["push"];
    if set_upstream {
        git_args.push("--set-upstream");
    }
    git_args.push(remote);
    if let Some(branch) = branch {
        git_args.push(branch);
    }

    let output = run_git(&git_args, &path)?;
    Ok(json!({ "success": true, "output": output }))
}

// ─── git_commit ───────────────────────────────────────────────────────────────

pub fn git_commit(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;
    let message = get_non_empty_str(&args, "message")
        .ok_or_else(|| PluginError::Custom("missing required field: message".into()))?;
    let add_all = args["add_all"].as_bool().unwrap_or(true);

    if add_all {
        run_git(&["add", "-A"], &path)?;
    }

    let status = run_git(&["status", "--porcelain"], &path).unwrap_or_default();
    if status.is_empty() {
        return Ok(json!({
            "success": true,
            "output": "nothing to commit, working tree clean"
        }));
    }

    let output = run_git(&["commit", "-m", message], &path)?;
    Ok(json!({ "success": true, "output": output }))
}

// ─── git_checkout ─────────────────────────────────────────────────────────────

pub fn git_checkout(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;
    let branch = get_non_empty_str(&args, "branch")
        .ok_or_else(|| PluginError::Custom("missing required field: branch".into()))?;
    let create = args["create"].as_bool().unwrap_or(false);

    let git_args: Vec<&str> = if create {
        vec!["checkout", "-b", branch]
    } else {
        vec!["checkout", branch]
    };

    let output = run_git(&git_args, &path)?;
    Ok(json!({ "success": true, "output": output }))
}
