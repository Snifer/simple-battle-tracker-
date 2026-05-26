# Contributing to Combat Ledger

Thanks for taking the time to contribute! 🎲

## Getting Started

### Prerequisites
- Node.js 16+
- A test Obsidian vault

### Setup
```bash
git clone https://github.com/snifer/combat-ledger
cd combat-ledger
npm install
```

### Development workflow

**Watch mode** (rebuilds on save):
```bash
npm run dev
```

Copy or symlink the plugin folder into your test vault:
```bash
ln -s $(pwd) /path/to/your/vault/.obsidian/plugins/combat-ledger
```

Then enable the plugin in Obsidian. Every time the dev server rebuilds, reload Obsidian with `Ctrl+R` or the `Reload app without saving` command.

**Production build:**
```bash
npm run build
```

---

## Project Structure

```
src/                     # Source directory
  ├── main.ts            # Plugin entry point, command registrations, ribbon activation
  ├── types.ts           # TypeScript interfaces (Combatant, Settings, FieldMapping)
  ├── localization.ts    # UI Translation dictionary (English / Spanish)
  ├── settings.ts        # Settings default values and settings tab GUI
  ├── view.ts            # Sidebar panel View, turn order logic, and markdown logger
  └── modals.ts          # Interactive modal dialogs (Damage/Heal, Conditions, Notes, Pickers, Log Setup)

manifest.json            # Plugin metadata (required by Obsidian)
package.json             # Dependencies and build scripts
tsconfig.json            # TypeScript configuration
esbuild.config.mjs       # esbuild bundler configuration
```

---

## How to Contribute

### Bug reports
Open an issue with:
- Obsidian version
- Plugin version
- Steps to reproduce
- Expected vs actual behavior

### Feature requests
Open an issue describing the feature and the use case (which system? which workflow?).

### Pull Requests
- Keep PRs focused — one feature or fix per PR
- Update the README if you add a user-facing feature
- Update `manifest.json` version following [semver](https://semver.org/)
- Add an entry to `CHANGELOG.md`

---

## Code Style

- TypeScript strict mode is on — no `any` unless truly unavoidable
- Use Obsidian's DOM helpers (`createEl`, `createDiv`) instead of raw `innerHTML` where possible
- Keep styles in the `injectStyles()` method inside `src/view.ts` using Obsidian CSS variables for theme compatibility

---

## Release Process (maintainer)

1. Update version in `manifest.json` and `package.json`
2. Add release notes to `CHANGELOG.md`
3. Commit: `git commit -m "chore: release vX.Y.Z"`
4. Tag: `git tag X.Y.Z`
5. Push: `git push && git push --tags`
6. GitHub Actions will build and create the release automatically
