# Telegrid

An Obsidian plugin that opens onto a masonry search pane over the vault, on desktop and Android.

Type into the big box; words become chips, chips narrow the search, removing one widens it again.
An empty box shows every note and image, most recently modified first. Clicking a note expands it
into an editor with a metadata box beside it; clicking an image opens a lightbox with its tags and a
place for thoughts. The plus button makes a note or takes in files, and so does dropping files on
the pane or sharing them to Obsidian from your phone.

## Layout of the source

| File | What lives there |
|---|---|
| `src/main.ts` | The plugin: settings, view registration, vault events, standalone mode |
| `src/view.tsx` | The `ItemView` that mounts React |
| `src/App.tsx` | The pane: chips, results, paging, intake, overlays |
| `src/index.ts` | The in-memory index of notes and images, kept current by vault events |
| `src/search.ts` | Chips, `prepareSimpleSearch` matching, excerpts |
| `src/compact.ts` | The shortest-column compactor and the card geometry |
| `src/ingest.ts` | The one intake path: hash, dedupe, write |
| `src/share.ts` | Mobile share intake and the bring-back |
| `src/sidecar.ts` | `<name>.<ext>.md` beside an image: its tags and thoughts |
| `src/writes.ts` | The flag that tells the plugin's own writes from a shared file |
| `src/components/` | Search box, card, masonry, note overlay, lightbox, metadata box, editor |
| `src/confirm.ts` | The yes-or-no modal duplicates are asked about |
| `src/borrowed.ts` | The flag that says the overlay has one of Obsidian's leaves on loan |
| `src/window.ts` | Toggling maximize, the one call that leaves Obsidian's API behind |

## Dev loop

```sh
npm install
npm run dev                                            # esbuild watch
ln -s "$PWD" "<vault>/.obsidian/plugins/telegrid"      # symlink into a dev vault
touch .hotreload                                       # Hot Reload reloads on rebuild
```

`npm run build` typechecks and writes a minified `main.js`. `app.emulateMobile(true)` in the
developer console previews the mobile layout.

## The expanded note

Clicking a note card borrows Obsidian's own markdown editor: a real markdown leaf is created out of
sight in the right sidebar, and its view is moved into the overlay. That brings live preview with it
— headings, links, embeds and images render as they are typed — and the view saves the file itself.
The borrowed leaf is detached when the overlay closes, and the empty husk it leaves behind is hidden
by a stylesheet rule. If a leaf cannot be borrowed, the overlay falls back to a plain CodeMirror
editor over the file's text, writing through `vault.process`.

The cursor stays out of the note until it is clicked, so the first line opens as a rendered heading
rather than as `# title` under a caret. **Focus the editor on open** in the settings puts the cursor
there straight away instead. Closing blurs the editor before the transition starts, so the text the
card shrinks into is the rendered text.

While a leaf is on loan it counts as Obsidian's active leaf, so the plugin treats a borrowed editor
as the grid rather than as somewhere else, and closing the overlay hands the active leaf back.

"Open in Obsidian" puts the note in its own tab and adds a **Back to Telegrid** action to that tab's
header. In standalone mode, where the ribbon and tab bar are hidden, a pill in the bottom-left
corner appears whenever the grid is up but something else is in front of it. Both ways back reveal
the grid *and* make it the active pane — revealing alone leaves the pill hanging around until
something is clicked.

## Tags

The tag box writes to frontmatter, so Obsidian's own tag pane sees everything added here. A tag
appears the moment it is typed and is reconciled against the index afterwards, because the write
only comes back through the metadata cache — and a note open in an editor can take a couple of
seconds to get there. A write that fails rolls the tag back and says so. The × is only on tags that
live in frontmatter: a `#tag` written in the body belongs to the body. Suggestions come from the
index, so they are the tags already in the vault.

The index is taken again when `metadataCache` fires `resolved`: before that, tags and headings read
as empty for files the cache has not reached yet.

## Standalone chrome

Standalone mode hides the ribbon, tab bar, sidebars and status bar with a stylesheet, and on Android
the navbar too. The titlebar's back and forward arrows are hidden as well — the grid keeps no
navigation history for them to walk. The window buttons fade out and come back when the pointer
reaches the top edge of the window, a band as tall as `--titlebar-height`.

In a frameless window Obsidian's draggable region is the tab header bar, so hiding it leaves the
window with nothing to drag by. The top band of the window takes that job: a mouse-down there moves
the window, a double-click maximizes it, and the window buttons fade in and out of it. The listeners
are on the document and keyed on the pointer's distance from the top edge, so whatever happens to be
in that band answers — the pane's own drag band, a view header, the titlebar overlay — and anything
in it that is there to be clicked is left alone. The grid's view header is hidden in standalone
along with the titlebar arrows and the sidebar toggles: no history to walk, no sidebar to toggle. A
note opened in Obsidian keeps its header, which is where the way back lives.

Moving and maximizing go through Electron's window, the way Obsidian's own titlebar buttons do —
`src/window.ts`, the single place the plugin steps outside Obsidian's API and the browser. It is
desktop-only and feature-detected, the settings tab says whether this window handed a handle over,
and without one the band falls back to a CSS `app-region: drag` region. Android never touches it.

## Two notes on the implementation

- **A known hash asks before it writes.** Drop or pick a file whose contents are already in the
  vault and Telegrid asks: add it again, or open the one you have. Dismissing the question opens the
  existing card and writes nothing. Shared items are the same question from the other side — the
  share target has already written the copy, so the choice is to keep it or move it to the trash,
  and dismissing the question keeps it. A hash held by several cards resolves to the newest.
- **`@codemirror/commands` is declared, not installed.** Obsidian ships the CodeMirror 6 modules and
  hands them to plugins at runtime, so they are external to the bundle. `@codemirror/state` and
  `@codemirror/view` come with types through the `obsidian` package; the few pieces of
  `@codemirror/commands` the editor uses are declared in `src/codemirror.d.ts` instead of adding a
  dependency.
