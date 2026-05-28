"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { MappingTransformationType, type IMappingTransformation } from "@/lib/types"

import { useEffect, useState, type ChangeEvent } from "react"

interface TransformationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourcePath: string
  targetPath: string
  currentTransformation?: IMappingTransformation
  onSave: (transformation: IMappingTransformation) => void
}

export function TransformationDialog({
  open,
  onOpenChange,
  sourcePath,
  targetPath,
  currentTransformation = { type: MappingTransformationType.DIRECT },
  onSave,
}: TransformationDialogProps) {
  const [transformationType, setTransformationType] = useState<IMappingTransformation["type"]>(
    currentTransformation?.type
  )

  const transformationTypes=[{
    type: MappingTransformationType.DIRECT, label: "Direct Mapping"
  },{
    type: MappingTransformationType.FUNCTION, label: "Function / Custom XPath"
  },{
    type: MappingTransformationType.CONCAT, label: "Concatenation"
  },{
    type: MappingTransformationType.CONDITIONAL, label: "Conditional (if-then)"
  },{
    type: MappingTransformationType.VARIABLE, label: "Variable (before use)"
  },{
    type: MappingTransformationType.INLINE_VARIABLE, label: "Inline Variable (often use)"
  },{
    type: MappingTransformationType.NESTED_VARIABLE, label: "Nested Variable Structure"
  },{
    type: MappingTransformationType.LOGGER, label: "Logger (Response filtering)"
  }]


  const [expression, setExpression] = useState(currentTransformation?.customXPath || sourcePath)
  const [condition, setCondition] = useState(currentTransformation?.condition || "")
  const [variableName, setVariableName] = useState(currentTransformation?.variableName || "")
  const [variableExpression, setVariableExpression] = useState(
    currentTransformation?.variableExpression || ""
  )
  const [variablePosition, setVariablePosition] = useState(
    currentTransformation.variablePosition
  )

  useEffect(() => {
    if (!open) {
      return
    }
    setTransformationType(currentTransformation?.type || MappingTransformationType.DIRECT)
    setExpression(currentTransformation?.customXPath || sourcePath)
    setCondition(currentTransformation?.condition || "")
    setVariableName(currentTransformation?.variableName || "")
    setVariableExpression(currentTransformation?.variableExpression || "")
    setVariablePosition(currentTransformation?.variablePosition)
    setOuterElement(currentTransformation?.nestedStructure?.outerElement || "")
    setInnerElement(currentTransformation?.nestedStructure?.innerElement || "")
    setNestedVariableName(currentTransformation?.nestedStructure?.variableName || "")
    setNestedVariableExpression(currentTransformation?.nestedStructure?.variableExpression || "")
    setValueExpression(currentTransformation?.nestedStructure?.valueExpression || "")
    setSourceVariable(currentTransformation?.sourceVariable || "Start")
    setCopyNilAttributes(currentTransformation?.copyNilAttributes || false)
    setAddConditionalWrapper(currentTransformation?.addConditionalWrapper || false)
    setHardcodedValue(currentTransformation?.hardcodedValue || "")
  }, [open, currentTransformation, sourcePath])
  // For nested structure
  const [outerElement, setOuterElement] = useState(
    currentTransformation?.nestedStructure?.outerElement || ""
  )
  const [innerElement, setInnerElement] = useState(
    currentTransformation?.nestedStructure?.innerElement || ""
  )
  const [nestedVariableName, setNestedVariableName] = useState(
    currentTransformation?.nestedStructure?.variableName || ""
  )
  const [nestedVariableExpression, setNestedVariableExpression] = useState(
    currentTransformation?.nestedStructure?.variableExpression || ""
  )
  const [valueExpression, setValueExpression] = useState(
    currentTransformation?.nestedStructure?.valueExpression || ""
  )

  // For TIBCO Logger
  const [sourceVariable, setSourceVariable] = useState(
    currentTransformation?.sourceVariable || "Start"
  )
  const [copyNilAttributes, setCopyNilAttributes] = useState(
    currentTransformation?.copyNilAttributes || false
  )
  const [addConditionalWrapper, setAddConditionalWrapper] = useState(
    currentTransformation?.addConditionalWrapper || false
  )
  const [hardcodedValue, setHardcodedValue] = useState(
    currentTransformation?.hardcodedValue || ""
  )


  const handleSave = () => {
    const transformation: IMappingTransformation = {
      type: transformationType,
    }

    switch (transformationType) {
      case MappingTransformationType.DIRECT:
        transformation.customXPath = expression
        break

      case MappingTransformationType.FUNCTION:
        transformation.customXPath = expression
        break

      case MappingTransformationType.CONCAT:
        // Parse expression into parts (simple implementation)
        transformation.customXPath = expression
        break

      case MappingTransformationType.CONDITIONAL:
        transformation.condition = condition
        transformation.customXPath = expression
        break

      case MappingTransformationType.VARIABLE:
        transformation.variableName = variableName
        transformation.variableExpression = variableExpression
        transformation.variablePosition = variablePosition
        break

      case MappingTransformationType.INLINE_VARIABLE:
        transformation.variableName = variableName
        transformation.variableExpression = variableExpression
        break

      case MappingTransformationType.NESTED_VARIABLE:
        transformation.nestedStructure = {
          outerElement,
          innerElement,
          variableName: nestedVariableName,
          variableExpression: nestedVariableExpression,
          valueExpression,
        }
        break

      case MappingTransformationType.LOGGER:
        transformation.sourceVariable = sourceVariable
        transformation.copyNilAttributes = copyNilAttributes
        transformation.addConditionalWrapper = addConditionalWrapper
        if (hardcodedValue) {
          transformation.hardcodedValue = hardcodedValue
        }
        break
    }

    onSave(transformation)
    onOpenChange(false)
  }

  const expressionSetter=(e:ChangeEvent<HTMLInputElement>
)=>{
    e.preventDefault()
    setExpression(e.target.value)
  }

  const conditionSetter=(e:ChangeEvent<HTMLInputElement>)=>{
    e.preventDefault()
    setCondition(e.target.value)
  }

  const variableNameSetter=(e:ChangeEvent<HTMLInputElement>)=>{
    e.preventDefault()
    setVariableName(e.target.value)
  }

  const variableExpressionSetter=(e:ChangeEvent<HTMLTextAreaElement>
)=>{
    e.preventDefault()
    setVariableExpression(e.target.value)
  }

  const outerElementSetter =(e:ChangeEvent<HTMLInputElement>)=>{
    e.preventDefault()
    setOuterElement(e.target.value)
  }
  const innerElementSetter =(e:ChangeEvent<HTMLInputElement>)=>{
    e.preventDefault()
    setInnerElement(e.target.value)
  }

  const nestedVariableNameSetter =(e:ChangeEvent<HTMLInputElement>)=>{
    e.preventDefault()
    setNestedVariableName(e.target.value)
  }
  const nestedVariableExpressionSetter =(e:ChangeEvent<HTMLTextAreaElement>)=>{
    e.preventDefault()
    setNestedVariableExpression(e.target.value)
  }

  const valueExpressionSetter =(e:ChangeEvent<HTMLInputElement>)=>{
    e.preventDefault()
    setValueExpression(e.target.value)
  }

  const sourceVariableSetter =(e:ChangeEvent<HTMLInputElement>)=>{
    e.preventDefault()
    setSourceVariable(e.target.value)
  }

  const conditionWrapperAdder =(e:ChangeEvent<HTMLInputElement>
)=>{
    e.preventDefault()
    setAddConditionalWrapper(e.target.checked)
  }
  const hardcodedValueSetter =(e:ChangeEvent<HTMLInputElement>) =>{ setHardcodedValue(e.target.value)}
  return (
    <Dialog open={open} onOpenChange={onOpenChange} >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-zinc-550 text-zinc-100 border-zinc-800">
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-zinc-100">Configure Transformation</DialogTitle>
          <DialogDescription className="space-y-1 text-zinc-300">
            <div className="break-words">
              Source: <code className="text-sm bg-zinc-500 text-zinc-100 px-1 py-0.5 rounded break-all">{sourcePath}</code>
            </div>
            <div className="break-words">
              Target: <code className="text-sm bg-zinc-500 text-zinc-100 px-1 py-0.5 rounded break-all">{targetPath}</code>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Transformation Type */}
          <div className="grid gap-2">
            <Label htmlFor="type">Transformation Type</Label>
            <Select
              value={transformationType}
              onValueChange={(value) => setTransformationType(value as IMappingTransformation["type"])}
            >
              <SelectTrigger id="type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {transformationTypes.map((tt) => (
                  <SelectItem key={tt.type} value={tt.type}>{tt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(transformationType === MappingTransformationType.DIRECT ||
            transformationType === MappingTransformationType.FUNCTION ||
            transformationType === MappingTransformationType.CONCAT) && (
            <div className="grid gap-2">
              <Label htmlFor="expression">XPath Expression</Label>
              <Textarea
                id="expression"
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                placeholder="e.g., concat('PCR::', tib:timestamp(), '_', $processId)"
                rows={3}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {/* You can use also TIBCO functions*/}
                Use functions: timestamp(), tokenize(), concat(), etc.
              </p>
            </div>
          )}

          {/* Conditional */}
          {transformationType === "conditional" && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="condition">Condition (test)</Label>
                <Input
                  id="condition"
                  value={condition}
                  onChange={conditionSetter}
                  placeholder="e.g., string-length($value) > 0"
                  className="font-mono text-sm"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="expression">Expression (when true)</Label>
                <Input
                  id="expression"
                  value={expression}
                  onChange={expressionSetter}
                  placeholder="e.g., $Start/root/provider"
                  className="font-mono text-sm"
                />
              </div>
            </>
          )}

          {/* Variable / Inline Variable */}
          {(transformationType === MappingTransformationType.VARIABLE || transformationType === MappingTransformationType.INLINE_VARIABLE) && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="variableName">Variable Name</Label>
                <Input
                  id="variableName"
                  value={variableName}
                  onChange={(variableNameSetter)}
                  placeholder="e.g., pcrfTariff"
                  className="font-mono text-sm"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="variableExpression">Variable Expression</Label>
                <Textarea
                  id="variableExpression"
                  value={variableExpression}
                  onChange={variableExpressionSetter}
                  placeholder="e.g., if (string-length($volume) > 0) then concat($event, '_', $volume) else $event"
                  rows={3}
                  className="font-mono text-sm"
                />
              </div>
              {transformationType === MappingTransformationType.VARIABLE && (
                <div className="grid gap-2">
                  <Label htmlFor="variablePosition">Variable Position</Label>
                  <Select value={variablePosition} onValueChange={(v) => { if(v!==undefined){ setVariablePosition(v as IMappingTransformation["variablePosition"]) }}}>
                    <SelectTrigger id="variablePosition">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="before">Before Element (Standard)</SelectItem>
                      <SelectItem value="inline">Inline with Element</SelectItem>
                      <SelectItem value="after">After Element</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {transformationType === MappingTransformationType.INLINE_VARIABLE && (
                <p className="text-sm text-yellow-600 dark:text-yellow-500 bg-yellow-50 dark:bg-yellow-950 p-2 rounded">
                  {/*TIBCO STYLE Variable will be declared inline with the element */}
                  Variable will be declared AFTER the element that uses it!
                </p>
              )}
            </>
          )}

          {/* Nested Variable */}
          {transformationType === MappingTransformationType.NESTED_VARIABLE && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="outerElement">Outer Element</Label>
                  <Input
                    id="outerElement"
                    value={outerElement}
                    onChange={outerElementSetter}
                    placeholder="e.g., pfx9:amount"
                    className="font-mono text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="innerElement">Inner Element</Label>
                  <Input
                    id="innerElement"
                    value={innerElement}
                    onChange={innerElementSetter}
                    placeholder="e.g., ns6:value"
                    className="font-mono text-sm"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="nestedVariableName">Variable Name</Label>
                <Input
                  id="nestedVariableName"
                  value={nestedVariableName}
                  onChange={nestedVariableNameSetter}
                  placeholder="e.g., priceRecord"
                  className="font-mono text-sm"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="nestedVariableExpression">Variable Expression</Label>
                <Textarea
                  id="nestedVariableExpression"
                  value={nestedVariableExpression}
                  onChange={nestedVariableExpressionSetter}
                  placeholder="e.g., tib:tokenize($prices, '|')[1]"
                  rows={2}
                  className="font-mono text-sm"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="valueExpression">Value Expression</Label>
                <Input
                  id="valueExpression"
                  value={valueExpression}
                  onChange={valueExpressionSetter}
                  placeholder="e.g., substring-after($priceRecord, ':')"
                  className="font-mono text-sm"
                />
              </div>
            </>
          )}

          {/* Logger */}
          {transformationType === MappingTransformationType.LOGGER && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="sourceVariable">Source Variable Name</Label>
                <Input
                  id="sourceVariable"
                  value={sourceVariable}
                  onChange={sourceVariableSetter}
                  placeholder="e.g., fetchESimProfileStatusCore"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Variable name used in source XPath (default: "Start")
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="copyNilAttributes"
                  checked={copyNilAttributes}
                  onChange={(e) => setCopyNilAttributes(e.target.checked)}
                  className="rounded"
                />
                <Label htmlFor="copyNilAttributes" className="cursor-pointer">
                  Copy @xsi:nil attributes
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="addConditionalWrapper"
                  checked={addConditionalWrapper}
                  onChange={conditionWrapperAdder}
                  className="rounded"
                />
                <Label htmlFor="addConditionalWrapper" className="cursor-pointer">
                  Wrap optional elements in &lt;xsl:if&gt;
                </Label>concat(order/customer/firstName, ' ', order/customer/lastNam
              </div>
              <div className="grid gap-2">
                <Label htmlFor="hardcodedValue">Hardcoded Value (optional)</Label>
                <Input
                  id="hardcodedValue"
                  value={hardcodedValue}
                  onChange={hardcodedValueSetter}
                  placeholder="e.g., Omitted for logging"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Replace element value with this text (for security filtering)
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Transformation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
