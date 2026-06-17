export interface VsCodeThemeMessage {
    value?: number;
    isDark?: boolean;
}

export const isVsCodeDarkBody = (): boolean =>
    document.body.classList.contains("vscode-dark")
    || document.body.classList.contains("vscode-high-contrast");

export const resolveVsCodeThemeDark = (message?: VsCodeThemeMessage): boolean => {
    if (typeof message?.isDark === "boolean") {
        return message.isDark;
    }
    if (message?.value === 2 || message?.value === 3) {
        return true;
    }
    if (message?.value === 1 || message?.value === 4) {
        return false;
    }
    return isVsCodeDarkBody();
};

export const applyPatternflyTheme = (isDark: boolean): void => {
    document.documentElement.classList.toggle("pf-v6-theme-dark", isDark);
};

export const watchVsCodeBodyTheme = (callback: () => void): (() => void) => {
    const observer = new MutationObserver(callback);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
};

export const isThemeMessage = (data: unknown): data is VsCodeThemeMessage & { type?: string; command?: string } => {
    if (!data || typeof data !== "object") {
        return false;
    }
    const msg = data as { type?: string; command?: string };
    return msg.type === "theme" || msg.command === "theme";
};
