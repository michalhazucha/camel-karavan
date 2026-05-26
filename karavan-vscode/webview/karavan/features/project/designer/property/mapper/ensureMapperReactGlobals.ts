import React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as ReactJSXRuntime from "react/jsx-runtime";

/** Mapper IIFE expects these globals so it shares the webview React instance (avoids React #525). */
export const ensureMapperReactGlobals = (): void => {
    const w = window as Window & {
        React?: typeof React;
        ReactDOM?: typeof ReactDOM;
        ReactDOMClient?: typeof ReactDOMClient;
        jsxRuntime?: typeof ReactJSXRuntime;
    };
    w.React = React;
    w.ReactDOM = ReactDOM;
    w.ReactDOMClient = ReactDOMClient;
    w.jsxRuntime = ReactJSXRuntime;
};
