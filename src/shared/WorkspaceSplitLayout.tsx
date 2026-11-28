import React from 'react';
import { useTabletPortrait } from './useTabletPortrait';

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
 * Unified adaptive studio workspace:
 * - Desktop / Tablet Landscape: 3-column fixed left sidebar | center canvas | right sidebar
 * - Tablet Portrait (600px–1366px portrait):
 *     • When both sidebars exist: left sidebar becomes a static horizontal TOP bar, right sidebar becomes
 *       a static horizontal BOTTOM bar, and the sheet/canvas scrolls & zooms independently in the middle.
 *     • When only one sidebar exists: prioritizes placing that single static horizontal bar at the BOTTOM.
 * - Phone (< 600px): single-column stacked flow.
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
  const isTabletPortrait = useTabletPortrait();

  if (isTabletPortrait) {
    const hasBothBars = Boolean(rightSidebar);

    return (
      <main className="workspace-split-container siscom-tablet-portrait-workspace flex-1 w-full flex flex-col h-full min-h-0 overflow-hidden print-wrapper">
        {/* Top Static Horizontal Bar (Left sidebar moved to top when both bars exist) */}
        {hasBothBars && (
          <aside className="no-print siscom-tablet-bar siscom-tablet-bar-top shrink-0 w-full border-b border-white/[0.11] order-1">
            {sidebar}
          </aside>
        )}

        {/* Center Independent Scroll/Zoom Sheet Canvas */}
        <section
          className={`workspace-split-container flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden print-wrapper ${
            hasBothBars ? 'order-2' : 'order-1'
          }`}
        >
          <div
            ref={contentRef}
            className={`workspace-scroll-pane flex-1 min-h-0 overflow-auto overscroll-contain px-4 py-4 print-wrapper ${contentClassName}`}
          >
            {children}
          </div>
        </section>

        {/* Bottom Static Horizontal Bar (Right sidebar when both exist, or sole sidebar prioritized at bottom) */}
        <aside
          className={`no-print siscom-tablet-bar siscom-tablet-bar-bottom shrink-0 w-full border-t border-white/[0.11] ${
            hasBothBars ? 'order-3' : 'order-2'
          }`}
        >
          {hasBothBars ? rightSidebar : sidebar}
        </aside>
      </main>
    );
  }

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
