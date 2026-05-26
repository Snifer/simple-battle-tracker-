import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import BattleTrackerPlugin from "./main";
import { ActiveCondition, Combatant } from "./types";
import { LOCALIZATION } from "./localization";
import { ActionModal, ConditionModal, DmgModal, NoteModal, PickCombatantsModal } from "./modals";

export const VIEW_TYPE = "combat-ledger-view";

interface DamageResult {
	finalDamage: number;
	absorbedByShield: number;
	defeated: boolean;
	healed: number;
}

export class BattleTrackerView extends ItemView {
	plugin: BattleTrackerPlugin;
	combatants: Combatant[] = [];
	round = 1;
	activeCombatantId: string | null = null;
	editingInitiativeId: string | null = null;

	activeLogFile: TFile | null = null;
	logDismissed = false;
	logQueue: string[] = [];
	logSetupInProgress = false;

	constructor(leaf: WorkspaceLeaf, plugin: BattleTrackerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		return "Combat Ledger";
	}

	getIcon() {
		return "sword";
	}

	async onOpen() {
		this.render();
	}

	async writeToLog(actionText: string) {
		if (!this.plugin.settings.logEnabled) return;
		if (this.logDismissed) return;

		if (!this.activeLogFile) {
			this.logQueue.push(actionText);
			if (!this.logSetupInProgress) {
				this.triggerLogSetup();
			}
			return;
		}

		const lang = this.plugin.settings.language;
		const now = new Date();
		const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
		const prefix = `[${timeStr}] (${lang === "es" ? "Ronda" : "Round"} ${this.round})`;
		const logLine = `- ${prefix} ${actionText}`;

		try {
			const file = this.activeLogFile;
			const content = await this.app.vault.read(file);
			const lines = content.split("\n");

			const targetHeader = this.plugin.settings.logHeader.trim();
			const headerRegex = /^(#+)\s+(.*)$/;
			const targetMatch = targetHeader.match(headerRegex);

			if (targetMatch) {
				const targetLevel = targetMatch[1].length;
				const targetName = targetMatch[2].trim().toLowerCase();
				let headerIndex = -1;

				for (let i = 0; i < lines.length; i++) {
					const match = lines[i].match(headerRegex);
					if (match && match[2].trim().toLowerCase() === targetName) {
						headerIndex = i;
						break;
					}
				}

				if (headerIndex !== -1) {
					let insertIndex = lines.length;
					for (let i = headerIndex + 1; i < lines.length; i++) {
						const match = lines[i].match(headerRegex);
						if (!match) continue;
						const level = match[1].length;
						if (level <= targetLevel) {
							insertIndex = i;
							break;
						}
					}

					lines.splice(insertIndex, 0, logLine);
					await this.app.vault.modify(file, lines.join("\n"));
					return;
				}
			}

			const newContent = content.trimEnd() + `\n\n${targetHeader}\n${logLine}\n`;
			await this.app.vault.modify(file, newContent);
		} catch (e) {
			console.error("Error writing to combat log:", e);
			new Notice(lang === "es" ? "Error al escribir en el registro de combate." : "Error writing to combat log.");
		}
	}

	triggerLogSetup() {
		if (this.activeLogFile || this.logDismissed || this.logSetupInProgress) return;

		this.logSetupInProgress = true;
		const { LogSetupModal } = require("./modals");
		new LogSetupModal(this.app, this.plugin, this, async (file: TFile | null) => {
			this.logSetupInProgress = false;
			if (file) {
				this.activeLogFile = file;
				this.logDismissed = false;
				const lang = this.plugin.settings.language;
				const startMsg = LOCALIZATION[lang].logStarted;
				const currentQueue = [startMsg, ...this.logQueue];
				this.logQueue = [];
				for (const msg of currentQueue) {
					await this.writeToLog(msg);
				}
			} else {
				this.logDismissed = true;
				this.logQueue = [];
			}
			this.render();
		}).open();
	}

	async createNewLogFile(): Promise<TFile> {
		const folderPath = this.plugin.settings.logFolder.trim();
		if (folderPath) {
			const folderExists = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folderExists) {
				await this.app.vault.createFolder(folderPath);
			}
		}

		const now = new Date();
		const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
		let fileName = this.plugin.settings.logFileName.replace("{date}", dateStr);
		if (!fileName.endsWith(".md")) fileName += ".md";

		const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;
		let uniquePath = fullPath;
		let counter = 1;
		while (this.app.vault.getAbstractFileByPath(uniquePath)) {
			uniquePath = fullPath.replace(/\.md$/, ` (${counter}).md`);
			counter++;
		}

		const header = this.plugin.settings.logHeader;
		return await this.app.vault.create(uniquePath, `# ${fileName.replace(/\.md$/, "")}\n\n${header}\n`);
	}

	parseConditionToken(token: unknown): ActiveCondition | null {
		if (typeof token === "string") {
			const match = token.match(/^(.*?)(?:\s*\((\d+)\))?$/);
			if (!match) return null;
			const name = match[1].trim();
			if (!name) return null;
			const duration = match[2] ? Number(match[2]) : null;
			return { name, duration: duration && duration > 0 ? duration : null };
		}

		if (token && typeof token === "object") {
			const maybe = token as { name?: unknown; duration?: unknown };
			if (typeof maybe.name !== "string" || !maybe.name.trim()) return null;
			const durationValue = Number(maybe.duration);
			return {
				name: maybe.name.trim(),
				duration: Number.isFinite(durationValue) && durationValue > 0 ? durationValue : null,
			};
		}

		return null;
	}

	parseStoredConditions(raw: unknown): ActiveCondition[] {
		if (Array.isArray(raw)) {
			return raw
				.map((entry) => this.parseConditionToken(entry))
				.filter((entry): entry is ActiveCondition => Boolean(entry));
		}

		if (typeof raw === "string") {
			return raw
				.split(",")
				.map((entry) => this.parseConditionToken(entry.trim()))
				.filter((entry): entry is ActiveCondition => Boolean(entry));
		}

		const single = this.parseConditionToken(raw);
		return single ? [single] : [];
	}

	serializeConditions(conditions: ActiveCondition[]): string[] {
		return conditions.map((entry) => entry.duration ? `${entry.name} (${entry.duration})` : entry.name);
	}

	formatConditionLabel(condition: ActiveCondition): string {
		return condition.duration ? `${condition.name} · ${condition.duration}` : condition.name;
	}

	async fileToCombatant(file: TFile): Promise<Combatant> {
		const f = this.plugin.settings.fields;
		const meta = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};

		const extraNames = f.extra_fields
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		const extraFields: Record<string, number> = {};
		for (const key of extraNames) {
			if (meta[key] !== undefined) extraFields[key] = Number(meta[key]) || 0;
		}

		const hpMax = Number(meta[f.hp_max] ?? meta[f.hp] ?? 10) || 10;
		const hp = Number(meta[f.hp] ?? hpMax) || hpMax;
		const shield = f.shield ? Number(meta[f.shield] ?? 0) || 0 : 0;
		const storedConditions = f.conditions ? this.parseStoredConditions(meta[f.conditions]) : [];

		return {
			id: file.path,
			name: file.basename,
			initiative: Number(meta[f.initiative] ?? 0) || 0,
			hp,
			hpMax,
			shield,
			ac: Number(meta[f.ac] ?? 10) || 10,
			combatType: String(meta[f.type] ?? "NPC"),
			extraFields,
			conditions: storedConditions,
			notes: "",
			alive: hp > 0,
			file,
		};
	}

	shouldSyncCombatant(combatant: Combatant): boolean {
		if (!this.plugin.settings.realtimeSync) return false;
		if (this.plugin.settings.realtimeSyncMode === "all") return true;
		return combatant.combatType === "PC";
	}

	async syncCombatantToNote(combatant: Combatant) {
		if (!this.shouldSyncCombatant(combatant)) return;

		const fields = this.plugin.settings.fields;
		try {
			await this.app.fileManager.processFrontMatter(combatant.file, (frontmatter) => {
				frontmatter[fields.hp] = combatant.hp;
				if (fields.initiative) frontmatter[fields.initiative] = combatant.initiative;
				if (fields.shield) frontmatter[fields.shield] = combatant.shield;
				if (fields.conditions) frontmatter[fields.conditions] = this.serializeConditions(combatant.conditions);

				Object.entries(combatant.extraFields).forEach(([key, value]) => {
					frontmatter[key] = value;
				});
			});
		} catch (error) {
			console.error("Failed to sync combatant note:", error);
			new Notice(this.plugin.settings.language === "es" ? `No se pudo sincronizar ${combatant.name}.` : `Could not sync ${combatant.name}.`);
		}
	}

	ensureActiveCombatant() {
		const alive = this.aliveSorted();
		if (!alive.length) {
			this.activeCombatantId = null;
			return;
		}
		if (!this.activeCombatantId || !alive.some((combatant) => combatant.id === this.activeCombatantId)) {
			this.activeCombatantId = alive[0].id;
		}
	}

	sorted(): Combatant[] {
		return [...this.combatants].sort((a, b) => b.initiative - a.initiative || a.name.localeCompare(b.name));
	}

	aliveSorted(): Combatant[] {
		return this.sorted().filter((combatant) => combatant.alive);
	}

	getCurrentTurnIndex(alive = this.aliveSorted()): number {
		if (!alive.length || !this.activeCombatantId) return 0;
		const index = alive.findIndex((combatant) => combatant.id === this.activeCombatantId);
		return index >= 0 ? index : 0;
	}

	getCombatant(id: string): Combatant | undefined {
		return this.combatants.find((combatant) => combatant.id === id);
	}

	async processConditionDurations(combatant: Combatant) {
		if (!combatant.conditions.length) return;
		const lang = this.plugin.settings.language;
		const retained: ActiveCondition[] = [];
		let changed = false;

		for (const condition of combatant.conditions) {
			if (condition.duration == null) {
				retained.push(condition);
				continue;
			}

			const nextDuration = condition.duration - 1;
			changed = true;
			if (nextDuration <= 0) {
				await this.writeToLog(lang === "es"
					? `${combatant.name} pierde la condición por expiración: ${condition.name}`
					: `${combatant.name} loses condition by expiration: ${condition.name}`);
				continue;
			}

			retained.push({ ...condition, duration: nextDuration });
		}

		if (changed) {
			combatant.conditions = retained;
			await this.syncCombatantToNote(combatant);
		}
	}

	async nextTurn() {
		const alive = this.aliveSorted();
		if (!alive.length) return;

		this.ensureActiveCombatant();
		const currentIndex = this.getCurrentTurnIndex(alive);
		const nextIndex = (currentIndex + 1) % alive.length;
		if (nextIndex === 0) this.round++;
		this.activeCombatantId = alive[nextIndex].id;

		const currentCombatant = alive[nextIndex];
		await this.processConditionDurations(currentCombatant);
		await this.writeToLog(this.plugin.settings.language === "es"
			? `Turno de ${currentCombatant.name}`
			: `Turn of ${currentCombatant.name}`);

		this.render();
	}

	applyDamage(combatant: Combatant, amount: number, heal: boolean, useShield: boolean): DamageResult {
		if (heal) {
			const previous = combatant.hp;
			combatant.hp = Math.min(combatant.hpMax, combatant.hp + amount);
			if (combatant.hp > 0) combatant.alive = true;
			return {
				finalDamage: 0,
				absorbedByShield: 0,
				defeated: false,
				healed: combatant.hp - previous,
			};
		}

		let remaining = Math.max(0, amount);
		let absorbedByShield = 0;
		if (useShield && combatant.shield > 0) {
			absorbedByShield = Math.min(combatant.shield, remaining);
			combatant.shield -= absorbedByShield;
			remaining -= absorbedByShield;
		}

		combatant.hp = Math.max(0, combatant.hp - remaining);
		if (combatant.hp === 0) combatant.alive = false;

		return {
			finalDamage: remaining,
			absorbedByShield,
			defeated: combatant.hp === 0,
			healed: 0,
		};
	}

	async applyDmg(id: string, amount: number, heal: boolean, useShield: boolean) {
		const combatant = this.getCombatant(id);
		if (!combatant) return;

		const lang = this.plugin.settings.language;
		const result = this.applyDamage(combatant, amount, heal, useShield);
		if (heal) {
			await this.writeToLog(lang === "es"
				? `${combatant.name} se cura ${result.healed} PV (PV: ${combatant.hp}/${combatant.hpMax})`
				: `${combatant.name} heals ${result.healed} HP (HP: ${combatant.hp}/${combatant.hpMax})`);
		} else {
			const shieldText = result.absorbedByShield > 0
				? lang === "es"
					? `, ${result.absorbedByShield} absorbidos por escudo`
					: `, ${result.absorbedByShield} absorbed by shield`
				: "";
			await this.writeToLog(lang === "es"
				? `${combatant.name} recibe ${result.finalDamage} de daño${shieldText} (PV: ${combatant.hp}/${combatant.hpMax})`
				: `${combatant.name} takes ${result.finalDamage} damage${shieldText} (HP: ${combatant.hp}/${combatant.hpMax})`);
			if (result.defeated) {
				await this.writeToLog(lang === "es" ? `${combatant.name} ha sido derrotado` : `${combatant.name} has been defeated`);
			}
		}

		await this.syncCombatantToNote(combatant);
		this.ensureActiveCombatant();
		this.render();
	}

	async setInitiative(id: string, initiative: number) {
		const combatant = this.getCombatant(id);
		if (!combatant) return;
		combatant.initiative = initiative;
		this.editingInitiativeId = null;
		await this.syncCombatantToNote(combatant);
		await this.writeToLog(this.plugin.settings.language === "es"
			? `${combatant.name} cambia su iniciativa a ${initiative}`
			: `${combatant.name} changes initiative to ${initiative}`);
		this.ensureActiveCombatant();
		this.render();
	}

	async updateConditions(id: string, updated: ActiveCondition[]) {
		const combatant = this.getCombatant(id);
		if (!combatant) return;
		const lang = this.plugin.settings.language;

		const oldMap = new Map(combatant.conditions.map((condition) => [condition.name, condition.duration]));
		const newMap = new Map(updated.map((condition) => [condition.name, condition.duration]));

		combatant.conditions = updated;

		for (const condition of updated) {
			if (!oldMap.has(condition.name)) {
				await this.writeToLog(lang === "es"
					? `${combatant.name} obtiene la condición: ${this.formatConditionLabel(condition)}`
					: `${combatant.name} gains condition: ${this.formatConditionLabel(condition)}`);
			} else if (oldMap.get(condition.name) !== condition.duration) {
				await this.writeToLog(lang === "es"
					? `${combatant.name} actualiza la duración de ${condition.name} a ${condition.duration ?? "∞"}`
					: `${combatant.name} updates ${condition.name} duration to ${condition.duration ?? "∞"}`);
			}
		}

		for (const [name] of oldMap.entries()) {
			if (!newMap.has(name)) {
				await this.writeToLog(lang === "es"
					? `${combatant.name} pierde la condición: ${name}`
					: `${combatant.name} loses condition: ${name}`);
			}
		}

		await this.syncCombatantToNote(combatant);
		this.render();
	}

	async modExtra(id: string, key: string, delta: number) {
		const combatant = this.getCombatant(id);
		if (!combatant) return;
		combatant.extraFields[key] = Math.max(0, (combatant.extraFields[key] ?? 0) + delta);
		await this.syncCombatantToNote(combatant);
		await this.writeToLog(this.plugin.settings.language === "es"
			? `${combatant.name} - ${key.toUpperCase()} modificado a ${combatant.extraFields[key]}`
			: `${combatant.name} - ${key.toUpperCase()} modified to ${combatant.extraFields[key]}`);
		this.render();
	}

	async removeCombatant(id: string) {
		const combatant = this.getCombatant(id);
		if (combatant) {
			await this.writeToLog(this.plugin.settings.language === "es"
				? `${combatant.name} retirado del combate`
				: `${combatant.name} removed from combat`);
		}
		this.combatants = this.combatants.filter((entry) => entry.id !== id);
		if (this.activeCombatantId === id) this.activeCombatantId = null;
		this.ensureActiveCombatant();
		this.render();
	}

	resetBattle() {
		void this.writeToLog(LOCALIZATION[this.plugin.settings.language].logEnded);
		this.combatants = [];
		this.round = 1;
		this.activeCombatantId = null;
		this.activeLogFile = null;
		this.logDismissed = false;
		this.logQueue = [];
		this.editingInitiativeId = null;
		this.render();
	}

	async applyAction(attackerId: string, payload: {
		targetId: string;
		damage: number;
		useShield: boolean;
		conditionName: string;
		conditionDuration: number | null;
		note: string;
	}) {
		const attacker = this.getCombatant(attackerId);
		const target = this.getCombatant(payload.targetId);
		if (!attacker || !target) return;

		const lang = this.plugin.settings.language;
		const result = payload.damage > 0
			? this.applyDamage(target, payload.damage, false, payload.useShield)
			: { finalDamage: 0, absorbedByShield: 0, defeated: false, healed: 0 };

		if (payload.conditionName) {
			const existing = target.conditions.find((condition) => condition.name === payload.conditionName);
			if (existing) existing.duration = payload.conditionDuration;
			else target.conditions.push({ name: payload.conditionName, duration: payload.conditionDuration });
		}

		const parts: string[] = [];
		if (payload.damage > 0) {
			parts.push(lang === "es"
				? `le inflige ${result.finalDamage} de daño`
				: `deals ${result.finalDamage} damage`);
			if (result.absorbedByShield > 0) {
				parts.push(lang === "es"
					? `${result.absorbedByShield} absorbidos por escudo`
					: `${result.absorbedByShield} absorbed by shield`);
			}
		}
		if (payload.conditionName) {
			parts.push(lang === "es"
				? `aplica ${payload.conditionName}${payload.conditionDuration ? ` (${payload.conditionDuration})` : ""}`
				: `applies ${payload.conditionName}${payload.conditionDuration ? ` (${payload.conditionDuration})` : ""}`);
		}
		if (payload.note) parts.push(payload.note);

		const actionVerb = lang === "es" ? "ataca a" : "attacks";
		const suffix = parts.length ? ` ${lang === "es" ? "y" : "and"} ${parts.join(", ")}` : "";
		await this.writeToLog(lang === "es"
			? `${attacker.name} ${actionVerb} ${target.name}${suffix}.`
			: `${attacker.name} ${actionVerb} ${target.name}${suffix}.`);

		if (result.defeated) {
			await this.writeToLog(lang === "es" ? `${target.name} ha sido derrotado` : `${target.name} has been defeated`);
		}

		await this.syncCombatantToNote(target);
		this.ensureActiveCombatant();
		this.render();
	}

	async loadFromVault() {
		const folder = this.plugin.settings.combatantFolder.trim();
		const lang = this.plugin.settings.language;
		let files: TFile[];

		if (folder) {
			const folderObj = this.app.vault.getAbstractFileByPath(folder);
			if (!folderObj) {
				new Notice(lang === "es" ? `Carpeta "${folder}" no encontrada.` : `Folder "${folder}" not found.`);
				return;
			}
			files = this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(folder + "/"));
		} else {
			new PickCombatantsModal(this.app, this.plugin, async (picked) => {
				const loaded = await Promise.all(picked.map((file) => this.fileToCombatant(file)));
				for (const combatant of loaded) {
					if (!this.combatants.find((entry) => entry.id === combatant.id)) {
						this.combatants.push(combatant);
					}
				}
				this.ensureActiveCombatant();
				for (const combatant of loaded) {
					await this.writeToLog(lang === "es"
						? `Combatiente cargado: ${combatant.name} (Iniciativa: ${combatant.initiative}, PV: ${combatant.hp}/${combatant.hpMax})`
						: `Combatant loaded: ${combatant.name} (Initiative: ${combatant.initiative}, HP: ${combatant.hp}/${combatant.hpMax})`);
				}
				this.render();
				if (this.combatants.length > 0) this.triggerLogSetup();
			}).open();
			return;
		}

		const loaded = await Promise.all(files.map((file) => this.fileToCombatant(file)));
		for (const combatant of loaded) {
			if (!this.combatants.find((entry) => entry.id === combatant.id)) {
				this.combatants.push(combatant);
			}
		}
		this.ensureActiveCombatant();

		for (const combatant of loaded) {
			await this.writeToLog(lang === "es"
				? `Combatiente cargado: ${combatant.name} (Iniciativa: ${combatant.initiative}, PV: ${combatant.hp}/${combatant.hpMax})`
				: `Combatant loaded: ${combatant.name} (Initiative: ${combatant.initiative}, HP: ${combatant.hp}/${combatant.hpMax})`);
		}

		this.render();
		if (this.combatants.length > 0) this.triggerLogSetup();
	}

	render() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("bt-panel");

		const lang = this.plugin.settings.language;
		const t = LOCALIZATION[lang];
		const conditionEntries = this.plugin.settings.conditions;
		const alive = this.aliveSorted();
		const allSorted = this.sorted();
		this.ensureActiveCombatant();
		const activeIndex = this.getCurrentTurnIndex(alive);

		const topBar = container.createDiv("bt-topbar");
		topBar.createDiv("bt-round-badge", (el) => el.setText(`${t.round} ${this.round}`));

		const topActions = topBar.createDiv("bt-top-actions");

		const nextBtn = topActions.createEl("button", { cls: "bt-btn bt-btn-primary" });
		nextBtn.innerHTML = t.nextTurn;
		nextBtn.onclick = () => void this.nextTurn();

		const loadBtn = topActions.createEl("button", { cls: "bt-btn" });
		loadBtn.innerHTML = t.load;
		loadBtn.onclick = () => void this.loadFromVault();

		if (this.plugin.settings.logEnabled) {
			const logBtn = topActions.createEl("button", {
				cls: `bt-btn${this.activeLogFile ? " bt-btn-primary" : ""}`,
				title: t.logSelectLogFileButton,
			});
			logBtn.innerHTML = `📝 ${this.activeLogFile ? (lang === "es" ? "Registrando" : "Logging") : (lang === "es" ? "Registro" : "Log")}`;
			logBtn.onclick = () => this.triggerLogSetup();
		}

		const resetBtn = topActions.createEl("button", { cls: "bt-btn bt-btn-danger-soft" });
		resetBtn.innerHTML = t.reset;
		resetBtn.onclick = () => {
			if (confirm(t.resetConfirm)) this.resetBattle();
		};

		if (alive.length) {
			const strip = container.createDiv("bt-init-strip");
			alive.forEach((combatant, index) => {
				const chip = strip.createDiv(`bt-init-chip${index === activeIndex ? " active" : ""}`);
				chip.setText(`${combatant.name} (${combatant.initiative})`);
			});
		}

		if (!this.combatants.length) {
			const empty = container.createDiv("bt-empty");
			empty.createEl("p", { text: t.emptyState });
			return;
		}

		allSorted.forEach((combatant) => {
			const isActive = combatant.alive && combatant.id === this.activeCombatantId;
			const ratio = combatant.hpMax > 0 ? combatant.hp / combatant.hpMax : 0;
			const card = container.createDiv(`bt-card${isActive ? " bt-card-active" : ""}${!combatant.alive ? " bt-card-dead" : ""}`);

			const header = card.createDiv("bt-card-header");
			const avatar = header.createDiv(`bt-avatar bt-avatar-${combatant.combatType === "PC" ? "pc" : combatant.combatType === "Enemy" ? "enemy" : "npc"}`);
			avatar.setText(combatant.name.slice(0, 2).toUpperCase());

			const nameWrap = header.createDiv("bt-name-wrap");
			const nameEl = nameWrap.createEl("span", { cls: "bt-name", text: combatant.name });
			nameEl.style.cursor = "pointer";
			nameEl.title = lang === "es" ? "Abrir nota" : "Open note";
			nameEl.onclick = () => void this.app.workspace.getLeaf(true).openFile(combatant.file);

			const metaRow = nameWrap.createDiv("bt-sub bt-init-edit-row");
			if (this.editingInitiativeId === combatant.id) {
				const initInput = metaRow.createEl("input", {
					cls: "bt-init-edit-input",
					type: "number",
				}) as HTMLInputElement;
				initInput.value = String(combatant.initiative);
				const commit = () => void this.setInitiative(combatant.id, parseInt(initInput.value) || 0);
				initInput.onblur = commit;
				initInput.onkeydown = (evt) => {
					if (evt.key === "Enter") commit();
					if (evt.key === "Escape") {
						this.editingInitiativeId = null;
						this.render();
					}
				};
				setTimeout(() => {
					initInput.focus();
					initInput.select();
				}, 0);
			} else {
				const initText = metaRow.createEl("span", { text: `${t.init} ${combatant.initiative} · ${t.ac} ${combatant.ac}` });
				initText.ondblclick = () => {
					this.editingInitiativeId = combatant.id;
					this.render();
				};
				if (combatant.shield > 0) {
					metaRow.createEl("span", { cls: "bt-sub-shield", text: `${t.shield} ${combatant.shield}` });
				}
			}

			const badge = header.createDiv(`bt-badge bt-badge-${combatant.combatType === "PC" ? "pc" : combatant.combatType === "Enemy" ? "enemy" : "npc"}`);
			badge.setText(combatant.combatType);

			const initEditBtn = header.createEl("button", { cls: "bt-btn-icon", title: t.editInitiative });
			initEditBtn.setText("✎");
			initEditBtn.onclick = () => {
				this.editingInitiativeId = combatant.id;
				this.render();
			};

			const removeBtn = header.createEl("button", { cls: "bt-btn-icon", title: t.removeTitle });
			removeBtn.setText("✕");
			removeBtn.onclick = () => void this.removeCombatant(combatant.id);

			if (combatant.conditions.length) {
				const condRow = card.createDiv("bt-cond-row");
				combatant.conditions.forEach((condition) => {
					const tag = condRow.createDiv("bt-cond-tag");
					tag.setText(`${this.formatConditionLabel(condition)} ×`);
					const entry = conditionEntries.find((item) => item.name === condition.name);
					if (entry?.color) {
						tag.style.color = entry.color;
						tag.style.borderColor = entry.color;
						tag.style.backgroundColor = entry.color + "22";
					}
				});
			}

			const hpWrap = card.createDiv("bt-hp-wrap");
			const hpLabelRow = hpWrap.createDiv("bt-hp-label-row");
			hpLabelRow.createEl("span", { text: t.hp, cls: "bt-label" });
			hpLabelRow.createEl("span", { cls: "bt-hp-text", text: `${combatant.hp} / ${combatant.hpMax}` });

			const bar = hpWrap.createDiv("bt-bar");
			const fill = bar.createDiv("bt-bar-fill");
			fill.style.width = `${Math.max(0, ratio * 100)}%`;
			fill.className = `bt-bar-fill ${ratio > 0.6 ? "bt-hp-ok" : ratio > 0.3 ? "bt-hp-mid" : "bt-hp-low"}`;

			const extraNames = Object.keys(combatant.extraFields);
			if (extraNames.length) {
				const extraRow = card.createDiv("bt-extra-row");
				extraNames.forEach((key) => {
					const box = extraRow.createDiv("bt-extra-box");
					box.createEl("span", { cls: "bt-label", text: key.toUpperCase() });
					const valRow = box.createDiv("bt-extra-val-row");
					const minusBtn = valRow.createEl("button", { cls: "bt-btn-mini", text: "−" });
					minusBtn.onclick = () => void this.modExtra(combatant.id, key, -1);
					valRow.createEl("span", { cls: "bt-extra-val", text: String(combatant.extraFields[key]) });
					const plusBtn = valRow.createEl("button", { cls: "bt-btn-mini", text: "+" });
					plusBtn.onclick = () => void this.modExtra(combatant.id, key, 1);
				});
			}

			if (combatant.notes) {
				card.createEl("p", { cls: "bt-notes", text: combatant.notes });
			}

			const actions = card.createDiv("bt-actions");

			const dmgBtn = actions.createEl("button", { cls: "bt-btn bt-btn-danger-soft" });
			dmgBtn.setText(t.damageHeal);
			dmgBtn.onclick = () => new DmgModal(this.app, combatant.name, this.plugin, combatant.shield > 0, (value, heal, useShield) => {
				void this.applyDmg(combatant.id, value, heal, useShield);
			}).open();

			const condBtn = actions.createEl("button", { cls: "bt-btn" });
			condBtn.setText(t.status);
			condBtn.onclick = () => new ConditionModal(this.app, conditionEntries, combatant.conditions, this.plugin, (updated) => {
				void this.updateConditions(combatant.id, updated);
			}).open();

			const noteBtn = actions.createEl("button", { cls: "bt-btn" });
			noteBtn.setText(t.note);
			noteBtn.onclick = () => new NoteModal(this.app, combatant.notes, this.plugin, (text) => {
				combatant.notes = text;
				void this.writeToLog(lang === "es"
					? `${combatant.name} - Nota: ${text || "vaciada"}`
					: `${combatant.name} - Note: ${text || "cleared"}`);
				this.render();
			}).open();

			if (isActive && alive.length > 1) {
				const actionBtn = actions.createEl("button", { cls: "bt-btn bt-btn-primary" });
				actionBtn.setText(t.action);
				actionBtn.onclick = () => new ActionModal(
					this.app,
					combatant,
					alive.filter((entry) => entry.id !== combatant.id),
					conditionEntries,
					this.plugin,
					(payload) => void this.applyAction(combatant.id, payload),
				).open();
			}

			if (combatant.alive) {
				const defeatBtn = actions.createEl("button", { cls: "bt-btn bt-btn-ghost" });
				defeatBtn.setText(t.defeat);
				defeatBtn.onclick = async () => {
					combatant.alive = false;
					combatant.hp = 0;
					await this.syncCombatantToNote(combatant);
					await this.writeToLog(lang === "es" ? `${combatant.name} ha sido derrotado` : `${combatant.name} has been defeated`);
					this.ensureActiveCombatant();
					this.render();
				};
			} else {
				const reviveBtn = actions.createEl("button", { cls: "bt-btn" });
				reviveBtn.setText(t.revive);
				reviveBtn.onclick = async () => {
					combatant.alive = true;
					combatant.hp = Math.max(1, combatant.hp);
					await this.syncCombatantToNote(combatant);
					await this.writeToLog(lang === "es" ? `${combatant.name} ha resucitado` : `${combatant.name} has been revived`);
					this.ensureActiveCombatant();
					this.render();
				};
			}
		});
	}

	async onClose() {
		await Promise.resolve();
	}
}
