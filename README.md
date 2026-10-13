# Central & Stores — Admin Panel

Private admin interface for managing the Central & Stores grocery store.

**Do not share this URL publicly. This panel is `noindex` and `nofollow` by design.**

## URL

Once GitHub Pages is enabled:
- `https://YOUR-USERNAME.github.io/YOUR-ADMIN-REPO/`

Optional custom subdomain:
- `https://admin.central-and-stores.ct.ws/`

## Files

| File | Purpose |
|------|---------|
| `index.html` | Admin shell (HTML) |
| `admin-base.css` | Design tokens + layout + components |
| `admin-responsive.css` | Mobile / tablet / desktop + visible icons |
| `admin-core.js` | Supabase init, auth, navigation, toasts, utilities |
| `admin-dashboard.js` | Dashboard stats + recent activity |
| `admin-products.js` | Products CRUD + pagination + grid |
| `admin-trash.js` | Soft delete + restore + Trash view |
| `admin-categories.js` | Category CRUD + rename cascade |
| `admin-orders.js` | Orders + status + WhatsApp/Call |
| `admin-reviews.js` | Reviews moderation |
| `admin-ads.js` | Advertisements CRUD + scheduling |
| `admin-media.js` | Media library (3 buckets) |
| `admin-image-compressor.js` | Client-side WebP compression *(pending)* |
| `admin-image-multisize.js` | 400/800/1200 variants *(pending)* |
| `admin-image-scraper.js` | Amazon/Flipkart/BigBasket/JioMart *(pending)* |
| `admin-bulk-import.js` | CSV / Google Sheet bulk import *(pending)* |
| `robots.txt` | Block all crawlers |
| `.nojekyll` | Serve all files raw |

## Setup

### 1. Enable GitHub Pages
1. Repo → **Settings** → **Pages**
2. Branch: `main` → folder: `/ (root)` → Save
3. Wait 1–2 minutes
4. Visit the URL shown

### 2. Create an admin user
1. Supabase → **Authentication** → **Users** → **Add User**
2. Enter email + password
3. Confirm email (or disable email confirmation for testing)

### 3. Log in
1. Open the admin URL
2. Sign in with the email/password from step 2

### 4. Optional: Custom subdomain
1. In your DNS, add a CNAME: `admin` → `YOUR-USERNAME.github.io`
2. In GitHub repo → Settings → Pages → Custom domain → enter `admin.central-and-stores.ct.ws`
3. Wait for DNS + SSL

## Environment

All configuration is inside `admin-core.js`:
- Supabase URL
- Supabase anon key (public — safe in browser)

**Never put the service-role key in this repo.**

## Security

- Panel is `noindex, nofollow, noarchive, nosnippet`
- `robots.txt` blocks all crawlers
- Only authenticated users can write (RLS enforces this)
- Session persisted via `localStorage` (Supabase Auth)
- Change password: Account → Change Password

## Support

For issues, contact the developer.
