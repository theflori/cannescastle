# Château Privé · EventOS Dashboard

Multi-page guest dashboard for private events. Cloudflare Pages + Airtable + Apify + R2.
White + gold theme, sidebar nav, Twilio-prepared.

---

## Pages

- `/guests` — Guest list with status, tags, notes, bulk actions, IG data refresh
- `/analytics` — Charts and KPIs (submissions, status distribution, follower distribution, top guests, etc.)
- `/branding` — Brand asset upload and gallery (logos, sponsors, brand guidelines)
- `/login` — Password gate

---

## Cloudflare Pages Environment Variables

In Cloudflare Pages → Settings → Variables and Secrets → Production:

| Name | Type | Value |
|---|---|---|
| `DASHBOARD_PASSWORD` | Plaintext | Your dashboard login password |
| `SESSION_SECRET` | Encrypted | Random string for session token signing |
| `AIRTABLE_TOKEN` | Encrypted | Airtable Personal Access Token |
| `AIRTABLE_BASE_ID` | Plaintext | `appHcXDC9XhvjYnwa` |
| `AIRTABLE_TABLE_NAME` | Plaintext | `tblGNkr4kT6yWbpqN` |
| `APIFY_TOKEN` | Encrypted | Apify Personal API token |

---

## R2 Setup (for Branding page)

The Branding page uses Cloudflare R2 for file storage. Setup:

### 1) Activate R2

1. Cloudflare Dashboard → **R2 Object Storage** (left sidebar)
2. Click **Purchase R2** (free tier: 10GB storage, no egress fees)
3. Create new bucket: name = `chateau-brand-assets`, location = automatic
4. Click **Create bucket**

### 2) Bind R2 bucket to Pages project

1. Cloudflare Pages → your `chateau-dashboard` project → **Settings**
2. Go to **Functions** tab (or Functions section)
3. Scroll to **R2 bucket bindings**
4. Click **Add binding**:
   - Variable name: `ASSETS`
   - R2 bucket: `chateau-brand-assets`
5. Save and **redeploy** (Deployments → Retry)

### 3) Verify

After redeploy, open `/branding`. You should see the upload zone. If you see "R2 storage not configured", the binding didn't take effect — retry the deployment.

---

## Airtable Schema

Required fields in table `tblGNkr4kT6yWbpqN`:

- `Full Name` (Text)
- `Email` (Text)
- `Phone` (Text)
- `Company / Industry` (Text)
- `Instagram` (Text)
- `Referred By` (Text)
- `Source` (Text)
- `Status` (Single select): Pending / Waitlisted / Approved / Approved Ticket sent / Rejected
- `IG Followers` (Number)
- `IG Avatar URL` (URL)
- `IG Last Refresh` (Date with time)
- `Tags` (Multiple select): VIP / Creator / Influencer Tier 1 / Influencer Tier 2 / Influencer Tier 3 / Press / Industry / Plus One
- `Internal Notes` (Long text)

---

## Architecture

```
chateau-dashboard/
├── index.html              ← Redirect to /guests
├── guests.html             ← Main guest list (Phase 1+2)
├── analytics.html          ← Charts + KPIs (Phase 3)
├── branding.html           ← Brand asset gallery (Phase 4)
├── login.html              ← Password gate
├── shared/
│   ├── theme.css           ← Design tokens, all components
│   ├── sidebar.html        ← Sidebar markup, fetched per page
│   └── app.js              ← ChateauApp utility (toast, auth, format)
└── functions/
    ├── _middleware.js      ← Auth middleware (cookie-based)
    └── api/
        ├── login.js
        ├── logout.js
        ├── guests.js       ← GET — list all guests from Airtable
        ├── update-record.js     ← PATCH single record
        ├── update-bulk.js       ← PATCH multiple
        ├── update-instagram.js  ← Update IG handle
        ├── refresh.js           ← Apify scrape trigger
        ├── avatar.js            ← Instagram CDN proxy
        ├── send-sms.js          ← Twilio prep (logs only)
        └── assets/
            ├── upload.js        ← POST — multipart upload to R2
            ├── delete.js        ← POST — remove from R2
            └── file/
                └── [[path]].js  ← GET — serve R2 file
```

---

## Cost

- **Cloudflare Pages**: Free
- **R2 Storage**: Free up to 10GB (no egress fees)
- **Airtable**: Free (existing setup)
- **Apify**: ~$0.32 per 200-profile refresh ($5 free credit at signup)
