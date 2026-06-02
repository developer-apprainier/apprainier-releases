# AppRainier Web SDK

Production browser SDK for AppRainier engagement features: surveys, announcements and banners, live cards, feature flags, experiments, audience variants, event logs, and message center.

## Install

Use the package from this repository while developing:

```sh
npm install ../apprainier-web-plugin
```

Or import directly in a plain browser test page:

```js
import { AppRainier } from '../apprainier-web-plugin/src/index.js';
```

## Initialize

Download an API-key config from the AppRainier admin portal and serve it with your website. Do not commit the real config file.

```js
import { AppRainier } from '@apprainier/web-sdk';

await AppRainier.initializeFromConfigUrl('/apprainier-config.json');
```

You can also pass the config object directly:

```js
import config from './apprainier-config.json';

await AppRainier.initializeWithConfig(config);
```

## Common APIs

```js
await AppRainier.identify('user_123', { email: 'user@example.com' });
await AppRainier.trackEvent('checkout_completed', { total: 89.99 });

await AppRainier.showSurvey('survey_star_rating_prompt');
await AppRainier.showAnnouncement('maintenance_alert_announcement');

const card = await AppRainier.createLiveCard('live_card_discount_product');
document.querySelector('#slot').replaceChildren(card);

const promoEnabled = await AppRainier.getFeatureFlag('promo_status', false);
await AppRainier.openMessageCenter({ initialTab: 'messages' });
```

## Callbacks

```js
AppRainier.addSurveyCallback({
  onSurveySubmitted: (payload) => console.log('survey submitted', payload),
  onSurveyDismissed: (payload) => console.log('survey dismissed', payload),
});

AppRainier.addAnnouncementCallback({
  onAnnouncementSubmitted: (payload) => console.log('announcement action', payload),
});
```

## Browser Notes

- Add your website origin, such as `http://localhost:5174`, to the Appwrite Web/CORS platform settings.
- The SDK talks only to the AppRainier runtime gateway. Client apps do not need Appwrite API keys.
- The SDK is dependency-free and uses scoped `apprainier-` DOM classes.
- Events are queued in memory and flushed periodically, when the tab is hidden, and when `flush()` is called.
- Runtime config controls cache TTLs, event batching, sampling, and passive message polling.
- Live-card carousel text is rendered over the image, matching the Android and iOS SDKs.
- Built-in announcement icons such as `rocket_launch`, `new_releases`, `system_update`, `warning`, `error`, `build`, `construction`, `cloud_off`, and `signal_wifi_off` resolve locally in the browser SDK.
- Live-card text sizes support legacy names (`small`, `medium`, `large`, `extraLarge`) and numeric web/native-style values such as `18px`, `18dp`, or `{ "value": 18, "unit": "dp" }`.
