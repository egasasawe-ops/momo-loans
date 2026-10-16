# Kibet MTN - Netlify version

Static site (`public/`) + Netlify Functions (`netlify/functions/`) + Netlify Blobs for storage.
No separate database or server to manage.

## Deploy from GitHub
1. Create a GitHub repo and push this folder (`git init && git add . && git commit -m "init" && git push`).
2. Netlify -> **Add new site -> Import an existing project -> GitHub** -> pick the repo.
   Build settings are read from `netlify.toml` (publish `public`, functions `netlify/functions`). Click **Deploy**.
3. Create your admin credentials on your computer:
   ```
   npm install
   node scripts/hash-password.mjs "choose a long password"
   ```
   It prints `ADMIN_PASSWORD_HASH=...` and `SESSION_SECRET=...`.
4. Netlify -> **Site configuration -> Environment variables**, add:
   - `ADMIN_PASSWORD_HASH`
   - `SESSION_SECRET`
   - `ADMIN_USER` (optional, default `admin`)
5. **Deploys -> Trigger deploy** so the functions pick up the variables.
6. Admin is at `https://YOUR-SITE.netlify.app/admin.html`.

## Local development
```
npm install
npx netlify dev        # needs the Netlify CLI; set the env vars in a .env file
npm test               # offline tests, no network needed
```

## Where things are
- Loan rules: `netlify/lib/core.mjs` (`CFG`)
- API: `/api/eligibility`, `/api/apply`, `/api/status`, `/api/admin/*`
- Data: Netlify Blobs store `kibet` (view it in the Netlify UI under Blobs)
