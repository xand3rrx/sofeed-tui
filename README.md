# sofeed TUI

A quiet, keyboard-first terminal client for [sofeed.cc](https://sofeed.cc), built with Bun, React, and Ink.

## Run and build

```sh
bun install
bun run dev
bun run build
./dist/sofeed
```

`bun run build:release` cross-compiles supported Linux, macOS, and Windows targets and writes checksums to `dist/SHA256SUMS`.

## Controls

Use arrows or `j`/`k` to move and Enter or `l` to open. `h`, Escape, or `q` goes back; `g`/`G` jumps to the first/last entry. When signed in, the tabs are `1` feed, `2` mentions, `3` replies, `4` saved, `5` trending, and `6` discover; as a guest they are `1` trending and `2` discover. Other global shortcuts are `/` search, `m` (or `M`) find people (a member search, not your profile), `0` your own profile, `w` write, `L` live, `a` account, `,` settings, and `?` help. `p`/`n` move a page and `R` refreshes.

The footer always shows the keys that work right now: its first line is the global set and its second line is what the current screen adds, so nothing has to be memorised.

Within an entry, Tab and Shift+Tab cycle forward and backward through the author, the thread, the save action, links, and `#hashtags`; Enter opens the selected target. Use `r` to reply, `u` for the author, `s` to save/unsave, `o` for the browser, `f`/`F` to follow/unfollow, `e` to edit, and `d` to delete. A thread adds `T` for its top and `P` for its parent.

Multiline editors use Enter for a newline and Ctrl+Enter to preview or submit. Ctrl+S is a fallback for terminals that cannot distinguish Ctrl+Enter from Enter.

## Configuration

The default instance is `https://sofeed.cc`. Options are `--url`, `--theme <scheme>`, `--help`, and `--version`. Environment overrides are `SOFEED_URL`, `SOFEED_TOKEN`, `SOFEED_THEME`, and `NO_COLOR`.

A scheme is one of the site's own, picked from `,` settings: `auto`, `mono`, `paper`, `sepia`, `rose`, `midnight`, `forest` or `plum`. They are the schemes on sofeed.cc/themes, and since the site exposes no API for them the palettes are hardcoded in `src/theme.ts`, copied by hand from the site's `public/static/style.css`. `auto` resolves to the base light palette or the dark one from your terminal's `COLORFGBG`. `NO_COLOR` keeps the chosen scheme and paints it without color.

Settings, the API session token and the cached member are stored in the platform user configuration directory (`$XDG_CONFIG_HOME/sofeed/config.json`, macOS Application Support, or Windows AppData) with owner-only permissions where supported. `SOFEED_CONFIG_DIR` overrides that directory outright, which is how the test suite stays out of your real session.

Sign-in is the site's own username/password form: `POST /api/login` with a urlencoded body, which answers with the Fernet identity token and the member. The token never expires, so it is the whole session; signing out simply forgets it. Creating an account, account recovery and messages remain on the web app.

## The API it speaks

The TUI is a thin client over the same JSON the web app and the mobile app use, so field names are the server's (`content`, `created_by`, `reply_count`, `timestamp`) rather than reshaped here. Two server quirks are load-bearing:

- Writes are sent as `application/x-www-form-urlencoded`, because the endpoints read forms.
- Validation failures answer HTTP 200 with `{errors: {...}}`, so the error check happens before the status check.

Feeds are page-numbered with `?p=` (16 entries, 24 people). A thread is `GET /api/reply/{id}`: the permalinked entry, its ancestors, and its replies inlined as a tree. Discover and trending are public; feed, mentions, replies, saved, profiles and threads need the token.

Features the web app has that the TUI does not: messages, reports and blocks (the API does not expose them), and the topic index (it is HTML, not JSON). A `#hashtag` reference opens a search instead, which is what `discover?q=` searches.

## Checks

```sh
bun run check
bun run build
```

## License

This project is licensed under the AGPLv3 license. See the [LICENSE](LICENSE) file for details.
