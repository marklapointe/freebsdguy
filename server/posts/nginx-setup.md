---
title: Setting Up a Web Server with Nginx on FreeBSD
summary: Learn how to install and configure Nginx on FreeBSD to host your websites.
date: 2026-02-15
author: contributor
---

# Setting Up a Web Server with Nginx on FreeBSD

FreeBSD is known for its legendary network performance and stability, making it a perfect choice for a web server. Let's set up Nginx today.

## 1. Install Nginx

Using the `pkg` command, we can quickly install Nginx:

```bash
pkg update
pkg install nginx
```

## 2. Enable the Service

To make Nginx start automatically on boot, add it to your `/etc/rc.conf`:

```bash
sysrc nginx_enable="YES"
```

## 3. Configuration

The default configuration file is located at `/usr/local/etc/nginx/nginx.conf`. Here's a basic server block configuration:

```nginx
server {
    listen       80;
    server_name  example.com;

    location / {
        root   /usr/local/www/nginx;
        index  index.html index.htm;
    }
}
```

## 4. Start Nginx

Finally, start the Nginx service:

```bash
service nginx start
```

Your web server is now running! Check your server's IP in your browser to see the default Nginx page.
