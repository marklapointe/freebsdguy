/** Track #1682: PostDetail runs the collapsible-list enhancer on the rendered post. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../src/lib/api', () => ({
    api: { get: vi.fn().mockResolvedValue({ data: { title: 'Live', content: 'x', date: '2026-11-03' } }) },
    getMdEditorTheme: () => 'light',
    siteConfig: { load: vi.fn().mockResolvedValue({ siteName: 'Test' }) },
}));
vi.mock('md-editor-rt', () => ({
    MdPreview: ({ onHtmlChanged }: { onHtmlChanged?: (h: string) => void }) => {
        setTimeout(() => onHtmlChanged?.('<p></p>'), 0);
        return <div className="md-editor-preview"><p><strong>Updates (newest first)</strong></p><ul>{[1, 2, 3, 4, 5].map((i) => <li key={i}>u{i}</li>)}</ul></div>;
    },
    MdCatalog: () => <div />,
}));

import { PostDetail } from '../src/components/PostDetail';

describe('PostDetail collapsible updates', () => {
    it('adds a Show more button under the Updates list', async () => {
        render(<MemoryRouter initialEntries={['/post/live']}><Routes><Route path="/post/:slug" element={<PostDetail />} /></Routes></MemoryRouter>);
        const b = await waitFor(() => screen.getByRole('button', { name: 'Show 2 more entries' }));
        expect(b.getAttribute('aria-expanded')).toBe('false');
    });
});
