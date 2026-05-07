import React from 'react';
import { Sparkles, X } from 'lucide-react';

interface ModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    type: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export const Modal = ({ isOpen, title, message, type, onConfirm, onCancel }: ModalProps) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-secondary p-6 rounded-xl shadow-2xl border border-accent border-opacity-30 max-w-md w-full text-text">
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <Sparkles className="text-accent" /> {title || (type === 'confirm' ? 'Confirm Action' : 'Message')}
                </h3>
                <p className="mb-6 opacity-90">{message}</p>
                <div className="flex justify-end gap-3">
                    {type === 'confirm' && (
                        <button
                            onClick={onCancel}
                            className="p-2 px-4 rounded hover:bg-bg transition border border-accent border-opacity-30"
                        >
                            Cancel
                        </button>
                    )}
                    <button
                        onClick={onConfirm}
                        className="bg-accent p-2 px-6 rounded font-bold hover:bg-opacity-80 transition shadow-lg text-white"
                    >
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
};

interface NotificationProps {
    id: number;
    message: string;
    title: string;
    onClose: (id: number) => void;
}

export const Notification = ({ id, message, title, onClose }: NotificationProps) => {
    React.useEffect(() => {
        const timer = setTimeout(() => {
            onClose(id);
        }, 5000);
        return () => clearTimeout(timer);
    }, [id, onClose]);

    return (
        <div className="bg-secondary border-l-4 border-accent p-4 rounded shadow-2xl flex justify-between items-start gap-4 w-80 mb-3 pointer-events-auto transition-all duration-300 transform translate-x-0 opacity-100">
            <div className="flex-1">
                {title && <h4 className="font-bold text-accent text-sm mb-1">{title}</h4>}
                <p className="text-sm opacity-90">{message}</p>
            </div>
            <button onClick={() => onClose(id)} className="opacity-50 hover:opacity-100 transition">
                <X size={16} />
            </button>
        </div>
    );
};