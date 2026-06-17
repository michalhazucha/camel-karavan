import * as vscode from "vscode";

const themedWebviews = new Set<vscode.Webview>();

export const isDarkColorTheme = (kind: vscode.ColorThemeKind): boolean =>
    kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;

export const postThemeToWebview = (
    webview: vscode.Webview,
    kind: vscode.ColorThemeKind = vscode.window.activeColorTheme.kind,
): void => {
    void webview.postMessage({
        command: "theme",
        type: "theme",
        value: kind,
        isDark: isDarkColorTheme(kind),
    });
};

export const registerThemedWebview = (webview: vscode.Webview): vscode.Disposable => {
    themedWebviews.add(webview);
    postThemeToWebview(webview);
    return new vscode.Disposable(() => {
        themedWebviews.delete(webview);
    });
};

export const bindThemedPanel = (panel: vscode.WebviewPanel, context: vscode.ExtensionContext): void => {
    const registration = registerThemedWebview(panel.webview);
    panel.onDidDispose(() => registration.dispose(), null, context.subscriptions);
};

export const bindThemedWebviewView = (webviewView: vscode.WebviewView, context: vscode.ExtensionContext): void => {
    const registration = registerThemedWebview(webviewView.webview);
    webviewView.onDidDispose(() => registration.dispose(), null, context.subscriptions);
};

export const activateWebviewThemeSync = (context: vscode.ExtensionContext): void => {
    context.subscriptions.push(
        vscode.window.onDidChangeActiveColorTheme((theme) => {
            themedWebviews.forEach((webview) => postThemeToWebview(webview, theme.kind));
        }),
    );
};
