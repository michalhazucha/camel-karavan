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
import { DslProperties } from "@features/project/designer/property/DslProperties";
import { ExpressionEditor } from "@features/project/designer/property/expression/ExpressionEditor";
import { Tab, Tabs, TabTitleText, } from '@patternfly/react-core';
import { ErrorBoundaryWrapper } from "@shared/ui/ErrorBoundaryWrapper";
import React from 'react';
import { MapperPanel } from "./MapperPanel";

export function MainPropertiesPanel() {

    const [activeTabKey, setActiveTabKey] = React.useState<string | number>("properties");
    const handleTabClick = (event: React.MouseEvent<any> | React.KeyboardEvent | MouseEvent, tabIndex: string | number) => {
        setActiveTabKey(tabIndex);
    };


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
        <div className='main-properties'>
            {getPropertiesPanelTabs()}
            <ErrorBoundaryWrapper onError={error => console.error(error)}>
                {activeTabKey === 'properties' && <DslProperties expressionEditor={ExpressionEditor}/> }
                {activeTabKey === 'mapper' && <MapperPanel/> }
            </ErrorBoundaryWrapper>
        </div>
    )

}
