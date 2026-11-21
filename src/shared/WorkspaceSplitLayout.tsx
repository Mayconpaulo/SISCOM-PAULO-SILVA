import React from 'react';

export interface WorkspaceSplitLayoutProps {
  /** Left panel: model, template structure, data and export settings */
  sidebar: React.ReactNode;
  /** Center full-height canvas (A4 sheet, preview, calendar, table) — no bars above or below */
  children: React.ReactNode;
  /** Optional right panel: text formatting, Word-style controls, typography, page zoom */
  rightSidebar?: React.ReactNode;
  /** Desktop fixed left sidebar width classes */
  sidebarWidthClass?: string;
  /** Desktop fixed right sidebar width classes */
  rightSidebarWidthClass?: string;
  /** Extra classes applied to the scrollable center workspace canvas */
  contentClassName?: string;
  /** Optional ref forwarded to the center scrollable workspace pane */
  contentRef?: React.Ref<HTMLDivElement>;
}

/**
 * Unified 3-column desktop studio workspace:
 * - Left fixed sidebar: model/structure/data settings (independent scroll)
 * - Center main canvas: 100% viewport height with nothing above or below the sheet
 * - Right fixed sidebar (optional): text/typography/Word/page controls (independent scroll, padded at bottom for FAB clearance)
 * - Mobile (< lg): single-column stacked flow (left settings -> right text tools -> canvas preview)
 */
export const WorkspaceSplitLayout: React.FC<WorkspaceSplitLayoutProps> = ({
  sidebar,
  children,
  rightSidebar,
  sidebarWidthClass = 'lg:w-[300px] xl:w-[332px]',
  rightSidebarWidthClass = 'lg:w-[264px] xl:w-[292px]',
  contentClassName = '',
  contentRef,
}) => {
  return (
    <main className="workspace-split-container flex-1 w-full flex flex-col lg:flex-row lg:h-full lg:min-h-0 lg:overflow-hidden print-wrapper">
      {/* Left Fixed Sidebar (Model & Structure Settings) */}
      <aside
        className={`no-print w-full ${sidebarWidthClass} shrink-0 p-3.5 sm:p-5 lg:p-4 lg:pb-8 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-white/[0.11] siscom-liquid-sidebar`}
      >
        {sidebar}
      </aside>

      {/* Center Full-Height Document / Preview Canvas (Nothing Above, Nothing Below) */}
      <section className="workspace-split-container flex-1 min-w-0 flex flex-col lg:h-full lg:min-h-0 lg:overflow-hidden print-wrapper order-3 lg:order-2">
        <div
          ref={contentRef}
          className={`workspace-scroll-pane flex-1 min-h-0 lg:overflow-y-auto lg:overscroll-contain px-3.5 sm:px-5 py-4 sm:py-5 pb-24 lg:pb-8 print-wrapper ${contentClassName}`}
        >
          {children}
        </div>
      </section>

      {/* Right Fixed Sidebar (Text Formatting, Word Tools, Typography & Page Settings) */}
      {rightSidebar && (
        <aside
          className={`no-print w-full ${rightSidebarWidthClass} shrink-0 px-3.5 sm:px-5 pb-3.5 sm:pb-5 lg:p-4 lg:pb-24 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:border-l lg:border-white/[0.11] siscom-liquid-sidebar-right order-2 lg:order-3`}
        >
          {rightSidebar}
        </aside>
      )}
    </main>
  );
};
