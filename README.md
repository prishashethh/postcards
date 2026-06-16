# postcards :)

a small personal travel-map project. drop pins for cities you've visited, log trips
with photos/notes/restaurants/attractions, see them as vintage postcards, and build
out a profile with your top trips and a bucket list.

## stack

- **frontend** — plain HTML/CSS/JS (no framework), served by Live Server on `http://localhost:5500`
- **backend** — Node.js + Express on `http://localhost:3000`
- **database** — MongoDB Atlas (via Mongoose)
- **auth** — Google OAuth 2.0 (`passport-google-oauth20` + `express-session`)
- **image storage** — Cloudinary

## project layout

```
server.js          Express API (auth, pins, photos)
models/User.js     user + profile (bio, socials, top5, bucket)
models/Pin.js      a city pin with embedded trips[]
index.html         map view (login gate lives here)
postcards.html     postcard feed
profile.html       profile, top 5, bucket list, stamps
.env.example       copy to .env and fill in
```

## one-time setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **MongoDB Atlas** — grab your connection string (include a db name, e.g. `.../postcards`)
   and allowlist your IP in Atlas → Network Access.

3. **Google OAuth** — in [Google Cloud Console](https://console.cloud.google.com/):
   - APIs & Services → Credentials → **Create OAuth client ID** → type **Web application**
   - Authorized JavaScript origin: `http://localhost:3000`
   - Authorized redirect URI: `http://localhost:3000/auth/google/callback`
   - Configure the OAuth consent screen (External) and add yourself as a **test user**.
   - Copy the client ID + secret.

4. **Cloudinary** — create a free account; from the dashboard copy your
   cloud name, API key, and API secret.

5. **Environment** — copy the template and fill in your values:
   ```bash
   cp .env.example .env
   ```
   `SESSION_SECRET` can be any long random string.

## running it

In two terminals:

```bash
# 1) backend API
npm run start        # or: npm run dev  (auto-restart on change)

# 2) frontend
# open the folder in VS Code and click "Go Live" (Live Server, port 5500)
```

Then visit `http://localhost:5500/index.html`, click **continue with google**, and you're in.

## notes

- The session cookie uses `SameSite=Lax`, which works because `localhost:5500` and
  `localhost:3000` are treated as the same site. If you later deploy the frontend and
  backend to **different domains**, switch the cookie to `sameSite: 'none'` + `secure: true`
  (requires HTTPS) in `server.js`, and update CORS/`CLIENT_URL`.
- Photos are compressed in the browser, then uploaded to Cloudinary; only the resulting
  URL is stored in MongoDB.
- `.env` and `node_modules/` are gitignored — never commit real secrets.
