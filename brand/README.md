# Brand assets

`zoom-background.html` is the source for the Zoom/Meet virtual backgrounds. Colors and the
wordmark follow `public/index.html`, the marketing site.

Re-render after editing (1920x1080, the size Zoom expects):

```
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1920,1080 --virtual-time-budget=4000 \
  --screenshot=brand/playfund-zoom-background.png "file://$PWD/brand/zoom-background.html"
```

The light variant is the same file with `class="light"` on `<body>`.
