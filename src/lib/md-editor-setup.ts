/**
 * Bundle md-editor-rt extensions so the app never hits unpkg CDNs.
 * CSP blocks external scripts; we inject library instances at build time.
 */
import { config } from 'md-editor-rt';
import hljs from 'highlight.js';
import katex from 'katex';
import mermaid from 'mermaid';
import * as echarts from 'echarts';

import 'highlight.js/styles/github-dark.min.css';
import 'highlight.js/styles/github.min.css';
import 'katex/dist/katex.min.css';

mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'dark',
});

config({
    // Raw HTML in Markdown is off (P0 D1): a post is Markdown, not HTML. The
    // sanitizer in sanitize-md.ts is the second layer for whatever still renders.
    markdownItConfig: (md) => {
        md.set({ html: false });
    },
    editorExtensions: {
        highlight: {
            instance: hljs,
            // no js/css CDN urls
        },
        katex: {
            instance: katex,
        },
        mermaid: {
            instance: mermaid,
            enableZoom: true,
        },
        echarts: {
            instance: echarts,
        },
    },
});
