# App store submission — privacy checklist

The published policy is only half the job. Apple and Google each make you fill in
a **separate structured form**, and a mismatch between that form and your actual
SDK behaviour is one of the most common causes of rejection and of post-launch
policy warnings.

Work through this before every new app submission.

---

## 0. Before you submit — decisions to confirm

The policy at `server/data/legal/privacy.html` describes the stack we normally
ship. **Confirm each of these against the app you are actually submitting**, and
edit the policy if any is wrong. An inaccurate policy is worse than a thin one.

| Question | If the answer differs from the default |
| --- | --- |
| Does the app show ads via AdMob? | If no ads at all, delete §5 and the AdMob row in §8. |
| Do you use Firebase Analytics / Crashlytics? | Replace or delete that row in §8. Do not list an SDK you don't ship. |
| Any other SDK (attribution, push, support chat, mediation partners)? | Add a row to §8 — every SDK receiving user data must be listed. |
| Does the app have accounts / user-generated content? | If not, trim §2.1 accordingly. |
| Does the app request location, camera, mic, contacts, or photos? | Update the §1 summary table — it currently says "No, unless an App states otherwise". |
| Is the app child-directed or mixed-audience? | §16 covers it, but you must also configure AdMob TFCD/TFUA and complete Play's Families declaration. |
| Do you target the EEA/UK? | You need a Google-certified CMP (UMP SDK). Consider whether an EU representative under GDPR Art. 27 is required. |

---

## 1. Apple — App Privacy ("nutrition label")

App Store Connect → your app → App Privacy. Declare each data type your app
**or any embedded SDK** collects. AdMob and Firebase collect on your behalf — their
collection is *your* declaration.

Typical ad-supported Koydam app:

| Data type | Collected | Linked to user | Used for tracking |
| --- | --- | --- | --- |
| Contact Info → Email Address | Only if the app has support/accounts | Yes | No |
| Identifiers → Device ID (IDFA) | Yes, if ads | Yes | **Yes** |
| Identifiers → User ID | Only if accounts | Yes | No |
| Usage Data → Product Interaction | Yes | Yes if accounts, else No | Yes, if ads |
| Usage Data → Advertising Data | Yes, if ads | Yes | **Yes** |
| Diagnostics → Crash Data | Yes | No | No |
| Diagnostics → Performance Data | Yes | No | No |
| Purchases → Purchase History | Yes, if IAP | Yes | No |
| Location → Coarse Location | Yes, if ads (IP-derived) | No | Yes, if ads |

**"Used for tracking" = yes** whenever data is linked to third-party data for
targeted advertising or shared with a data broker. Personalised AdMob ads count.
If you answer yes, you **must** implement the App Tracking Transparency prompt
(`ATTrackingManager.requestTrackingAuthorization`) and only read the IDFA after
authorisation. Shipping ATT-less while declaring tracking is a guaranteed rejection.

Also required:
- **Privacy policy URL** → `https://koydam.com/privacy.html`
- **Privacy nutrition label must cover third-party SDK collection**, not just your own code.
- iOS 17+: a **privacy manifest** (`PrivacyInfo.xcprivacy`) declaring required-reason
  APIs and tracking domains. Most major SDKs now ship their own — verify yours do.

---

## 2. Google Play — Data safety form

Play Console → Policy → App content → Data safety. Declare collection **and**
sharing separately; "sharing" means transfer to a third party, which includes
sending data to AdMob.

Typical ad-supported app:

| Data category | Collected | Shared | Purpose |
| --- | --- | --- | --- |
| Personal info → Email address | If support/accounts | No | App functionality, support |
| Financial info → Purchase history | If IAP | No | App functionality |
| Location → Approximate location | Yes, if ads | **Yes** | Advertising |
| App activity → App interactions | Yes | **Yes**, if ads | Analytics, advertising |
| App info and performance → Crash logs, diagnostics | Yes | Yes (to Firebase) | Analytics |
| Device or other IDs → Device or other IDs | Yes | **Yes**, if ads | Advertising, fraud prevention |

Also required:
- **Privacy policy URL** in both the store listing and the Data safety form.
- **Encryption in transit** — answer yes (all our endpoints are HTTPS).
- **Data deletion** — you must offer a way to request deletion. `hello@koydam.com`
  satisfies this; if the app has accounts, Play also requires an **in-app account
  deletion path plus a web deletion URL**.
- **Ads ID permission** — declare `com.google.android.gms.permission.AD_ID` in the
  manifest if targeting API 33+ and using the advertising ID.
- **Families policy** — if the app targets children, personalised ads are prohibited
  and only Play-certified ad SDKs may be used.

---

## 3. AdMob configuration

- **EEA/UK consent** — integrate Google's **User Messaging Platform (UMP)** SDK and
  present the consent form *before* the first ad request. Without a certified CMP,
  Google may stop serving ads to EEA users.
- **US state privacy** — enable the restricted data processing / US states signal in
  AdMob so opt-outs propagate.
- **Child-directed treatment** — set `TagForChildDirectedTreatment` (COPPA) and/or
  `TagForUnderAgeOfConsent` where relevant. This disables personalised ads.
- **Test ads during development** — never click your own live ads; invalid traffic
  gets accounts suspended.
- Keep the AdMob row in policy §8 accurate if you add mediation partners — each
  partner is a separate recipient of user data.

---

## 4. In-app purchase requirements

- Purchases must use the platform's billing (StoreKit / Play Billing). Steering users
  to outside payment is a policy violation in most regions.
- **Subscription disclosure before purchase**: title, length, price per period, and
  that it auto-renews. Apple requires this on the paywall screen itself, not only in
  the terms.
- Link to both **Terms of Service** and **Privacy Policy** from the paywall — Apple
  rejects subscription apps that omit this.
- **Restore Purchases** button is mandatory for non-consumable and subscription apps.
- ToS §4 covers renewal, trials, price changes, and refunds — keep the paywall copy
  consistent with it.

---

## 5. URLs to use

| Field | Value |
| --- | --- |
| Privacy policy | `https://koydam.com/privacy.html` |
| Terms of service / EULA | `https://koydam.com/terms.html` |
| Support | `https://koydam.com/contact.html` |
| Marketing | `https://koydam.com` |
| Support email | `support@koydam.com` |
| Privacy / rights requests | `hello@koydam.com` |

Apple's default EULA can be replaced with our ToS — paste the URL into the "EULA"
field in App Store Connect. §18 of the ToS contains Apple's required minimum terms
(Apple as third-party beneficiary, no Apple support obligation, product and IP claim
responsibility, export compliance). If you use Apple's standard EULA instead, §18
becomes redundant but harmless.

---

## 6. Per-app policies

One company-wide policy covering all Koydam apps is acceptable to both stores, and
is what we currently publish. If an app's practices diverge meaningfully — it
collects location, or it's aimed at children — publish a supplementary notice and
link *that* URL on the store listing. The policy's opening section already
establishes that a supplementary notice controls where it conflicts.

---

## 7. Maintenance

- Re-check this list whenever you add or update an SDK.
- Update the "Last updated" date in the policy when practices change — edit
  `server/data/legal/privacy.html`, then run `node server/scripts/load-legal.js`,
  or edit directly in Admin → Pages & legal.
- Apple and Google both re-verify declarations on each submission; a new SDK added
  in a point release still needs the forms updated.
