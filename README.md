# dsh-workspace-hide-empty

**English** | [中文](README.zh-CN.md)

Declutters the sidebar's workspace list: a non-default workspace whose sessions have all been
archived is hidden; the default workspace and brand-new workspaces with no real sessions stay
visible.

The host half is empty — all behaviour is in the browser half. It does not modify `app.asar`, any
vendor package, or any field in `workspace.json`.

## Rules

| # | Rule | Decision |
| --- | --- | --- |
| R1 | the default workspace is always visible | `workspaceId === defaultWorkspaceId` → never hide |
| R2 | another workspace is hidden after its last visible session is archived; shown again when any session is unarchived | `real sessions > 0` and `visible sessions === 0` → hide |
| R3 | a newly created workspace with no real session yet is unaffected | `real sessions === 0` → never hide |

Definitions:

- **Real session**: a session header exists and `blank !== true` (`blank` is the "new session"
  placeholder).
- **Visible session**: what the built-in sidebar would actually render in the "hide archived" view,
  matching `sessionVisible(session, current, archived, "default")` — archived sessions do not
  render; `blank` sessions render only when they are the current session.
- A session id with no header is skipped, so the workspace counts as having no real sessions and is
  not hidden.

Confirmed corollary: a new workspace that creates its first real session and then archives it **is**
hidden (it is no longer "has not produced its first real session").

## How it works

1. Reads official client services (no DOM text parsing): `ctx.get('workspaces').list` for workspaces
   and `sessionIds`, `archivedSessionIds`; `ctx.get('sessions').list` for headers; and
   `initializeDefault()` for the default workspace id.
2. Writes one CSS rule for the computed hidden set:
   ```css
   [data-row-key="workspace:<workspaceId>"]{display:none !important}
   ```
   Every sidebar row already has `data-row-key`, so re-renders, virtualization and drag-and-drop do
   not break it.
3. Recomputes on store `subscribe`, a `MutationObserver`, and a 2 s low-frequency fallback.
4. When the current view is "all conversations (show archived)" or "archived only", the plugin
   disables itself entirely and hands control back to the built-in filter.

## Install

```powershell
# Quit DSH completely first.
pwsh -NoProfile -File .\scripts\install.ps1
```

The script copies the package to `%USERPROFILE%\.dsh\plugins\dsh-workspace-hide-empty`, adds the
`link:` dependency and bundle entry, and backs up `package.json` first. Restart DSH afterwards.

## Tests

```powershell
npm test        # 13 cases
```

`scripts/hide-policy-sim.mjs` is an executable specification of the rules; it is kept in sync with
the implementation (the test suite runs the same cases against both).

## Compatibility

DSH 0.2.2-rc.5, Windows 10/11, Node >= 20.

## License

MIT — see [LICENSE](LICENSE). Policy: [SECURITY.md](SECURITY.md).
