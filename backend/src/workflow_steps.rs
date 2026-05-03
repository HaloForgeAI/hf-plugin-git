//! Workflow step execution for the Git plugin.

use hf_plugin_api::{PluginContext, PluginError};
use serde_json::{json, Value};
use std::process::Command;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(target_os = "windows")]
fn hide_windows_command_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn hide_windows_command_window(_command: &mut Command) {}

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

fn require_str<'a>(config: &'a Value, key: &str) -> Result<&'a str, PluginError> {
    config[key]
        .as_str()
        .ok_or_else(|| PluginError::Custom(format!("missing required config field: {key}")))
}

// ─── step: git_pull ───────────────────────────────────────────────────────────

fn step_git_pull(config: Value) -> Result<Value, PluginError> {
    let path   = require_str(&config, "path")?.to_string();
    let remote = config["remote"].as_str().unwrap_or("origin");
    let rebase = config["rebase"].as_bool().unwrap_or(false);
    let branch = config["branch"].as_str().unwrap_or("").to_string();

    // Optional: checkout the target branch first
    if !branch.is_empty() {
        run_git(&["checkout", &branch], &path)?;
    }

    let mut args = vec!["pull"];
    if rebase { args.push("--rebase"); }
    args.push(remote);
    if !branch.is_empty() { args.push(&branch); }

    let output = run_git(&args, &path)?;
    Ok(json!({ "success": true, "output": output }))
}

// ─── step: git_fetch ──────────────────────────────────────────────────────────

fn step_git_fetch(config: Value) -> Result<Value, PluginError> {
    let path   = require_str(&config, "path")?.to_string();
    let remote = config["remote"].as_str().unwrap_or("origin");
    let prune  = config["prune"].as_bool().unwrap_or(true);

    let mut args = vec!["fetch", remote];
    if prune { args.push("--prune"); }

    let output = run_git(&args, &path)?;
    Ok(json!({ "success": true, "output": output }))
}

// ─── step: git_commit ─────────────────────────────────────────────────────────

fn step_git_commit(config: Value) -> Result<Value, PluginError> {
    let path    = require_str(&config, "path")?.to_string();
    let message = require_str(&config, "message")?.to_string();
    let add_all = config["add_all"].as_bool().unwrap_or(true);

    if add_all {
        run_git(&["add", "-A"], &path)?;
    }

    // Check if there is anything to commit
    let status = run_git(&["status", "--porcelain"], &path).unwrap_or_default();
    if status.is_empty() {
        return Ok(json!({ "success": true, "output": "nothing to commit, working tree clean" }));
    }

    let output = run_git(&["commit", "-m", &message], &path)?;
    Ok(json!({ "success": true, "output": output }))
}

// ─── step: git_checkout ───────────────────────────────────────────────────────

fn step_git_checkout(config: Value) -> Result<Value, PluginError> {
    let path   = require_str(&config, "path")?.to_string();
    let branch = require_str(&config, "branch")?.to_string();
    let create = config["create"].as_bool().unwrap_or(false);

    let args: Vec<&str> = if create {
        vec!["checkout", "-b", &branch]
    } else {
        vec!["checkout", &branch]
    };

    let output = run_git(&args, &path)?;
    Ok(json!({ "success": true, "output": output }))
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

pub fn execute(
    step_type: &str,
    config: Value,
    _ctx: &dyn PluginContext,
) -> Result<Value, PluginError> {
    match step_type {
        "git_pull"     => step_git_pull(config),
        "git_fetch"    => step_git_fetch(config),
        "git_commit"   => step_git_commit(config),
        "git_checkout" => step_git_checkout(config),
        other => Err(PluginError::Unsupported(format!(
            "unknown git workflow step type: {other}"
        ))),
    }
}
