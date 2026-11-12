# The app icon

A stack of three cards, the front one with the Markdown mark (M↓) and a tick,
in the neutral grey **clear-dark** style: the same icon as the todomd CLI
(todomd.online uses the violet set). The favicon and the app icon are one
drawing. The files are exported from todomd-online by
`design/app-icon/web.sh clear-dark`; nothing in this repo generates them. To
change the icon, re-export there and copy the files over rather than editing
them by hand.

| File | What |
| --- | --- |
| `web/public/favicon.svg` | the stack of cards on the tile, drawn on a 32 px grid (the mark drawn pixel by pixel) |
| `web/public/favicon.ico` | the favicon at 16 (the mark as a plain bar) and 32 px, for browsers that ask for `/favicon.ico` |
| `web/public/apple-touch-icon.png` | 180 px, full bleed (iOS rounds it) |
| `web/public/icon-192.png`, `icon-512.png` | manifest icons, on Apple's grid with a transparent margin |
| `web/public/icon-maskable-512.png` | manifest maskable icon, the cards inside the 80% safe circle |
| `docs/logo.png` | the README header (512 px, same as `icon-512.png`) |

The favicon reads on light and dark tabs alike, so it has no light/dark
switch. The manifest doesn't list `favicon.svg`: it is a drawing for small
sizes, and browsers may pick an `any`-sized SVG for a large install icon.
