import React, { useCallback, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../../lib/utils';
import { SPRING_EXPRESSIVE } from '../../shared/motion';

interface SpotlightCardBaseProps {
  children: React.ReactNode;
  className?: string;
  index?: number;
  highlighted?: boolean;
  layout?: boolean | 'position';
}

interface SpotlightButtonCardProps extends SpotlightCardBaseProps {
  href?: undefined;
  onClick: () => void;
  ariaLabel?: string;
}

interface SpotlightLinkCardProps extends SpotlightCardBaseProps {
  href: string;
  onClick?: undefined;
  ariaLabel?: string;
}

export type SpotlightCardProps = SpotlightButtonCardProps | SpotlightLinkCardProps;

/**
 * 21st.dev-inspired interactive pointer-tracking Spotlight Card
 * paired with Motion.dev spring layout transitions.
 * Updates CSS custom properties directly on the DOM node for 60fps zero-re-render hover lighting.
 */
export const SpotlightCard: React.FC<SpotlightCardProps> = ({
  children,
  className,
  index = 0,
  highlighted = false,
  layout = true,
  href,
  onClick,
  ariaLabel,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const nodeRef = useRef<HTMLElement | null>(null);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (prefersReducedMotion || e.pointerType !== 'mouse') return;
      const el = nodeRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
      el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
      el.style.setProperty('--spot-opacity', '1');
    },
    [prefersReducedMotion]
  );

  const handlePointerLeave = useCallback(() => {
    const el = nodeRef.current;
    if (!el) return;
    el.style.setProperty('--spot-opacity', '0');
  }, []);

  const sharedClassName = cn(
    'siscom-spotlight-card group rounded-2xl cursor-pointer select-none will-change-transform no-underline',
    highlighted &&
      'ring-1 ring-[#DFBC75]/65 border-[#DFBC75]/55 shadow-[inset_0_1px_0_rgba(255,250,236,0.3),0_18px_36px_-14px_rgba(0,0,0,0.82)]',
    className
  );

  const motionProps = {
    layout: prefersReducedMotion ? false : layout,
    initial: prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.985 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 },
    transition: prefersReducedMotion
      ? { duration: 0.12 }
      : {
          ...SPRING_EXPRESSIVE,
          delay: Math.min(index * 0.024, 0.18),
        },
    whileTap: prefersReducedMotion ? undefined : { scale: 0.978 },
    onPointerMove: handlePointerMove,
    onPointerLeave: handlePointerLeave,
  };

  if (href) {
    return (
      <motion.a
        ref={(el) => {
          nodeRef.current = el;
        }}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel}
        className={sharedClassName}
        {...motionProps}
      >
        {children}
      </motion.a>
    );
  }

  return (
    <motion.button
      ref={(el) => {
        nodeRef.current = el;
      }}
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={sharedClassName}
      {...motionProps}
    >
      {children}
    </motion.button>
  );
};
