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
    run_git_with_success_codes(args, cwd, &[0])
}

fn run_git_with_success_codes(
    args: &[&str],
    cwd: &str,
    success_codes: &[i32],
) -> Result<String, PluginError> {
    let mut command = Command::new("git");
    hide_windows_command_window(&mut command);
    let output = command
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| PluginError::Process(format!("failed to run git: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let status_code = output.status.code().unwrap_or(-1);

    if success_codes.contains(&status_code) {
        Ok(join_command_output(&stdout, &stderr))
    } else {
        let message = join_command_output(&stdout, &stderr);
        Err(PluginError::Process(format!("git error: {message}")))
    }
}

fn run_git_owned(args: &[String], cwd: &str) -> Result<String, PluginError> {
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    run_git(&refs, cwd)
}

fn join_command_output(stdout: &str, stderr: &str) -> String {
    match (stdout.trim(), stderr.trim()) {
        ("", "") => String::new(),
        (stdout, "") => stdout.to_string(),
        ("", stderr) => stderr.to_string(),
        (stdout, stderr) => format!("{stdout}\n{stderr}"),
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
    args[key]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn get_string_list(args: &Value, key: &str) -> Vec<String> {
    args[key]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
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
        return Err(PluginError::Custom(format!(
            "path is not a directory: {trimmed}"
        )));
    }

    dir.canonicalize()
        .map(|value| value.to_string_lossy().to_string())
        .map_err(|e| PluginError::Process(format!("failed to resolve path: {e}")))
}

fn resolve_repo_root(path: &str) -> Result<String, PluginError> {
    let normalized_path = normalize_existing_directory(path)?;
    match run_git(&["rev-parse", "--show-toplevel"], &normalized_path) {
        Ok(root) => Ok(root),
        Err(PluginError::Process(message)) if message.contains("not a git repository") => Err(
            PluginError::Custom("Selected folder is not a Git repository.".into()),
        ),
        Err(error) => Err(error),
    }
}

fn get_repo_path(args: &Value) -> Result<String, PluginError> {
    let path = get_path(args)?;
    resolve_repo_root(&path)
}

fn parse_status_line(line: &str) -> Option<Value> {
    if line.len() < 3 {
        return None;
    }

    let code = line.get(0..2).unwrap_or("").to_string();
    let index = code.chars().next().unwrap_or(' ');
    let worktree = code.chars().nth(1).unwrap_or(' ');
    let mut file_path = line.get(3..).unwrap_or("").trim().to_string();
    let mut original_path = String::new();

    if matches!(index, 'R' | 'C') {
        if let Some((from, to)) = file_path.clone().split_once(" -> ") {
            original_path = from.trim().to_string();
            file_path = to.trim().to_string();
        }
    }

    let untracked = index == '?' && worktree == '?';
    let staged = !untracked && index != ' ';
    let unstaged = untracked || worktree != ' ';

    Some(json!({
        "path": file_path,
        "original_path": original_path,
        "code": code,
        "index": index.to_string(),
        "worktree": worktree.to_string(),
        "staged": staged,
        "unstaged": unstaged,
        "untracked": untracked,
    }))
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
            PluginError::Custom(
                "Selected folder is not a Git repository and cannot be added.".into(),
            )
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

    let branch =
        run_git(&["rev-parse", "--abbrev-ref", "HEAD"], &path).unwrap_or_else(|_| "unknown".into());

    let status_raw = run_git(&["status", "--porcelain"], &path).unwrap_or_default();
    let changes: Vec<Value> = status_raw
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(parse_status_line)
        .collect();

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
            parts
                .first()
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(0),
            parts
                .get(1)
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(0),
        )
    } else {
        (0, 0)
    };

    let last_commit =
        run_git(&["log", "-1", "--pretty=format:%h %s", "--"], &path).unwrap_or_default();
    let is_clean = staged.is_empty() && unstaged.is_empty();

    Ok(json!({
        "repo_root": path,
        "branch": branch,
        "changes": changes,
        "staged": staged,
        "unstaged": unstaged,
        "ahead": ahead,
        "behind": behind,
        "last_commit": last_commit,
        "is_clean": is_clean,
    }))
}

// ─── git_log ──────────────────────────────────────────────────────────────────

pub fn git_log(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;
    let limit = args["limit"].as_u64().unwrap_or(40).clamp(1, 200) as usize;
    let offset = args["offset"].as_u64().unwrap_or(0) as usize;
    let query = get_non_empty_str(&args, "query")
        .map(str::to_lowercase)
        .unwrap_or_default();

    let scan_limit = if query.is_empty() {
        limit + 1
    } else {
        ((offset + limit + 1) * 4).clamp(200, 2000)
    };

    let mut git_args = vec![
        "log".to_string(),
        format!("-{scan_limit}"),
        "--pretty=format:%H|%h|%an|%ae|%ar|%s".to_string(),
    ];
    if query.is_empty() && offset > 0 {
        git_args.push(format!("--skip={offset}"));
    }
    git_args.push("--".to_string());

    let raw = run_git_owned(&git_args, &path)?;

    let mut commits: Vec<Value> = raw
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(6, '|').collect();
            let commit = json!({
                "hash":    parts.first().copied().unwrap_or(""),
                "short":   parts.get(1).copied().unwrap_or(""),
                "author":  parts.get(2).copied().unwrap_or(""),
                "email":   parts.get(3).copied().unwrap_or(""),
                "when":    parts.get(4).copied().unwrap_or(""),
                "message": parts.get(5).copied().unwrap_or(""),
            });

            if query.is_empty() || commit_matches_query(&commit, &query) {
                Some(commit)
            } else {
                None
            }
        })
        .collect();

    if !query.is_empty() && offset > 0 {
        commits = commits.into_iter().skip(offset).collect();
    }

    let has_more = commits.len() > limit;
    commits.truncate(limit);

    Ok(json!({
        "commits": commits,
        "limit": limit,
        "offset": offset,
        "has_more": has_more,
    }))
}

fn commit_matches_query(commit: &Value, query: &str) -> bool {
    ["hash", "short", "author", "email", "message", "when"]
        .iter()
        .filter_map(|key| commit[*key].as_str())
        .any(|value| value.to_lowercase().contains(query))
}

// ─── git_graph ────────────────────────────────────────────────────────────────

pub fn git_graph(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;
    let limit = args["limit"].as_u64().unwrap_or(80).clamp(1, 300);
    let raw = run_git(
        &[
            "log",
            "--graph",
            "--decorate",
            "--oneline",
            "--all",
            &format!("-{limit}"),
        ],
        &path,
    )
    .unwrap_or_default();

    Ok(json!({
        "lines": raw.lines().map(str::to_string).collect::<Vec<_>>()
    }))
}

// ─── git_branches ─────────────────────────────────────────────────────────────

pub fn git_branches(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;

    let current = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], &path).unwrap_or_default();

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

// ─── git_remotes ──────────────────────────────────────────────────────────────

pub fn git_remotes(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;
    let raw = run_git(&["remote", "-v"], &path).unwrap_or_default();
    let mut remotes: HashMap<String, (String, String)> = HashMap::new();

    for line in raw.lines() {
        let mut parts = line.split_whitespace();
        let Some(name) = parts.next() else { continue };
        let Some(url) = parts.next() else { continue };
        let kind = parts.next().unwrap_or("");
        let entry = remotes
            .entry(name.to_string())
            .or_insert_with(|| (String::new(), String::new()));
        if kind.contains("(fetch)") {
            entry.0 = url.to_string();
        } else if kind.contains("(push)") {
            entry.1 = url.to_string();
        }
    }

    let list: Vec<Value> = remotes
        .into_iter()
        .map(|(name, (fetch, push))| {
            json!({
                "name": name,
                "fetch": fetch,
                "push": push,
            })
        })
        .collect();

    Ok(json!({ "remotes": list }))
}

// ─── git_pull ─────────────────────────────────────────────────────────────────

pub fn git_pull(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;
    let remote = get_non_empty_str(&args, "remote").unwrap_or("origin");
    let branch = get_non_empty_str(&args, "branch");
    let rebase = args["rebase"].as_bool().unwrap_or(false);

    let mut git_args = vec!["pull"];
    if rebase {
        git_args.push("--rebase");
    }
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
    if prune {
        git_args.push("--prune");
    }

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

// ─── git_stage / git_unstage ─────────────────────────────────────────────────

pub fn git_stage(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;
    let files = get_string_list(&args, "files");

    let output = if files.is_empty() {
        run_git(&["add", "-A"], &path)?
    } else {
        let mut git_args: Vec<&str> = vec!["add", "--"];
        for file in &files {
            git_args.push(file.as_str());
        }
        run_git(&git_args, &path)?
    };

    Ok(json!({ "success": true, "output": output }))
}

pub fn git_unstage(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;
    let files = get_string_list(&args, "files");

    let output = if files.is_empty() {
        run_git(&["restore", "--staged", "."], &path)?
    } else {
        let mut git_args: Vec<&str> = vec!["restore", "--staged", "--"];
        for file in &files {
            git_args.push(file.as_str());
        }
        run_git(&git_args, &path)?
    };

    Ok(json!({ "success": true, "output": output }))
}

// ─── git_discard ─────────────────────────────────────────────────────────────

pub fn git_discard(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;
    let confirmed = args["confirm"].as_bool().unwrap_or(false);
    if !confirmed {
        return Err(PluginError::Custom(
            "discard requires confirm=true because it permanently removes working tree changes"
                .into(),
        ));
    }

    let files = get_string_list(&args, "files");
    if files.is_empty() {
        return Err(PluginError::Custom("missing required field: files".into()));
    }

    let mut outputs = Vec::new();
    for file in &files {
        let status =
            run_git(&["status", "--porcelain", "--", file.as_str()], &path).unwrap_or_default();
        let output = if status.lines().any(|line| line.starts_with("??")) {
            run_git(&["clean", "-f", "--", file.as_str()], &path)?
        } else {
            run_git(&["restore", "--worktree", "--", file.as_str()], &path)?
        };
        if !output.trim().is_empty() {
            outputs.push(output);
        }
    }

    Ok(json!({ "success": true, "output": outputs.join("\n") }))
}

// ─── git_diff ────────────────────────────────────────────────────────────────

pub fn git_diff(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;
    let staged = args["staged"].as_bool().unwrap_or(false);
    let file = get_non_empty_str(&args, "file");

    let is_untracked = if let Some(file) = file {
        !staged
            && run_git(&["status", "--porcelain", "--", file], &path)
                .unwrap_or_default()
                .lines()
                .any(|line| line.starts_with("??"))
    } else {
        false
    };

    let output = match (staged, file) {
        (true, Some(file)) => run_git(&["diff", "--staged", "--", file], &path)?,
        (true, None) => run_git(&["diff", "--staged"], &path)?,
        (false, Some(file)) if is_untracked => {
            let null_file = if cfg!(target_os = "windows") { "NUL" } else { "/dev/null" };
            run_git_with_success_codes(&["diff", "--no-index", "--", null_file, file], &path, &[0, 1])?
        }
        (false, Some(file)) => run_git(&["diff", "--", file], &path)?,
        (false, None) => run_git(&["diff"], &path)?,
    };

    Ok(json!({ "output": output }))
}

// ─── git_stash ───────────────────────────────────────────────────────────────

pub fn git_stash(args: Value, _ctx: &dyn PluginContext) -> Result<Value, PluginError> {
    let path = get_repo_path(&args)?;
    let message = get_non_empty_str(&args, "message").unwrap_or("HaloForge stash");
    let include_untracked = args["include_untracked"].as_bool().unwrap_or(true);

    let output = if include_untracked {
        run_git(&["stash", "push", "-u", "-m", message], &path)?
    } else {
        run_git(&["stash", "push", "-m", message], &path)?
    };

    Ok(json!({ "success": true, "output": output }))
}
