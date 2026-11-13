import { useEffect } from "react";

/**
 * Client-side defense-in-depth hook to deter casual DevTools inspection,
 * hotkey interception (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U), and context menu inspection in production.
 */
export const useDevtoolsProtection = () => {
	useEffect(() => {
		if (process.env.NODE_ENV !== "production") {
			return;
		}

		// Prevent right-click context menu outside of input/textarea fields
		const handleContextMenu = (e: MouseEvent) => {
			const target = e.target as HTMLElement | null;
			const isEditable =
				target?.tagName === "INPUT" ||
				target?.tagName === "TEXTAREA" ||
				target?.isContentEditable ||
				target?.closest("[contenteditable='true']");

			if (!isEditable) {
				e.preventDefault();
			}
		};

		// Prevent developer tool keyboard shortcuts
		const handleKeyDown = (e: KeyboardEvent) => {
			const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
			const modifier = isMac ? e.metaKey : e.ctrlKey;

			// F12 key
			if (e.key === "F12" || e.keyCode === 123) {
				e.preventDefault();
				e.stopPropagation();
				return false;
			}

			// Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C (DevTools / Console / Inspector)
			if (
				modifier &&
				e.shiftKey &&
				(e.key === "I" ||
					e.key === "i" ||
					e.key === "J" ||
					e.key === "j" ||
					e.key === "C" ||
					e.key === "c")
			) {
				e.preventDefault();
				e.stopPropagation();
				return false;
			}

			// Ctrl+U (View Page Source)
			if (modifier && (e.key === "U" || e.key === "u")) {
				e.preventDefault();
				e.stopPropagation();
				return false;
			}

			// Ctrl+S (Save Page)
			if (modifier && (e.key === "S" || e.key === "s") && !e.shiftKey) {
				const target = e.target as HTMLElement | null;
				const isEditable =
					target?.tagName === "INPUT" ||
					target?.tagName === "TEXTAREA" ||
					target?.isContentEditable;
				if (!isEditable) {
					e.preventDefault();
					e.stopPropagation();
					return false;
				}
			}
		};

		window.addEventListener("contextmenu", handleContextMenu, { capture: true });
		window.addEventListener("keydown", handleKeyDown, { capture: true });

		return () => {
			window.removeEventListener("contextmenu", handleContextMenu, { capture: true });
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, []);
};

