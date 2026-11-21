import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  DriveUploadItem,
} from './arquivoTypes';
import { logDriveAuditEvent } from './arquivoStore';
import {
  DriveApiError,
  checkDriveFileDuplicate,
  uploadFileResumableToDrive,
} from './driveApiClient';
import { subscribeGoogleDriveSession } from './googleDriveAuthService';

const MAX_CONCURRENT_UPLOADS = 2;

const EXTENSION_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
};

const ALLOWED_MIME_SET = new Set<string>([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
  'video/mp4',
  'video/quicktime',
  'application/pdf',
]);

function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx < 0 || idx === name.length - 1) return '';
  return name.slice(idx + 1).toLowerCase();
}

export function validateAndResolveUploadMime(file: File): {
  valid: boolean;
  mimeType: string;
  reason?: string;
} {
  const ext = getFileExtension(file.name);
  const rawMime = (file.type || '').toLowerCase().trim();

  if (file.size <= 0) {
    return {
      valid: false,
      mimeType: '',
      reason: 'Arquivo vazio (0 bytes).',
    };
  }

  const extAllowed = (ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext);
  const mimeAllowed = rawMime.length > 0 && ALLOWED_MIME_SET.has(rawMime);

  if (!extAllowed && !mimeAllowed) {
    return {
      valid: false,
      mimeType: '',
      reason: 'Formato não permitido. Aceitos: JPG, JPEG, PNG, HEIC, MP4, MOV e PDF.',
    };
  }

  const resolvedMime =
    (extAllowed ? EXTENSION_MIME_MAP[ext] : '') ||
    (mimeAllowed ? rawMime : 'application/octet-stream');

  return { valid: true, mimeType: resolvedMime };
}

function buildUniqueRenamedFileName(originalName: string, attemptSuffix = 2): string {
  const dotIndex = originalName.lastIndexOf('.');
  const nowStamp = new Date();
  const timeTag = `${String(nowStamp.getHours()).padStart(2, '0')}h${String(nowStamp.getMinutes()).padStart(2, '0')}m${String(nowStamp.getSeconds()).padStart(2, '0')}s`;
  const suffix = attemptSuffix <= 2 ? ` (${timeTag})` : ` (${timeTag}-${attemptSuffix})`;
  if (dotIndex <= 0) {
    return `${originalName}${suffix}`.slice(0, 220);
  }
  const base = originalName.slice(0, dotIndex);
  const ext = originalName.slice(dotIndex);
  return `${base}${suffix}${ext}`.slice(0, 220);
}

function formatBytesShort(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface EnqueueFilesResult {
  addedCount: number;
  skippedDuplicates: string[];
  rejectedFiles: Array<{ name: string; reason: string }>;
}

interface ArquivoUploadContextValue {
  items: DriveUploadItem[];
  activeCount: number;
  queuedCount: number;
  completedCount: number;
  errorCount: number;
  duplicateCount: number;
  overallProgress: number;
  completedTick: number;
  enqueueFiles: (params: {
    files: File[];
    rootFolderId: string;
    targetFolderId: string;
    targetFolderName: string;
  }) => EnqueueFilesResult;
  retryUpload: (localId: string) => void;
  retryAllFailed: () => void;
  resolveDuplicateWithRename: (localId: string) => void;
  cancelUpload: (localId: string) => void;
  removeUploadItem: (localId: string) => void;
  clearFinishedUploads: () => void;
}

const ArquivoUploadContext = createContext<ArquivoUploadContextValue>({
  items: [],
  activeCount: 0,
  queuedCount: 0,
  completedCount: 0,
  errorCount: 0,
  duplicateCount: 0,
  overallProgress: 0,
  completedTick: 0,
  enqueueFiles: () => ({ addedCount: 0, skippedDuplicates: [], rejectedFiles: [] }),
  retryUpload: () => {},
  retryAllFailed: () => {},
  resolveDuplicateWithRename: () => {},
  cancelUpload: () => {},
  removeUploadItem: () => {},
  clearFinishedUploads: () => {},
});

interface ArquivoUploadProviderProps {
  actorUid: string;
  actorName: string;
  children: React.ReactNode;
}

export function ArquivoUploadProvider({
  actorUid,
  actorName,
  children,
}: ArquivoUploadProviderProps) {
  const [items, setItems] = useState<DriveUploadItem[]>([]);
  const [completedTick, setCompletedTick] = useState(0);

  const itemsRef = useRef<DriveUploadItem[]>([]);
  const activeWorkersRef = useRef<Set<string>>(new Set());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const skipDuplicateCheckIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const updateItem = useCallback(
    (localId: string, updater: (prev: DriveUploadItem) => DriveUploadItem) => {
      setItems((prev) => prev.map((it) => (it.localId === localId ? updater(it) : it)));
    },
    []
  );

  // Cancel all active uploads cleanly if the user disconnects Google Drive
  useEffect(() => {
    return subscribeGoogleDriveSession((session) => {
      if (session.status === 'disconnected') {
        abortControllersRef.current.forEach((ctrl) => {
          try {
            ctrl.abort();
          } catch {
            // Ignore
          }
        });
        abortControllersRef.current.clear();
        activeWorkersRef.current.clear();
      }
    });
  }, []);

  // Warn user only if trying to close the entire browser tab while uploads are actively running
  useEffect(() => {
    const hasRunning = items.some(
      (it) => it.status === 'queued' || it.status === 'checking' || it.status === 'uploading'
    );
    if (!hasRunning) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [items]);

  // Cleanup controllers on provider unmount (e.g., SISCOM logout)
  useEffect(() => {
    return () => {
      abortControllersRef.current.forEach((ctrl) => {
        try {
          ctrl.abort();
        } catch {
          // Ignore
        }
      });
      abortControllersRef.current.clear();
      activeWorkersRef.current.clear();
    };
  }, []);

  const runWorkerForItem = useCallback(
    async (itemSnapshot: DriveUploadItem) => {
      const { localId } = itemSnapshot;
      const controller = new AbortController();
      abortControllersRef.current.set(localId, controller);

      try {
        const shouldSkipDupCheck = skipDuplicateCheckIdsRef.current.has(localId);

        if (!shouldSkipDupCheck) {
          updateItem(localId, (prev) => ({
            ...prev,
            status: 'checking',
            errorMessage: undefined,
          }));

          const dup = await checkDriveFileDuplicate({
            rootFolderId: itemSnapshot.rootFolderId,
            parentId: itemSnapshot.targetFolderId,
            fileName: itemSnapshot.uploadName,
          });

          if (controller.signal.aborted) {
            updateItem(localId, (prev) => ({
              ...prev,
              status: 'cancelled',
              errorMessage: 'Envio cancelado.',
            }));
            return;
          }

          if (dup.exists) {
            const suggested = buildUniqueRenamedFileName(itemSnapshot.uploadName);
            updateItem(localId, (prev) => ({
              ...prev,
              status: 'duplicate',
              duplicateExistingId: dup.existingId || undefined,
              suggestedUniqueName: suggested,
              errorMessage: `Já existe um arquivo "${itemSnapshot.uploadName}" na pasta "${itemSnapshot.targetFolderName}".`,
            }));
            return;
          }
        }

        updateItem(localId, (prev) => ({
          ...prev,
          status: 'uploading',
          progress: prev.progress > 0 ? prev.progress : 1,
          errorMessage: undefined,
        }));

        const uploaded = await uploadFileResumableToDrive({
          file: itemSnapshot.file,
          uploadName: itemSnapshot.uploadName,
          mimeType: itemSnapshot.mimeType,
          rootFolderId: itemSnapshot.rootFolderId,
          targetFolderId: itemSnapshot.targetFolderId,
          signal: controller.signal,
          onProgress: (percent, bytesUploaded) => {
            updateItem(localId, (prev) => {
              if (prev.status !== 'uploading') return prev;
              return {
                ...prev,
                progress: percent,
                bytesUploaded,
              };
            });
          },
        });

        skipDuplicateCheckIdsRef.current.delete(localId);
        updateItem(localId, (prev) => ({
          ...prev,
          status: 'completed',
          progress: 100,
          bytesUploaded: prev.fileSize,
          driveFileId: uploaded.id,
          uploadName: uploaded.name || prev.uploadName,
          completedAt: Date.now(),
          errorMessage: undefined,
        }));
        setCompletedTick((t) => t + 1);

        // Log immutable metadata-only audit entry in Firestore
        void logDriveAuditEvent({
          action: 'file_upload',
          targetId: uploaded.id,
          targetName: uploaded.name || itemSnapshot.uploadName,
          summary: `Arquivo "${uploaded.name || itemSnapshot.uploadName}" (${formatBytesShort(itemSnapshot.fileSize)}) enviado para "${itemSnapshot.targetFolderName}".`,
          actorUid,
          actorName,
        });
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof DriveApiError && err.code === 'UPLOAD_CANCELLED')
        ) {
          updateItem(localId, (prev) => ({
            ...prev,
            status: 'cancelled',
            errorMessage: 'Envio cancelado.',
          }));
        } else {
          updateItem(localId, (prev) => ({
            ...prev,
            status: 'error',
            errorMessage:
              err instanceof Error
                ? err.message
                : 'Falha ao enviar arquivo ao Google Drive.',
          }));
        }
      } finally {
        abortControllersRef.current.delete(localId);
        activeWorkersRef.current.delete(localId);
      }
    },
    [actorName, actorUid, updateItem]
  );

  // Queue dispatcher: keeps up to MAX_CONCURRENT_UPLOADS running continuously across screen changes
  useEffect(() => {
    const runningCount = activeWorkersRef.current.size;
    if (runningCount >= MAX_CONCURRENT_UPLOADS) return;

    const slotsAvailable = MAX_CONCURRENT_UPLOADS - runningCount;
    const nextQueued = items
      .filter((it) => it.status === 'queued' && !activeWorkersRef.current.has(it.localId))
      .slice(0, slotsAvailable);

    for (const item of nextQueued) {
      activeWorkersRef.current.add(item.localId);
      void runWorkerForItem(item);
    }
  }, [items, runWorkerForItem]);

  const enqueueFiles = useCallback(
    (params: {
      files: File[];
      rootFolderId: string;
      targetFolderId: string;
      targetFolderName: string;
    }): EnqueueFilesResult => {
      const skippedDuplicates: string[] = [];
      const rejectedFiles: Array<{ name: string; reason: string }> = [];
      const toAdd: DriveUploadItem[] = [];

      const existingKeys = new Set<string>(
        itemsRef.current
          .filter((it) => it.status !== 'cancelled')
          .map(
            (it) =>
              `${it.targetFolderId}::${it.uploadName.toLowerCase()}::${it.fileSize}`
          )
      );

      for (const file of params.files) {
        const validation = validateAndResolveUploadMime(file);
        if (!validation.valid) {
          rejectedFiles.push({
            name: file.name,
            reason: validation.reason || 'Formato não suportado.',
          });
          continue;
        }

        const cleanName = file.name.trim().slice(0, 220) || 'arquivo';
        const dedupKey = `${params.targetFolderId}::${cleanName.toLowerCase()}::${file.size}`;
        if (existingKeys.has(dedupKey)) {
          skippedDuplicates.push(cleanName);
          continue;
        }
        existingKeys.add(dedupKey);

        toAdd.push({
          localId: `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          file,
          originalName: cleanName,
          uploadName: cleanName,
          fileSize: file.size,
          mimeType: validation.mimeType,
          rootFolderId: params.rootFolderId,
          targetFolderId: params.targetFolderId,
          targetFolderName: params.targetFolderName,
          status: 'queued',
          progress: 0,
          bytesUploaded: 0,
          addedAt: Date.now(),
        });
      }

      if (toAdd.length > 0) {
        setItems((prev) => [...toAdd, ...prev]);
      }

      return {
        addedCount: toAdd.length,
        skippedDuplicates,
        rejectedFiles,
      };
    },
    []
  );

  const retryUpload = useCallback((localId: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.localId === localId && (it.status === 'error' || it.status === 'cancelled')
          ? {
              ...it,
              status: 'queued',
              progress: 0,
              bytesUploaded: 0,
              errorMessage: undefined,
            }
          : it
      )
    );
  }, []);

  const retryAllFailed = useCallback(() => {
    setItems((prev) =>
      prev.map((it) =>
        it.status === 'error'
          ? {
              ...it,
              status: 'queued',
              progress: 0,
              bytesUploaded: 0,
              errorMessage: undefined,
            }
          : it
      )
    );
  }, []);

  const resolveDuplicateWithRename = useCallback((localId: string) => {
    skipDuplicateCheckIdsRef.current.add(localId);
    setItems((prev) =>
      prev.map((it) => {
        if (it.localId !== localId || it.status !== 'duplicate') return it;
        const nextName = it.suggestedUniqueName || buildUniqueRenamedFileName(it.uploadName);
        return {
          ...it,
          uploadName: nextName,
          status: 'queued',
          progress: 0,
          bytesUploaded: 0,
          duplicateExistingId: undefined,
          suggestedUniqueName: undefined,
          errorMessage: undefined,
        };
      })
    );
  }, []);

  const cancelUpload = useCallback((localId: string) => {
    const ctrl = abortControllersRef.current.get(localId);
    if (ctrl) {
      try {
        ctrl.abort();
      } catch {
        // Ignore
      }
      abortControllersRef.current.delete(localId);
    }
    activeWorkersRef.current.delete(localId);
    setItems((prev) =>
      prev.map((it) =>
        it.localId === localId &&
        (it.status === 'queued' || it.status === 'checking' || it.status === 'uploading')
          ? { ...it, status: 'cancelled', errorMessage: 'Envio cancelado.' }
          : it
      )
    );
  }, []);

  const removeUploadItem = useCallback((localId: string) => {
    const ctrl = abortControllersRef.current.get(localId);
    if (ctrl) {
      try {
        ctrl.abort();
      } catch {
        // Ignore
      }
      abortControllersRef.current.delete(localId);
    }
    activeWorkersRef.current.delete(localId);
    skipDuplicateCheckIdsRef.current.delete(localId);
    setItems((prev) => prev.filter((it) => it.localId !== localId));
  }, []);

  const clearFinishedUploads = useCallback(() => {
    setItems((prev) =>
      prev.filter(
        (it) =>
          it.status === 'queued' ||
          it.status === 'checking' ||
          it.status === 'uploading' ||
          it.status === 'duplicate' ||
          it.status === 'error'
      )
    );
  }, []);

  const stats = useMemo(() => {
    let activeCount = 0;
    let queuedCount = 0;
    let completedCount = 0;
    let errorCount = 0;
    let duplicateCount = 0;
    let totalBytesInBatch = 0;
    let uploadedBytesInBatch = 0;

    for (const it of items) {
      if (it.status === 'uploading' || it.status === 'checking') {
        activeCount += 1;
        totalBytesInBatch += it.fileSize;
        uploadedBytesInBatch += it.bytesUploaded;
      } else if (it.status === 'queued') {
        queuedCount += 1;
        totalBytesInBatch += it.fileSize;
      } else if (it.status === 'completed') {
        completedCount += 1;
      } else if (it.status === 'error') {
        errorCount += 1;
      } else if (it.status === 'duplicate') {
        duplicateCount += 1;
      }
    }

    const overallProgress =
      totalBytesInBatch > 0
        ? Math.min(100, Math.round((uploadedBytesInBatch / totalBytesInBatch) * 100))
        : activeCount === 0 && queuedCount === 0 && completedCount > 0
          ? 100
          : 0;

    return {
      activeCount,
      queuedCount,
      completedCount,
      errorCount,
      duplicateCount,
      overallProgress,
    };
  }, [items]);

  const value = useMemo<ArquivoUploadContextValue>(
    () => ({
      items,
      ...stats,
      completedTick,
      enqueueFiles,
      retryUpload,
      retryAllFailed,
      resolveDuplicateWithRename,
      cancelUpload,
      removeUploadItem,
      clearFinishedUploads,
    }),
    [
      items,
      stats,
      completedTick,
      enqueueFiles,
      retryUpload,
      retryAllFailed,
      resolveDuplicateWithRename,
      cancelUpload,
      removeUploadItem,
      clearFinishedUploads,
    ]
  );

  return (
    <ArquivoUploadContext.Provider value={value}>
      {children}
    </ArquivoUploadContext.Provider>
  );
}

export function useArquivoUpload(): ArquivoUploadContextValue {
  return useContext(ArquivoUploadContext);
}
