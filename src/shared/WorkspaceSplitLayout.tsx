import React from 'react';

export interface WorkspaceSplitLayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  bottomBar?: React.ReactNode;
  /** Desktop fixed left sidebar width classes (default: lg:w-[390px] xl:w-[420px]) */
  sidebarWidthClass?: string;
  /** Extra classes applied to the scrollable right workspace canvas */
  contentClassName?: string;
  /** Extra classes applied to the fixed bottom bar container */
  bottomBarClassName?: string;
  /**
   * Controls where the bottomBar appears on mobile (< lg) while keeping it
   * anchored at the bottom on desktop (lg+) to form the L-shaped fixed frame.
   */
  mobileBottomBarPosition?: 'top' | 'bottom';
  /** Optional ref forwarded to the right scrollable workspace pane */
  contentRef?: React.Ref<HTMLDivElement>;
}

/**
 * Unified desktop L-shaped workspace frame:
 * - On desktop (lg+): fixed left sidebar (independent vertical scroll) +
 *   independent scrollable main document pane + optional fixed bottom bar
 *   forming a continuous L-shape around the page without overlapping content.
 * - On mobile (< lg): natural single-column stacked flow for comfortable touch scrolling.
 */
export const WorkspaceSplitLayout: React.FC<WorkspaceSplitLayoutProps> = ({
  sidebar,
  children,
  bottomBar,
  sidebarWidthClass = 'lg:w-[390px] xl:w-[420px]',
  contentClassName = '',
  bottomBarClassName = '',
  mobileBottomBarPosition = 'bottom',
  contentRef,
}) => {
  return (
    <main className="workspace-split-container flex-1 w-full flex flex-col lg:flex-row lg:h-full lg:min-h-0 lg:overflow-hidden print-wrapper">
      {/* Left Fixed Sidebar (vertical leg of the L on desktop) */}
      <aside
        className={`no-print w-full ${sidebarWidthClass} shrink-0 p-3.5 sm:p-5 lg:p-4 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-white/[0.11] siscom-liquid-sidebar`}
      >
        {sidebar}
      </aside>

      {/* Right Main Column: Independent Scrollable Page + Optional Fixed Bottom Bar (foot of the L) */}
      <section className="workspace-split-container flex-1 min-w-0 flex flex-col lg:h-full lg:min-h-0 lg:overflow-hidden print-wrapper">
        <div
          ref={contentRef}
          className={`workspace-scroll-pane flex-1 min-h-0 lg:overflow-y-auto lg:overscroll-contain px-3.5 sm:px-6 py-4 sm:py-6 print-wrapper ${contentClassName}`}
        >
          {children}
        </div>

        {bottomBar && (
          <div
            className={`no-print siscom-liquid-bar shrink-0 px-3.5 sm:px-5 py-2.5 ${
              mobileBottomBarPosition === 'top'
                ? 'order-first lg:order-last border-b border-white/[0.12] lg:border-b-0 lg:border-t lg:border-white/[0.12]'
                : 'border-t border-white/[0.12]'
            } lg:shadow-[0_-12px_28px_-16px_rgba(0,0,0,0.8)] ${bottomBarClassName}`}
          >
            {bottomBar}
          </div>
        )}
      </section>
    </main>
  );
};
