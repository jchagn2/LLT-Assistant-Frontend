/**
 * Git Commit Watcher
 * Monitors Git repository for new commits and triggers maintenance analysis
 */

import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';
import { GitCommit, CommitComparison } from '../models/types';

/**
 * Git Commit Watcher
 * Monitors Git repository for commit changes
 */
export class GitCommitWatcher {
	private workspaceRoot: string;
	private currentCommitHash: string | null = null;
	private watcher: vscode.FileSystemWatcher | null = null;
	private pollingInterval: NodeJS.Timeout | null = null;
	private onCommitDetected: ((comparison: CommitComparison) => void) | null = null;
	private isWatching: boolean = false;

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	/**
	 * Start watching for new commits
	 * @param onCommitDetected Callback when a new commit is detected
	 * @param usePolling Whether to use polling instead of file watching (default: true)
	 * @param pollInterval Polling interval in milliseconds (default: 5000)
	 */
	startWatching(
		onCommitDetected: (comparison: CommitComparison) => void,
		usePolling: boolean = true,
		pollInterval: number = 5000
	): void {
		if (this.isWatching) {
			console.warn('[Maintenance] Already watching for commits');
			return;
		}

		this.onCommitDetected = onCommitDetected;
		this.isWatching = true;

		// Initialize current commit hash
		try {
			this.currentCommitHash = this.getCurrentCommitHash();
		} catch (error) {
			console.error('[Maintenance] Failed to get initial commit hash:', error);
			this.currentCommitHash = null;
		}

		if (usePolling) {
			this.startPolling(pollInterval);
		} else {
			this.startFileWatching();
		}
	}

	/**
	 * Stop watching for commits
	 */
	stopWatching(): void {
		this.isWatching = false;

		if (this.pollingInterval) {
			clearInterval(this.pollingInterval);
			this.pollingInterval = null;
		}

		if (this.watcher) {
			this.watcher.dispose();
			this.watcher = null;
		}

		this.onCommitDetected = null;
	}

	/**
	 * Start polling for new commits
	 */
	private startPolling(interval: number): void {
		this.pollingInterval = setInterval(() => {
			this.checkForNewCommit();
		}, interval);

		// Also check immediately
		this.checkForNewCommit();
	}

	/**
	 * Start file system watching (less reliable, but more efficient)
	 */
	private startFileWatching(): void {
		// Watch .git/HEAD and .git/refs/heads/* for changes
		const gitDir = path.join(this.workspaceRoot, '.git');
		const headFile = path.join(gitDir, 'HEAD');
		const refsDir = path.join(gitDir, 'refs', 'heads');

		// Watch HEAD file
		this.watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(this.workspaceRoot, '.git/HEAD')
		);

		this.watcher.onDidChange(() => {
			// Debounce to avoid multiple rapid triggers
			setTimeout(() => {
				this.checkForNewCommit();
			}, 1000);
		});

		// Also watch refs directory
		const refsWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(this.workspaceRoot, '.git/refs/heads/**')
		);

		refsWatcher.onDidChange(() => {
			setTimeout(() => {
				this.checkForNewCommit();
			}, 1000);
		});
	}

	/**
	 * Check for new commit
	 */
	private checkForNewCommit(): void {
		if (!this.isWatching || !this.onCommitDetected) {
			return;
		}

		try {
			const newCommitHash = this.getCurrentCommitHash();

			// If no previous commit, just update and return
			if (!this.currentCommitHash) {
				this.currentCommitHash = newCommitHash;
				return;
			}

			// If commit hash changed, trigger callback
			if (newCommitHash && newCommitHash !== this.currentCommitHash) {
				const comparison = this.compareCommits(this.currentCommitHash, newCommitHash);
				if (comparison.has_changes) {
					this.currentCommitHash = newCommitHash;
					this.onCommitDetected(comparison);
				}
			}
		} catch (error) {
			console.error('[Maintenance] Error checking for new commit:', error);
		}
	}

	/**
	 * Get current commit hash
	 */
	getCurrentCommitHash(): string | null {
		try {
			if (!this.isGitRepository()) {
				return null;
			}

			const hash = execSync('git rev-parse HEAD', {
				cwd: this.workspaceRoot,
				encoding: 'utf-8'
			}).trim();

			return hash || null;
		} catch (error) {
			console.error('[Maintenance] Failed to get commit hash:', error);
			return null;
		}
	}

	/**
	 * Get previous commit hash (HEAD~1)
	 */
	getPreviousCommitHash(): string | null {
		try {
			if (!this.isGitRepository()) {
				return null;
			}

			// Check if there's a previous commit
			const hasPrevious = execSync('git rev-parse --verify HEAD~1', {
				cwd: this.workspaceRoot,
				encoding: 'utf-8',
				stdio: 'pipe'
			}).trim();

			return hasPrevious || null;
		} catch (error) {
			// No previous commit (first commit or empty repo)
			return null;
		}
	}

	/**
	 * Compare two commits
	 */
	compareCommits(previousHash: string, currentHash: string): CommitComparison {
		const currentCommit = this.getCommitInfo(currentHash);
		const previousCommit = this.getCommitInfo(previousHash);

		// Get list of changed files
		const changedFiles = this.getChangedFiles(previousHash, currentHash);

		return {
			current_commit: currentCommit,
			previous_commit: previousCommit,
			has_changes: changedFiles.length > 0,
			changed_files: changedFiles
		};
	}

	/**
	 * Get commit information
	 */
	getCommitInfo(commitHash: string): GitCommit {
		try {
			const shortHash = execSync(`git rev-parse --short ${commitHash}`, {
				cwd: this.workspaceRoot,
				encoding: 'utf-8'
			}).trim();

			const message = execSync(`git log -1 --pretty=%s ${commitHash}`, {
				cwd: this.workspaceRoot,
				encoding: 'utf-8'
			}).trim();

			const author = execSync(`git log -1 --pretty=%an ${commitHash}`, {
				cwd: this.workspaceRoot,
				encoding: 'utf-8'
			}).trim();

			const timestamp = parseInt(
				execSync(`git log -1 --pretty=%at ${commitHash}`, {
					cwd: this.workspaceRoot,
					encoding: 'utf-8'
				}).trim(),
				10
			) * 1000; // Convert to milliseconds

			return {
				hash: commitHash,
				short_hash: shortHash,
				message,
				author,
				timestamp
			};
		} catch (error) {
			console.error(`[Maintenance] Failed to get commit info for ${commitHash}:`, error);
			// Return minimal info
			return {
				hash: commitHash,
				short_hash: commitHash.substring(0, 7),
				message: 'Unknown',
				author: 'Unknown',
				timestamp: Date.now()
			};
		}
	}

	/**
	 * Get list of changed files between two commits
	 */
	getChangedFiles(previousHash: string, currentHash: string): string[] {
		try {
			const output = execSync(`git diff --name-only ${previousHash} ${currentHash}`, {
				cwd: this.workspaceRoot,
				encoding: 'utf-8'
			});

			return output
				.split('\n')
				.map(line => line.trim())
				.filter(line => line.length > 0 && line.endsWith('.py'));
		} catch (error) {
			console.error('[Maintenance] Failed to get changed files:', error);
			return [];
		}
	}

	/**
	 * Check if current workspace is a git repository
	 */
	isGitRepository(): boolean {
		try {
			execSync('git rev-parse --is-inside-work-tree', {
				cwd: this.workspaceRoot,
				stdio: 'pipe'
			});
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get current branch name
	 */
	getCurrentBranch(): string | null {
		try {
			const branch = execSync('git rev-parse --abbrev-ref HEAD', {
				cwd: this.workspaceRoot,
				encoding: 'utf-8'
			}).trim();

			return branch || null;
		} catch (error) {
			console.error('[Maintenance] Failed to get current branch:', error);
			return null;
		}
	}

	/**
	 * Check if there are uncommitted changes
	 */
	hasUncommittedChanges(): boolean {
		try {
			const output = execSync('git status --porcelain', {
				cwd: this.workspaceRoot,
				encoding: 'utf-8'
			});

			return output.trim().length > 0;
		} catch {
			return false;
		}
	}
}

