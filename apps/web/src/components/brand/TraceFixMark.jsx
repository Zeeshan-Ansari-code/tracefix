/**
 * TraceFix mark — trace path → resolved check.
 * Use in shell, auth, and anywhere the brand needs a mark.
 */
export function TraceFixMark({ size = 28, className, title = 'TraceFix' }) {
  const id = `tf-${size}`;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={id} x1="12" y1="48" x2="52" y2="12" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1F9D63" />
          <stop offset="1" stopColor="#3DD68C" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#0F1728" />
      <path
        d="M16 20h32M16 32h32M16 44h32M20 16v32M32 16v32M44 16v32"
        stroke="#1A2433"
        strokeWidth="1.2"
      />
      <path
        d="M13 46c6-2 8-14 15-16 7-2 8 10 15 8 4-1 7-7 9-12"
        stroke={`url(#${id})`}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="44" r="3.2" fill="#3DD68C" />
      <circle cx="33" cy="28" r="3.2" fill="#3DD68C" />
      <circle cx="50" cy="16" r="9" fill="#1F9D63" />
      <path
        d="M45.8 16.2l2.8 2.8 5.6-5.8"
        stroke="#F4FFF8"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
