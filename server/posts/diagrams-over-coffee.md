---
title: Diagrams Over Coffee
summary: Mermaid flowcharts in Markdown — architecture without the slide deck.
date: 2026-07-26
author: MDWeb
---

# Diagrams Over Coffee

Whiteboards are great until someone erases the good box. Keep the diagram next to the prose.

## Request path

```mermaid
flowchart LR
  Browser -->|GET /| Nginx
  Nginx --> MDWeb
  MDWeb --> Posts["/var/db/mdweb/posts"]
  MDWeb --> Config["/usr/local/etc/mdweb"]
```

## Login sequence (JWT mode)

```mermaid
sequenceDiagram
  participant U as User
  participant S as MDWeb
  U->>S: POST /api/login
  S-->>U: token + role
  U->>S: Authorization Bearer
  S-->>U: admin APIs
```

Sip coffee. Ship the doc. Skip the proprietary whiteboard export.
