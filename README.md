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
| `tests/` | What can be checked without a workspace, run with `npm test` |
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

`npm test` runs `tests/`: esbuild bundles each `*.test.ts` with the `obsidian` import pointed at
`tests/obsidian-stub.ts`, node runs it, and a file that throws fails. Obsidian cannot be driven from
a shell, so these cover the modules that need no workspace — the compactor and card geometry, the
sidecar and frontmatter rules, chips and search, and `ingest`'s duplicate branches against a fake
vault. Everything about views, transitions and window chrome still has to be looked at in the app.

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

## The head, the composer and the places

The search box and the plus button hold the top of the pane while the grid scrolls under them, on
both platforms; in a standalone window the drag band rides along with them, so the window can still
be moved once the grid has been scrolled.

The plus button is square, beside the search box, and offers the two ways in: **New note**, which
writes a note into the intake folder and expands it straight into its editor, and **Add files**,
which opens the file picker. Files also arrive by drag and drop or from the share sheet, and a card
for a file that has just arrived drops into the grid.

A phone also carries a round toggle above those places for standalone mode, which otherwise hides
the navbar and puts Obsidian's own settings a long way off. It is there for trying the mode out, and
nothing but mobile shows it.

Along the bottom of a phone sit three places — everything, spaces, serendipity — as placeholders.
They are deliberately not wired up to anything yet.

## On a phone

Fewer columns, from the container width: a narrow screen may pack cards into 160px columns rather
than 240px, so a phone gets a two-column grid in portrait instead of one card per screen. **Columns
on a phone** in the settings pins it to one or two instead.

The search box does not take the cursor on a phone, because the keyboard would come up over a grid
the reader opened to scroll. Obsidian's own sheet animation is the only movement on mobile — the
card transitions and the staggered fade sit out — except the drop-in the composer earns.

The expanded card is hosted in one of Obsidian's own modals, rendered into it through a portal. A
modal is a history handler, so the Android back gesture closes the card instead of leaving the app,
a tap outside closes it, and it arrives as a full-screen sheet with Obsidian's own animation — which
is why the shared-element view transition sits out on mobile. The header carries a back arrow where
an Android reader looks for one, and the × steps aside. Down the sheet it is plain block flow — the
editor or the image, then the side pane below it — so nothing is asked to shrink and the whole sheet
scrolls.

## Trying it on a phone

The plugin is three files — `main.js`, `manifest.json`, `styles.css` — copied into
`<vault>/.obsidian/plugins/telegrid/` on the device, with Restricted mode off and Telegrid enabled
in Community plugins.

```sh
npm run deploy                              # builds, then copies into ./dist/telegrid
TELEGRID_DEST=~/Music/telegrid-dist npm run deploy
```

That leaves a plain `telegrid` folder to drag across — over FTP, say. Obsidian Sync with installed
plugins turned on, or a tagged GitHub release through BRAT, saves doing it by hand at all.

Content hashing needs `crypto.subtle` and so a secure context. Obsidian's own windows are one, but
where it is missing the intake says so once and takes the file in without a hash rather than
swallowing it — dedupe is what degrades, not the import.

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

In the middle of that band sits the way to the settings, arriving and leaving with the window
buttons, because standalone mode hides every other route to them. The settings window is not part of
the public API, so if `app.setting` is ever not there the button says where to look instead of
failing quietly.

**Appearance** in the settings dresses the pane light or dark on its own. `.theme-dark` and
`.theme-light` go on the pane and on the sheets, which are Obsidian's own modals and live outside
it, and that gives those subtrees the other palette — but it changes nothing visible on its own. The
palette is the `--color-base-*` ramp; the names everything is drawn with (`--background-primary` and
the rest) are declared on `body` in terms of the ramp, so they are resolved there and reach the pane
already decided.

So `src/theme.ts` declares those names again, for the pane alone. Rather than pin a copy of
Obsidian's mappings into the stylesheet, it reads them back out of the live stylesheets: whatever
this Obsidian and this theme declare on `body`, and whatever leans on the ramp however many names
deep, is re-declared in a scoped `<style>` and recomputed from the ramp the pane now has. It is
rebuilt when Obsidian fires `css-change`, and a handful of core names are also written plainly in
`styles.css` so the pane's own furniture flips even if that walk comes back empty.

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
