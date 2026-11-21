import React from 'react';
import heroBackdropImg from '../assets/images/siscom_operational_montage_1795291140833.jpg';

interface OperationalBackdropProps {
  /** 'workspace' uses a calmer, darker scrim ideal behind editors & forms; 'auth' is slightly brighter */
  mode?: 'workspace' | 'auth';
}

export const OperationalBackdrop: React.FC<OperationalBackdropProps> = ({
  mode = 'workspace',
}) => {
  const isAuth = mode === 'auth';

  return (
    <div
      aria-hidden="true"
      className="no-print pointer-events-none fixed inset-0 overflow-hidden z-0"
    >
      <img
        src={heroBackdropImg}
        alt=""
        className={`w-full h-full object-cover object-center select-none scale-[1.03] ${
          isAuth
            ? 'opacity-[0.44] sm:opacity-[0.50] blur-[1px]'
            : 'opacity-[0.34] sm:opacity-[0.38] blur-[2px]'
        }`}
      />
      <div
        className="absolute inset-0"
        style={{
          background: isAuth
            ? 'linear-gradient(180deg, rgba(6, 9, 8, 0.42) 0%, rgba(7, 10, 9, 0.56) 50%, rgba(6, 9, 8, 0.80) 100%)'
            : 'linear-gradient(180deg, rgba(6, 9, 8, 0.54) 0%, rgba(7, 11, 9, 0.62) 48%, rgba(6, 9, 8, 0.78) 100%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(85% 75% at 50% 25%, rgba(28, 56, 42, 0.14) 0%, rgba(6, 9, 8, 0.52) 100%)',
        }}
      />
    </div>
  );
};
