# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-05-23

### Added
- Sidebar panel with initiative order strip.
- Load combatants from any vault notes via searchable modal.
- Auto-load from a configured folder (bestiary support).
- Configurable YAML field mapping (initiative, hp, hp_max, ac, type).
- Unlimited extra numeric fields (mp, stamina, stress, ki…).
- Damage / healing modal per combatant.
- Conditions / status effects modal with customizable condition list.
- Quick notes per combat.
- HP bar with color coding (green / yellow / red).
- Defeat / revive combats.
- Round counter.
- Settings tab for all field names and conditions.
- Combat template notes: `TEMPLATE_Combat.md` (English) and `PLANTILLA_COMBATIENTE` (Spanish).
- Dual language support (English / Spanish) switch in settings, dynamically translating the interface, condition lists, headers, and file names.
- Dynamic combat log system:
  * Prompts to create a new note, use an existing note (searchable list), or run in-memory only.
  * Chronologically appends logs under a customizable Markdown header in the note.
  * Automatically handles missing folder creation and file naming patterns with `{date}`.
- Refactored code architecture into a clean, modular structure under `src/` directory:
  * `main.ts` (Entry Point & Commands)
  * `types.ts` (Data Models)
  * `localization.ts` (Translations)
  * `settings.ts` (Config & Setting Tab Panel)
  * `view.ts` (Battle Tracker View Panel & Combats Flow)
  * `modals.ts` (UI Popups & Choice Modals)

---

## [1.0.1] - 2026-05-25

### Fixed
- Corrected plugin `id` in `manifest.json` to match the expected Obsidian plugin identifier.

---

## [1.0.2] - 2026-05-25

### Added
- **Per-condition color customization** in Settings → Conditions / States:
  * Each condition now has an individual color picker (native browser color input).
  * Colors are applied to condition badges in the combat view (text + border tinted, semi-transparent background — Option A style).
  * Colors are also reflected in the condition toggle modal, making it easy to identify statuses at a glance.
  * Default palette: each of the 10 built-in conditions ships with a distinct preset color (amber, green, violet, orange, slate, blue, purple, red, stone, dark).
- **Add new conditions** with a custom name and color directly from the Settings panel.
- **Delete any condition** from the list via a per-row delete button.
- **Automatic data migration**: existing installations that stored conditions as a comma-separated string are silently upgraded to the new `ConditionEntry[]` format on first load, preserving all custom condition names.
- **Refactored UI styling architecture:** Migrated component styles to a dedicated `styles.css` file. 
  * Organized styles into clean, commented sections:
    * Panel, top bar, buttons.
    * Initiative tracker, combatant cards, avatars, type badges.
    * Condition tags, HP bar, extra fields, notes, actions.
    * Modals (damage, conditions, notes, pick, log).
    * Settings section (condition color management).
  * Streamlined codebase by cleaning up style-related code in `view.ts` and `settings.ts`.

## [1.0.3] - 2026-05-26

### Changed
- Rename plug-in from Simple Battle Tracker to Combat Ledger.
- Update all the files with the new name.


## [1.0.4] - 2026-05-26

### Changed
- Replaced deprecated `builtin-modules` dependency with the native Node.js `builtinModules` API.
- Updated the release workflow to generate GitHub artifact attestations for release assets.

### Fixed
- Updated the plugin description to comply with Obsidian community review guidelines.

### Security
- Release assets now include provenance attestations for cryptographic verification.