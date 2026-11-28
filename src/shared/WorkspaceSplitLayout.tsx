import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { SISCOM_EASE } from './motion';
import { useTabletPortrait } from './useTabletPortrait';

export interface TabletWorkspaceDrawer {
  /** Which bar the floating panel anchors to */
  position?: 'top' | 'bottom';
  /** Alias for position */
  anchor?: 'top' | 'bottom';
  /** Concise title shown in the drawer header */
  title: string;
  /** Called when backdrop, close button, or Escape is pressed */
  onClose: () => void;
  /** Panel body */
  content: React.ReactNode;
  /** Optional compact actions in the drawer header */
  headerActions?: React.ReactNode;
  /** Alias for headerActions */
  headerAction?: React.ReactNode;
}

export interface WorkspaceSplitLayoutProps {
  /** Left panel: model, template structure, data and export settings */
  sidebar: React.ReactNode;
  /** Center full-height canvas (A4 sheet, preview, calendar, table) — no bars above or below */
  children: React.ReactNode;
  /** Optional right panel: text formatting, Word-style controls, typography, page zoom */
  rightSidebar?: React.ReactNode;
  /** Ergonomic single-row horizontal top bar rendered in Tablet Portrait */
  tabletTopBar?: React.ReactNode;
  /** Ergonomic single-row horizontal bottom bar rendered in Tablet Portrait */
  tabletBottomBar?: React.ReactNode;
  /** When only one bar exists in Tablet Portrait, choose whether it docks at bottom (default) or top */
  tabletSingleBarPosition?: 'bottom' | 'top';
  /** Optional floating drawer anchored below the top bar or above the bottom bar in Tablet Portrait */
  tabletDrawer?: TabletWorkspaceDrawer | null;
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
 *     • Slim, single-axis horizontal static bars (top and/or bottom) with zero vertical scroll traps.
 *     • Complex forms & lists open inside anchored floating glass sheets without shifting the canvas.
 *     • When only one bar exists, docks at the bottom by default, or top when tabletSingleBarPosition="top".
 * - Phone (< 600px): single-column stacked flow.
 */
export const WorkspaceSplitLayout: React.FC<WorkspaceSplitLayoutProps> = ({
  sidebar,
  children,
  rightSidebar,
  tabletTopBar,
  tabletBottomBar,
  tabletSingleBarPosition = 'bottom',
  tabletDrawer = null,
  sidebarWidthClass = 'lg:w-[300px] xl:w-[332px]',
  rightSidebarWidthClass = 'lg:w-[264px] xl:w-[292px]',
  contentClassName = '',
  contentRef,
}) => {
  const isTabletPortrait = useTabletPortrait();

  useEffect(() => {
    if (!isTabletPortrait || !tabletDrawer) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        tabletDrawer.onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isTabletPortrait, tabletDrawer]);

  if (isTabletPortrait) {
    const hasCustomBars = Boolean(tabletTopBar || tabletBottomBar);
    let topContent: React.ReactNode = null;
    let bottomContent: React.ReactNode = null;

    if (hasCustomBars) {
      topContent = tabletTopBar ?? null;
      bottomContent = tabletBottomBar ?? null;
    } else if (rightSidebar) {
      topContent = sidebar;
      bottomContent = rightSidebar;
    } else if (tabletSingleBarPosition === 'top') {
      topContent = sidebar;
    } else {
      bottomContent = sidebar;
    }

    const hasTop = Boolean(topContent);
    const hasBottom = Boolean(bottomContent);

    return (
      <main className="workspace-split-container siscom-tablet-portrait-workspace relative flex-1 w-full flex flex-col h-full min-h-0 overflow-hidden print-wrapper">
        {/* Top Static Horizontal Bar */}
        {hasTop && (
          <aside className="no-print siscom-tablet-bar siscom-tablet-bar-top shrink-0 w-full border-b border-white/[0.11]">
            {topContent}
          </aside>
        )}

        {/* Center Independent Scroll/Zoom Sheet Canvas */}
        <section className="workspace-split-container relative flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden print-wrapper">
          <div
            ref={contentRef}
            className={`workspace-scroll-pane flex-1 min-h-0 overflow-auto overscroll-contain px-4 py-4 print-wrapper ${contentClassName}`}
          >
            {children}
          </div>

          {/* Anchored Floating Glass Drawer (never clipped by bar horizontal scroll) */}
          <AnimatePresence>
            {tabletDrawer && (() => {
              const drawerPos = tabletDrawer.position ?? tabletDrawer.anchor ?? 'bottom';
              const drawerActions = tabletDrawer.headerActions ?? tabletDrawer.headerAction;
              return (
                <>
                  <motion.div
                    key="tablet-drawer-backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    onClick={tabletDrawer.onClose}
                    aria-hidden="true"
                    className="no-print absolute inset-0 z-20 bg-black/48 backdrop-blur-[2px]"
                  />
                  <motion.div
                    key={`tablet-drawer-${drawerPos}-${tabletDrawer.title}`}
                    role="dialog"
                    aria-label={tabletDrawer.title}
                    initial={{
                      opacity: 0,
                      y: drawerPos === 'top' ? -12 : 12,
                    }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{
                      opacity: 0,
                      y: drawerPos === 'top' ? -10 : 10,
                    }}
                    transition={{ duration: 0.18, ease: SISCOM_EASE }}
                    className={`no-print absolute left-3 right-3 z-30 metal-elevated rounded-2xl border border-[#C9A961]/32 flex flex-col overflow-hidden max-h-[72%] ${
                      drawerPos === 'top' ? 'top-2.5' : 'bottom-2.5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/[0.09] bg-white/[0.03] shrink-0">
                      <span className="font-display text-sm font-semibold text-[#F4E6C4] truncate">
                        {tabletDrawer.title}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {drawerActions}
                        <button
                          type="button"
                          onClick={tabletDrawer.onClose}
                          aria-label="Fechar painel"
                          className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-[#98A89F] hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="p-4 overflow-y-auto overscroll-contain">
                      {tabletDrawer.content}
                    </div>
                  </motion.div>
                </>
              );
            })()}
          </AnimatePresence>
        </section>

        {/* Bottom Static Horizontal Bar */}
        {hasBottom && (
          <aside className="no-print siscom-tablet-bar siscom-tablet-bar-bottom shrink-0 w-full border-t border-white/[0.11]">
            {bottomContent}
          </aside>
        )}
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
