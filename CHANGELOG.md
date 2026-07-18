# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-07-18

### Fixed

- Prevent mind map nodes and selection glow from painting into adjacent Obsidian sidebars (clip SVG view; remove CSS `drop-shadow` filters that escaped overflow).

## [1.1.0] - 2026-07-18

### Added

- **Radial mind map layout** — Choose outline (rightward list) or radial (balanced left/right) in settings. New root topics auto-balance to the less crowded side; arrow keys follow on-screen direction on left branches.

## [1.0.3] - 2026-05-28

### Fixed

- Stuck keyboard focus when interacting with the view header title; map hotkeys no longer fire from header/title input.
- New mind maps now open as a normal document without a forced rename modal.
- Drag indicator lines now appear reliably while dragging nodes (no inline opacity override).

### Changed

- Renaming a mind map now always uses a modal (`F2` or right-click) instead of inline title editing, eliminating focus chaos between title and map panes.
- Reduced vault enumeration: replaced `getFiles` / `getMarkdownFiles` / `getAllLoadedFiles` with scoped tree walks and incremental `.mindmap` tracking.
- Build no longer depends on the `builtin-modules` package; uses Node's built-in `node:module` instead.
- CSS cleanup: removed `!important` overrides where possible and dropped `mask-image` for the `.mindmap` icon to broaden Obsidian/browser support.

### Added

- GitHub Actions release workflow that builds the plugin on tag push and publishes a release with `main.js`, `manifest.json`, and `styles.css` along with build provenance attestations.

## [1.0.2] - 2026-05-26

### Fixed

- Keep newly added and moved nodes visible in the map pane when adding children/siblings, reordering, or promoting/demoting.
- Pan adjustment uses live node bounds so the view stays correct when Obsidian sidebars resize the editor area.

## [1.0.1] - 2026-05-25

### Changed

- Renamed plugin display name to **Simple Mindmap** for Obsidian community trademark requirements.

## [1.0.0] - 2026-05-24

### Added

- Initial public release for GitHub and Obsidian community plugin submission.
- Keyboard-centric mind map view with `.mindmap` file support.
- Wiki-linked notes, drag-and-drop, multi-select, and undo.
- Markdown outline import/export and full-note compile export.
- Customizable hotkeys and map themes in settings.

[1.0.3]: https://github.com/Creative781/obsimap/releases/tag/1.0.3
[1.0.2]: https://github.com/Creative781/obsimap/releases/tag/1.0.2
[1.0.1]: https://github.com/Creative781/obsimap/releases/tag/1.0.1
[1.0.0]: https://github.com/Creative781/obsimap/releases/tag/1.0.0
