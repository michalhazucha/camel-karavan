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
import { Alert } from "@patternfly/react-core";
import React from "react";
import { shallow } from "zustand/shallow";
import { useDesignerStore } from "../DesignerStore";
import { KaravanMapperMount } from "./mapper/KaravanMapperMount";
import { isMapperStep } from "./mapper/mapperStepUtils";

export { isMapperStep } from "./mapper/mapperStepUtils";

export function MapperPanel() {
    const [selectedStep] = useDesignerStore((s) => [s.selectedStep], shallow);
    const mapperStep = isMapperStep(selectedStep);

    if (!mapperStep) {
        return (
            <Alert isInline variant="info" title="Mapper is available for Transform and Mapper Activity steps.">
                Select a Transform step or Mapper Activity to load or edit XSLT mapping in this panel.
            </Alert>
        );
    }

    return <KaravanMapperMount />;
}
