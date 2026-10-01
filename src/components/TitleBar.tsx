import { useState } from "react";
import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function TitleBar({
  nav,
  onReloadCatalog,
  onForgetToken,
  hasToken,
}: {
  nav: ReactNode;
  onReloadCatalog: () => void;
  onForgetToken: () => void;
  hasToken: boolean;
}) {
  const win = getCurrentWindow();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <span className="menu-wrap">
          <button
            type="button"
            className="menu-btn"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 5h10M4 12h16M7 19h10" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <span className="menu-overlay" onClick={() => setMenuOpen(false)} />
              <span className="menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onReloadCatalog();
                  }}
                >
                  Reload catalog
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!hasToken}
                  onClick={() => {
                    setMenuOpen(false);
                    onForgetToken();
                  }}
                >
                  Forget token
                </button>
                <span className="menu-sep" />
                <span className="menu-foot">QuestRig v0.5.0</span>
              </span>
            </>
          )}
        </span>
        <span className="app-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M7.5 21.7a8.95 8.95 0 0 1 9 0 1 1 0 0 0 1-1.73c-.6-.35-1.24-.64-1.9-.87.54-.3 1.05-.65 1.52-1.07a3.98 3.98 0 0 0 5.49-1.8.77.77 0 0 0-.24-.95 3.98 3.98 0 0 0-2.02-.76A4 4 0 0 0 23 10.47a.76.76 0 0 0-.71-.71 4.06 4.06 0 0 0-1.6.22 3.99 3.99 0 0 0 .54-5.35.77.77 0 0 0-.95-.24c-.75.36-1.37.95-1.77 1.67V6a4 4 0 0 0-4.9-3.9.77.77 0 0 0-.6.72 4 4 0 0 0 3.7 4.17c.89 1.3 1.3 2.95 1.3 4.51 0 3.66-2.75 6.5-6 6.5s-6-2.84-6-6.5c0-1.56.41-3.21 1.3-4.51A4 4 0 0 0 11 2.82a.77.77 0 0 0-.6-.72 4.01 4.01 0 0 0-4.9 3.96A4.02 4.02 0 0 0 3.73 4.4a.77.77 0 0 0-.95.24 3.98 3.98 0 0 0 .55 5.35 4 4 0 0 0-1.6-.22.76.76 0 0 0-.72.71l-.01.28a4 4 0 0 0 2.65 3.77c-.75.06-1.45.33-2.02.76-.3.22-.4.62-.24.95a4 4 0 0 0 5.49 1.8c.47.42.98.78 1.53 1.07-.67.23-1.3.52-1.91.87a1 1 0 1 0 1 1.73Z" />
          </svg>
        </span>
        <span className="wordmark">
          Quest<em>Rig</em>
        </span>
      </div>
      <div className="titlebar-center">{nav}</div>
      <div className="window-btns">
        <button type="button" className="wbtn" aria-label="Minimize" onClick={() => void win.minimize()}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8h10" />
          </svg>
        </button>
        <button type="button" className="wbtn" aria-label="Maximize" onClick={() => void win.toggleMaximize()}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
          </svg>
        </button>
        <button type="button" className="wbtn close" aria-label="Close" onClick={() => void win.close()}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4L4 12" />
          </svg>
        </button>
      </div>
    </header>
  );
}
