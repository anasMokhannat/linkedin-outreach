# Session Connector — browser extension

Captures the HttpOnly `li_at` LinkedIn session cookie (which page JavaScript
cannot read) via the privileged `chrome.cookies` API and POSTs it to your app's
`/api/linkedin/connect` endpoint over HTTPS. The cookie is never displayed in the
popup, never stored by the extension, and never logged.

## Load it (development, unpacked)

1. Build/run the app and sign in to it in the same browser.
2. Go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
   and select this `extension/` folder.
3. Open the popup, enter your app URL (e.g. `http://localhost:3000` in dev or your
   Vercel URL in prod), and click **Capture & connect**.

## Production host permission

`manifest.json` includes `http://localhost:3000/*` for local dev. Before publishing,
add your production origin to `host_permissions` so the popup's `fetch` can send the
app session cookie, e.g.:

```json
"host_permissions": [
  "https://www.linkedin.com/*",
  "https://*.linkedin.com/*",
  "https://your-app.vercel.app/*"
]
```

## Publishing

Package the folder and submit to the Chrome Web Store / Firefox Add-ons. The
`cookies` permission for `linkedin.com` is shown to users at install time.

## Fallback

If the extension isn't available, the app's **Connections** page offers a manual
paste fallback (copy `li_at` from DevTools → Application → Cookies).
