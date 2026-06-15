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
import vscode from "@/vscode";
import { DslProperties } from "@features/project/designer/property/DslProperties";
import { ExpressionEditor } from "@features/project/designer/property/expression/ExpressionEditor";
import { Tab, Tabs, TabTitleText, } from '@patternfly/react-core';
import { ErrorBoundaryWrapper } from "@shared/ui/ErrorBoundaryWrapper";
import React from 'react';
import { shallow } from "zustand/shallow";
import { useDesignerStore } from "@features/project/designer/DesignerStore";
import { MapperPanel } from "./MapperPanel";
import { isMapperStep } from "./mapper/mapperStepUtils";

export function MainPropertiesPanel() {

    const [activeTabKey, setActiveTabKey] = React.useState<string | number>("properties");
    const [selectedStep] = useDesignerStore((s) => [s.selectedStep], shallow);
    const pendingEditConnectionIdRef = React.useRef<string | null>(null);
    const activeTabKeyRef = React.useRef(activeTabKey);
    activeTabKeyRef.current = activeTabKey;

    React.useEffect(() => {
        if (selectedStep && isMapperStep(selectedStep)) {
            setActiveTabKey("mapper");
        }
    }, [(selectedStep as any)?.uuid]);

    const scheduleMapperEditDialog = React.useCallback((connectionId: string) => {
        window.setTimeout(() => {
            window.postMessage({
                type: "mapperSelectionAction",
                action: "editMapping",
                connectionId,
            });
        }, 80);
    }, []);

    const handleTabClick = (event: React.MouseEvent<any> | React.KeyboardEvent | MouseEvent, tabIndex: string | number) => {
        setActiveTabKey(tabIndex);
    };

    React.useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            const data = event.data;
            if (data?.command !== "focusMapperTab" || typeof data.connectionId !== "string") {
                return;
            }
            if (activeTabKeyRef.current === "mapper") {
                scheduleMapperEditDialog(data.connectionId);
                return;
            }
            pendingEditConnectionIdRef.current = data.connectionId;
            setActiveTabKey("mapper");
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [scheduleMapperEditDialog]);

    React.useEffect(() => {
        if (activeTabKey === "mapper") {
            vscode?.postMessage({ command: "openMapperSelectionPanel" });
            const connectionId = pendingEditConnectionIdRef.current;
            if (connectionId) {
                pendingEditConnectionIdRef.current = null;
                scheduleMapperEditDialog(connectionId);
            }
        }
    }, [activeTabKey, scheduleMapperEditDialog]);


    function getTab(title: string, icon: string, error: boolean = false) {
        const color = error ? "red" : "initial";
        return (
            <div className="top-menu-item" style={{color: color}}>
                <TabTitleText>{title}</TabTitleText>
            </div>
        )
    }

    function getPropertiesPanelTabs() {
        return (
            <div>
                <Tabs activeKey={activeTabKey}
                      onSelect={handleTabClick}
                      isFilled
                      aria-label="PropertyTypes"
                      role="proeprty-type"
                >
                    <Tab eventKey={'properties'} title={getTab('Properties', 'properties')} aria-label="Properties"/>
                    <Tab eventKey={'mapper'} title={getTab('Mapper', 'mapper')} aria-label="Mapper"/>
                </Tabs>
            </div>
        )
    }


    return (
        <div className={`main-properties ${activeTabKey === "mapper" ? "main-properties-mapper" : ""}`.trim()}>
            {getPropertiesPanelTabs()}
            <ErrorBoundaryWrapper onError={error => console.error(error)}>
                {activeTabKey === 'properties' && <DslProperties expressionEditor={ExpressionEditor}/> }
                {activeTabKey === 'mapper' && <MapperPanel/> }
            </ErrorBoundaryWrapper>
        </div>
    )

}
