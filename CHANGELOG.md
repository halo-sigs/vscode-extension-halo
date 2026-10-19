# Change Log

## Unreleased

- Batch publish: select multiple files or right-click a folder in the Explorer, unchanged posts are skipped automatically (content hash in frontmatter, zero server requests)
- Transfer external images to the Halo attachment library while publishing, with configurable storage policy / group (per upload and transfer) via the new "Configure image storage policy" command
- Explorer context menu with concise entries; pull posts into the right-clicked folder
- Frontmatter `date` is pushed to the server as publish time
- Configurable slug strategy for new posts (timestamp by default / pinyin)
- Refined notifications: a single summary per run, process details go to the dedicated output channel
- Network resilience: request timeouts (configurable), retry on optimistic-lock conflicts (409) covering the full update chain, and verification of the server state after an interrupted publish
- Permission-specific 403 messages (which permission to grant, per Halo role template)
- Fixed silent publish failures (no active editor, document closed during batch runs) and duplicate posts on network errors (never fall back to create)

## 1.3.0

⚠️ Due to changes in the api authentication method in this version, it is necessary to rerun `Halo Setup`.

- Log in with Personal Access Token instead of password
- Refactor post related api
- Support setting of slug, excerpt and cover in Front Matter
- Add publishByDefault option

## 1.2.0

- Add anchor feature for markdown renderer

## 1.1.0

- Exclude deleted posts when pulling posts
- Exclude hidden attachment group when setup
- Support batch pulling posts
- Add publish parameters to Front-matter
- Optimize the logic of picture upload
- Support setting categories, tags and title
- Support updating post from halo remote
- Check whether the site matches when publishing
- Support to set categories and tags by selection
- Allow insert html code

## 1.0.0

- Initial release
