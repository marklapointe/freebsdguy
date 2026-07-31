---
title: Code from the Terminal
summary: Fenced code blocks for shell, TypeScript, and the odd C fragment.
date: 2026-07-28
author: MDWeb
---

# Code from the Terminal

Blogs about software should show software. MDWeb renders fenced blocks with highlighting where the stack supports it.

## Shell

```bash
# FreeBSD-ish muscle memory
sysrc mdweb_enable=YES
service mdweb status
curl -sS http://127.0.0.1:5173/api/health | jq .
```

## TypeScript

```ts
export type ThemeMode = 'light' | 'dark';

export function getEffectiveThemeMode(siteDefault?: ThemeMode): ThemeMode {
  const stored = localStorage.getItem('themeMode');
  if (stored === 'light' || stored === 'dark') return stored;
  return siteDefault === 'light' ? 'light' : 'dark';
}
```

## A little C for the kernel crowd

```c
#include <stdio.h>

int main(void) {
    puts("hello from a Markdown fence");
    return 0;
}
```

Inline: run `npm test` before you brag on the internet.
