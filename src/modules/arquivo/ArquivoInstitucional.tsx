import React from 'react';
import { ExternalLink, Folder } from 'lucide-react';

export const ARQUIVO_DRIVE_FOLDER_URL =
  'https://drive.google.com/drive/folders/1eFGncFhMuOQBEU4Gv-NDFw8BVphTub7v?usp=drive_link';

export function ArquivoInstitucional() {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center px-4 py-8">
      <section className="metal-surface rounded-xl p-6 sm:p-7 max-w-md w-full text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-[#14251C]/85 border border-[#C9A961]/35 flex items-center justify-center text-[#E5C17B] mx-auto">
          <Folder className="w-6 h-6" />
        </div>
        <h2 className="font-display text-lg font-semibold text-[#F4E6C4] tracking-tight">
          FOTOS - 2026
        </h2>
        <a
          href={ARQUIVO_DRIVE_FOLDER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="siscom-btn siscom-btn-gold !min-h-[44px] w-full text-sm inline-flex items-center justify-center gap-2"
        >
          <span>Abrir no Google Drive</span>
          <ExternalLink className="w-4 h-4" />
        </a>
      </section>
    </div>
  );
}
