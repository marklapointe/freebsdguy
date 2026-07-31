import React from 'react';
import { X, Upload, Eye, Image as ImageIcon, Plus } from 'lucide-react';
import { ImageInfo } from '../types';

interface ImagePickerModalProps {
    isOpen: boolean;
    images: ImageInfo[];
    onSelect: (filename: string) => void;
    onClose: () => void;
    onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onPreview: (img: ImageInfo) => void;
}

export const ImagePickerModal = ({ isOpen, images, onSelect, onClose, onUpload, onPreview }: ImagePickerModalProps) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[100] p-4 backdrop-blur-sm">
            <div className="bg-secondary rounded-2xl shadow-2xl border border-accent border-opacity-30 w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
                <div className="p-6 border-b border-accent border-opacity-20 flex justify-between items-center bg-bg bg-opacity-50">
                    <div>
                        <h2 className="text-2xl font-bold">Select Image</h2>
                        <p className="text-xs opacity-60">Choose an existing image or upload a new one</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <label className="bg-accent bg-opacity-10 text-accent p-2 px-4 rounded-lg font-bold border border-accent border-opacity-30 hover:bg-opacity-20 transition cursor-pointer flex items-center gap-2">
                            <Upload size={18} /> Upload New
                            <input type="file" className="hidden" accept="image/*" onChange={onUpload} multiple />
                        </label>
                        <button onClick={onClose} className="p-2 hover:bg-accent hover:bg-opacity-10 rounded-lg transition text-accent"><X size={28} /></button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                    {images.map(img => (
                        <div
                            key={img.filename}
                            className="group cursor-pointer rounded-xl border border-accent border-opacity-10 p-2 transition hover:border-opacity-100 hover:bg-accent hover:bg-opacity-5 relative flex flex-col"
                        >
                            <div
                                onClick={() => { onSelect(img.filename); onClose(); }}
                                className="aspect-square rounded-lg overflow-hidden bg-bg flex items-center justify-center mb-2 border border-accent border-opacity-5 group-hover:border-opacity-20 relative"
                            >
                                <img
                                    src={`/api/getimage?fileName=${img.filename}`}
                                    alt={img.originalName}
                                    className="max-h-full max-w-full object-contain transition-transform group-hover:scale-105"
                                    onError={(e) => {
                                        e.currentTarget.src = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%233a297a%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20x%3D%223%22%20y%3D%223%22%20width%3D%2218%22%20height%3D%2218%22%20rx%3D%222%22%20ry%3D%222%22%3E%3C%2Frect%3E%3Ccircle%20cx%3D%228.5%22%20cy%3D%228.5%22%20r%3D%221.5%22%3E%3C%2Fcircle%3E%3Cpolyline%20points%3D%2221%2015%2016%2010%205%2021%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E';
                                        e.currentTarget.className += ' opacity-40';
                                    }}
                                />
                                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all flex items-center justify-center">
                                    <span className="bg-accent text-on-accent p-2 rounded-full opacity-0 group-hover:opacity-100 transition shadow-lg">
                                        <Plus size={16} />
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center justify-between gap-1">
                                <p className="text-[10px] font-medium truncate opacity-70 group-hover:opacity-100 flex-1" title={img.originalName}>{img.originalName}</p>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onPreview(img); }}
                                    className="p-1 hover:bg-accent hover:bg-opacity-20 rounded text-accent opacity-0 group-hover:opacity-100 transition"
                                    title="Preview"
                                >
                                    <Eye size={12} />
                                </button>
                            </div>
                        </div>
                    ))}
                    {images.length === 0 && (
                        <div className="col-span-full py-32 text-center">
                            <ImageIcon className="mx-auto mb-4 opacity-20" size={64} />
                            <p className="opacity-50 font-medium">No images found in your library.</p>
                            <p className="text-xs opacity-30 mt-1">Upload some images to get started!</p>
                        </div>
                    )}
                </div>
                <div className="p-6 border-t border-accent border-opacity-20 flex justify-end bg-bg bg-opacity-50">
                    <button onClick={onClose} className="p-3 px-8 bg-secondary border border-accent border-opacity-30 rounded-lg font-bold hover:bg-opacity-80 transition">Close</button>
                </div>
            </div>
        </div>
    );
};

interface ImagePreviewModalProps {
    image: ImageInfo | null;
    onClose: () => void;
}

export const ImagePreviewModal = ({ image, onClose }: ImagePreviewModalProps) => {
    if (!image) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[200] p-4 backdrop-blur-md cursor-zoom-out" onClick={onClose}>
            <div className="relative max-w-5xl max-h-full flex flex-col items-center" onClick={e => e.stopPropagation()}>
                <button onClick={onClose} className="absolute -top-12 right-0 p-2 text-white hover:text-accent transition bg-black bg-opacity-50 rounded-full"><X size={32} /></button>
                <div className="bg-bg p-2 rounded-xl shadow-2xl border border-accent border-opacity-20">
                    <img src={`/api/getimage?fileName=${image.filename}`} alt={image.originalName} className="max-w-full max-h-[80vh] rounded-lg object-contain" />
                </div>
                <div className="mt-4 p-4 bg-secondary bg-opacity-80 backdrop-blur-md rounded-xl border border-accent border-opacity-20 text-center min-w-[300px]">
                    <h3 className="text-xl font-bold text-white mb-1">{image.originalName}</h3>
                    <div className="flex items-center justify-center gap-4 text-xs text-gray-400">
                        <span>{image.filename}</span>
                        {image.size && <span>• {(image.size / 1024).toFixed(1)} KB</span>}
                    </div>
                </div>
            </div>
        </div>
    );
};