/**
 * Home route entry (Track #2063): load md-editor-rt extensions and CSS
 * in the same async chunk as Home/MdPreview. App.tsx must lazy-import
 * this module, not ./components/Home, so unit tests that import Home
 * directly never pull mermaid/katex/hljs/echarts.
 */
import './md-editor-setup';
import 'md-editor-rt/lib/style.css';

export { Home } from '../components/Home';
