import type { Timestamp } from 'firebase/firestore';

export type DriveAuditAction =
  | 'drive_connect'
  | 'drive_disconnect'
  | 'root_select'
  | 'root_unlink'
  | 'folder_create'
  | 'folder_rename'
  | 'folder_delete'
  | 'file_upload';

export interface DriveRootConfig {
  id: 'root_folder';
  rootFolderId: string;
  rootFolderName: string;
  institutionalEmail: string;
  linkedAccountEmail: string;
  driveWebViewUrl: string;
  sectionScope: 'comsoc';
  updatedByUid: string;
  updatedByName: string;
  updatedAt?: Timestamp;
}

export interface DriveAuditEntry {
  id: string;
  action: DriveAuditAction;
  targetId: string;
  targetName: string;
  summary: string;
  actorUid: string;
  actorName: string;
  sectionScope: 'comsoc';
  createdAt?: Timestamp;
}

export interface DriveStorageQuota {
  limitBytes: number | null;
  usageBytes: number | null;
  usageInDriveBytes: number | null;
}

export interface DriveAccountInfo {
  email: string | null;
  displayName: string | null;
  storageQuota: DriveStorageQuota;
}

export interface DriveFolderCandidate {
  id: string;
  name: string;
  modifiedTime: string | null;
  ownedByMe: boolean;
  ownerEmail: string | null;
  ownerName: string | null;
  webViewLink: string | null;
  canAddChildren: boolean;
  canListChildren: boolean;
}

export interface DriveFolderItem {
  id: string;
  name: string;
  modifiedTime: string | null;
  createdTime: string | null;
  canRename: boolean;
  canDelete: boolean;
  canAddChildren: boolean;
}

export interface DriveFolderListResult {
  parentId: string;
  folders: DriveFolderItem[];
  directFileCount: number;
  directFileCountTruncated: boolean;
}

export interface DriveFolderInspection {
  folderId: string;
  folderName: string;
  directSubfolderCount: number;
  directFileCount: number;
  totalSubfolderCount: number;
  totalFileCount: number;
  scanTruncated: boolean;
  isEmpty: boolean;
}

export interface DriveBreadcrumbNode {
  id: string;
  name: string;
}

export type DriveUploadStatus =
  | 'queued'
  | 'checking'
  | 'duplicate'
  | 'uploading'
  | 'completed'
  | 'error'
  | 'cancelled';

export interface DriveUploadItem {
  localId: string;
  file: File;
  originalName: string;
  uploadName: string;
  fileSize: number;
  mimeType: string;
  rootFolderId: string;
  targetFolderId: string;
  targetFolderName: string;
  status: DriveUploadStatus;
  progress: number;
  bytesUploaded: number;
  driveFileId?: string;
  errorMessage?: string;
  duplicateExistingId?: string;
  suggestedUniqueName?: string;
  addedAt: number;
  completedAt?: number;
}

export const ALLOWED_UPLOAD_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'heic',
  'heif',
  'mp4',
  'mov',
  'pdf',
] as const;

export const ALLOWED_UPLOAD_ACCEPT =
  '.jpg,.jpeg,.png,.heic,.heif,.mp4,.mov,.pdf,image/jpeg,image/png,image/heic,image/heif,video/mp4,video/quicktime,application/pdf';

export const DRIVE_AUDIT_ACTION_LABELS: Record<DriveAuditAction, string> = {
  drive_connect: 'Conexão Drive',
  drive_disconnect: 'Desconexão Drive',
  root_select: 'Pasta raiz vinculada',
  root_unlink: 'Pasta raiz desvinculada',
  folder_create: 'Pasta criada',
  folder_rename: 'Pasta renomeada',
  folder_delete: 'Pasta excluída',
  file_upload: 'Envio de arquivo',
};
