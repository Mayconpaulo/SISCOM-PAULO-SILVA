import type { Transition, Variants } from 'motion/react';

/**
 * SISCOM Motion System
 * Combines Motion.dev spring physics with Material Design 3 Expressive spring tokens.
 * Strictly compositor-only properties (opacity, transform) and respects prefers-reduced-motion.
 */
export const SISCOM_EASE = [0.22, 1, 0.36, 1] as const;

/** M3 Expressive / Motion.dev Snappy Spring: buttons, tabs, segmented indicators, toggles */
export const SPRING_SNAPPY: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 32,
  mass: 0.72,
};

/** M3 Expressive / Motion.dev Gentle Spring: dialogs, sheets, popovers, shared layouts */
export const SPRING_GENTLE: Transition = {
  type: 'spring',
  stiffness: 270,
  damping: 28,
  mass: 0.85,
};

/** M3 Expressive / Motion.dev Expressive Spring: grid reflow, card choreography, speed-dial */
export const SPRING_EXPRESSIVE: Transition = {
  type: 'spring',
  stiffness: 330,
  damping: 26,
  mass: 0.78,
};

/** 150–200ms: buttons, tabs, checkboxes, feedback indicators */
export const MICRO_TRANSITION: Transition = SPRING_SNAPPY;

/** 200–280ms: panels, step changes, cards, alerts */
export const UI_TRANSITION: Transition = {
  duration: 0.22,
  ease: SISCOM_EASE,
};

/** 240–320ms: modals, sheets, module view transitions */
export const MODAL_TRANSITION: Transition = SPRING_GENTLE;

export const CREST_LAYOUT_TRANSITION: Transition = {
  type: 'spring',
  stiffness: 240,
  damping: 27,
  mass: 0.88,
};

export const MODULE_EXPAND_TRANSITION: Transition = {
  duration: 0.3,
  ease: SISCOM_EASE,
};

export const MODULE_LOCKUP_TRANSITION: Transition = {
  type: 'spring',
  stiffness: 310,
  damping: 30,
  mass: 0.82,
};

export const fadeSlideVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: UI_TRANSITION },
  exit: { opacity: 0, y: -4, transition: { duration: 0.14, ease: SISCOM_EASE } },
};

export const stepSlideVariants: Variants = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.22, ease: SISCOM_EASE } },
  exit: { opacity: 0, x: -10, transition: { duration: 0.15, ease: SISCOM_EASE } },
};

export const modalBackdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2, ease: SISCOM_EASE } },
  exit: { opacity: 0, transition: { duration: 0.16, ease: SISCOM_EASE } },
};

export const modalPanelVariants: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 12 },
  animate: { opacity: 1, scale: 1, y: 0, transition: SPRING_GENTLE },
  exit: { opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.16, ease: SISCOM_EASE } },
};

export const noticeVariants: Variants = {
  initial: { opacity: 0, y: -6, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1, transition: SPRING_SNAPPY },
  exit: { opacity: 0, y: -4, scale: 0.99, transition: { duration: 0.14, ease: SISCOM_EASE } },
};
