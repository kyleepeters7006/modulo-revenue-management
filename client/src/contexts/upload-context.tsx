import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface ActiveUpload {
  id: string;
  type: 'rent-roll' | 'inquiry' | 'competitor';
  fileName: string;
  startedAt: number;
  status: 'uploading' | 'processing' | 'success' | 'error';
  progress?: number;
  message?: string;
  error?: string;
}

interface UploadContextType {
  activeUploads: ActiveUpload[];
  addUpload: (upload: Omit<ActiveUpload, 'id' | 'startedAt'>) => string;
  updateUpload: (id: string, updates: Partial<ActiveUpload>) => void;
  removeUpload: (id: string) => void;
  clearCompletedUploads: () => void;
  isUploading: (type: string) => boolean;
}

const UploadContext = createContext<UploadContextType | null>(null);

const STORAGE_KEY = 'modulo_active_uploads';

export function UploadProvider({ children }: { children: ReactNode }) {
  const [activeUploads, setActiveUploads] = useState<ActiveUpload[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const uploads = JSON.parse(stored) as ActiveUpload[];
        return uploads.filter(u => 
          u.status === 'uploading' || u.status === 'processing' ||
          (Date.now() - u.startedAt < 60000)
        );
      }
    } catch (e) {
      console.error('Failed to load upload state:', e);
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(activeUploads));
    } catch (e) {
      console.error('Failed to save upload state:', e);
    }
  }, [activeUploads]);

  useEffect(() => {
    const cleanup = setInterval(() => {
      setActiveUploads(prev => {
        const now = Date.now();
        return prev.filter(upload => {
          if (upload.status === 'success' || upload.status === 'error') {
            return now - upload.startedAt < 30000;
          }
          if (now - upload.startedAt > 600000) {
            return false;
          }
          return true;
        });
      });
    }, 10000);

    return () => clearInterval(cleanup);
  }, []);

  const addUpload = useCallback((upload: Omit<ActiveUpload, 'id' | 'startedAt'>) => {
    const id = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newUpload: ActiveUpload = {
      ...upload,
      id,
      startedAt: Date.now(),
    };
    setActiveUploads(prev => [...prev, newUpload]);
    return id;
  }, []);

  const updateUpload = useCallback((id: string, updates: Partial<ActiveUpload>) => {
    setActiveUploads(prev =>
      prev.map(upload =>
        upload.id === id ? { ...upload, ...updates } : upload
      )
    );
  }, []);

  const removeUpload = useCallback((id: string) => {
    setActiveUploads(prev => prev.filter(upload => upload.id !== id));
  }, []);

  const clearCompletedUploads = useCallback(() => {
    setActiveUploads(prev =>
      prev.filter(upload => upload.status === 'uploading' || upload.status === 'processing')
    );
  }, []);

  const isUploading = useCallback((type: string) => {
    return activeUploads.some(
      upload => upload.type === type && (upload.status === 'uploading' || upload.status === 'processing')
    );
  }, [activeUploads]);

  return (
    <UploadContext.Provider
      value={{
        activeUploads,
        addUpload,
        updateUpload,
        removeUpload,
        clearCompletedUploads,
        isUploading,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
}

export function useUploads() {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error('useUploads must be used within an UploadProvider');
  }
  return context;
}
