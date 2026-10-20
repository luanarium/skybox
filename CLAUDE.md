# skybox

Skybox is an Obsidian plugin that opens onto a masonry search pane over the vault, running on desktop and Android.

## Conventions

- Obsidian plugin in TypeScript; built and tested on Linux Mint; runs on desktop and Android Obsidian
- Self-contained: only Obsidian's APIs and the browser, with no server of its own, bar the one exception below
- One listening socket, agreed on 2026-10-19: the local hub, so a phone and a computer can keep in step with no cloud between them. Desktop only, behind `Platform.isDesktopApp`, reaching Node's `http` the same guarded way `fs` is already reached, off until switched on, locked to a phrase that is hashed on both ends and never sent, and serving only the folders named in settings. From 0.1.18 it also takes changes back into those same folders, which is the only way anything written on a phone can reach a computer; a write is refused unless the hub still holds the copy the sender said it expected, and the whole of it is behind a setting that can make the hub read-only again. Every file in a served folder travels as bytes, images included; a picture outside them does not, so the served notes are read for what they point at and the switch says where any stray ones are. A deletion is never applied by either end on its own: the device about to lose the file shows a review window, keeping is per file, what is not kept goes to Obsidian's trash rather than being erased, and closing the window keeps everything. Two edits to one note are merged by lines against a content baseline kept beside the plugin, and where they overlap the other side's version is written beside yours carrying `collision_of` and the `collision` tag, so one chip finds every one of them. This is the exception to "no server of its own".
- One external service, agreed on 2026-10-17: Mastodon, and only where the user has connected an account and tagged a note for it. The access token is kept in Obsidian's per-vault local storage, never in `data.json` and never in the vault, so it does not sync or sit among the notes. Posting and deleting always ask first. Nothing is sent anywhere until a note carries the sharing tag.
- A second external service, agreed on 2026-10-19: YouTube, for a bookmarked video, since a watch page has no article to clip and the video is what the page is. The player is an `iframe` from `youtube-nocookie.com`, loaded when such a card is opened and never before, behind its own setting. The top five comments are read by fetching the watch page for the continuation token and key it carries and posting that token to `youtubei/v1/next`, which YouTube documents nowhere: the fragility and the review risk were raised before building and the trade was taken deliberately, so there is no key and no account, nothing is posted or voted on, comments are read only, it sits behind its own setting, and every unexpected shape is an empty list with a line in the card rather than a guess
- Obsidian launches straight into the plugin as a standalone app
- Entry point is a masonry search pane over the vault
- Search box is large, with an italic grayed placeholder "search my vault"
- Typed words become chips on space; chips are removable and removing one widens the search
- A chip beginning `!` asks for what a bookmarked address is for rather than for a word: `!video`, `!music`, `!code`, `!social`, `!shop`, `!wiki`, `!read`. The kind is worked out from the host in `src/kinds.ts` and never written into a note, so a note that says "video" is not a video and a video whose address says nothing is still one
- Results fade in as they surface when chips are added
- An empty search box shows all markdown notes and images
- Clicking a note expands it into its editor, with a metadata box on the right
- A bookmarked video opens as the video: the player first, what the page said about itself underneath, then the top five comments, with nothing above the player but the card's own properties
- A video tagged `music`, or one from a host that only serves music, gets a transport bar instead of a frame: an homage to a desktop player drawn in CSS with no artwork and no product's name on it, keeping the picture as its own visualisation, driven by posting messages at the embed rather than by any library loaded from Google, and showing dashes rather than zeros where the embed says nothing back
- A YouTube embed refuses with one flat message for several reasons, so the frame climbs down rather than guessing: the private host taking instructions, then `youtube.com` taking instructions, then `youtube.com` plainly with its own controls, three seconds a rung. `src/components/useEmbed.ts` holds it and both the plain card and the skinned player use it
- A card from a hashtag wall is its picture alone: the words are in the post and the hashtag is the search that found it
- Images open as a lightbox with tags on the right and a text area below for thoughts and annotations
- A plus button on desktop and mobile creates a new note or adds files through a file picker; desktop also accepts drag and drop
- Intake is deduplicated by content hash: an image or file already imported opens its existing card and creates nothing; one never imported gets a new note
- On mobile, items shared to Obsidian from the OS share sheet are reacted to by the plugin, which then drops the user back into the plugin once the note is created or appended to
- Minimal, themable look using Obsidian's own CSS variables
- Animations use the View Transitions API
- Layout adapts to mobile

## Pipeline

| Role | Piece |
|---|---|
| Plugin | TypeScript, esbuild, official sample-plugin template; React 18 bundled into an `ItemView`; `isDesktopOnly: false`, no Node APIs |
| Masonry layout | react-grid-layout v2 with a custom compactor |
| Search | `metadataCache`, `vault.cachedRead`, `prepareSimpleSearch`, in-memory index |
| File intake | DOM drag-and-drop and `<input type="file">`, written with `vault.create` / `vault.createBinary`; one `ingest(file)` function with SHA-256 via `crypto.subtle.digest` |
| Share intake | Obsidian's built-in mobile share target; the plugin reacts through vault `create` / `modify` events and returns with `workspace.revealLeaf` |
| Expanded editor | CodeMirror 6, provided by Obsidian, writing through `vault.process` |
| Metadata box | `fileManager.processFrontMatter`, `metadataCache` links, file stat |
| Animation | View Transitions API plus CSS keyframes |
| Theming | Obsidian CSS variables |

The view is registered with `registerView` and opened from a ribbon icon, a command, and an "open on startup" setting. The index is built from the vault and kept current by vault events; the editor and metadata box write back through the vault and file manager APIs.

## Search pane

- Space commits the typed word to a chip; backspace on an empty box pops the last chip; each chip has a × that removes it; chips are ANDed; `#word` matches tags only; `!kind` matches what the bookmarked address is for and nothing else
- Empty box shows all markdown notes and images, most recently modified first, in pages (first 100, more on scroll via `IntersectionObserver`)
- Index is in memory: `getMarkdownFiles()` and image files, with tags, frontmatter and headings from `metadataCache`; note content is read with `cachedRead`, cached by mtime, and matched with `prepareSimpleSearch`; updated on vault `create`, `modify`, `delete` and `rename`
- Cards: one title for notes, plain rather than bold, with no excerpt under it, since a clipped page carries its own heading in its body as well as in its properties; a thumbnail (`getResourcePath`) for images; tags only while chips are in the box, because that is when they say why a card is in the results; heights vary

## Masonry

- Every card is `w: 1` in an N-column react-grid-layout grid; a custom compactor places each result in the shortest column in result order, so relevance order is preserved
- Heights come from a `ResizeObserver`, estimated from text length on first paint so nothing jumps
- Dragging and resizing are off; column count follows `useContainerWidth`
- react-grid-layout's transform transitions slide cards when the chip set changes; new results fade in with a short staggered keyframe

## Expanding a card

- `view-transition-name` goes on the clicked card only; `document.startViewTransition` swaps to the overlay carrying the same name
- The root cross-fade is disabled (`::view-transition-group(root) { animation: none }`); feature-detected with an instant fallback; honors `prefers-reduced-motion`
- Expanded note is an embedded CodeMirror 6 editor writing through `vault.process`, with an "Open in Obsidian" button (`leaf.openFile`) for live preview
- Right box shows tags and properties (`processFrontMatter`), links and backlinks (`metadataCache`), and dates (file stat)

## Images

- Images are not notes, so the lightbox edits a sidecar note `<name>.<ext>.md`
- Tags go in the sidecar's frontmatter, so Obsidian's tag pane sees them; thoughts go in its body
- The image and its sidecar are one card in results

## Creating and adding files

- Plus button (desktop and mobile) opens a small menu: New note, Add files
- New note: `vault.create` in the folder set in settings, then the card expands straight into the editor
- Add files: opens `<input type="file" multiple accept="image/*,.md">`, feeding the same handler as drag and drop
- Desktop drag and drop: `dragover` and `drop` handlers on the view call `preventDefault`; each dropped `File` is read with `arrayBuffer()` and written with `vault.createBinary` (images) or `vault.create` (markdown) into the same folder; name collisions get a numeric suffix; other file types are ignored
- A picture dragged out of a browser carries no `File`, only an address: it is read from `text/uri-list`, the dragged HTML's `img` tag or plain text, fetched with `requestUrl`, and taken in as a file, so the vault holds the picture rather than a link
- A picture dropped on a note, on its card or anywhere on an open card but the editor, goes into that note: through `ingest`, then embedded above any extracted article. The card under the drag is outlined first, and a drop that can do nothing says so
- The index remembers the names of pictures a note is waiting on and reads that note again when one arrives, since a fetched picture's line can be written before its bytes
- Every route (plus menu, drag and drop, shared items) goes through `ingest`
- A newly created or added file appears first because the empty-box order is most recently modified first, with the fade-in; adding chips applies normal filtering

## Deduplication

- `ingest(file)` hashes the content (SHA-256, `crypto.subtle.digest`) and compares it with `hash:` in existing sidecars' frontmatter, read from `metadataCache` so images are not re-read
- Known hash: open the existing card and create nothing
- Unknown hash: write a new sidecar note carrying the hash; the card appears first

## Share intake (mobile)

- Obsidian's own mobile share target imports the shared item into the vault; the plugin cannot replace it, so Obsidian's prompt appears first
- The plugin listens for `vault.on('create')` (new note or image) and `modify` (share appended to an existing note), registered inside `onLayoutReady` because the vault fires `create` for every file at load
- Images and files never imported before go through `ingest`; markdown notes just surface
- The plugin's own writes (a flag around `ingest`) and sync arrivals are ignored: it reacts only when the app has just returned to the foreground (`visibilitychange`, within a few seconds); on a cold start from the share sheet it checks for files created in the last few seconds once the layout is ready
- Bring-back: `workspace.revealLeaf` on the search view; if Obsidian opened the destination note in its own leaf, the main leaf is reset to the search view with `setViewState`
- The new or changed item lands first, fading in; ordering by modified time makes an appended-to note surface like a new one
- A setting chooses whether the card also expands straight into the editor (default: stays on the grid)

## Standalone mode

- `onLayoutReady` closes other leaves and opens the search view in the main leaf
- A body class and CSS snippet hide the ribbon, tab bar and sidebars; `body.is-mobile` hides the navbar on Android

## Mobile

- Fewer columns from container width; the lightbox becomes a full-screen sheet with the side pane below

## Dev loop (Mint)

```
npm install
npm run dev                                            # esbuild watch
ln -s "$PWD" "<vault>/.obsidian/plugins/skybox"        # symlink build into a dev vault
touch .hotreload                                       # Hot Reload reloads on rebuild
```

- `app.emulateMobile(true)` in the developer console previews the mobile layout

## Adding App Logic

- Use what the stack already provides first, then mature conventions in the wild that slot in. No new dependencies and no additions to the stack.
- One exception, taken deliberately on 2026-10-17: `defuddle`, pinned exactly, for reading the article out of a bookmarked page. It is the library Obsidian's own Web Clipper uses, it is reached from `src/article.ts` alone, it is loaded on first use rather than at startup, and it runs only on desktop. Raise anything else that would add a dependency rather than adding it.

## Terms

| Term | Meaning |
|---|---|
| Skybox | The plugin |
| Obsidian | Markdown knowledge-base app; the plugin runtime |
| Plugin | The TypeScript Obsidian plugin |
| `ItemView` | Obsidian class for a custom pane view |
| `registerView` | Plugin API call registering a view type |
| `onLayoutReady` | Obsidian hook that runs once the workspace has loaded |
| Leaf | An Obsidian pane |
| Masonry | Layout of variable-height cards packed into columns |
| react-grid-layout | React library for grid layouts; used here for masonry via a custom compactor |
| Compactor | react-grid-layout strategy that arranges items after layout changes |
| `useContainerWidth` | react-grid-layout hook measuring container width |
| Chip | A committed search word shown as a removable bubble in the search box |
| Sidecar note | Markdown note beside an image (`<name>.<ext>.md`) holding its tags and thoughts |
| View Transitions API | Browser API animating shared elements between two DOM states (`document.startViewTransition`) |
| CodeMirror 6 | Editor library bundled with Obsidian |
| `metadataCache` | Obsidian's cache of tags, frontmatter, headings and links |
| `prepareSimpleSearch` | Obsidian API for matching a query against text |
| `cachedRead` | Vault read that serves cached content |
| `processFrontMatter` | Obsidian API for editing a note's frontmatter |
| `ResizeObserver` / `IntersectionObserver` | Browser APIs reporting element size changes / visibility |
| `ingest` | The single function every intake route calls: hash, dedupe, write |
| SHA-256 / `crypto.subtle` | Content hash / browser cryptography API computing it |
| Share target | The OS share-sheet destination Obsidian registers on mobile |
| `revealLeaf` / `setViewState` | Obsidian APIs to bring a pane to the front / set the view a leaf shows |
| `visibilitychange` | Browser event fired when the app returns to or leaves the foreground |
| Hot Reload | Community plugin reloading a plugin on rebuild |
| esbuild | JavaScript/TypeScript bundler |
| React | UI library bundled into the plugin |
