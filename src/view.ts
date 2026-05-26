import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import BattleTrackerPlugin from "./main";
import { Combatant } from "./types";
import { LOCALIZATION } from "./localization";
import { DmgModal, ConditionModal, NoteModal, PickCombatantsModal } from "./modals";

export const VIEW_TYPE = "combat-ledger-view";

export class BattleTrackerView extends ItemView {
	plugin: BattleTrackerPlugin;
	combatants: Combatant[] = [];
	round: number = 1;
	currentTurn: number = 0;

	// Logging state
	activeLogFile: TFile | null = null;
	logDismissed: boolean = false;
	logQueue: string[] = [];
	logSetupInProgress = false;

	constructor(leaf: WorkspaceLeaf, plugin: BattleTrackerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return VIEW_TYPE; }
	getDisplayText() { return "Combat Ledger"; }
	getIcon() { return "sword"; }

	async onOpen() {
		this.render();
	}

	// ── Log actions to Markdown Note ──────────────────────────────────────────

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
		const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
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
					const m = lines[i].match(headerRegex);
					if (m && m[2].trim().toLowerCase() === targetName) {
						headerIndex = i;
						break;
					}
				}
				
				if (headerIndex !== -1) {
					// Find end of section (next header of equal or higher level, or EOF)
					let insertIndex = lines.length;
					for (let i = headerIndex + 1; i < lines.length; i++) {
						const m = lines[i].match(headerRegex);
						if (m) {
							const level = m[1].length;
							if (level <= targetLevel) {
								insertIndex = i;
								break;
							}
						}
					}
					
					// Insert line
					lines.splice(insertIndex, 0, logLine);
					await this.app.vault.modify(file, lines.join("\n"));
					return;
				}
			}
			
			// If header is not found, append to end
			const newContent = content.trimEnd() + `\n\n${targetHeader}\n${logLine}\n`;
			await this.app.vault.modify(file, newContent);
		} catch (e) {
			console.error("Error writing to combat log:", e);
			new Notice(lang === "es" ? "Error al escribir en el registro de combate." : "Error writing to combat log.");
		}
	}

	triggerLogSetup() {
		if (this.activeLogFile || this.logDismissed || this.logSetupInProgress) {
			return;
		}

		this.logSetupInProgress = true;
		// Lazy import to resolve circular dependencies cleanly at runtime
		const { LogSetupModal } = require("./modals");
		new LogSetupModal(this.app, this.plugin, this, async (file: TFile | null) => {
			this.logSetupInProgress = false;
			if (file) {
				this.activeLogFile = file;
				this.logDismissed = false;
				const lang = this.plugin.settings.language;
				
				// Process queue
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
		// Create folder if it doesn't exist
		if (folderPath) {
			const folderExists = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folderExists) {
				await this.app.vault.createFolder(folderPath);
			}
		}
		
		// Format name
		const now = new Date();
		const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
		let fileName = this.plugin.settings.logFileName.replace("{date}", dateStr);
		if (!fileName.endsWith(".md")) fileName += ".md";
		
		const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;
		
		// Handle duplicates
		let uniquePath = fullPath;
		let counter = 1;
		while (this.app.vault.getAbstractFileByPath(uniquePath)) {
			uniquePath = fullPath.replace(/\.md$/, ` (${counter}).md`);
			counter++;
		}
		
		const header = this.plugin.settings.logHeader;
		const initialContent = `# ${fileName.replace(/\.md$/, "")}\n\n${header}\n`;
		const file = await this.app.vault.create(uniquePath, initialContent);
		return file;
	}

	// ── Read a TFile and build a Combatant ──────────────────────────────────

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

		return {
			id: file.path,
			name: file.basename,
			initiative: Number(meta[f.initiative] ?? 0) || 0,
			hp,
			hpMax,
			ac: Number(meta[f.ac] ?? 10) || 10,
			combatType: String(meta[f.type] ?? "NPC"),
			extraFields,
			conditions: [],
			notes: "",
			alive: true,
			file,
		};
	}

	// ── Load combatants from vault ──────────────────────────────────────────

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
			files = this.app.vault
				.getMarkdownFiles()
				.filter((f) => f.path.startsWith(folder + "/"));
		} else {
			// Let user pick from a modal
			new PickCombatantsModal(this.app, this.plugin, async (picked) => {
				const loaded = await Promise.all(picked.map((f) => this.fileToCombatant(f)));
				// Merge: keep existing state for already-loaded combatants
				for (const c of loaded) {
					if (!this.combatants.find((x) => x.id === c.id)) {
						this.combatants.push(c);
					}
				}
				
				// Log loading
				loaded.forEach(c => {
					const logMsg = lang === "es" 
						? `Combatiente cargado: ${c.name} (Iniciativa: ${c.initiative}, PV: ${c.hp}/${c.hpMax})`
						: `Combatant loaded: ${c.name} (Initiative: ${c.initiative}, HP: ${c.hp}/${c.hpMax})`;
					this.writeToLog(logMsg);
				});

				this.render();
				if (this.combatants.length > 0) {
					this.triggerLogSetup();
				}
			}).open();
			return;
		}

		const loaded = await Promise.all(files.map((f) => this.fileToCombatant(f)));
		for (const c of loaded) {
			if (!this.combatants.find((x) => x.id === c.id)) {
				this.combatants.push(c);
			}
		}

		// Log loading
		loaded.forEach(c => {
			const logMsg = lang === "es" 
				? `Combatiente cargado: ${c.name} (Iniciativa: ${c.initiative}, PV: ${c.hp}/${c.hpMax})`
				: `Combatant loaded: ${c.name} (Initiative: ${c.initiative}, HP: ${c.hp}/${c.hpMax})`;
			this.writeToLog(logMsg);
		});

		this.render();
		if (this.combatants.length > 0) {
			this.triggerLogSetup();
		}
	}

	// ── Sorted combatants by initiative ────────────────────────────────────

	sorted(): Combatant[] {
		return [...this.combatants].sort((a, b) => b.initiative - a.initiative);
	}

	aliveSorted(): Combatant[] {
		return this.sorted().filter((c) => c.alive);
	}

	// ── Advance turn ───────────────────────────────────────────────────────

	nextTurn() {
		const alive = this.aliveSorted();
		if (!alive.length) return;
		this.currentTurn = (this.currentTurn + 1) % alive.length;
		if (this.currentTurn === 0) this.round++;
		
		const currentC = alive[this.currentTurn];
		const lang = this.plugin.settings.language;
		const logMsg = lang === "es"
			? `Turno de ${currentC.name}`
			: `Turn of ${currentC.name}`;
		this.writeToLog(logMsg);

		this.render();
	}

	// ── Apply damage / heal ────────────────────────────────────────────────

	applyDmg(id: string, amount: number, heal: boolean) {
		const c = this.combatants.find((x) => x.id === id);
		if (!c) return;
		const lang = this.plugin.settings.language;

		if (heal) {
			c.hp = Math.min(c.hpMax, c.hp + amount);
			const logMsg = lang === "es"
				? `${c.name} se cura ${amount} PV (PV: ${c.hp}/${c.hpMax})`
				: `${c.name} heals ${amount} HP (HP: ${c.hp}/${c.hpMax})`;
			this.writeToLog(logMsg);
		} else {
			c.hp = Math.max(0, c.hp - amount);
			const logMsg = lang === "es"
				? `${c.name} recibe ${amount} de daño (PV: ${c.hp}/${c.hpMax})`
				: `${c.name} takes ${amount} damage (HP: ${c.hp}/${c.hpMax})`;
			this.writeToLog(logMsg);
			if (c.hp === 0) {
				c.alive = false;
				const defeatMsg = lang === "es"
					? `${c.name} ha sido derrotado`
					: `${c.name} has been defeated`;
				this.writeToLog(defeatMsg);
			}
		}
		this.render();
	}

	// ── Toggle condition ───────────────────────────────────────────────────

	toggleCondition(id: string, cond: string) {
		const c = this.combatants.find((x) => x.id === id);
		if (!c) return;
		const lang = this.plugin.settings.language;
		const idx = c.conditions.indexOf(cond);
		if (idx >= 0) {
			c.conditions.splice(idx, 1);
			const logMsg = lang === "es"
				? `${c.name} pierde la condición: ${cond}`
				: `${c.name} loses condition: ${cond}`;
			this.writeToLog(logMsg);
		} else {
			c.conditions.push(cond);
			const logMsg = lang === "es"
				? `${c.name} obtiene la condición: ${cond}`
				: `${c.name} gains condition: ${cond}`;
			this.writeToLog(logMsg);
		}
		this.render();
	}

	// ── Modify extra field ─────────────────────────────────────────────────

	modExtra(id: string, key: string, delta: number) {
		const c = this.combatants.find((x) => x.id === id);
		if (!c) return;
		const lang = this.plugin.settings.language;
		c.extraFields[key] = Math.max(0, (c.extraFields[key] ?? 0) + delta);
		
		const logMsg = lang === "es"
			? `${c.name} - ${key.toUpperCase()} modificado a ${c.extraFields[key]}`
			: `${c.name} - ${key.toUpperCase()} modified to ${c.extraFields[key]}`;
		this.writeToLog(logMsg);

		this.render();
	}

	// ── Remove combatant ───────────────────────────────────────────────────

	removeCombatant(id: string) {
		const c = this.combatants.find((x) => x.id === id);
		const lang = this.plugin.settings.language;
		if (c) {
			const logMsg = lang === "es"
				? `${c.name} retirado del combate`
				: `${c.name} removed from combat`;
			this.writeToLog(logMsg);
		}
		this.combatants = this.combatants.filter((x) => x.id !== id);
		this.render();
	}

	// ── Reset battle ───────────────────────────────────────────────────────

	resetBattle() {
		const lang = this.plugin.settings.language;
		this.writeToLog(LOCALIZATION[lang].logEnded);
		this.combatants = [];
		this.round = 1;
		this.currentTurn = 0;
		this.activeLogFile = null;
		this.logDismissed = false;
		this.logQueue = [];
		this.render();
	}

	// ── Main render ────────────────────────────────────────────────────────

	render() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("bt-panel");

		const lang = this.plugin.settings.language;
		const t = LOCALIZATION[lang];

		const conditionEntries = this.plugin.settings.conditions;
		const conditions = conditionEntries.map(e => e.name);

		// ── Top bar ──────────────────────────────────────────────────────

		const topBar = container.createDiv("bt-topbar");

		const roundEl = topBar.createDiv("bt-round-badge");
		roundEl.setText(`${t.round} ${this.round}`);

		const topActions = topBar.createDiv("bt-top-actions");

		const nextBtn = topActions.createEl("button", { cls: "bt-btn bt-btn-primary" });
		nextBtn.innerHTML = t.nextTurn;
		nextBtn.onclick = () => this.nextTurn();

		const loadBtn = topActions.createEl("button", { cls: "bt-btn" });
		loadBtn.innerHTML = t.load;
		loadBtn.onclick = () => this.loadFromVault();

		if (this.plugin.settings.logEnabled) {
			const logBtn = topActions.createEl("button", { 
				cls: `bt-btn${this.activeLogFile ? " bt-btn-primary" : ""}`, 
				title: t.logSelectLogFileButton 
			});
			logBtn.innerHTML = `📝 ${this.activeLogFile ? (lang === "es" ? "Registrando" : "Logging") : (lang === "es" ? "Registro" : "Log")}`;
			logBtn.onclick = () => this.triggerLogSetup();
		}

		const resetBtn = topActions.createEl("button", { cls: "bt-btn bt-btn-danger-soft" });
		resetBtn.innerHTML = t.reset;
		resetBtn.onclick = () => {
			if (confirm(t.resetConfirm)) this.resetBattle();
		};

		// ── Initiative strip ─────────────────────────────────────────────

		if (this.aliveSorted().length) {
			const strip = container.createDiv("bt-init-strip");
			const alive = this.aliveSorted();
			alive.forEach((c, i) => {
				const chip = strip.createDiv(`bt-init-chip${i === this.currentTurn % alive.length ? " active" : ""}`);
				chip.setText(`${c.name} (${c.initiative})`);
			});
		}

		// ── Empty state ──────────────────────────────────────────────────

		if (!this.combatants.length) {
			const empty = container.createDiv("bt-empty");
			empty.createEl("p", { text: t.emptyState });
			return;
		}

		// ── Combatant cards ──────────────────────────────────────────────

		const alive = this.aliveSorted();
		const allSorted = this.sorted();

		allSorted.forEach((c) => {
			const aliveIdx = alive.findIndex((x) => x.id === c.id);
			const isActive = c.alive && aliveIdx === this.currentTurn % Math.max(alive.length, 1);
			const ratio = c.hp / c.hpMax;

			const card = container.createDiv(`bt-card${isActive ? " bt-card-active" : ""}${!c.alive ? " bt-card-dead" : ""}`);

			// Card header
			const header = card.createDiv("bt-card-header");
			const avatarWrap = header.createDiv("bt-avatar bt-avatar-" + (c.combatType === "PC" ? "pc" : c.combatType === "Enemy" ? "enemy" : "npc"));
			avatarWrap.setText(c.name.slice(0, 2).toUpperCase());

			const nameWrap = header.createDiv("bt-name-wrap");
			const nameEl = nameWrap.createEl("span", { cls: "bt-name", text: c.name });
			nameEl.style.cursor = "pointer";
			nameEl.title = lang === "es" ? "Abrir nota" : "Open note";
			nameEl.onclick = () => this.app.workspace.getLeaf(true).openFile(c.file);

			nameWrap.createEl("span", {
				cls: "bt-sub",
				text: `${t.init} ${c.initiative} · ${t.ac} ${c.ac}`,
			});

			const badge = header.createDiv(`bt-badge bt-badge-${c.combatType === "PC" ? "pc" : c.combatType === "Enemy" ? "enemy" : "npc"}`);
			badge.setText(c.combatType);

			const removeBtn = header.createEl("button", { cls: "bt-btn-icon", title: t.removeTitle });
			removeBtn.setText("✕");
			removeBtn.onclick = () => this.removeCombatant(c.id);

			// Conditions
			if (c.conditions.length) {
				const condRow = card.createDiv("bt-cond-row");
				c.conditions.forEach((cond) => {
					const tag = condRow.createDiv("bt-cond-tag");
					tag.setText(cond + " ×");
					// Apply Option A: color as text + border, semi-transparent bg
					const entry = conditionEntries.find(e => e.name === cond);
					if (entry?.color) {
						tag.style.color = entry.color;
						tag.style.borderColor = entry.color;
						tag.style.backgroundColor = entry.color + "22";
					}
					tag.onclick = () => this.toggleCondition(c.id, cond);
				});
			}

			// HP bar
			const hpWrap = card.createDiv("bt-hp-wrap");
			const hpLabelRow = hpWrap.createDiv("bt-hp-label-row");
			hpLabelRow.createEl("span", { text: t.hp, cls: "bt-label" });
			hpLabelRow.createEl("span", { cls: "bt-hp-text", text: `${c.hp} / ${c.hpMax}` });

			const bar = hpWrap.createDiv("bt-bar");
			const fill = bar.createDiv("bt-bar-fill");
			fill.style.width = `${Math.max(0, ratio * 100)}%`;
			fill.className = `bt-bar-fill ${ratio > 0.6 ? "bt-hp-ok" : ratio > 0.3 ? "bt-hp-mid" : "bt-hp-low"}`;

			// Extra fields
			const extraNames = Object.keys(c.extraFields);
			if (extraNames.length) {
				const extraRow = card.createDiv("bt-extra-row");
				extraNames.forEach((key) => {
					const box = extraRow.createDiv("bt-extra-box");
					box.createEl("span", { cls: "bt-label", text: key.toUpperCase() });
					const valRow = box.createDiv("bt-extra-val-row");
					const minusBtn = valRow.createEl("button", { cls: "bt-btn-mini", text: "−" });
					minusBtn.onclick = () => this.modExtra(c.id, key, -1);
					valRow.createEl("span", { cls: "bt-extra-val", text: String(c.extraFields[key]) });
					const plusBtn = valRow.createEl("button", { cls: "bt-btn-mini", text: "+" });
					plusBtn.onclick = () => this.modExtra(c.id, key, 1);
				});
			}

			// Notes
			if (c.notes) {
				card.createEl("p", { cls: "bt-notes", text: c.notes });
			}

			// Action row
			const actions = card.createDiv("bt-actions");

			const dmgBtn = actions.createEl("button", { cls: "bt-btn bt-btn-danger-soft" });
			dmgBtn.setText(t.damageHeal);
			dmgBtn.onclick = () => new DmgModal(this.app, c.name, this.plugin, (val, heal) => {
				this.applyDmg(c.id, val, heal);
			}).open();

			const condBtn = actions.createEl("button", { cls: "bt-btn" });
			condBtn.setText(t.status);
			condBtn.onclick = () => new ConditionModal(this.app, conditionEntries, c.conditions, this.plugin, (updated) => {
				const removed = c.conditions.filter(x => !updated.includes(x));
				const added = updated.filter(x => !c.conditions.includes(x));

				c.conditions = updated;

				added.forEach(cond => {
					const logMsg = lang === "es"
						? `${c.name} obtiene la condición: ${cond}`
						: `${c.name} gains condition: ${cond}`;
					this.writeToLog(logMsg);
				});
				removed.forEach(cond => {
					const logMsg = lang === "es"
						? `${c.name} pierde la condición: ${cond}`
						: `${c.name} loses condition: ${cond}`;
					this.writeToLog(logMsg);
				});

				this.render();
			}).open();

			const noteBtn = actions.createEl("button", { cls: "bt-btn" });
			noteBtn.setText(t.note);
			noteBtn.onclick = () => new NoteModal(this.app, c.notes, this.plugin, (txt) => {
				c.notes = txt;
				const logMsg = lang === "es"
					? `${c.name} - Nota: ${txt || "vaciada"}`
					: `${c.name} - Note: ${txt || "cleared"}`;
				this.writeToLog(logMsg);
				this.render();
			}).open();

			if (c.alive) {
				const defeatBtn = actions.createEl("button", { cls: "bt-btn bt-btn-ghost" });
				defeatBtn.setText(t.defeat);
				defeatBtn.onclick = () => {
					c.alive = false;
					c.hp = 0;
					const logMsg = lang === "es"
						? `${c.name} ha sido derrotado`
						: `${c.name} has been defeated`;
					this.writeToLog(logMsg);
					this.render();
				};
			} else {
				const revBtn = actions.createEl("button", { cls: "bt-btn" });
				revBtn.setText(t.revive);
				revBtn.onclick = () => {
					c.alive = true;
					c.hp = 1;
					const logMsg = lang === "es"
						? `${c.name} ha resucitado`
						: `${c.name} has been revived`;
					this.writeToLog(logMsg);
					this.render();
				};
			}
		});

		// ── Styles loaded from styles.css ───────────────────────────────
	}

	async onClose() {
		// Nothing to clean up — styles are in styles.css
	}
}
