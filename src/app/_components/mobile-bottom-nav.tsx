"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  {
    href: "/",
    label: "Home",
    match: (pathname: string) => pathname === "/",
    icon: (
      <path
        d="M3.75 10.5 12 3.75l8.25 6.75M5.5 9.75v9.75h4.25v-5.25h4.5v5.25h4.25V9.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    href: "/solo",
    label: "Solo",
    match: (pathname: string) =>
      pathname === "/solo" || pathname.startsWith("/solo/run"),
    icon: (
      <>
        <circle cx="12" cy="12" r="8.25" />
        <path d="m10.25 8.75 5 3.25-5 3.25Z" strokeLinejoin="round" />
      </>
    ),
  },
  {
    href: "/solo/leaderboards",
    label: "Boards",
    match: (pathname: string) => pathname.startsWith("/solo/leaderboards"),
    icon: (
      <>
        <path d="M5.5 19V11.5" strokeLinecap="round" />
        <path d="M12 19V5" strokeLinecap="round" />
        <path d="M18.5 19v-9.5" strokeLinecap="round" />
        <path d="M4 19.25h16" strokeLinecap="round" />
      </>
    ),
  },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <>
      <div aria-hidden="true" className="h-24 shrink-0 sm:hidden" />
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] backdrop-blur sm:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-3 gap-1">
          {navItems.map((item) => {
            const isActive = item.match(pathname);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium transition ${
                  isActive
                    ? "bg-gray-900 text-white"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                >
                  {item.icon}
                </svg>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
