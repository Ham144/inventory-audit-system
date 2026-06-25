import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

import { useEffect } from "react";
import { useUserInfo } from "./store";
import { getUserInfo } from "./api/authApi";
import { syncAppUser, getAppUser } from "./api/opnameUserApi";
import { parseAuthProfile, resolveUserRole } from "./libs/auth-profile";
import { applyStoredTheme } from "./libs/app-prefs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

export default function App() {
  const setUserInfo = useUserInfo((state) => state.setUserInfo);

  useEffect(() => {
    applyStoredTheme();
  }, []);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await getUserInfo();
        if (!res) return;

        const profile = parseAuthProfile(res);
        if (!profile) return;

        try {
          const synced = await syncAppUser({
            office: profile.office,
            description: profile.description,
          });
          setUserInfo({
            username: profile.username,
            office: synced.office ?? profile.office,
            description: profile.description ?? undefined,
            role: resolveUserRole(profile, synced.role),
          });
        } catch {
          try {
            const appUser = await getAppUser();
            setUserInfo({
              username: profile.username,
              office: appUser.office ?? profile.office,
              description: profile.description ?? undefined,
              role: resolveUserRole(profile, appUser.role),
            });
          } catch {
            setUserInfo({
              username: profile.username,
              office: profile.office,
              description: profile.description ?? undefined,
              role: resolveUserRole(profile),
            });
          }
        }
      } catch {
        // user belum login atau sesi habis
      }
    };
    fetchUser();
  }, [setUserInfo]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
