import { Plugin, WorkspaceLeaf } from "obsidian";
import { BattleTrackerSettings } from "./types";
import { DEFAULT_SETTINGS, BattleTrackerSettingTab } from "./settings";
import { VIEW_TYPE, BattleTrackerView } from "./view";

export default class BattleTrackerPlugin extends Plugin {
	settings: BattleTrackerSettings;

	async onload() {
		await this.loadSettings();

		const registry = (this.app as any).viewRegistry;
		if (registry && registry.viewByType && registry.viewByType[VIEW_TYPE]) {
			delete registry.viewByType[VIEW_TYPE];
		}

		this.registerView(VIEW_TYPE, (leaf) => new BattleTrackerView(leaf, this));

		this.addRibbonIcon("sword", "Combat Ledger", () => this.activateView());

		this.addCommand({
			id: "open-combat-ledger",
			name: this.settings.language === "es" ? "Abrir Combat Ledger" : "Open Combat Ledger",
			callback: () => this.activateView(),
		});

		this.addSettingTab(new BattleTrackerSettingTab(this.app, this));
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE);
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE);
		if (existing.length) {
			leaf = existing[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		if (leaf) workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.settings.fields = Object.assign({}, DEFAULT_SETTINGS.fields, this.settings.fields ?? {});

		// Migration: convert legacy comma-separated conditions string to ConditionEntry[]
		if (typeof this.settings.conditions === "string") {
			this.settings.conditions = (this.settings.conditions as unknown as string)
				.split(",")
				.map(s => s.trim())
				.filter(Boolean)
				.map(name => ({ name, color: "" }));
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
