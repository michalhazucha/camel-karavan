/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { useTheme } from "@app/theme/ThemeContext";
import { ensureEditorString } from "@/karavan/utils/workspaceFileResolver";
import Editor from "@monaco-editor/react";
import React, { useEffect, useState } from 'react';
import { ExpressionFunctions, ExpressionVariables } from "./ExpressionContextModel";
import './ExpressionEditor.css';

interface Props {
    customCode: any,
    onChange: (value: string |undefined) => void,
    title: string,
    dslLanguage?: [string, string, string],
    dark?: boolean,
    name?: string
}

export function ExpressionEditor(props: Props) {

    const {isDark} = useTheme();
    const [customCode, setCustomCode] = useState<string | undefined>();

    const {dslLanguage, onChange} = props;

    useEffect(() => {
        setCustomCode(ensureEditorString(props.customCode));
    }, [props.customCode]);

    const language = dslLanguage?.[0] ?? 'plaintext';
    const editorKey = `${language}-${props.name ?? 'editor'}`;
    const showVars = ExpressionVariables.findIndex(e => e.name === language) > - 1;
    const showFuncs = ExpressionFunctions.findIndex(e => e.name === language) > - 1;
    const show = showVars || showFuncs;

    return (
        <div className='container expression-editor-root'>
            <div className='panel-top'>
                <Editor
                    key={editorKey}
                    height="100%"
                    width="100%"
                    defaultLanguage={language}
                    language={language}
                    theme={isDark ? 'vs-dark' : 'light'}
                    options={{
                        lineNumbers: "on",
                        folding: true,
                        lineNumbersMinChars: 3,
                        showUnused: false,
                        fontSize: 13,
                        minimap: {enabled: false},
                        wordWrap: "on",
                    }}
                    value={ensureEditorString(customCode)}
                    className={'code-editor'}
                    onChange={(value) => {
                        const next = value ?? '';
                        setCustomCode(next);
                        onChange(next);
                    }}
                />
            </div>

        </div>
    )
}
