# Publishing to the Public Repo

## One-time setup

Add the public remote:

```bash
git remote add public https://github.com/omuryildirim/apelsin.git
```

Mark the last published commit so incremental publishes know where to start:

```bash
git tag published $(git rev-parse HEAD)
```

## Preview without pushing

```bash
./publish.sh --dry-run
```

## Publish new commits (default)

```bash
./publish.sh
```

## Reset public repo history (squash everything into one commit)

```bash
./publish.sh --squash
```

With a custom message:

```bash
./publish.sh --squash -m "feat: apelsin"
```

## After a squash

Re-tag so future incremental publishes start from the right point:

```bash
git tag -f published $(git rev-parse HEAD)
```

## What gets published

- Everything on `main`
- `.github/workflows/` is replaced with `.github/workflows-public/` contents
- `.github/workflows-public/` is stripped from the public tree
- Files in `.public-overlay/<path>` overwrite the same `<path>` at project root
- Paths listed in `.public-strip` are removed
- `.public-overlay/` and `.public-strip` are themselves stripped
- Original commit messages, authors, and dates are preserved

## Keep a file private

Add its path (relative to project root) to `.public-strip`:

```
cloudflare/apelsin-fe/app/lib/constants/ru.ts
```

## Replace a file with a public version

Place the public version at the same path under `.public-overlay/`:

```
.public-overlay/cloudflare/apelsin-fe/app/lib/i18n.ts
```
