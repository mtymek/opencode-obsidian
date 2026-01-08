## Context

This plugin embeds the OpenCode AI assistant into Obsidian by spawning a local server process and displaying its web UI in an iframe within the Obsidian sidebar. The design prioritizes simplicity and reliability for the MVP.

**Constraints:**
- Desktop-only (requires Node.js child_process APIs)
- Must work within Obsidian's plugin sandbox
- OpenCode CLI must be installed separately by the user

## Goals / Non-Goals

**Goals:**
- Seamless embedding of OpenCode UI in Obsidian sidebar
- Reliable server process lifecycle management
- Configurable server and project settings
- Quick access via ribbon icon and keyboard shortcut

**Non-Goals:**
- Mobile support (not possible due to Node.js dependencies)
- Native UI rendering (OpenCode provides its own web UI)
- Multiple simultaneous OpenCode instances
- Deep Obsidian integration (file linking, note references)

## Decisions

### 1. Iframe Embedding vs Native Rendering
**Decision:** Embed OpenCode's web UI via iframe rather than building native Obsidian UI.

**Rationale:**
- Can be up and running quickly
- OpenCode already provides a full-featured web interface
- Reduces maintenance burden - UI updates come from OpenCode automatically
- Allows feature parity with standalone OpenCode web experience

**Trade-offs:**
- Limited ability to customize UI appearance
- Requires CORS configuration (`--cors app://obsidian.md`)
- Iframe isolation limits some interactions

### 2. Process State Machine
**Decision:** Use a 4-state machine: `stopped` → `starting` → `running` | `error`

**Rationale:**
- Clear, predictable state transitions
- Enables reactive UI that shows appropriate content for each state
- Prevents race conditions (can't start while starting)

**States:**
- `stopped`: Server not running, show start button
- `starting`: Spawn initiated, polling health endpoint, show spinner
- `running`: Health check passed, show iframe
- `error`: Spawn failed or health check timeout, show retry option

### 3. Lazy Start Strategy
**Decision:** Start server when view opens, not when plugin loads.

**Rationale:**
- Faster Obsidian startup (server spawn is ~2-5 seconds)
- User may not need OpenCode every session
- Auto-start available as opt-in setting for users who prefer it

**Implementation:** `OpenCodeView.onOpen()` calls `plugin.startServer()` if state is `stopped`.

### 4. Health Check Polling
**Decision:** Poll `/global/health` endpoint every 500ms during startup, with 15-second timeout.

**Rationale:**
- Server needs time to initialize before accepting connections
- Polling is simple and reliable
- 15 seconds accommodates slow systems without waiting too long

**Trade-offs:**
- Slight delay before iframe loads (typically 1-3 seconds)
- Could use server stdout parsing instead, but health endpoint is more reliable

### 5. Graceful Shutdown
**Decision:** SIGTERM first, SIGKILL after 2-second timeout.

**Rationale:**
- Allows server to clean up resources gracefully
- SIGKILL fallback ensures process doesn't hang
- 2 seconds is sufficient for typical cleanup

### 6. Project Directory Encoding
**Decision:** Encode project directory as base64 in URL path (e.g., `http://127.0.0.1:14096/{base64-path}`).

**Rationale:**
- OpenCode server supports multiple projects via URL routing
- Base64 handles special characters in paths safely
- Allows future support for switching projects without server restart

### 7. Callback-Based State Subscriptions
**Decision:** Use callback array pattern for state change notifications.

**Rationale:**
- Simpler than event emitters or observables for this scale
- View subscribes to plugin state changes in `onOpen()`
- Immediate notification ensures UI stays in sync

**Implementation:**
```typescript
plugin.onProcessStateChange((state) => {
  this.currentState = state;
  this.updateView();
});
```

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| OpenCode CLI not installed | Clear error message with settings link |
| Port already in use | Health check detects existing server, reuses it |
| Server crash during use | View shows error state, user can retry |
| Slow server startup | 15-second timeout with spinner feedback |

## Open Questions

- Should we support multiple project directories (tabs/switcher)?
- Should settings changes hot-reload the iframe without full restart?
- Should we add connection status indicator in header?
