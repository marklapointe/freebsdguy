export interface Post {
    slug: string;
    title: string;
    date: string;
    author: string;
    summary: string;
    content: string;
    category?: string;
    pinned?: boolean;
}

export interface ImageInfo {
    filename: string;
    originalName: string;
    uploadedAt: number;
    size?: number;
    md5?: string;
}

export interface User {
    username: string;
    role: string;
}

export interface AlertType {
    id: number;
    title: string;
    message: string;
}

export interface ModalState {
    isOpen: boolean;
    title: string;
    message: string;
    type: string;
    onConfirm: () => void;
}