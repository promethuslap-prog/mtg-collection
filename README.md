# MTG Collection

A personal Magic: The Gathering collection tracker. It runs in the browser, with no account and no server. Card data stays on your device.

**Live site:** https://promethuslap-prog.github.io/mtg-collection/

Card names, images, and prices come from [Scryfall](https://scryfall.com).

## What you can do

- Search any card by name, with autocomplete
- Save a specific printing, a nonfoil or foil finish, and a quantity
- Browse the collection as a grid or a list
- Filter by color, type, set, and rarity, and sort by name, price, or date added
- See total cards, unique cards, estimated value, and a breakdown by color and set
- Refresh USD market prices from Scryfall. Moxfield is the main list, and TCGplayer fills in cards Moxfield does not already have
- Export or import JSON and CSV, or paste a decklist such as `4 Lightning Bolt`

## Local development

```bash
npm install
npm test
npm run dev
```

The app uses the `/mtg-collection/` base path, the same path GitHub Pages uses. Open the local URL Vite prints, including that path.

```bash
npm run build
npm run preview
```

## Moxfield and TCGplayer

Moxfield is the main list. `public/moxfield.json` is served at:

https://promethuslap-prog.github.io/mtg-collection/moxfield.json

`public/purchases.json` is served at:

https://promethuslap-prog.github.io/mtg-collection/purchases.json

Every push to `main` runs `.github/workflows/pages.yml` and republishes the site. There is no path filter, so a daily update of either file is enough.

On each visit, and when you press Refresh, the page fetches both files with a cache-busting query. The Moxfield rows mirror that file. TCGplayer rows are only cards whose name is not in Moxfield. Cards you add in the tracker stay separate. A short note appears when either synced list changed since the last visit.

## Where your cards are stored

The collection is stored in `localStorage` in this browser. Clearing site data deletes it. Use **Backup** to export a JSON or CSV file, then import that file on another device.

Scryfall requests are sent from your browser. Autocomplete and search are spaced about 150ms apart. Collection lookups stay under Scryfall’s limit of two requests per second. See the [Scryfall API docs](https://scryfall.com/docs/api).

## Fan content

This website is unofficial Fan Content permitted under the [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.

## Deploy

Pushes to `main` run `.github/workflows/pages.yml`. The workflow tests the app, builds it, and publishes the `gh-pages` branch.

GitHub Pages should serve that branch at the live URL above. The token used to push this repo cannot change repository settings (the Pages API returns 403), so if the site is not live yet an owner needs to turn Pages on:

1. Open https://github.com/promethuslap-prog/mtg-collection/settings/pages
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**
3. Set **Branch** to `gh-pages` and the folder to `/ (root)`
4. Save

The first publish can take a minute after that setting is saved.
