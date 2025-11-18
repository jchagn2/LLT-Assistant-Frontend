/**
 * Configuration Manager for Quality Analysis
 */

import * as vscode from 'vscode';
import { AnalysisMode } from '../api/types';

export class QualityConfigManager {
	private static readonly SECTION = 'llt-assistant.quality';

	/**
	 * Get backend URL
	 */
	static getBackendUrl(): string {
		return this.get<string>('backendUrl', 'http://localhost:8000/api/v1');
	}

	/**
	 * Get analysis mode
	 */
	static getAnalysisMode(): AnalysisMode {
		return this.get<AnalysisMode>('analysisMode', 'hybrid');
	}

	/**
	 * Get auto-analyze setting
	 */
	static getAutoAnalyze(): boolean {
		return this.get<boolean>('autoAnalyze', false);
	}

	/**
	 * Get inline decorations setting
	 */
	static getEnableInlineDecorations(): boolean {
		return this.get<boolean>('enableInlineDecorations', true);
	}

	/**
	 * Get code actions setting
	 */
	static getEnableCodeActions(): boolean {
		return this.get<boolean>('enableCodeActions', true);
	}

	/**
	 * Get severity filter
	 */
	static getSeverityFilter(): string[] {
		return this.get<string[]>('severityFilter', ['error', 'warning', 'info']);
	}

	/**
	 * Get disabled rules
	 */
	static getDisabledRules(): string[] {
		return this.get<string[]>('disabledRules', []);
	}

	/**
	 * Get LLM temperature
	 */
	static getLLMTemperature(): number {
		return this.get<number>('llmTemperature', 0.3);
	}

	/**
	 * Generic get method
	 */
	private static get<T>(key: string, defaultValue: T): T {
		const config = vscode.workspace.getConfiguration(this.SECTION);
		return config.get<T>(key, defaultValue);
	}

	/**
	 * Watch for configuration changes
	 */
	static onDidChange(
		callback: (e: vscode.ConfigurationChangeEvent) => void
	): vscode.Disposable {
		return vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(this.SECTION)) {
				callback(e);
			}
		});
	}
}
