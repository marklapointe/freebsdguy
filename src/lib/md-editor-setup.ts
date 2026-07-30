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
