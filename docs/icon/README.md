# The app icon

`web/public/favicon.svg` is the source: todomd's dark tile and MD badge with
its checklist swapped for a board, one card carrying the green outline the UI
uses for "an agent touched this".

The PNGs — `apple-touch-icon.png` (iOS home screen), `icon-192.png` /
`icon-512.png` (web app manifest) and `docs/logo.png` (the README header) —
are generated from it:

```sh
sh docs/icon/make.sh
```

It renders the SVG in headless Chrome through agent-browser, which the demo
recorder already needs, and which by definition agrees with what a browser
will draw. iOS ignores SVG for home-screen icons, which is why the PNGs exist
at all.
