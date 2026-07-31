import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('md-editor-rt', () => ({
    MdEditor: ({ modelValue, onChange }: any) => (
        <textarea
            data-testid="md-editor"
            value={modelValue || ''}
            onChange={e => onChange?.(e.target.value)}
        />
    ),
    MdPreview: ({ modelValue }: any) => <div data-testid="md-preview">{modelValue}</div>
}));

import { Modal, Notification } from '../src/components/Modal';
import { PostModal } from '../src/components/PostModal';
import { ImagePickerModal, ImagePreviewModal } from '../src/components/ImageModals';

describe('Modal + Notification', () => {
    it('renders closed modal as null', () => {
        const { container } = render(
            <Modal isOpen={false} title="t" message="m" type="alert" onConfirm={() => {}} onCancel={() => {}} />
        );
        expect(container.innerHTML).toBe('');
    });

    it('confirm modal has cancel', () => {
        const onCancel = vi.fn();
        const onConfirm = vi.fn();
        render(
            <Modal isOpen title="Confirm?" message="Sure?" type="confirm" onConfirm={onConfirm} onCancel={onCancel} />
        );
        fireEvent.click(screen.getByText('Cancel'));
        expect(onCancel).toHaveBeenCalled();
        fireEvent.click(screen.getByText('OK'));
        expect(onConfirm).toHaveBeenCalled();
    });

    it('notification auto-closes and manual close', () => {
        vi.useFakeTimers();
        const onClose = vi.fn();
        render(<Notification id={1} title="Hi" message="Body" onClose={onClose} />);
        fireEvent.click(screen.getByRole('button'));
        expect(onClose).toHaveBeenCalledWith(1);
        onClose.mockClear();
        render(<Notification id={2} title="" message="Only" onClose={onClose} />);
        act(() => {
            vi.advanceTimersByTime(5000);
        });
        expect(onClose).toHaveBeenCalledWith(2);
        vi.useRealTimers();
    });
});

describe('PostModal', () => {
    it('renders closed as null', () => {
        const { container } = render(
            <PostModal
                isOpen={false}
                post={{}}
                onSave={() => {}}
                onCancel={() => {}}
                onAutoSummarize={() => {}}
                isSummarizing={false}
                onAutoEnhance={() => {}}
                isEnhancing={false}
                enhancedPreview={null}
                onApplyEnhancement={() => {}}
                onDismissEnhancement={() => {}}
                setPost={() => {}}
                aiEnabled={false}
            />
        );
        expect(container.innerHTML).toBe('');
    });

    it('edits fields and content', () => {
        const setPost = vi.fn();
        const post = { slug: 's', title: 'T', summary: 'sum', content: 'body', pinned: false };
        render(
            <PostModal
                isOpen
                post={post}
                onSave={e => e.preventDefault()}
                onCancel={() => {}}
                onAutoSummarize={() => {}}
                isSummarizing={false}
                onAutoEnhance={() => {}}
                isEnhancing={false}
                enhancedPreview={null}
                onApplyEnhancement={() => {}}
                onDismissEnhancement={() => {}}
                setPost={setPost}
                aiEnabled
            />
        );
        fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'New' } });
        expect(setPost).toHaveBeenCalled();
        fireEvent.change(screen.getByTestId('md-editor'), { target: { value: 'more' } });
        expect(setPost).toHaveBeenCalled();
        fireEvent.click(screen.getByLabelText(/Pin/i));
    });

    it('shows enhance preview controls', () => {
        const onApply = vi.fn();
        const onDismiss = vi.fn();
        render(
            <PostModal
                isOpen
                post={{ slug: 's', title: 'T', summary: '', content: 'c', pinned: false }}
                onSave={e => e.preventDefault()}
                onCancel={() => {}}
                onAutoSummarize={() => {}}
                isSummarizing
                onAutoEnhance={() => {}}
                isEnhancing
                enhancedPreview="# enhanced"
                onApplyEnhancement={onApply}
                onDismissEnhancement={onDismiss}
                setPost={() => {}}
                aiEnabled
            />
        );
        fireEvent.click(screen.getByText(/Apply Changes/i));
        expect(onApply).toHaveBeenCalled();
        fireEvent.click(screen.getByText(/Dismiss/i));
        expect(onDismiss).toHaveBeenCalled();
    });
});

describe('ImageModals', () => {
    it('picker closed is null', () => {
        const { container } = render(
            <ImagePickerModal isOpen={false} images={[]} onSelect={() => {}} onClose={() => {}} />
        );
        expect(container.innerHTML).toBe('');
    });

    it('picker selects image, preview, upload, empty state', () => {
        const onSelect = vi.fn();
        const onClose = vi.fn();
        const onUpload = vi.fn();
        const onPreview = vi.fn();
        const { rerender } = render(
            <ImagePickerModal
                isOpen
                images={[{ filename: 'a.webp', originalName: 'A', uploadedAt: 1 }]}
                onSelect={onSelect}
                onClose={onClose}
                onUpload={onUpload}
                onPreview={onPreview}
            />
        );
        // Click the image tile (onSelect is on the aspect-square div, not the label)
        const img = screen.getByAltText('A');
        fireEvent.click(img.parentElement!);
        expect(onSelect).toHaveBeenCalledWith('a.webp');
        expect(onClose).toHaveBeenCalled();

        // Preview eye button
        fireEvent.click(screen.getByTitle('Preview'));
        expect(onPreview).toHaveBeenCalled();

        // Upload input
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(fileInput, { target: { files: [] } });
        expect(onUpload).toHaveBeenCalled();

        // img onError fallback
        fireEvent.error(img);

        // Close button
        fireEvent.click(screen.getByText('Close'));

        // Empty library
        rerender(
            <ImagePickerModal
                isOpen
                images={[]}
                onSelect={onSelect}
                onClose={onClose}
                onUpload={onUpload}
                onPreview={onPreview}
            />
        );
        expect(screen.getByText(/No images found/i)).toBeTruthy();
    });

    it('preview modal shows size and closes', () => {
        const onClose = vi.fn();
        const { rerender } = render(
            <ImagePreviewModal
                image={{ filename: 'a.webp', originalName: 'A.png', uploadedAt: 1, size: 2048 }}
                onClose={onClose}
            />
        );
        expect(screen.getByText(/2\.0 KB/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button'));
        expect(onClose).toHaveBeenCalled();

        // null image
        rerender(<ImagePreviewModal image={null} onClose={onClose} />);
        expect(screen.queryByText('A.png')).toBeNull();
    });
});
