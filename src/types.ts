import { TFile } from "obsidian";

export interface FieldMapping {
	initiative: string;
	hp: string;
	hp_max: string;
	shield: string;
	ac: string;
	type: string;          // "PC" | "Enemy" | "NPC"
	extra_fields: string;  // comma-separated extra numeric field names
	conditions: string;
}

export interface ConditionEntry {
	name: string;
	color: string; // hex color, e.g. "#a855f7". Empty string = use default style.
}

export interface ActiveCondition {
	name: string;
	duration: number | null;
}

export interface BattleTrackerSettings {
	language: "es" | "en";
	fields: FieldMapping;
	conditions: ConditionEntry[];
	combatantFolder: string;
	realtimeSync: boolean;
	realtimeSyncMode: "pc" | "all";
	shieldAbsorbsDamage: boolean;
	logEnabled: boolean;
	logMode: "new" | "existing" | "ask";
	logHeader: string;
	logFileName: string;
	logFolder: string;
}

export interface Combatant {
	id: string;           // file path
	name: string;
	initiative: number;
	hp: number;
	hpMax: number;
	shield: number;
	ac: number;
	combatType: string;
	extraFields: Record<string, number>;
	conditions: ActiveCondition[];
	notes: string;
	alive: boolean;
	file: TFile;
}
