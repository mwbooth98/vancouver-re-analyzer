# Vancouver RE Analyzer — GitHub Pages Deploy Guide

## Project Structure

```
vancouver-re-analyzer/
├── .github/
│   └── workflows/
│       └── deploy.yml          ← auto-deploys on push to main
├── src/
│   ├── App.jsx                 ← paste your dashboard component here
│   ├── main.jsx
│   └── index.css
├── index.html
├── package.json
├── vite.config.js              ← ⚠ update base path to match your repo name
├── tailwind.config.js
└── postcss.config.js
```

---

## One-Time Setup

### 1. Create the GitHub repo

Go to github.com → New repository → name it `vancouver-re-analyzer` (or whatever you prefer).

> ⚠ **If you use a different repo name**, open `vite.config.js` and update the `base` field:
> ```js
> base: '/your-actual-repo-name/',
> ```

### 2. Copy your dashboard component

Copy `VancouverRealEstateDashboard.jsx` into `src/` and rename it `App.jsx`
(or keep the filename and update the import in `src/main.jsx`).

### 3. Install dependencies locally

```bash
npm install
```

### 4. Test it locally

```bash
npm run dev
```

Open http://localhost:5173 — should look exactly like it does in Claude.

### 5. Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/vancouver-re-analyzer.git
git push -u origin main
```

### 6. Enable GitHub Pages

1. Go to your repo on GitHub
2. **Settings** → **Pages** (left sidebar)
3. Under **Source**, select **GitHub Actions**
4. Save

That's it. The Actions workflow will trigger automatically on your push and deploy within ~1 minute.

---

## After First Deploy

Your app will be live at:
```
https://YOUR_USERNAME.github.io/vancouver-re-analyzer/
```

Every subsequent `git push` to `main` will automatically rebuild and redeploy. You can watch the progress under the **Actions** tab in your repo.

---

## Local Development

```bash
npm run dev      # start dev server with hot reload
npm run build    # build for production (outputs to dist/)
npm run preview  # preview the production build locally
```

---

## Troubleshooting

**Blank page after deploy?**
Almost always a `base` path mismatch. Make sure `vite.config.js` has `base: '/your-repo-name/'` matching exactly.

**Styles not loading?**
Make sure `src/index.css` has the three Tailwind directives and is imported in `src/main.jsx`.

**Actions workflow failing?**
Check the Actions tab for the error. Most common cause is a JS syntax error — run `npm run build` locally first to catch it before pushing.
