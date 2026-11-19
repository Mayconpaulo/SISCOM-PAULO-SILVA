import type { Transition, Variants } from 'motion/react';

/**
 * SISCOM Motion System
 * Restraint, precision, and natural deceleration curves.
 * Strictly compositor-only properties (opacity, transform).
 */
export const SISCOM_EASE = [0.22, 1, 0.36, 1] as const;

/** 150–220ms: buttons, tabs, checkboxes, feedback pills */
export const MICRO_TRANSITION: Transition = {
  duration: 0.18,
  ease: SISCOM_EASE,
};

/** 200–300ms: panels, step changes, cards, alerts */
export const UI_TRANSITION: Transition = {
  duration: 0.24,
  ease: SISCOM_EASE,
};

/** 250–350ms: modals, sheets, module view transitions */
export const MODAL_TRANSITION: Transition = {
  duration: 0.28,
  ease: SISCOM_EASE,
};

export const CREST_LAYOUT_TRANSITION: Transition = {
  type: 'spring',
  stiffness: 220,
  damping: 26,
  mass: 0.9,
};

export const MODULE_EXPAND_TRANSITION: Transition = {
  duration: 0.32,
  ease: SISCOM_EASE,
};

export const MODULE_LOCKUP_TRANSITION: Transition = {
  duration: 0.32,
  ease: SISCOM_EASE,
};

export const fadeSlideVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: UI_TRANSITION },
  exit: { opacity: 0, y: -4, transition: MICRO_TRANSITION },
};

export const stepSlideVariants: Variants = {
  initial: { opacity: 0, x: 10 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.22, ease: SISCOM_EASE } },
  exit: { opacity: 0, x: -8, transition: { duration: 0.15, ease: SISCOM_EASE } },
};

export const modalBackdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.22, ease: SISCOM_EASE } },
  exit: { opacity: 0, transition: { duration: 0.18, ease: SISCOM_EASE } },
};

export const modalPanelVariants: Variants = {
  initial: { opacity: 0, scale: 0.97, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0, transition: MODAL_TRANSITION },
  exit: { opacity: 0, scale: 0.98, y: 6, transition: { duration: 0.18, ease: SISCOM_EASE } },
};

export const noticeVariants: Variants = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: SISCOM_EASE } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15, ease: SISCOM_EASE } },
};
