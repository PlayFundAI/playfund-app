# PlayFund demo

Demo mode shows the real app screens on made-up data. Nothing done in it is
saved, and nothing is sent to PlayFund's servers.

## Start the demo

From the repository root:

```bash
npx -y serve -c ../demo/serve.json -l 4173 public
```

Then open:

```
http://localhost:4173/app/?demo=1&guide=1
```

Start the server with `demo/serve.json` as shown. It keeps every address
exactly as typed, so the `demo` part of the address always reaches the page.

With `&guide=1` a panel in the corner walks through twelve steps.

| Key | Does |
|---|---|
| `→` or space | Next step |
| `←` | Back |
| `R` | Start again |
| `G` | Hide or show the panel |
| `1` to `9` | Jump to a step |

Leave `&guide=1` off to click around without the panel. Reloading the page
starts the demo again from the beginning.

To show a club's own name and numbers:

```
http://localhost:4173/app/?demo=1&guide=1&club=Northside+Select&city=Charlotte,+NC&dues=1200&athletes=64
```

The full list of options is at the top of `public/app/demo.js`.

## Check it is really demo mode

Look for both of these before touching anything:

- A dark green badge in the top left corner that reads "DEMO · NO LIVE DATA".
- A browser tab titled "PlayFund · demo".

If either is missing, stop and open the address above again.

If demo mode cannot start, the page shows one line, "Demo mode could not
start, so nothing was loaded.", and the app does not open. Reload to try
again.

## What leaves the page in demo mode

- Calls to PlayFund's servers and database are answered on the page from
  made-up data. None are sent.
- The payment processor's code does not run. The page's security policy
  blocks it, and stand-in sheets marked "STAND-IN" are shown in its place. No
  card is charged.
- The served demo can still ask the processor's servers for its two script
  files, because the browser looks ahead for files before the policy is in
  place. The files are not run. The request names the site but not the page
  address, so it carries no club name and no figures. The one-file demo below
  does not make this request.
- Fonts are loaded from Google Fonts.

## Build the deck

With the server above running:

```bash
node demo/capture.mjs
node demo/capture.mjs --club "Northside Select" --city "Charlotte, NC" --dues 1200 --athletes 64
```

This writes one PNG per screen and `playfund-demo.pdf` into `demo/out/`, which
is not committed. `--deck-only` rebuilds the PDF from the PNGs already there.
`--only club-send` re-shoots one slide.

## Build the one-file demo

```bash
node demo/build-walkthrough.mjs
node demo/build-walkthrough.mjs --club "Northside Select" --city "Charlotte, NC" --dues 1200 --athletes 64 --out northside.html
```

This writes `demo/out/playfund-walkthrough.html`, the whole demo in one file
that opens with a double-click. No server is needed. Demo mode is always on
in this file, and the same check applies: look for the badge.
