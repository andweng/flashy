// Custom HTML wrapper for the static web export.
// Adds PWA meta tags, the web app manifest, and registers a minimal service worker.

import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="theme-color" content="#3c87f7" />
        <meta name="description" content="Family flashcards, Leitner style." />

        {/* iOS standalone web app */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Flashy" />

        <title>Flashy</title>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icon.png" />

        {/* The web <body> has no background of its own, so without this it stays
            browser-default white while the JS-themed app renders dark — dark
            components on a white page. This makes the page background follow the
            OS color scheme (no white flash before JS runs);
            ThemePreferenceProvider overrides it from JS to honor a manual
            light/dark choice that differs from the OS. */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              :root { color-scheme: light dark; }
              html, body { background-color: #ffffff; }
              @media (prefers-color-scheme: dark) {
                html, body { background-color: #000000; }
              }
            `,
          }}
        />

        <ScrollViewStyleReset />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function () {
                  navigator.serviceWorker.register('/sw.js').catch(function (err) {
                    console.warn('SW registration failed:', err);
                  });
                });
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
